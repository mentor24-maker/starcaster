'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

/**
 * Studio Phase 1 operational · 3 of 5 (86bccuqpw) — the proxy pass.
 *
 * Real SQLite queue, real files, real ffmpeg on the success path; the catalog
 * is faked, as in studioProbePass.test.js. The claim this ticket makes is that
 * a real file ends with real working copies on disk and its row reads back
 * `ready` — a stubbed encoder would only prove the stub agreed with the pass.
 */

const { openQueue, DEFAULT_LEASE_MS } = require('../../workers/studio/queue.js');
const { FAILURES, encodeTimeoutMs } = require('../../workers/studio/proxy.js');
const {
  runProxy,
  enqueueProxy,
  leaseForEncode,
  laneFor,
  STAGE_PROXY,
} = require('../../workers/studio/proxyPass.js');
const { runProbe, enqueueProbe } = require('../../workers/studio/probePass.js');
const { STAGE_RUNNERS } = require('../../workers/studio/daemon.js');

const PROJECT = 'proj_studio';
const OWNER = 'proxy-test';

const FFMPEG = process.env.STUDIO_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.STUDIO_FFPROBE || 'ffprobe';
function toolWorks(bin) {
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return !res.error && Number(res.status) === 0;
}
const HAVE_FFMPEG = toolWorks(FFMPEG) && toolWorks(FFPROBE);

test('ffmpeg and ffprobe are installed, or the real-media proof below is not being taken', () => {
  if (process.env.STUDIO_ALLOW_NO_FFMPEG === '1') return;
  assert.ok(HAVE_FFMPEG, `ffmpeg/ffprobe not runnable (${FFMPEG} / ${FFPROBE}). `
    + 'Install it (`brew install ffmpeg` / `sudo apt-get install -y ffmpeg`) '
    + 'or set STUDIO_ALLOW_NO_FFMPEG=1 to say this machine is not taking the reading.');
});

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-proxy-pass-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tmpQueue(t, options) {
  const queue = openQueue(path.join(tmpDir(t), 'queue.sqlite'), options);
  t.after(() => queue.close());
  return queue;
}

/** One second of picture and sound, 8-bit H.264 — the "already ordinary" shape. */
function makeClip(dir, name = 'clip.mov') {
  const out = path.join(dir, name);
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    out,
  ]);
  return out;
}

