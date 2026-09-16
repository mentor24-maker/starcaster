'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

/**
 * Studio Phase 1 · 4 of 8 (86bbjv686) — resumable ingest.
 *
 * Everything here runs against a fake Drive and a fake catalog, on a real
 * SQLite queue and a real temp directory. The bytes and the disk are real
 * because the slice is ABOUT bytes and disk — a resumed download that is
 * mocked all the way down proves only that the mock was written to agree with
 * the code. Drive and Supabase are faked because a test that needs a live
 * Google account and a live database is a test nobody runs.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const {
  runIngest,
  ingestJob,
  downloadToPart,
  hashFile,
  freeBytesFor,
  cachePathsFor,
  safeFileName,
  humanBytes,
  resolveDiskFloorBytes,
  holdingSessionTitle,
  formatIngestReport,
  STAGE_INGEST,
  SUBJECT_DRIVE_FILE,
  STAGE_INGEST_HEALTH,
  SUBJECT_INGEST_HEALTH,
} = require('../../workers/studio/ingest.js');

const PROJECT = 'proj_studio';
const OWNER = 'ingest-test';

function tmpDir(t, prefix = 'studio-ingest-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A real queue on a real file, with a clock the test can wind forward — which
 * a retry test needs, because `fail` holds the job off for 30 seconds and a
 * test that cannot move time can only prove the job came BACK by sleeping.
 */
function tmpQueue(t, clockRef = null) {
  const dir = tmpDir(t, 'studio-ingest-queue-');
  const queue = openQueue(
    path.join(dir, 'queue.sqlite'),
    clockRef ? { clock: () => clockRef.now } : {}
  );
  t.after(() => queue.close());
  return queue;
}

/** A disk with however much room the test wants. */
function fakeStatfs(freeBytes) {
  return () => ({ bsize: 1, bavail: freeBytes, blocks: freeBytes, bfree: freeBytes });
}

/**
 * A Drive that hands out a known buffer, and can be told to die part-way
 * through — which is the only way to test that a download RESUMES rather than
 * restarting, since "it restarted" and "it resumed" produce the same file.
 */
function fakeDrive(bytes, { name = 'clip.mov', cutAfter = null, honourRange = true, meta = {} } = {}) {
  const calls = [];
  return {
    calls,
    getMetadata: async (fileId) => ({
      ok: true,
      status: 200,
      data: {
        id: fileId,
        name,
        mimeType: 'video/quicktime',
        size: String(bytes.length),
        md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'),
        trashed: false,
        createdTime: '2026-09-15T04:00:00.000Z',
        ...meta,
      },
    }),
    openStream: async (fileId, { offset = 0 } = {}) => {
      calls.push({ fileId, offset });
      const from = honourRange ? offset : 0;
      const slice = bytes.subarray(from);
      const body = cutAfter === null ? slice : slice.subarray(0, cutAfter);
      return {
        ok: true,
        status: from > 0 ? 206 : 200,
        // A Range that was never asked for is trivially honoured; one that was
        // asked for and ignored is the case this flag exists to report.
        rangeHonoured: offset === 0 ? true : honourRange,
        stream: Readable.from([Buffer.from(body)]),
      };
    },
  };
}

