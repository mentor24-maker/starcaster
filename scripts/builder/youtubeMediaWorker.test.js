'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Acquire YouTube, slice 1 — the server half of the .mp4/.mp3 acquire.
 *
 * The whole point of this slice is that it ships INERT: it lands on production
 * before any worker exists and before the migration has run, and neither of
 * those absences may be visible to anyone using the Acquire screen. So the
 * three things pinned here are all about behaviour when the pieces are missing:
 *
 *  - the worker client never throws, it returns a status you can render;
 *  - the route says 503 with an actionable message rather than 500 or a hang;
 *  - the video store treats a missing COLUMN as a soft failure, so code
 *    deployed ahead of the migration degrades to unsaved-but-working instead
 *    of failing every upsert and taking the video repository down with it.
 */

// ── A response object shaped like the bits routes/http.js actually touches ──

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    ended: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(chunk) { this.body = chunk == null ? '' : String(chunk); this.ended = true; },
  };
  return res;
}

function fakeReq(method, url, body) {
  return {
    method,
    url,
    body,
    headers: { host: 'localhost:3001', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    connection: { remoteAddress: '127.0.0.1' },
  };
}

function payloadOf(res) {
  try { return JSON.parse(res.body); } catch { return null; }
}

// The worker is configured through env OR Settings > APIs. Every test here
// wants it UNconfigured, and env wins, so blank the env for the whole file.
const MEDIA_ENV = [
  'YOUTUBE_MEDIA_WORKER_URL',
  'YOUTUBE_MEDIA_WORKER_TOKEN',
  'YOUTUBE_MEDIA_WORKER_TIMEOUT_MS',
  'YOUTUBE_MEDIA_WORKER_ENABLED',
];
for (const key of MEDIA_ENV) delete process.env[key];

// ── The worker client ──────────────────────────────────────────────────────

test('worker client reports unconfigured rather than throwing', async (t) => {
  const worker = require('../../lib/acquire/YoutubeMediaWorker');

  await t.test('isConfigured() is false with no URL and no token', () => {
    assert.equal(worker.isConfigured(), false);
  });

  await t.test('a URL with no shared secret is still not configured', () => {
    process.env.YOUTUBE_MEDIA_WORKER_URL = 'https://worker.example.com';
    assert.equal(worker.isConfigured(), false, 'a worker with no secret must not count as configured');
    delete process.env.YOUTUBE_MEDIA_WORKER_URL;
  });

  await t.test('both halves present makes it configured', () => {
    process.env.YOUTUBE_MEDIA_WORKER_URL = 'https://worker.example.com';
    process.env.YOUTUBE_MEDIA_WORKER_TOKEN = 'shhh';
    assert.equal(worker.isConfigured(), true);
    delete process.env.YOUTUBE_MEDIA_WORKER_URL;
    delete process.env.YOUTUBE_MEDIA_WORKER_TOKEN;
  });

  await t.test('startMediaJob resolves with ok:false instead of rejecting', async () => {
    const started = await worker.startMediaJob({ videoUrl: 'https://youtu.be/abc' });
    assert.equal(started.ok, false);
    assert.equal(started.status, 'worker-unconfigured', 'the caller renders this tag, so it names the actual cause');
    assert.equal(started.job_id, '');
    assert.equal(started.mp4, null);
    assert.equal(started.mp3, null);
  });

  await t.test('startMediaJob rejects a blank URL before reaching the network', async () => {
    const started = await worker.startMediaJob({ videoUrl: '  ' });
    assert.equal(started.ok, false);
    assert.equal(started.status, 'invalid-input');
    assert.match(started.error, /URL is required/i);
  });

  await t.test('getMediaJob resolves with ok:false instead of rejecting', async () => {
    const job = await worker.getMediaJob('job_1');
    assert.equal(job.ok, false);
    assert.equal(job.status, 'worker-unconfigured');
  });
});

// ── The routes ─────────────────────────────────────────────────────────────

test('POST /api/acquire/youtube-media without a worker', async (t) => {
  const { handle } = require('../../routes/acquire');

  await t.test('answers 503 and names where to configure it', async () => {
    const res = fakeRes();
    const handled = await handle(
      fakeReq('POST', '/api/acquire/youtube-media', { video_url: 'https://youtu.be/abc' }),
      res,
      '/api/acquire/youtube-media',
      'POST'
    );
    assert.equal(handled, true, 'the route must claim the request');
    assert.equal(res.statusCode, 503, 'an absent worker is "not available yet", never a 500');
    const payload = payloadOf(res);
    assert.equal(payload.ok, false);
    assert.match(
      payload.error.message,
      /Settings > APIs/,
      'the message has to tell the operator where to fix it, not just that it broke'
    );
  });

  await t.test('a missing video_url is a 400, checked before the worker', async () => {
    const res = fakeRes();
    await handle(
      fakeReq('POST', '/api/acquire/youtube-media', {}),
      res,
      '/api/acquire/youtube-media',
      'POST'
    );
    assert.equal(res.statusCode, 400);
  });
});

test('the media routes are registered under the acquire prefix', () => {
  const { manifest } = require('../../routes/acquire');
  assert.ok(
    manifest.prefixes.some((prefix) => '/api/acquire/youtube-media'.startsWith(prefix)),
    'both media routes have to fall inside a prefix the dispatcher forwards here'
  );
});

// ── Deployed-ahead-of-the-migration tolerance ──────────────────────────────

test('the video store treats a missing media column as a soft failure', async (t) => {
  const store = require('../../lib/acquire/YoutubeVideosStore');

  await t.test('carries the media fields onto a new record', () => {
    const record = store.makeVideoRecordId('abc123', 'https://youtu.be/abc123');
    assert.equal(typeof record, 'string');
    assert.ok(record.length > 0, 'a record id is what every media write is keyed by');
  });

  // isMissingTableError is internal, so the widening is pinned through the
  // observable consequence: a PostgREST "column does not exist" error is the
  // exact shape production returns between this deploy and slice 4's migration.
  await t.test('a PostgREST missing-column error is recognisable as schema-not-ready', () => {
    const source = require('node:fs').readFileSync(
      require.resolve('../../lib/acquire/YoutubeVideosStore.js'),
      'utf8'
    );
    assert.match(
      source,
      /column .\*+ does not exist/,
      'missing COLUMN must be soft too, not just missing table — otherwise every upsert fails until the migration runs'
    );
    assert.match(source, /could not find the '\[\^'\]\+' column/);
  });

  await t.test('media_status defaults to none, matching the check constraint', () => {
    const sql = require('node:fs').readFileSync(
      require.resolve('../../supabase/migrations/20260730000001_acquire_youtube_video_media.sql'),
      'utf8'
    );
    assert.match(sql, /media_status text not null default 'none'/);
    assert.match(
      sql,
      /check \(media_status in \('none', 'queued', 'running', 'done', 'failed'\)\)/,
      'the states the route writes and the states the column allows must be the same list'
    );
    for (const column of ['media_status', 'media_job_id', 'media_mp4_url', 'media_mp3_url', 'media_error']) {
      assert.match(sql, new RegExp(`add column if not exists ${column}\\b`), `${column} must be idempotent`);
    }
  });
});
