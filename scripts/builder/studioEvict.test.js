'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { spawnSync, execFileSync } = require('node:child_process');

/**
 * Task 86bcwqp2y — the Mini's cache keeps only originals that are still needed.
 *
 * On 2026-11-02 the Studio cache held 9.6 GB of originals for 30 finished
 * videos and the Mini was at 28 GB free, below the 50 GB floor ingest refuses
 * to download under, so every new upload sat at "downloading". Nothing ever
 * deleted an original once the proxy was made.
 *
 * Real queue, real files and real ffmpeg on the chain test, with Drive and the
 * catalog faked — the claim is about bytes on a disk, so the disk is real.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const { runIngest, STAGE_INGEST } = require('../../workers/studio/ingest.js');
const { runProbe, enqueueProbe } = require('../../workers/studio/probePass.js');
const { runProxy, enqueueProxy } = require('../../workers/studio/proxyPass.js');
const {
  evictionVerdict,
  evictOriginal,
  sweepReadyOriginals,
  isInside,
} = require('../../workers/studio/evict.js');
const daemon = require('../../workers/studio/daemon.js');

const PROJECT = 'proj_studio';
const OWNER = 'evict-test';

const FFMPEG = process.env.STUDIO_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.STUDIO_FFPROBE || 'ffprobe';
function toolWorks(bin) {
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return !res.error && Number(res.status) === 0;
}
const HAVE_FFMPEG = toolWorks(FFMPEG) && toolWorks(FFPROBE);

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-evict-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tmpQueue(t) {
  const queue = openQueue(path.join(tmpDir(t), 'queue.sqlite'));
  t.after(() => queue.close());
  return queue;
}

function put(file, body = 'bytes') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

/** A ready source whose original sits in the cache and whose proxy sits in derived. */
function readyRow(dir, overrides = {}) {
  const cacheDir = path.join(dir, 'cache');
  const localPath = put(path.join(cacheDir, 'inbox', 'file_1', 'IMG_0001.MOV'), 'original');
  const proxyPath = put(path.join(dir, 'derived', 'inbox', 'src_1', 'proxy.mp4'), 'proxy');
  return {
    cacheDir,
    row: { id: 'src_1', state: 'ready', driveFileId: 'file_1', localPath, proxyPath, ...overrides },
  };
}

// ── The rule ────────────────────────────────────────────────────────────────

test('a ready source with its proxy on disk has its cached original deleted, and the proxy stays', (t) => {
  const { cacheDir, row } = readyRow(tmpDir(t));
  const result = evictOriginal(row, { cacheDir });
  assert.equal(result.action, 'evicted', JSON.stringify(result));
  assert.equal(result.bytes, 'original'.length);
  assert.equal(fs.existsSync(row.localPath), false, 'the original is gone');
  assert.equal(fs.existsSync(row.proxyPath), true, 'the proxy is still there');
  assert.equal(fs.existsSync(path.dirname(row.localPath)), false, 'and the empty Drive-id folder with it');
});

test('an original is KEPT whenever deleting it could lose the only copy on this machine', (t) => {
  const dir = tmpDir(t);
  const { cacheDir, row } = readyRow(dir);
  const kept = (overrides) => evictionVerdict({ ...row, ...overrides }, { cacheDir });

  assert.match(kept({ state: 'probed' }).why, /not ready/);
  assert.match(kept({ state: 'downloaded' }).why, /not ready/);
  assert.match(kept({ proxyPath: row.localPath }).why, /its own proxy/,
    'a small clip used directly as its proxy keeps its original');
  assert.match(kept({ proxyPath: path.join(dir, 'derived', 'gone.mp4') }).why, /proxy is not on disk/);
  assert.match(kept({ proxyPath: '' }).why, /no proxy/);
  assert.match(kept({ driveFileId: '' }).why, /no Drive file id/, 'nothing to fetch it back from');
  const outside = put(path.join(dir, 'elsewhere', 'IMG.MOV'));
  assert.match(kept({ localPath: outside }).why, /not inside the Studio cache/);
  assert.equal(fs.existsSync(row.localPath), true, 'none of those touched the file');

  assert.equal(isInside('/a/cache', '/a/cache/x/y.mov'), true);
  assert.equal(isInside('/a/cache', '/a/cache-other/y.mov'), false);
  assert.equal(isInside('/a/cache', '/a/cache'), false);
  assert.equal(isInside('/a/cache', '/a/cache/../derived/p.mp4'), false);
});

// ── The sweep: the originals already in the cache when this shipped ────────