/** A catalog in memory, answering in the same envelopes the stores return. */
function fakeCatalog({ projectIdOnInsert = PROJECT } = {}) {
  const sources = [];
  const sessions = [];
  // What the caller ASKED for, kept apart from what the row came back as. The
  // two are different questions and the interesting assertions are about the
  // first: a row always HAS a layerRole, because the column has a default.
  const createInputs = [];
  let n = 0;
  return {
    sources,
    sessions,
    createInputs,
    findSourceByDriveFileId: async (driveFileId) => ({
      ok: true,
      status: 200,
      data: sources.find((s) => s.driveFileId === driveFileId) || null,
    }),
    findSourceByContentHash: async (contentHash) => ({
      ok: true,
      status: 200,
      data: sources.find((s) => s.contentHash === contentHash) || null,
    }),
    createSource: async (input) => {
      createInputs.push(input);
      if (sources.some((s) => s.contentHash && s.contentHash === input.contentHash)) {
        return {
          ok: false,
          status: 409,
          error: 'This file is already in the catalog for this project (same content hash)',
        };
      }
      n += 1;
      const row = { id: `src_${n}`, projectId: projectIdOnInsert, layerRole: 'reference', ...input };
      sources.push(row);
      return { ok: true, status: 201, data: row };
    },
    getSourceById: async (id) => {
      const found = sources.find((s) => s.id === id);
      return found
        ? { ok: true, status: 200, data: found }
        : { ok: false, status: 404, error: 'Source not found' };
    },
    listSessions: async () => ({ ok: true, status: 200, data: sessions.slice() }),
    createSession: async (input) => {
      const row = { id: `sess_${sessions.length + 1}`, ...input };
      sessions.push(row);
      return { ok: true, status: 201, data: row };
    },
  };
}

function queueIngestJob(queue, { fileId = 'file_1', name = 'clip.mov', lane = 'inbox', layerRole = null } = {}) {
  return queue.enqueue({
    stage: STAGE_INGEST,
    subjectKind: SUBJECT_DRIVE_FILE,
    subjectId: fileId,
    payload: { driveFileId: fileId, name, lane, layerRole, createdTime: '2026-09-15T04:00:00.000Z' },
  }).job;
}

/**
 * One pass's worth of wiring, with a roomy disk unless a test says otherwise.
 * Everything is top-level because that is where both `runIngest` and
 * `ingestJob` read their settings from.
 */
function passOptions(t, { bytes, drive, catalog, freeBytes = 500 * 1024 * 1024 * 1024, env = {} } = {}) {
  const cacheDir = path.join(tmpDir(t), 'cache');
  return {
    cacheDir,
    projectId: PROJECT,
    drive: drive || fakeDrive(bytes),
    catalog: catalog || fakeCatalog(),
    statfs: fakeStatfs(freeBytes),
    env: { STUDIO_PROJECT_ID: PROJECT, ...env },
    heartbeatMs: 0,
  };
}

// ── AC1: an interrupted download resumes rather than restarting ────────────

test('an interrupted download resumes from what is already on disk', async (t) => {
  const bytes = crypto.randomBytes(40_000);
  const dir = tmpDir(t);
  const partPath = path.join(dir, 'clip.mov.part');

  // First attempt: the stream dies after 15,000 of 40,000 bytes.
  const dying = fakeDrive(bytes, { cutAfter: 15_000 });
  const first = await downloadToPart({
    drive: dying, driveFileId: 'file_1', partPath, expectedBytes: bytes.length,
  });
  assert.equal(first.ok, true, 'the stream ended without throwing — it just ended short');
  assert.equal(first.bytes, 15_000, 'so 15,000 bytes are on disk');
  assert.equal(fs.existsSync(partPath), true, 'and the part file was KEPT — those bytes are the progress');

  // Second attempt: a healthy Drive, same part file.
  const healthy = fakeDrive(bytes);
  const second = await downloadToPart({
    drive: healthy, driveFileId: 'file_1', partPath, expectedBytes: bytes.length,
  });
  assert.equal(second.ok, true);
  assert.equal(second.resumedFrom, 15_000, 'it resumed rather than restarting');
  assert.equal(second.transferred, 25_000, 'and asked Drive for only the missing 25,000 bytes');
  assert.deepEqual(healthy.calls, [{ fileId: 'file_1', offset: 15_000 }], 'the Range offset it sent');
  assert.deepEqual(fs.readFileSync(partPath), bytes, 'and the two halves make the original file');
});

test('a Drive that IGNORES the Range header restarts instead of appending', async (t) => {
  // The failure this guards: appending a whole-file response to a half-full
  // part file produces a file of exactly the right LENGTH made of the wrong
  // bytes, which the size check passes and only the hash catches.
  const bytes = crypto.randomBytes(20_000);
  const dir = tmpDir(t);
  const partPath = path.join(dir, 'clip.mov.part');
  fs.writeFileSync(partPath, bytes.subarray(0, 8_000));

  const rude = fakeDrive(bytes, { honourRange: false });
  const result = await downloadToPart({
    drive: rude, driveFileId: 'file_1', partPath, expectedBytes: bytes.length,
  });
  assert.equal(result.ok, true);
  assert.equal(result.restarted, true, 'it noticed and started again');
  assert.equal(result.resumedFrom, 0);
  assert.deepEqual(fs.readFileSync(partPath), bytes, 'so the file is the right bytes, not merely the right size');
});

