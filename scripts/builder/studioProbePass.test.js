'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

/**
 * Studio Phase 1 operational · 2 of 5 (86bccuqpv) — the probe pass.
 *
 * Real SQLite queue, real files, real ffprobe; the catalog is faked because a
 * test that needs a live database is a test nobody runs. The probe itself is
 * NOT faked on the success path: the claim this ticket makes is that a real
 * container's duration, frame rate and device reach the row, and a stubbed
 * probe would only prove the stub was written to agree with the pass.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const { PROBE_FAILURES } = require('../../workers/studio/probe.js');
const {
  runProbe,
  enqueueProbe,
  probePatch,
  STAGE_PROBE,
} = require('../../workers/studio/probePass.js');
const { tickOnce, STAGE_RUNNERS } = require('../../workers/studio/daemon.js');

const PROJECT = 'proj_studio';
const OWNER = 'probe-test';
const ENV = { STUDIO_PROJECT_ID: PROJECT };

const FFMPEG = process.env.STUDIO_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.STUDIO_FFPROBE || 'ffprobe';
function toolWorks(bin) {
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return !res.error && Number(res.status) === 0;
}
const HAVE_FFMPEG = toolWorks(FFMPEG) && toolWorks(FFPROBE);

test('ffmpeg and ffprobe are installed, or the real-media proof below is not being taken', () => {
  // A skip nobody sees is a pass that proved nothing — the same rule
  // studioProbeLanes.test.js holds, with the same typed escape hatch.
  if (process.env.STUDIO_ALLOW_NO_FFMPEG === '1') return;
  assert.ok(HAVE_FFMPEG, `ffmpeg/ffprobe not runnable (${FFMPEG} / ${FFPROBE}). `
    + 'Install it (`brew install ffmpeg` / `sudo apt-get install -y ffmpeg`) '
    + 'or set STUDIO_ALLOW_NO_FFMPEG=1 to say this machine is not taking the reading.');
});

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-probe-pass-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tmpQueue(t) {
  const queue = openQueue(path.join(tmpDir(t), 'queue.sqlite'));
  t.after(() => queue.close());
  return queue;
}

/** A one-second iPhone-shaped clip with its own recording date. */
function makeIphoneClip(dir, name = 'clip.mov') {
  const out = path.join(dir, name);
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', 'use_metadata_tags',
    '-metadata', 'com.apple.quicktime.make=Apple',
    '-metadata', 'com.apple.quicktime.model=iPhone 15 Pro',
    '-metadata', 'com.apple.quicktime.creationdate=2026-08-01T12:34:56-0400',
    out,
  ]);
  return out;
}

/** The catalog in memory, in the stores' envelopes. */
function fakeCatalog(rows) {
  const sources = rows.map((r) => ({ projectId: PROJECT, state: 'downloaded', ...r }));
  const updates = [];
  return {
    sources,
    updates,
    getSourceById: async (id) => {
      const found = sources.find((s) => s.id === id);
      return found ? { ok: true, status: 200, data: { ...found } } : { ok: false, status: 404, error: 'Source not found' };
    },
    updateSource: async (id, patch) => {
      updates.push({ id, patch });
      const found = sources.find((s) => s.id === id);
      if (!found) return { ok: false, status: 404, error: 'Source not found' };
      Object.assign(found, patch);
      return { ok: true, status: 200, data: { ...found } };
    },
  };
}

// ── The real thing ──────────────────────────────────────────────────────────

