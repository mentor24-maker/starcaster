'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

/**
 * Acquire YouTube 3/4 — the worker service on the other end of
 * lib/acquire/YoutubeMediaWorker.js.
 *
 * This BOOTS THE REAL SERVER and talks to it over HTTP. The two things worth
 * proving without a network or a real download are the two the client depends
 * on absolutely:
 *
 *   1. `POST /jobs` returns a job id IMMEDIATELY. The whole design rests on
 *      that — a video takes minutes and the caller is a serverless function
 *      that will be frozen long before it finishes. A server that waited for
 *      the download would look fine in a hand test on a 20-second clip and
 *      fail on everything real.
 *   2. A wrong or missing secret is refused. This endpoint downloads whatever
 *      URL it is handed, so an open one is a stranger's transcoding farm.
 *
 * yt-dlp and ffmpeg are NOT installed on this machine, so the download itself
 * is not exercised here — a fake yt-dlp on PATH stands in, and the test says
 * so rather than implying coverage it does not have.
 */

const SERVER = path.resolve(__dirname, '../../workers/youtube-media/server.js');
const SECRET = 'test-secret-value';

/** A stand-in yt-dlp that exits non-zero, so a job starts and then fails —
 *  enough to prove the request returned before the work did. */
function fakeBinDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytw-bin-'));
  for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, '#!/bin/sh\necho "fake ' + name + '" >&2\nexit 1\n');
    fs.chmodSync(p, 0o755);
  }
  return dir;
}

async function startWorker(env = {}) {
  const bin = fakeBinDir();
  const port = 8100 + Math.floor(Number(process.hrtime.bigint() % 400n));
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PORT: String(port),
      WORKER_SHARED_SECRET: SECRET,
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_TESTTOKEN',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += String(d); });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) break;
    try {
      await fetch(`${base}/health`);
      return { child, base, bin, stderr: () => stderr };
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return { child, base, bin, stderr: () => stderr, failed: true };
}

function stop(w) {
  try { w.child.kill('SIGKILL'); } catch { /* already gone */ }
  try { fs.rmSync(w.bin, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ── It refuses to run unauthenticated at all ─────────────────────────────

test('the worker refuses to start with no shared secret', async () => {
  // Not "starts and allows everything" — refuses. An unauthenticated worker
  // that boots is worse than one that does not, because it looks healthy.
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WORKER_SHARED_SECRET: '', BLOB_READ_WRITE_TOKEN: 'x', PORT: '8099' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (d) => { err += String(d); });
  // Bounded: a server that WRONGLY boots would otherwise hang this test
  // forever waiting for an exit that never comes. A hang is a failure, but a
  // timeout that names the reason is a much better one.
  const code = await Promise.race([
    new Promise((resolve) => child.on('exit', resolve)),
    new Promise((resolve) => setTimeout(() => resolve('STILL_RUNNING'), 5000)),
  ]);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  assert.notEqual(code, 'STILL_RUNNING', 'it booted anyway — an unauthenticated worker must never start');
  assert.notEqual(code, 0, 'it must exit non-zero');
  assert.match(err, /WORKER_SHARED_SECRET is required/);
});

test('the worker refuses to start with nowhere to upload', async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WORKER_SHARED_SECRET: 's', BLOB_READ_WRITE_TOKEN: '', PORT: '8098' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (d) => { err += String(d); });
  const code = await Promise.race([
    new Promise((resolve) => child.on('exit', resolve)),
    new Promise((resolve) => setTimeout(() => resolve('STILL_RUNNING'), 5000)),
  ]);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  assert.notEqual(code, 'STILL_RUNNING', 'it booted with nowhere to upload');
  assert.notEqual(code, 0);
  assert.match(err, /BLOB_READ_WRITE_TOKEN is required/);
});

// ── The wire the client already speaks ───────────────────────────────────

test('POST /jobs returns a job id immediately, before any download finishes', async (t) => {
  const w = await startWorker();
  t.after(() => stop(w));
  assert.ok(!w.failed, `worker did not start: ${w.stderr()}`);

  const started = Date.now();
  const res = await fetch(`${w.base}/jobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', formats: ['mp4', 'mp3'] }),
  });
  const elapsed = Date.now() - started;

  // The client (lib/acquire/YoutubeMediaWorker.js) gates on `response.ok`, so
  // any 2xx satisfies the contract. The server answers 202 Accepted, which is
  // the right code for "taken, not finished" and is pinned here so a change to
  // a plain 200 is a deliberate one rather than a drift.
  assert.ok(res.ok, `the client requires a 2xx, got ${res.status}: ${await res.clone().text()}`);
  assert.equal(res.status, 202, 'an accepted-but-unfinished job is a 202');

  const body = await res.json();
  // Exactly the two fields lib/acquire/YoutubeMediaWorker.js reads off the
  // start call. A rename on either side breaks the acquire silently.
  assert.ok(body.job_id, 'the client refuses a start with no job_id');
  assert.ok(body.status, 'the client falls back to "queued" but the field must exist');
  assert.ok(elapsed < 3000, `must return immediately, took ${elapsed}ms`);
});

test('GET /jobs/:id answers with the shape the client destructures', async (t) => {
  const w = await startWorker();
  t.after(() => stop(w));
  assert.ok(!w.failed, `worker did not start: ${w.stderr()}`);

  const start = await fetch(`${w.base}/jobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
  });
  const { job_id: jobId } = await start.json();

  const poll = await fetch(`${w.base}/jobs/${jobId}`, { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(poll.status, 200);
  const body = await poll.json();
  for (const field of ['status', 'progress', 'mp4', 'mp3', 'error']) {
    assert.ok(field in body, `the client reads .${field} off every poll`);
  }
});

test('an unknown job id is a 404, not a fabricated job', async (t) => {
  const w = await startWorker();
  t.after(() => stop(w));
  const res = await fetch(`${w.base}/jobs/no-such-job`, { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 404);
});

// ── The secret ───────────────────────────────────────────────────────────

test('a wrong secret is refused', async (t) => {
  const w = await startWorker();
  t.after(() => stop(w));
  const res = await fetch(`${w.base}/jobs`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-secret-value', 'content-type': 'application/json' },
    body: JSON.stringify({ video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
  });
  assert.equal(res.status, 401);
});

test('a missing Authorization header is refused', async (t) => {
  const w = await startWorker();
  t.after(() => stop(w));
  const res = await fetch(`${w.base}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
  });
  assert.equal(res.status, 401);
});

test('polling is protected too, not just starting', async (t) => {
  // An open GET would let a stranger read back what has been downloaded and
  // where it was uploaded.
  const w = await startWorker();
  t.after(() => stop(w));
  const res = await fetch(`${w.base}/jobs/anything`);
  assert.equal(res.status, 401);
});

test('a secret of a different LENGTH is refused, not crashed on', async (t) => {
  // timingSafeEqual throws on unequal buffer lengths; the length check in
  // front of it is what stops a short token 500-ing instead of 401-ing.
  const w = await startWorker();
  t.after(() => stop(w));
  const res = await fetch(`${w.base}/jobs/anything`, { headers: { authorization: 'Bearer x' } });
  assert.equal(res.status, 401, 'a short token must be refused, not throw');
});