test('the sweep deletes every ready original, keeps the rest, and a second run finds nothing to do', async (t) => {
  const dir = tmpDir(t);
  const cacheDir = path.join(dir, 'cache');
  const derived = (id) => put(path.join(dir, 'derived', 'inbox', id, 'proxy.mp4'), 'proxy');
  const cached = (id) => put(path.join(cacheDir, 'inbox', id, `${id}.MOV`), 'x'.repeat(1000));
  const rows = [
    { id: 'ready_a', state: 'ready', driveFileId: 'a', localPath: cached('a'), proxyPath: derived('ready_a') },
    { id: 'ready_b', state: 'ready', driveFileId: 'b', localPath: cached('b'), proxyPath: derived('ready_b') },
    { id: 'probing', state: 'probed', driveFileId: 'c', localPath: cached('c'), proxyPath: '' },
    { id: 'busy', state: 'ready', driveFileId: 'd', localPath: cached('d'), proxyPath: derived('busy') },
  ];
  const queue = tmpQueue(t);
  enqueueProxy(queue, { sourceId: 'busy' });
  const catalog = { listSources: async () => ({ ok: true, status: 200, data: rows }) };
  const env = { STUDIO_PROJECT_ID: PROJECT, STUDIO_CACHE_DIR: cacheDir };

  const first = await sweepReadyOriginals({ queue, catalog, env });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.evicted.map((e) => e.id).sort(), ['ready_a', 'ready_b']);
  assert.equal(first.freedBytes, 2000);
  assert.deepEqual(first.kept.map((k) => k.id), ['busy'], 'a source with a proxy job waiting is left alone');
  assert.equal(fs.existsSync(rows[2].localPath), true, 'a source that is not ready keeps its original');
  assert.equal(fs.existsSync(rows[3].localPath), true);

  const second = await sweepReadyOriginals({ queue, catalog, env });
  assert.equal(second.evicted.length, 0);
  assert.equal(second.absent, 2, 'it says the two are already gone rather than calling it nothing');

  assert.match(daemon.formatSweep('cache sweep', first), /cache sweep OK: 2 original\(s\) deleted/);
});

test('a sweep that cannot read the catalog says COULD NOT TELL and deletes nothing', async (t) => {
  const { cacheDir, row } = readyRow(tmpDir(t));
  const catalog = { listSources: async () => ({ ok: false, status: 503, error: 'connect ECONNREFUSED' }) };
  const report = await sweepReadyOriginals({ catalog, env: { STUDIO_PROJECT_ID: PROJECT, STUDIO_CACHE_DIR: cacheDir } });
  assert.equal(report.ok, false);
  assert.match(daemon.formatSweep('cache sweep', report), /COULD NOT TELL: the source list could not be read/);
  assert.equal(fs.existsSync(row.localPath), true);

  const noProject = await sweepReadyOriginals({ catalog, env: { STUDIO_CACHE_DIR: cacheDir } });
  assert.match(noProject.error, /STUDIO_PROJECT_ID is not set/);
});

test('the daemon runs the cache sweep on its own clock, beside the Drive watch', () => {
  assert.ok(daemon.WATCHERS[daemon.STAGE_CACHE_SWEEP], 'registered as a watcher');
  assert.equal(daemon.WATCHERS[daemon.STAGE_CACHE_SWEEP].everyMs, daemon.DEFAULT_CACHE_SWEEP_EVERY_MS);
});

// ── The whole chain: ready → evicted → needed again → back from Drive ───────

function makeClip(dir) {
  const out = path.join(dir, 'IMG_0001.MOV');
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    out,
  ]);
  return out;
}

function fakeDrive(bytes) {
  const calls = [];
  return {
    calls,
    getMetadata: async (fileId) => ({
      ok: true,
      status: 200,
      data: {
        id: fileId,
        name: 'IMG_0001.MOV',
        mimeType: 'video/quicktime',
        size: String(bytes.length),
        md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'),
        trashed: false,
        createdTime: '2026-11-02T04:00:00.000Z',
      },
    }),
    openStream: async (fileId, { offset = 0 } = {}) => {
      calls.push({ fileId, offset });
      return { ok: true, status: 200, rangeHonoured: true, stream: Readable.from([Buffer.from(bytes.subarray(offset))]) };
    },
  };
}

/** One catalog for every pass, so the chain reads and writes ONE row. */
function fakeCatalog() {
  const sources = [];
  const sessions = [];
  return {
    sources,
    findSourceByDriveFileId: async (id) => ({ ok: true, status: 200, data: sources.find((s) => s.driveFileId === id) || null }),
    findSourceByContentHash: async (h) => ({ ok: true, status: 200, data: sources.find((s) => s.contentHash === h) || null }),
    createSource: async (input) => {
      const row = { id: `src_${sources.length + 1}`, projectId: PROJECT, layerRole: 'reference', ...input };
      sources.push(row);
      return { ok: true, status: 201, data: { ...row } };
    },
    getSourceById: async (id) => {
      const found = sources.find((s) => s.id === id);
      return found ? { ok: true, status: 200, data: { ...found } } : { ok: false, status: 404, error: 'Source not found' };
    },
    updateSource: async (id, patch) => {
      const found = sources.find((s) => s.id === id);
      if (!found) return { ok: false, status: 404, error: 'Source not found' };
      Object.assign(found, patch);
      return { ok: true, status: 200, data: { ...found } };
    },
    upsertTranscript: async () => ({ ok: true, status: 200, data: { state: 'no_audio' } }),
    findSessionByTitle: async (title) => ({ ok: true, status: 200, data: sessions.find((s) => s.title === title) || null }),
    createSession: async (input) => {
      const row = { id: `sess_${sessions.length + 1}`, ...input };
      sessions.push(row);
      return { ok: true, status: 201, data: row };
    },
  };
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath || e.path, e.name));
}