test('a part file LONGER than Drive says the file is, is thrown away', async (t) => {
  const bytes = crypto.randomBytes(5_000);
  const dir = tmpDir(t);
  const partPath = path.join(dir, 'clip.mov.part');
  fs.writeFileSync(partPath, crypto.randomBytes(9_000));

  const drive = fakeDrive(bytes);
  const result = await downloadToPart({
    drive, driveFileId: 'file_1', partPath, expectedBytes: bytes.length,
  });
  assert.equal(result.ok, true);
  assert.equal(result.resumedFrom, 0, 'it cannot become the right file by having more appended');
  assert.deepEqual(fs.readFileSync(partPath), bytes);
});

test('an interrupted INGEST leaves the job retryable and the bytes on disk', async (t) => {
  const bytes = crypto.randomBytes(30_000);
  const at = { now: Date.now() };
  const queue = tmpQueue(t, at);
  const opts = passOptions(t, { drive: fakeDrive(bytes, { cutAfter: 12_000 }) });
  queueIngestJob(queue);

  const first = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(first.ok, false);
  assert.equal(first.failed.length, 1);
  assert.match(first.failed[0].reason, /resumes from there/, 'and it says so in words');
  assert.equal(first.ingested.length, 0, 'nothing was registered on a short download');

  const job = queue.listJobs({ stage: STAGE_INGEST })[0];
  assert.equal(job.state, 'pending', 'the job is retryable, not blocked');
  assert.equal(job.attempts, 1);

  // Second pass with a healthy Drive: it resumes and finishes.
  const paths = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'clip.mov',
  });
  assert.equal(fs.statSync(paths.partPath).size, 12_000, 'the 12,000 downloaded bytes survived the failure');

  // `fail` holds a retry off with a growing backoff, so wind the queue's clock
  // past it rather than sleeping.
  at.now += 10 * 60 * 1000;
  const healthy = fakeDrive(bytes);
  const second = await runIngest({ queue, owner: OWNER, ...opts, drive: healthy });
  assert.equal(second.ok, true, formatIngestReport(second));
  assert.equal(second.ingested.length, 1);
  assert.equal(second.ingested[0].resumed, true);
  assert.equal(second.ingested[0].resumedFrom, 12_000);
  assert.deepEqual(healthy.calls, [{ fileId: 'file_1', offset: 12_000 }]);
  assert.deepEqual(fs.readFileSync(paths.finalPath), bytes, 'and the finished file is the original');
});

// ── AC2: verified before the row is written; a mismatch blocks ─────────────

test('a checksum mismatch BLOCKS the job and registers nothing', async (t) => {
  const bytes = crypto.randomBytes(4_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  // Drive describes one file and serves a different one — which is what a
  // corrupted transfer looks like from here.
  const drive = fakeDrive(bytes);
  drive.getMetadata = async (fileId) => ({
    ok: true,
    status: 200,
    data: {
      id: fileId,
      name: 'clip.mov',
      size: String(bytes.length),
      md5Checksum: crypto.createHash('md5').update(crypto.randomBytes(8)).digest('hex'),
      trashed: false,
      createdTime: '2026-09-15T04:00:00.000Z',
    },
  });
  const opts = passOptions(t, { drive, catalog });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ok, false);
  assert.equal(report.blocked.length, 1);
  assert.match(report.blocked[0].reason, /do not match Drive's checksum/);
  assert.match(report.blocked[0].reason, /nothing was registered/);
  assert.equal(catalog.sources.length, 0, 'no row was written');

  const jobs = queue.listJobs({ stage: STAGE_INGEST });
  assert.equal(jobs[0].state, 'blocked', 'and it is terminal, not retried against a wall');

  const paths = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'clip.mov',
  });
  assert.equal(fs.existsSync(paths.partPath), false, 'the corrupt bytes were deleted, not left to be resumed');
});