function fakeCatalog(rows) {
  const sources = rows.map((r) => ({ projectId: PROJECT, state: 'probed', ...r }));
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

/** A build that reports every copy made, without running ffmpeg. */
function fakeBuild(onBuild = () => {}) {
  return (opts) => {
    onBuild(opts);
    return {
      ok: true,
      outputs: { proxy: { action: 'encoded', path: path.join(opts.derivedDir || '/derived', 'proxy.mp4') } },
      failures: [],
    };
  };
}

function envFor(dir, extra = {}) {
  return { STUDIO_PROJECT_ID: PROJECT, STUDIO_DERIVED_DIR: path.join(dir, 'derived'), ...extra };
}

// ── The real thing ──────────────────────────────────────────────────────────

test('a real clip gets a real proxy, WAV and contact sheet, and its row reads back ready',
  { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async (t) => {
    const dir = tmpDir(t);
    const file = makeClip(dir);
    const queue = tmpQueue(t);
    const catalog = fakeCatalog([{ id: 'src_1', localPath: file, durationS: 1 }]);
    enqueueProxy(queue, { sourceId: 'src_1', localPath: file });

    // A floor of 1 kbps forces an encode: this clip is small enough that the
    // default floor would (rightly) use the original directly.
    const env = envFor(dir, { STUDIO_PROXY_FLOOR_KBPS: '1' });
    const report = await runProxy({ queue, owner: OWNER, catalog, env });
    assert.equal(report.ready.length, 1, JSON.stringify(report, null, 2));

    const row = catalog.sources[0];
    assert.equal(row.state, 'ready');
    const outDir = path.join(dir, 'derived', 'inbox', 'src_1');
    assert.equal(row.proxyPath, path.join(outDir, 'proxy.mp4'));
    assert.ok(fs.statSync(row.proxyPath).size > 0, 'the proxy is on disk');
    assert.ok(fs.statSync(path.join(outDir, 'analysis-16k.wav')).size > 0, 'the WAV is on disk');
    assert.ok(fs.statSync(path.join(outDir, 'contact-sheet.jpg')).size > 0, 'the contact sheet is on disk');
    assert.equal(queue.listJobs({ stage: STAGE_PROXY })[0].state, 'done');
  });

test('a small, ordinary file is used directly — still ready, with the ORIGINAL as its proxy',
  { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async (t) => {
    const dir = tmpDir(t);
    const file = makeClip(dir);
    const queue = tmpQueue(t);
    const catalog = fakeCatalog([{ id: 'src_1', localPath: file, durationS: 1 }]);
    enqueueProxy(queue, { sourceId: 'src_1', localPath: file });

    const report = await runProxy({ queue, owner: OWNER, catalog, env: envFor(dir) });
    assert.equal(report.ready.length, 1, JSON.stringify(report, null, 2));
    assert.equal(report.ready[0].proxyAction, 'skipped');
    assert.equal(catalog.sources[0].state, 'ready');
    assert.equal(catalog.sources[0].proxyPath, file, 'a skipped proxy points at the original, never blank');
  });

test('a probed file is handed to the proxy pass, once, however often the probe re-runs',
  { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async (t) => {
    const dir = tmpDir(t);
    const file = makeClip(dir);
    const queue = tmpQueue(t);
    const catalog = fakeCatalog([{ id: 'src_1', localPath: file, state: 'downloaded' }]);

    enqueueProbe(queue, { sourceId: 'src_1', localPath: file });
    await runProbe({ queue, owner: OWNER, catalog, env: envFor(dir) });
    enqueueProbe(queue, { sourceId: 'src_1', localPath: file });
    await runProbe({ queue, owner: OWNER, catalog, env: envFor(dir) });

    const live = queue.listJobs({ stage: STAGE_PROXY }).filter((j) => j.state === 'pending' || j.state === 'running');
    assert.equal(live.length, 1, 'one proxy job for one source');
    assert.equal(live[0].subjectId, 'src_1');
  });

test('plates get their copies too, filed apart from footage', () => {
  assert.equal(laneFor({ deviceLane: 'plate' }), 'plates');
  assert.equal(laneFor({ deviceLane: 'iphone' }), 'inbox');
  assert.equal(laneFor({}), 'inbox');
});

// ── The lease ───────────────────────────────────────────────────────────────

test('a long encode keeps its job: no other worker can reap it and start the same encode', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'long.mov');
  fs.writeFileSync(file, 'x');
  let now = 1_000_000;
  const queue = tmpQueue(t, { clock: () => now });
  const durationS = 3226; // the measured length of the August test session
  const catalog = fakeCatalog([{ id: 'src_1', localPath: file, durationS }]);
  enqueueProxy(queue, { sourceId: 'src_1', localPath: file });

  let stolen = null;
  const build = fakeBuild(() => {
    // Mid-encode: well past the default lease, short of the encode's own timeout.
    now += DEFAULT_LEASE_MS * 10;
    queue.reap();
    stolen = queue.claim('another-worker', { stages: [STAGE_PROXY] });
  });

  const report = await runProxy({ queue, owner: OWNER, catalog, env: envFor(dir), build });
  assert.equal(stolen, null, 'the job was not handed out again while it was being encoded');
  assert.equal(report.ready.length, 1, JSON.stringify(report, null, 2));
  assert.equal(queue.listJobs({ stage: STAGE_PROXY })[0].state, 'done');
});

test('the lease covers every encode the source can need, sized to its length', () => {
  assert.ok(leaseForEncode(3226) >= 3 * encodeTimeoutMs(3226));
  assert.ok(leaseForEncode(3226, { decodeMode: 'hardware' }) > leaseForEncode(3226));
  assert.ok(leaseForEncode(null) >= 3 * encodeTimeoutMs(0), 'an unknown length still gets the floor');
});

test('a job that is no longer ours is left alone: nothing is encoded', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'f.mov');
  fs.writeFileSync(file, 'x');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', localPath: file, durationS: 5 }]);
  enqueueProxy(queue, { sourceId: 'src_1', localPath: file });
  let built = false;
  const realHeartbeat = queue.heartbeat;
  queue.heartbeat = () => false; // reaped and re-claimed between claim and encode
  t.after(() => { queue.heartbeat = realHeartbeat; });

  const report = await runProxy({ queue, owner: OWNER, catalog, env: envFor(dir), build: fakeBuild(() => { built = true; }) });
  assert.equal(built, false);
  assert.equal(report.lost.length, 1);
  assert.equal(catalog.updates.length, 0);
});