test('an evicted original is downloaded again from Drive when probe and proxy re-run, and the chain succeeds',
  { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async (t) => {
    const dir = tmpDir(t);
    const bytes = fs.readFileSync(makeClip(dir));
    const cacheDir = path.join(dir, 'cache');
    const env = {
      STUDIO_PROJECT_ID: PROJECT,
      STUDIO_CACHE_DIR: cacheDir,
      STUDIO_DERIVED_DIR: path.join(dir, 'derived'),
      STUDIO_PROXY_FLOOR_KBPS: '1', // force a real proxy, so the original is not its own
    };
    const queue = tmpQueue(t);
    const catalog = fakeCatalog();
    const drive = fakeDrive(bytes);
    const statfs = () => ({ bsize: 1, bavail: 500e9, blocks: 500e9, bfree: 500e9 });
    const ingest = () => runIngest({ queue, owner: OWNER, drive, catalog, env, cacheDir, statfs, heartbeatMs: 0 });
    const probe = () => runProbe({ queue, owner: OWNER, catalog, env });
    const proxy = () => runProxy({ queue, owner: OWNER, catalog, env });

    queue.enqueue({
      stage: STAGE_INGEST,
      subjectKind: 'drive_file',
      subjectId: 'file_1',
      payload: { driveFileId: 'file_1', name: 'IMG_0001.MOV', lane: 'inbox' },
    });
    await ingest();
    await probe();
    const first = await proxy();
    assert.equal(first.ready.length, 1, JSON.stringify(first, null, 2));
    const row = catalog.sources[0];
    assert.equal(row.state, 'ready');
    assert.equal(first.ready[0].eviction.action, 'evicted', JSON.stringify(first.ready[0].eviction));
    assert.equal(fs.existsSync(row.localPath), false, 'the original left the cache when the source was ready');
    assert.equal(fs.existsSync(row.proxyPath), true, 'the proxy stayed');
    assert.deepEqual(filesUnder(cacheDir), [], 'the cache holds nothing for a source that is ready');
    assert.equal(row.localPath.startsWith(cacheDir), true, 'local_path is kept: it names the recording');

    // Something asks for the probe again — the original is not on disk.
    enqueueProbe(queue, { sourceId: row.id });
    const asked = await probe();
    assert.equal(asked.refetching.length, 1, JSON.stringify(asked, null, 2));
    assert.equal(asked.failed.length, 0, 'a missing original is a download to repeat, not a failed source');
    const refetchJob = queue.listJobs({ stage: STAGE_INGEST }).find((j) => j.state === 'pending');
    assert.equal(refetchJob && refetchJob.payload.refetch, true, 'ingest was asked to fetch it back');

    const back = await ingest();
    assert.equal(back.ok, true, JSON.stringify(back, null, 2));
    assert.equal(fs.existsSync(row.localPath), true, 'the original is back where the row says it is');
    assert.equal(catalog.sources.length, 1, 'still one row for one Drive file');
    assert.equal(drive.calls.length, 2, 'downloaded twice in total: once to ingest, once to refetch');

    await probe();
    const second = await proxy();
    assert.equal(second.ready.length, 1, JSON.stringify(second, null, 2));
    assert.equal(catalog.sources[0].state, 'ready');
    assert.equal(fs.existsSync(row.localPath), false, 'and once ready again, it is evicted again');
    assert.deepEqual(filesUnder(cacheDir), []);
  });

test('the proxy pass asks for a refetch rather than failing a source whose original was evicted', async (t) => {
  const dir = tmpDir(t);
  const queue = tmpQueue(t);
  const missing = path.join(dir, 'cache', 'inbox', 'file_9', 'GONE.MOV');
  const sources = [{ id: 'src_9', projectId: PROJECT, state: 'probed', driveFileId: 'file_9', localPath: missing }];
  const catalog = {
    getSourceById: async (id) => ({ ok: true, status: 200, data: { ...sources.find((s) => s.id === id) } }),
    updateSource: async () => { throw new Error('nothing should be written'); },
  };
  enqueueProxy(queue, { sourceId: 'src_9', localPath: missing });
  const report = await runProxy({ queue, owner: OWNER, catalog, env: { STUDIO_PROJECT_ID: PROJECT } });
  assert.equal(report.refetching.length, 1, JSON.stringify(report, null, 2));
  assert.equal(sources[0].state, 'probed', 'the row was not marked failed');
  const ingestJob = queue.listJobs({ stage: STAGE_INGEST })[0];
  assert.deepEqual(
    { id: ingestJob.subjectId, name: ingestJob.payload.name, refetch: ingestJob.payload.refetch },
    { id: 'file_9', name: 'GONE.MOV', refetch: true },
  );
});