test('a size mismatch blocks too, and says both numbers', async (t) => {
  const bytes = crypto.randomBytes(3_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const drive = fakeDrive(bytes);
  const truthful = drive.getMetadata;
  drive.getMetadata = async (fileId) => {
    const res = await truthful(fileId);
    return { ...res, data: { ...res.data, size: '1500' } }; // Drive claims half
  };
  const opts = passOptions(t, { drive, catalog });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.blocked.length, 1);
  assert.match(report.blocked[0].reason, /2.93 KB.*Drive says.*1.46 KB/s);
  assert.equal(catalog.sources.length, 0);
});

test('a file Drive gives no md5 for is blocked, not ingested on trust', async (t) => {
  const bytes = crypto.randomBytes(2_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const drive = fakeDrive(bytes, { meta: { md5Checksum: '' } });
  const opts = passOptions(t, { drive, catalog });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.blocked.length, 1);
  assert.match(report.blocked[0].reason, /no md5Checksum/);
  assert.match(report.blocked[0].reason, /could not be proved/);
  assert.equal(catalog.sources.length, 0, '"could not verify" is not "verified"');
});

// ── AC3: the same file arriving twice produces ONE row ─────────────────────

test('the same DRIVE FILE watched twice downloads once and makes one row', async (t) => {
  const bytes = crypto.randomBytes(6_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const drive = fakeDrive(bytes);
  const opts = passOptions(t, { drive, catalog });

  queueIngestJob(queue);
  const first = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(first.ingested.length, 1, formatIngestReport(first));

  queueIngestJob(queue); // the watcher saw a rename and queued it again
  const second = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(second.ok, true);
  assert.equal(second.deduped.length, 1);
  assert.match(second.deduped[0].reason, /already in the catalog/);
  assert.equal(catalog.sources.length, 1, 'ONE row');
  assert.equal(drive.calls.length, 1, 'and the second pass downloaded nothing at all');
});

test('the same BYTES arriving as a different Drive file make one row', async (t) => {
  // AirDrop, then a Photos sync: two Drive ids, one piece of footage.
  const bytes = crypto.randomBytes(6_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { catalog });

  queueIngestJob(queue, { fileId: 'file_airdrop', name: 'IMG_0001.MOV' });
  const first = await runIngest({ queue, owner: OWNER, ...opts, drive: fakeDrive(bytes, { name: 'IMG_0001.MOV' }) });
  assert.equal(first.ingested.length, 1, formatIngestReport(first));

  queueIngestJob(queue, { fileId: 'file_photos', name: 'IMG_0001 (1).MOV' });
  const second = await runIngest({
    queue, owner: OWNER, ...opts, drive: fakeDrive(bytes, { name: 'IMG_0001 (1).MOV' }),
  });
  assert.equal(second.ok, true, formatIngestReport(second));
  assert.equal(second.deduped.length, 1);
  assert.match(second.deduped[0].reason, /same bytes as source src_1/);
  assert.equal(catalog.sources.length, 1, 'ONE row for one piece of footage');

  const copy = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_photos', name: 'IMG_0001 (1).MOV',
  });
  assert.equal(fs.existsSync(copy.finalPath), false, 'and the duplicate copy is not left filling the disk');
  assert.equal(fs.existsSync(copy.partPath), false);
});

test('a 409 from the database is read as a dedupe, not as a failure', async (t) => {
  // The race the cheap check above cannot close: another worker registers
  // these exact bytes between our look and our write. The unique index is what
  // actually holds the rule.
  const bytes = crypto.randomBytes(2_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  catalog.findSourceByContentHash = async () => ({ ok: true, status: 200, data: null });
  catalog.createSource = async () => ({
    ok: false,
    status: 409,
    error: 'This file is already in the catalog for this project (same content hash)',
  });
  const opts = passOptions(t, { catalog, drive: fakeDrive(bytes) });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ok, true, formatIngestReport(report));
  assert.equal(report.deduped.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_INGEST })[0].state, 'done');
});