// ── What goes wrong ─────────────────────────────────────────────────────────

test('an encode that fails marks the row FAILED and keeps ffmpeg\'s reason on the job', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'f.mov');
  fs.writeFileSync(file, 'x');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', localPath: file, durationS: 5 }]);
  enqueueProxy(queue, { sourceId: 'src_1', localPath: file });
  const build = () => ({
    ok: false,
    outputs: {},
    failures: [{ output: 'proxy', reason: FAILURES.FFMPEG_FAILED, detail: 'Invalid data found when processing input' }],
  });

  const report = await runProxy({ queue, owner: OWNER, catalog, env: envFor(dir), build });
  assert.equal(report.failed.length, 1);
  assert.equal(catalog.sources[0].state, 'failed');
  const job = queue.listJobs({ stage: STAGE_PROXY })[0];
  assert.match(job.lastError, /proxy: Invalid data found/);
  assert.equal(job.state, 'pending', "through the queue's retry rules, not dropped");
  assert.equal(job.attempts, 1);
});

test('ffmpeg NOT INSTALLED is a fact about the machine: the row is untouched and no attempt is spent', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'f.mov');
  fs.writeFileSync(file, 'x');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', localPath: file, durationS: 5 }]);
  enqueueProxy(queue, { sourceId: 'src_1', localPath: file });
  const build = () => ({
    ok: false,
    outputs: {},
    failures: [{ output: 'proxy', reason: FAILURES.FFMPEG_MISSING, detail: 'ffmpeg is not installed or not on PATH' }],
  });

  const report = await runProxy({ queue, owner: OWNER, catalog, env: envFor(dir), build });
  assert.equal(report.released.length, 1);
  assert.equal(catalog.sources[0].state, 'probed');
  assert.equal(catalog.updates.length, 0);
  const job = queue.listJobs({ stage: STAGE_PROXY })[0];
  assert.equal(job.state, 'pending');
  assert.equal(job.attempts, 0);
});

test('a file missing from disk ends FAILED with a reason a person can read', async (t) => {
  const queue = tmpQueue(t);
  const gone = path.join(tmpDir(t), 'nowhere.mov');
  const catalog = fakeCatalog([{ id: 'src_1', localPath: gone }]);
  enqueueProxy(queue, { sourceId: 'src_1', localPath: gone });

  await runProxy({ queue, owner: OWNER, catalog, env: { STUDIO_PROJECT_ID: PROJECT }, build: fakeBuild() });
  assert.equal(catalog.sources[0].state, 'failed');
  assert.match(queue.listJobs({ stage: STAGE_PROXY })[0].lastError, /not on disk at .*nowhere\.mov.*re-ingest/);
});

test('a write that "succeeds" but does not stick is caught by the read-back', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'f.mov');
  fs.writeFileSync(file, 'x');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', localPath: file, durationS: 5 }]);
  catalog.updateSource = async (id) => ({ ok: true, status: 200, data: { id } }); // 200, stores nothing
  enqueueProxy(queue, { sourceId: 'src_1', localPath: file });

  const report = await runProxy({ queue, owner: OWNER, catalog, env: envFor(dir), build: fakeBuild() });
  assert.equal(report.blocked.length, 1, JSON.stringify(report, null, 2));
  assert.match(report.blocked[0].reason, /reads back as state "probed"/);
});

// ── The daemon ──────────────────────────────────────────────────────────────

test('the proxy stage is registered, so a proxy job is run rather than reported as unhandled', () => {
  assert.ok(STAGE_RUNNERS[STAGE_PROXY], 'proxy has a runner in workers/studio/daemon.js');
});