test('a real clip is probed: duration, fps, device and its own recording date reach the row, and it reads back probed',
  { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async (t) => {
    const dir = tmpDir(t);
    const file = makeIphoneClip(dir);
    const queue = tmpQueue(t);
    // Ingest stored Drive's upload date; the container knows better.
    const catalog = fakeCatalog([{ id: 'src_1', localPath: file, recordedAt: '2026-09-15T04:00:00.000Z' }]);
    enqueueProbe(queue, { sourceId: 'src_1', localPath: file, sourcePath: '/Studio/Inbox/clip.mov' });

    const report = await runProbe({ queue, owner: OWNER, catalog, env: ENV });
    assert.equal(report.probed.length, 1, JSON.stringify(report, null, 2));
    const row = catalog.sources[0];
    assert.equal(row.state, 'probed');
    assert.ok(Math.abs(row.durationS - 1) < 0.1, `about a second long, got ${row.durationS}`);
    assert.equal(row.fps, 30);
    assert.equal(row.deviceLane, 'iphone');
    assert.equal(row.width, 640);
    assert.equal(row.height, 360);
    assert.equal(row.codec, 'h264');
    assert.equal(row.recordedAt, '2026-08-01T16:34:56.000Z',
      "the container's own date replaced Drive's upload date");
    assert.equal(queue.listJobs({ stage: STAGE_PROBE })[0].state, 'done');
  });

test('a plate is placed by its Drive folder, not by the camera tags',
  { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async (t) => {
    const file = makeIphoneClip(tmpDir(t), 'wide.mov');
    const queue = tmpQueue(t);
    const catalog = fakeCatalog([{ id: 'src_1', localPath: file }]);
    enqueueProbe(queue, { sourceId: 'src_1', localPath: file, sourcePath: '/Studio/Plates/wide.mov' });
    await runProbe({ queue, owner: OWNER, catalog, env: ENV });
    assert.equal(catalog.sources[0].deviceLane, 'plate');
  });

// ── What goes wrong ─────────────────────────────────────────────────────────

test('a file missing from disk ends FAILED with a reason a person can read', async (t) => {
  const queue = tmpQueue(t);
  const gone = path.join(tmpDir(t), 'nowhere.mov');
  const catalog = fakeCatalog([{ id: 'src_1', localPath: gone }]);
  enqueueProbe(queue, { sourceId: 'src_1', localPath: gone });

  const report = await runProbe({ queue, owner: OWNER, catalog, env: ENV });
  assert.equal(report.failed.length, 1);
  assert.equal(catalog.sources[0].state, 'failed', 'the row says so, not "downloaded" forever');
  const job = queue.listJobs({ stage: STAGE_PROBE })[0];
  assert.match(job.lastError, /is not on disk at .*nowhere\.mov/);
  assert.match(job.lastError, /re-ingest/i, 'and it says what to do');
  assert.equal(job.state, 'pending', "through the queue's own retry rules, not dropped");
  assert.equal(job.attempts, 1);
});

test('a corrupt file ends FAILED with ffprobe\'s own complaint kept',
  { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async (t) => {
    const junk = path.join(tmpDir(t), 'broken.mov');
    fs.writeFileSync(junk, 'this is not a video');
    const queue = tmpQueue(t);
    const catalog = fakeCatalog([{ id: 'src_1', localPath: junk }]);
    enqueueProbe(queue, { sourceId: 'src_1', localPath: junk });

    await runProbe({ queue, owner: OWNER, catalog, env: ENV });
    assert.equal(catalog.sources[0].state, 'failed');
    const job = queue.listJobs({ stage: STAGE_PROBE })[0];
    assert.match(job.lastError, /ffprobe could not read the file for source src_1/);
    assert.match(job.lastError, /broken\.mov/);
  });

test('ffprobe NOT INSTALLED is a fact about the machine: the file is not marked failed and no attempt is spent', async (t) => {
  const file = path.join(tmpDir(t), 'fine.mov');
  fs.writeFileSync(file, 'x');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', localPath: file }]);
  enqueueProbe(queue, { sourceId: 'src_1', localPath: file });
  const probe = () => ({ ok: false, reason: PROBE_FAILURES.MISSING, message: 'ffprobe is not installed on this machine' });

  const report = await runProbe({ queue, owner: OWNER, catalog, env: ENV, probe });
  assert.equal(report.released.length, 1);
  assert.equal(catalog.sources[0].state, 'downloaded', 'a missing tool is not broken footage');
  assert.equal(catalog.updates.length, 0);
  const job = queue.listJobs({ stage: STAGE_PROBE })[0];
  assert.equal(job.state, 'pending');
  assert.equal(job.attempts, 0);
});

test('a write that "succeeds" but does not stick is caught by the read-back', async (t) => {
  const file = path.join(tmpDir(t), 'fine.mov');
  fs.writeFileSync(file, 'x');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', localPath: file }]);
  catalog.updateSource = async (id) => ({ ok: true, status: 200, data: { id } }); // 200, stores nothing
  enqueueProbe(queue, { sourceId: 'src_1', localPath: file });
  const probe = () => ({ ok: true, lane: 'zoom', media: { durationSec: 12.5, fps: 25 } });

  const report = await runProbe({ queue, owner: OWNER, catalog, env: ENV, probe });
  assert.equal(report.blocked.length, 1, JSON.stringify(report, null, 2));
  assert.match(report.blocked[0].reason, /reads back as state "downloaded"/);
  assert.equal(queue.listJobs({ stage: STAGE_PROBE })[0].state, 'blocked');
});

test('an unreadable value is left OUT of the patch, never written as null over what the row had', () => {
  const patch = probePatch({ ok: true, lane: 'unknown', media: { durationSec: 3, fps: null, displayWidth: null, recordedAt: null } });
  assert.deepEqual(patch, { state: 'probed', deviceLane: 'unknown', durationS: 3 });
});

// ── The daemon ──────────────────────────────────────────────────────────────

test('the probe stage is registered, so a probe job is run rather than reported as unhandled', () => {
  assert.ok(STAGE_RUNNERS[STAGE_PROBE], 'probe has a runner in workers/studio/daemon.js');
});

test('a probe that fails does not stop the daemon: the tick reports it and the next tick runs', async (t) => {
  const queue = tmpQueue(t);
  const dir = tmpDir(t);
  const fine = path.join(dir, 'fine.mov');
  fs.writeFileSync(fine, 'x');
  const catalog = fakeCatalog([
    { id: 'src_bad', localPath: path.join(dir, 'missing.mov') },
    { id: 'src_ok', localPath: fine },
  ]);
  enqueueProbe(queue, { sourceId: 'src_bad' });
  enqueueProbe(queue, { sourceId: 'src_ok' });
  const runners = {
    [STAGE_PROBE]: {
      label: 'probe',
      run: ({ queue: q, owner, env }) => runProbe({
        queue: q, owner, env, catalog, probe: () => ({ ok: true, lane: 'zoom', media: { durationSec: 4 } }),
      }),
    },
  };

  const first = await tickOnce({ queue, owner: OWNER, env: ENV, runners, watchers: {} });
  assert.equal(first.error, null);
  assert.equal(first.worked, true);
  assert.equal(catalog.sources[0].state, 'failed');

  const second = await tickOnce({ queue, owner: OWNER, env: ENV, runners, watchers: {} });
  assert.equal(second.worked, true, 'the lane kept going');
  assert.equal(catalog.sources[1].state, 'probed');
});