// ── AC4: read the row back and assert project_id is populated ──────────────

test('a registered source is read back and its project id checked', async (t) => {
  const bytes = crypto.randomBytes(5_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { catalog, drive: fakeDrive(bytes) });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ingested.length, 1, formatIngestReport(report));
  assert.equal(report.ingested[0].projectId, PROJECT, 'the value came off the ROW, not off the insert');
  assert.equal(catalog.sources[0].state, 'downloaded');
  assert.equal(catalog.sources[0].localPath, report.ingested[0].localPath);
});

test('a row that lands with NO project id blocks the job loudly (landmine 12)', async (t) => {
  // scopedInsertRow stops stamping the tenant columns when its probe fails,
  // and the insert still reports 201. The insert is not the evidence.
  const bytes = crypto.randomBytes(5_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ projectIdOnInsert: '' });
  const opts = passOptions(t, { catalog, drive: fakeDrive(bytes) });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ok, false);
  assert.equal(report.ingested.length, 0, 'a tenantless row is NOT reported as ingested');
  assert.equal(report.blocked.length, 1);
  assert.match(report.blocked[0].reason, /NO project id/);
  assert.match(report.blocked[0].reason, /landmine 12/);
});

test('with no STUDIO_PROJECT_ID the pass refuses and downloads nothing', async (t) => {
  const bytes = crypto.randomBytes(5_000);
  const queue = tmpQueue(t);
  const drive = fakeDrive(bytes);
  const catalog = fakeCatalog();
  const cacheDir = path.join(tmpDir(t), 'cache');
  queueIngestJob(queue);

  const report = await runIngest({
    queue,
    owner: OWNER,
    drive,
    catalog,
    cacheDir,
    statfs: fakeStatfs(500 * 1024 * 1024 * 1024),
    env: {},
  });
  assert.equal(report.ok, false);
  assert.match(report.unchecked[0], /STUDIO_PROJECT_ID is not set/);
  assert.equal(drive.calls.length, 0, 'nothing was downloaded');
  assert.equal(queue.listJobs({ stage: STAGE_INGEST })[0].state, 'pending', 'and the work is still queued');

  const health = queue.listJobs({ stage: STAGE_INGEST_HEALTH });
  assert.equal(health.length, 1, 'one health job carries the reason');
  assert.equal(health[0].state, 'blocked');
  assert.equal(health[0].subjectKind, SUBJECT_INGEST_HEALTH);
});

// ── AC5: the disk floor ────────────────────────────────────────────────────

test('below the floor, ingest refuses to start and downloads nothing', async (t) => {
  const bytes = crypto.randomBytes(5_000);
  const queue = tmpQueue(t);
  const drive = fakeDrive(bytes);
  const opts = passOptions(t, { drive, freeBytes: 10 * 1024 * 1024 * 1024 }); // 10 GB free
  queueIngestJob(queue);

  const report = await runIngest({
    queue, owner: OWNER, ...opts, diskFloorBytes: 50 * 1024 * 1024 * 1024,
  });
  assert.equal(report.ok, false);
  assert.equal(report.ingested.length, 0);
  assert.match(report.unchecked[0], /10.00 GB is free/);
  assert.match(report.unchecked[0], /floor is 50.00 GB/);
  assert.match(report.unchecked[0], /the disk was not partially filled/);
  assert.equal(drive.calls.length, 0, 'and it means it — no stream was ever opened');

  const health = queue.listJobs({ stage: STAGE_INGEST_HEALTH });
  assert.equal(health[0].state, 'blocked');
  assert.equal(queue.listJobs({ stage: STAGE_INGEST })[0].state, 'pending', 'the work itself is untouched');
});

test('a file that would EAT the floor is put back, not failed', async (t) => {
  // Above the floor overall, but this particular 3.5 GB file does not fit.
  const bytes = crypto.randomBytes(4_000);
  const queue = tmpQueue(t);
  const drive = fakeDrive(bytes);
  const truthful = drive.getMetadata;
  drive.getMetadata = async (fileId) => {
    const res = await truthful(fileId);
    return { ...res, data: { ...res.data, size: String(4 * 1024 * 1024 * 1024) } };
  };
  const opts = passOptions(t, { drive, freeBytes: 52 * 1024 * 1024 * 1024 }); // 52 GB free
  queueIngestJob(queue);

  const report = await runIngest({
    queue, owner: OWNER, ...opts, diskFloorBytes: 50 * 1024 * 1024 * 1024,
  });
  assert.equal(report.released.length, 1);
  assert.equal(report.released[0].jobAction, 'released');
  assert.match(report.released[0].reason, /not enough room/);
  assert.match(report.released[0].reason, /the disk was not partially filled/);
  assert.equal(drive.calls.length, 0, 'no bytes were written');

  const job = queue.listJobs({ stage: STAGE_INGEST })[0];
  assert.equal(job.state, 'pending', 'it went back on the queue');
  assert.equal(job.attempts, 0, 'and a full disk did not spend the file\'s retry budget');
  assert.match(job.lastError, /not enough room/, 'while still saying why it is waiting');
});

test('the health alarm stands down on the next pass that has room', async (t) => {
  const bytes = crypto.randomBytes(4_000);
  const queue = tmpQueue(t);
  queueIngestJob(queue);

  const cramped = passOptions(t, { drive: fakeDrive(bytes), freeBytes: 1024 });
  const first = await runIngest({
    queue, owner: OWNER, ...cramped, diskFloorBytes: 2048,
  });
  assert.equal(first.ok, false);
  assert.equal(queue.listJobs({ stage: STAGE_INGEST_HEALTH })[0].state, 'blocked');

  const roomy = { ...cramped, drive: fakeDrive(bytes), statfs: fakeStatfs(500 * 1024 * 1024 * 1024) };
  const second = await runIngest({ queue, owner: OWNER, ...roomy });
  assert.equal(second.ok, true, formatIngestReport(second));
  assert.equal(second.healthCleared, true, 'an alarm that cannot stand down is an alarm that gets ignored');
  assert.equal(queue.listJobs({ stage: STAGE_INGEST_HEALTH })[0].state, 'done');
});

test('a floor that cannot be READ stops the pass rather than passing', async () => {
  const junk = resolveDiskFloorBytes({}, { STUDIO_DISK_FLOOR_BYTES: 'fifty gigs' });
  assert.equal(junk.ok, false);
  assert.match(junk.error, /not a number of bytes/);

  const unset = resolveDiskFloorBytes({}, {});
  assert.equal(unset.ok, true);
  assert.equal(unset.value, 50 * 1024 * 1024 * 1024);

  const set = resolveDiskFloorBytes({}, { STUDIO_DISK_FLOOR_BYTES: '1024' });
  assert.equal(set.value, 1024);
});

test('free space that cannot be measured is a could-not-tell, not a pass', async (t) => {
  const queue = tmpQueue(t);
  const drive = fakeDrive(crypto.randomBytes(1_000));
  const opts = passOptions(t, { drive });
  queueIngestJob(queue);

  const report = await runIngest({
    queue,
    owner: OWNER,
    ...opts,
    statfs: () => { throw new Error('no such volume'); },
  });
  assert.equal(report.ok, false);
  assert.match(report.unchecked[0], /could not be read/);
  assert.match(report.unchecked[0], /nothing was downloaded/);
  assert.equal(drive.calls.length, 0);
});

// ── The rest of the pass's behaviour ───────────────────────────────────────

test('a lost lease stops the download and leaves the job alone', async (t) => {
  // A reaped job now belongs to another worker. Finishing it would be the
  // double-processing the single-statement claim exists to prevent.
  const bytes = crypto.randomBytes(40_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { catalog, drive: fakeDrive(bytes) });
  const job = queueIngestJob(queue);

  const stolen = { ...queue, heartbeat: () => false };
  const report = await runIngest({ queue: stolen, owner: OWNER, ...opts });
  assert.equal(report.ok, false);
  assert.equal(report.unchecked.length, 1);
  assert.match(report.unchecked[0].reason, /lease on this job was lost/);
  assert.equal(catalog.sources.length, 0, 'nothing was registered');
  assert.equal(queue.getJob(job.id).state, 'running', 'and the job was not touched');
});

test('a file trashed between watching and ingesting is completed, with the reason', async (t) => {
  const bytes = crypto.randomBytes(2_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { catalog, drive: fakeDrive(bytes, { meta: { trashed: true } }) });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ok, true);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /Drive trash/);
  assert.equal(catalog.sources.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_INGEST })[0].state, 'done');
});

test('a plate keeps the role the folder gave it; inbox footage does not get one guessed', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { catalog });

  queueIngestJob(queue, { fileId: 'file_plate', name: 'screen.mov', lane: 'plates', layerRole: 'plate' });
  const plate = await runIngest({
    queue, owner: OWNER, ...opts, drive: fakeDrive(crypto.randomBytes(1_000), { name: 'screen.mov' }),
  });
  assert.equal(plate.ingested.length, 1, formatIngestReport(plate));
  assert.equal(catalog.sources[0].layerRole, 'plate');

  queueIngestJob(queue, { fileId: 'file_inbox', name: 'wide.mov', lane: 'inbox', layerRole: null });
  const inbox = await runIngest({
    queue, owner: OWNER, ...opts, drive: fakeDrive(crypto.randomBytes(1_100), { name: 'wide.mov' }),
  });
  assert.equal(inbox.ingested.length, 1, formatIngestReport(inbox));
  assert.equal(
    'layerRole' in catalog.createInputs[1], false,
    'inbox footage is sent with NO role — 5/8 works it out, and a guess here is a wrong answer stated confidently'
  );
  assert.equal(catalog.createInputs[0].layerRole, 'plate', 'while the plate lane states the role it knows');
});

test('footage lands in a holding session named as a holding session', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { catalog });

  queueIngestJob(queue, { fileId: 'a', name: 'a.mov' });
  await runIngest({ queue, owner: OWNER, ...opts, drive: fakeDrive(crypto.randomBytes(900), { name: 'a.mov' }) });
  queueIngestJob(queue, { fileId: 'b', name: 'b.mov' });
  await runIngest({ queue, owner: OWNER, ...opts, drive: fakeDrive(crypto.randomBytes(950), { name: 'b.mov' }) });

  assert.equal(catalog.sessions.length, 1, 'two files from the same day share one holding session');
  assert.equal(catalog.sessions[0].title, 'Unsorted — inbox — 2026-09-15');
  assert.equal(catalog.sources[0].sessionId, catalog.sessions[0].id);
  assert.equal(catalog.sources[1].sessionId, catalog.sessions[0].id);
});

test('a caller that knows the session overrides the holding pen', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { catalog, drive: fakeDrive(crypto.randomBytes(800)) });
  queueIngestJob(queue);

  const report = await runIngest({
    queue, owner: OWNER, ...opts, resolveSessionId: async () => 'sess_known',
  });
  assert.equal(report.ingested.length, 1, formatIngestReport(report));
  assert.equal(catalog.sessions.length, 0, 'no holding session was invented');
  assert.equal(catalog.sources[0].sessionId, 'sess_known');
});

test('an already-complete file from a dead pass is verified, not downloaded again', async (t) => {
  const bytes = crypto.randomBytes(7_000);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const drive = fakeDrive(bytes);
  const opts = passOptions(t, { catalog, drive });
  const paths = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'clip.mov',
  });
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.finalPath, bytes);
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ingested.length, 1, formatIngestReport(report));
  assert.equal(drive.calls.length, 0, 'not one byte was fetched again');
  assert.equal(catalog.sources[0].contentHash, crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('an empty pass says WHY it is empty (landmine 17)', async (t) => {
  const queue = tmpQueue(t);
  const opts = passOptions(t, { drive: fakeDrive(Buffer.alloc(4)) });
  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ok, true);
  assert.match(formatIngestReport(report), /Nothing to do — no ingest jobs were waiting/);
});

test('a throw inside one job is reported and retried, not swallowed', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  catalog.findSourceByDriveFileId = async () => { throw new Error('the catalog exploded'); };
  const opts = passOptions(t, { catalog, drive: fakeDrive(crypto.randomBytes(500)) });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ok, false);
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].reason, /the catalog exploded/);
  assert.equal(queue.listJobs({ stage: STAGE_INGEST })[0].state, 'pending');
});

// ── The small decisions, pinned on their own ───────────────────────────────

test('release puts a job back without spending an attempt, and keeps the reason', async (t) => {
  const queue = tmpQueue(t);
  queue.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'x' });
  const job = queue.claim(OWNER);

  assert.equal(queue.release(job.id, 'somebody-else', { reason: 'nope' }), false, 'guarded by owner');
  assert.equal(queue.release(job.id, OWNER, { reason: 'the disk is full', runAfterMs: 1000 }), true);

  const back = queue.getJob(job.id);
  assert.equal(back.state, 'pending');
  assert.equal(back.attempts, 0, 'not a failure');
  assert.equal(back.recoveries, 0, 'and not a crash either');
  assert.equal(back.leaseOwner, '');
  assert.match(back.lastError, /the disk is full/, 'a pending job with a blank reason reads as "never tried"');
});

test('hashFile gives both digests in one read', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'x.bin');
  const bytes = crypto.randomBytes(1_234);
  fs.writeFileSync(file, bytes);
  const digests = await hashFile(file);
  assert.equal(digests.md5, crypto.createHash('md5').update(bytes).digest('hex'));
  assert.equal(digests.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('free space is measured by walking up to a folder that exists', async (t) => {
  const dir = tmpDir(t);
  const deep = path.join(dir, 'not', 'made', 'yet');
  const seen = [];
  const result = freeBytesFor(deep, (p) => {
    seen.push(p);
    if (p !== dir) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { bsize: 4096, bavail: 100 };
  });
  assert.equal(result.ok, true);
  assert.equal(result.value, 409_600);
  assert.equal(result.measuredAt, dir);
  assert.equal(seen.length, 4, 'it walked up rather than creating the folder to ask');
});

test('a Drive name cannot escape the cache folder', async () => {
  // The property, not one particular rendering of it: whatever a Drive name
  // contains, the result has no path separator, does not start with a dot, and
  // the file lands inside the folder the cache path names.
  for (const hostile of ['../../etc/passwd', '/absolute.mov', '..', 'a\\b.mov', 'x\ty.mov']) {
    const cleaned = safeFileName(hostile, 'fallback');
    assert.equal(/[/\\]/.test(cleaned), false, `no separator survived "${hostile}" (got "${cleaned}")`);
    assert.equal(cleaned.startsWith('.'), false, `and it is not a hidden name (got "${cleaned}")`);
    const paths = cachePathsFor({ cacheDir: '/cache', lane: 'inbox', driveFileId: 'f1', name: hostile });
    assert.equal(path.dirname(paths.finalPath), '/cache/inbox/f1', `and it stays put for "${hostile}"`);
  }
  assert.equal(safeFileName('   ', 'fallback'), 'fallback', 'a nameless file still gets a name');
  assert.equal(safeFileName('IMG_0001 (1).MOV', 'fallback'), 'IMG_0001 (1).MOV', 'an ordinary name is untouched');
});

test('bytes are rendered for a person', async () => {
  assert.equal(humanBytes(0), '0 bytes');
  assert.equal(humanBytes(3_830_794_649), '3.57 GB');
  assert.equal(humanBytes('not a number'), 'an unknown number of bytes');
});

test('a holding session with an unreadable date says undated rather than guessing', async () => {
  assert.equal(holdingSessionTitle('inbox', '2026-09-15T04:00:00.000Z'), 'Unsorted — inbox — 2026-09-15');
  assert.equal(holdingSessionTitle('plates', 'sometime last week'), 'Unsorted — plates — undated');
  assert.equal(holdingSessionTitle('', ''), 'Unsorted — inbox — undated');
});
