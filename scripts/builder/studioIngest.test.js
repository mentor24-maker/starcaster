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
const googleDrive = require('../../lib/googleDrive.js');
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
  getIngestMetadata,
  realDriveClient,
  findCachedFiles,
  humanDuration,
  resolveDriveTimeouts,
  HEALTH_NO_ROOM,
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
    findSessionByTitle: async (title) => ({
      ok: true,
      status: 200,
      data: sessions.find((sess) => sess.title === title) || null,
    }),
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

  // The half this test used to leave unasserted, which is the half that was
  // wrong: it checked everything about the JOB and nothing about the verdict.
  assert.equal(
    report.ok, false,
    'a pass that shipped nothing at all is not a pass that finished cleanly'
  );
  assert.match(formatIngestReport(report), /FINISHED WITH THINGS TO LOOK AT/);
  assert.match(formatIngestReport(report), /NO ROOM/);
});

test('a disk too full to do any work raises the alarm instead of clearing it', async (t) => {
  // 52 GB free, a 50 GB floor, one 3.57 GB file: the pass-level check passes
  // (52 > 50), the per-file check correctly refuses (52 - 3.57 < 50), and the
  // old code cleared the health alarm on its way past — so nothing was
  // ingested, no alarm was standing, `release` spent no attempt, and it
  // repeated every fifteen minutes for ever saying "finished cleanly".
  const bytes = crypto.randomBytes(4_000);
  const queue = tmpQueue(t);
  const drive = fakeDrive(bytes);
  const truthful = drive.getMetadata;
  drive.getMetadata = async (fileId) => {
    const res = await truthful(fileId);
    return { ...res, data: { ...res.data, size: String(4 * 1024 * 1024 * 1024) } };
  };
  const opts = passOptions(t, { drive, freeBytes: 52 * 1024 * 1024 * 1024 });
  queueIngestJob(queue);

  const report = await runIngest({
    queue, owner: OWNER, ...opts, diskFloorBytes: 50 * 1024 * 1024 * 1024,
  });

  const health = queue.listJobs({ stage: STAGE_INGEST_HEALTH });
  assert.equal(health.length, 1, 'one alarm');
  assert.equal(health[0].state, 'blocked', 'and it is RAISED, not cleared');
  assert.match(health[0].lastError, /making no progress/);
  assert.equal(report.healthCleared, false);

  // Run it again on the same still-full disk: the alarm is REFRESHED, never
  // duplicated, or a 15-minute timer files 96 rows a day.
  queue.enqueue({
    stage: STAGE_INGEST, subjectKind: SUBJECT_DRIVE_FILE, subjectId: 'file_2',
    payload: { driveFileId: 'file_2', name: 'other.mov', lane: 'inbox' },
  });
  await runIngest({ queue, owner: OWNER, ...opts, diskFloorBytes: 50 * 1024 * 1024 * 1024 });
  const after = queue.listJobs({ stage: STAGE_INGEST_HEALTH });
  assert.equal(after.length, 1, 'still one row, refreshed in place');
  assert.equal(after[0].id, health[0].id);
});

/**
 * A pass that runs INSIDE the hold-off window and does nothing at all.
 *
 * This is round 2's blocker, and it is the same sentence round 1 was sent back
 * for, one pass later. `release` holds the job off for fifteen minutes and
 * `claim` honours `run_after`, so the pass five minutes later claims nothing:
 * every bucket empty, `ok` flipping to true, the header line saying "finished
 * cleanly" over a disk exactly as full as it was, the empty-state line saying
 * nothing was waiting when something was, and `clearBlock` DELETING the only
 * durable record of the condition.
 *
 * It is deliberately the previous test's scenario with one more beat, rather
 * than a new one: the version on the branch re-ran it with a NEWLY ENQUEUED
 * second file, which re-hits the condition and so exercises the refresh path
 * and never the do-nothing path.
 */
function fullDiskPass(t, { clockRef }) {
  const bytes = crypto.randomBytes(4_000);
  const drive = fakeDrive(bytes);
  const truthful = drive.getMetadata;
  drive.getMetadata = async (fileId) => {
    const res = await truthful(fileId);
    return { ...res, data: { ...res.data, size: String(4 * 1024 * 1024 * 1024) } };
  };
  return {
    ...passOptions(t, { drive, freeBytes: 52 * 1024 * 1024 * 1024 }),
    diskFloorBytes: 50 * 1024 * 1024 * 1024,
  };
}

test('the pass five minutes later does NOT report clean and does NOT delete the alarm', async (t) => {
  const at = { now: Date.now() };
  const queue = tmpQueue(t, at);
  const opts = fullDiskPass(t, { clockRef: at });
  queueIngestJob(queue);

  const first = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(first.released.length, 1, 'the file was put back for want of room');
  assert.equal(first.ok, false);
  const alarm = queue.listJobs({ stage: STAGE_INGEST_HEALTH })[0];
  assert.equal(alarm.state, 'blocked');
  assert.deepEqual(
    alarm.payload, { kind: HEALTH_NO_ROOM, heldJobIds: first.awaitingRoom },
    'the alarm records WHICH jobs are stuck — the fact that has to outlive this pass'
  );

  // Five minutes later. Nothing has changed on the disk; the job is not due.
  at.now += 5 * 60 * 1000;
  const second = await runIngest({ queue, owner: `${OWNER}-2`, ...opts });

  assert.equal(second.released.length, 0, 'it claimed nothing — the job is held off');
  assert.equal(second.ingested.length, 0);
  assert.equal(
    second.ok, false,
    'a pass that shipped nothing while a file sits waiting for disk is not a clean pass'
  );
  assert.equal(second.healthCleared, false, 'and it did not stand the alarm down');
  assert.equal(second.healthStanding, true);
  assert.equal(
    queue.listJobs({ stage: STAGE_INGEST_HEALTH })[0].state, 'blocked',
    'the alarm is the only durable record of the condition, and the condition still holds'
  );
  assert.deepEqual(second.awaitingRoom, first.awaitingRoom, 'the same job, still stuck');

  const printed = formatIngestReport(second);
  assert.match(printed, /FINISHED WITH THINGS TO LOOK AT/);
  assert.match(printed, /ALARM STANDING/);
  assert.doesNotMatch(
    printed, /no ingest jobs were waiting/,
    'one WAS waiting — landmine 17: an empty state that says the wrong why is worse than one that says none'
  );
  assert.match(printed, /1 ingest job\(s\) are waiting and not due yet, the next in 10 minutes/);
});

test('the alarm stands down once the held-off file actually gets through', async (t) => {
  // The other half, and the one that keeps this from being an alarm nobody can
  // clear: when the disk is freed and the job comes due, the pass that ingests
  // it takes the alarm down.
  const at = { now: Date.now() };
  const queue = tmpQueue(t, at);
  const cramped = fullDiskPass(t, { clockRef: at });
  queueIngestJob(queue);

  const first = await runIngest({ queue, owner: OWNER, ...cramped });
  assert.equal(first.released.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_INGEST_HEALTH })[0].state, 'blocked');

  // Past the hold-off, with room and a Drive telling the truth about the size.
  at.now += 16 * 60 * 1000;
  const bytes = crypto.randomBytes(4_000);
  const roomy = {
    ...cramped,
    drive: fakeDrive(bytes),
    statfs: fakeStatfs(500 * 1024 * 1024 * 1024),
  };
  const second = await runIngest({ queue, owner: OWNER, ...roomy });

  assert.equal(second.ingested.length, 1, formatIngestReport(second));
  assert.deepEqual(second.awaitingRoom, [], 'nothing is stuck any more');
  assert.equal(second.healthCleared, true);
  assert.equal(second.healthStanding, false);
  assert.equal(second.ok, true, formatIngestReport(second));
  assert.equal(queue.listJobs({ stage: STAGE_INGEST_HEALTH })[0].state, 'done');
});

test('a queue holding work back is never reported as an empty queue', async (t) => {
  // The narrower claim on its own, away from the disk: `listJobs({ state:
  // "pending" })` cannot tell "nothing is waiting" from "something is waiting
  // and is not due", and the pass used to print the first for the second.
  const at = { now: Date.now() };
  const queue = tmpQueue(t, at);
  const job = queueIngestJob(queue);
  queue.claim(OWNER);
  queue.release(job.id, OWNER, { reason: 'the disk is full', runAfterMs: 15 * 60 * 1000 });

  assert.deepEqual(
    queue.waiting({ stage: STAGE_INGEST }),
    {
      pending: 1, dueNow: 0, heldOff: 1,
      nextDueAt: at.now + 15 * 60 * 1000, nextDueInMs: 15 * 60 * 1000,
      jobs: queue.waiting({ stage: STAGE_INGEST }).jobs,
    }
  );
  assert.equal(queue.claim(`${OWNER}-2`), null, 'and claim agrees it is not due');

  at.now += 15 * 60 * 1000 + 1;
  const due = queue.waiting({ stage: STAGE_INGEST });
  assert.equal(due.heldOff, 0, 'the same job, once its clock comes round');
  assert.equal(due.dueNow, 1);
  assert.equal(due.nextDueInMs, 0);
});

test('a job backing off after a FAILURE is outstanding work too, not a clean pass', async (t) => {
  // `heldOff` is not only the disk: a file that failed and is waiting out its
  // backoff has not been ingested either, and 7/8's daemon reads `report.ok`.
  // The alarm is NOT raised — that one is about disk room and would be a lie.
  const at = { now: Date.now() };
  const queue = tmpQueue(t, at);
  const opts = passOptions(t, { drive: fakeDrive(crypto.randomBytes(30_000), { cutAfter: 12_000 }) });
  queueIngestJob(queue);

  const first = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(first.failed.length, 1);

  // One second later: the backoff has not elapsed, so nothing is claimable.
  at.now += 1000;
  const second = await runIngest({ queue, owner: OWNER, ...opts });
  assert.deepEqual(second.failed, []);
  assert.equal(second.ok, false, 'a file is still waiting to be retried');
  assert.equal(second.waiting.heldOff, 1);
  assert.deepEqual(second.awaitingRoom, [], 'and it is not a disk problem');
  assert.equal(
    queue.listJobs({ stage: STAGE_INGEST_HEALTH }).length, 0,
    'so no disk alarm was invented for it'
  );
  assert.match(formatIngestReport(second), /waiting and not due yet/);
});

test('a blocked file NEVER leaves its own job running, even on the second round', async (t) => {
  // Blocker 1 as the review reproduced it, driven through the real pass rather
  // than the queue alone: block a file on a checksum mismatch, re-queue the
  // same Drive file exactly as the blocked reason tells the operator to, and
  // block it again. The old code reported it blocked and left job #2 running,
  // where `reap` found it, ingest re-claimed it and re-downloaded the WHOLE
  // file — up to twenty times, about 71 GB for one 3.57 GB clip — before going
  // terminal with a reason about the worker not responding.
  const bytes = crypto.randomBytes(3_000);
  const queue = tmpQueue(t);
  const lying = fakeDrive(bytes);
  const truthful = lying.getMetadata;
  lying.getMetadata = async (fileId) => {
    const res = await truthful(fileId);
    return { ...res, data: { ...res.data, md5Checksum: 'f'.repeat(32) } };
  };
  const opts = passOptions(t, { drive: lying });
  queueIngestJob(queue);

  const first = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(first.blocked.length, 1);
  assert.deepEqual(queue.listJobs({ state: 'running' }), []);

  queueIngestJob(queue); // the operator re-queues, as the reason tells them to
  const second = await runIngest({ queue, owner: `${OWNER}-2`, ...opts });

  assert.equal(second.blocked.length, 1, 'the report still says blocked');
  assert.equal(second.ok, false);
  assert.deepEqual(
    queue.listJobs({ state: 'running' }), [],
    'and NOTHING is left running behind that report'
  );
  assert.deepEqual(queue.listJobs({ state: 'pending' }), [], 'nor pending');
  const blocked = queue.listJobs({ stage: STAGE_INGEST, state: 'blocked' });
  assert.equal(blocked.length, 1, 'exactly one blocked row, not one more per re-queue');
  assert.match(blocked[0].lastError, /do not match Drive's checksum/);

  // The cost was the next round, so prove there is no next round.
  assert.deepEqual(queue.reap(), { recovered: 0, blocked: 0 }, 'no lease left to expire');
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

test('a cache folder that does not exist yet is measured on its parent, and says so', async (t) => {
  const dir = tmpDir(t);
  const notMadeYet = path.join(dir, 'cache');
  const seen = [];
  const result = freeBytesFor(notMadeYet, (p) => {
    seen.push(p);
    if (p !== dir) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { bsize: 4096, bavail: 100 };
  });
  assert.equal(result.ok, true);
  assert.equal(result.value, 409_600);
  assert.equal(result.measuredAt, dir, 'it measured the parent, which is the disk the mkdir would land on');
  assert.equal(result.exists, false, 'and it says the folder itself was not there');
  assert.deepEqual(seen, [notMadeYet, dir], 'it asked about exactly two paths and stopped');
});

test('an UNMOUNTED volume is refused, not measured on whatever is further up', async (t) => {
  // The defect this replaces: the old walk-up went all the way to the nearest
  // existing ancestor, so STUDIO_CACHE_DIR=/Volumes/Studio/cache with the
  // drive unplugged measured `/Volumes` — i.e. the BOOT DISK — the floor
  // passed on another disk's numbers, and `mkdir -p` then put 3.57 GB on the
  // one disk the floor exists to protect.
  const seen = [];
  const result = freeBytesFor('/Volumes/Studio/cache', (p) => {
    seen.push(p);
    if (p === '/Volumes') return { bsize: 4096, bavail: 1_000_000 };
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  assert.equal(result.ok, false, 'a missing PARENT is what an unmounted volume looks like from here');
  assert.match(result.error, /could not be read/);
  assert.match(result.error, /not[\s\S]*mounted/);
  assert.deepEqual(
    seen,
    ['/Volumes/Studio/cache', '/Volumes/Studio'],
    'and it never asked /Volumes, which would have answered for the boot disk'
  );
});

test('a cache folder that IS there is measured on itself', async (t) => {
  const dir = tmpDir(t);
  const seen = [];
  const result = freeBytesFor(dir, (p) => {
    seen.push(p);
    return { bsize: 4096, bavail: 100 };
  });
  assert.equal(result.ok, true);
  assert.equal(result.measuredAt, dir);
  assert.equal(result.exists, true);
  assert.deepEqual(seen, [dir], 'no walk at all when the folder is there');
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

// ── The smaller findings from review round 1 (2026-09-16) ──────────────────

test('a Drive connection that goes quiet is abandoned, not waited on for ever', async (t) => {
  // `onProgress` — the only thing that renews the queue lease — fires on a
  // CHUNK. A connection that stops delivering without closing therefore sends
  // no heartbeat, and Node's fetch waits for ever by default: the pass sat
  // there while its lease quietly expired and another worker claimed the same
  // 3.57 GB file.
  const dir = tmpDir(t);
  const partPath = path.join(dir, 'download.part');
  let sawSignal = null;

  const silent = {
    openStream: async (fileId, { signal = null } = {}) => {
      sawSignal = signal;
      // A stream that emits nothing and never ends, exactly like a socket that
      // has gone quiet without being closed.
      const stream = new Readable({ read() { /* nothing, ever */ } });
      return { ok: true, status: 200, rangeHonoured: true, stream };
    },
  };

  const result = await downloadToPart({
    drive: silent,
    driveFileId: 'file_1',
    partPath,
    expectedBytes: 40_000,
    stallMs: 40,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 504, 'a stall is a timeout, not a transport error');
  assert.match(result.error, /no bytes arrived from Google Drive/);
  assert.equal(sawSignal !== null, true, 'and the real fetch is handed a signal, so a socket is torn down');
  assert.equal(sawSignal.aborted, true);
});

test('a stream that is still delivering is NEVER abandoned by the stall clock', async (t) => {
  // The other half, and the one that matters on a 3.57 GB download: the clock
  // is a STALL clock, not a total-time budget, so bytes arriving slowly over an
  // hour must not trip it. Chunks land 20ms apart with a 60ms stall budget.
  const dir = tmpDir(t);
  const partPath = path.join(dir, 'download.part');
  const bytes = crypto.randomBytes(500);

  const trickle = {
    openStream: async () => ({
      ok: true,
      status: 200,
      rangeHonoured: true,
      stream: Readable.from((async function* () {
        for (let at = 0; at < bytes.length; at += 100) {
          await new Promise((resolve) => { setTimeout(resolve, 20); });
          yield bytes.subarray(at, at + 100);
        }
      })()),
    }),
  };

  const result = await downloadToPart({
    drive: trickle, driveFileId: 'file_1', partPath, expectedBytes: bytes.length, stallMs: 60,
  });

  assert.equal(result.ok, true, 'five chunks over ~100ms, well past any total-time budget of 60ms');
  assert.equal(result.bytes, bytes.length);
  assert.deepEqual(fs.readFileSync(partPath), bytes);
});

test('a 409 from the database deletes the duplicate copy instead of leaking it', async (t) => {
  // The findSourceByContentHash dedupe deletes its copy; the 409 path — the
  // same dedupe, decided by the database — did not, and by then the bytes have
  // been renamed to finalPath. A full-size file with no catalog row pointing
  // at it is a cache leak the disk floor cannot see, because the floor measures
  // free space and never asks what is using it.
  const bytes = crypto.randomBytes(2_500);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const opts = passOptions(t, { bytes, catalog });

  // A pre-existing row with these bytes that the in-memory FINDER cannot see,
  // so the collision is only discovered by the write — which is the race the
  // 409 path exists for.
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const realCreate = catalog.createSource;
  catalog.createSource = async (input) => {
    catalog.createSource = realCreate;
    return { ok: false, status: 409, error: 'This file is already in the catalog for this project' };
  };

  queueIngestJob(queue);
  const report = await runIngest({ queue, owner: OWNER, ...opts });

  assert.equal(report.deduped.length, 1, formatIngestReport(report));
  assert.match(report.deduped[0].reason, /duplicate copy was deleted/);
  assert.equal(report.deduped[0].contentHash, hash);

  const paths = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'clip.mov',
  });
  assert.equal(fs.existsSync(paths.finalPath), false, 'the duplicate copy is gone');
  assert.equal(fs.existsSync(paths.partPath), false, 'and so is the part file');
});

test('renaming a file in Drive between attempts does not throw the partial bytes away', async (t) => {
  // The part file used to be named from the Drive NAME, which a person can
  // change at any moment — so a rename mid-download orphaned the partial bytes
  // and restarted from zero, the one thing this slice exists to prevent. The
  // containing directory is the Drive file id, which cannot move.
  const bytes = crypto.randomBytes(40_000);
  const dir = tmpDir(t);
  const cacheDir = path.join(dir, 'cache');

  const before = cachePathsFor({ cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'clip.mov' });
  const after = cachePathsFor({ cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'Wedding — take 2.mov' });

  assert.equal(before.partPath, after.partPath, 'the partial bytes live at the same place either way');
  assert.equal(path.dirname(before.partPath), before.dir, 'inside the folder named for the Drive file id');
  assert.equal(before.finalPath === after.finalPath, false, 'while the FINISHED file keeps the human name');

  // And it really does resume across the rename.
  fs.mkdirSync(before.dir, { recursive: true });
  const dying = fakeDrive(bytes, { cutAfter: 15_000 });
  await downloadToPart({
    drive: dying, driveFileId: 'file_1', partPath: before.partPath, expectedBytes: bytes.length,
  });
  assert.equal(fs.statSync(before.partPath).size, 15_000);

  const renamed = fakeDrive(bytes, { name: 'Wedding — take 2.mov' });
  const second = await downloadToPart({
    drive: renamed, driveFileId: 'file_1', partPath: after.partPath, expectedBytes: bytes.length,
  });
  assert.equal(second.ok, true);
  assert.equal(second.resumedFrom, 15_000, 'it resumed rather than starting again after the rename');
  assert.deepEqual(fs.readFileSync(after.partPath), bytes);
});

test('a rename between the DOWNLOAD and the registration does not refetch the file', async (t) => {
  // The part file moved onto the Drive file id in round 1; the FINISHED file
  // was left keyed on the name, which is the identical hole one step later.
  // `createSource` failing (the `failIt` retry path) leaves a complete file on
  // disk; rename the clip in Drive before the retry and the next attempt used
  // to compute a different `finalPath`, not find its own 3.57 GB, fetch the
  // whole thing again, and strand the first copy with no catalog row pointing
  // at it — a leak the disk floor cannot see.
  const bytes = crypto.randomBytes(9_000);
  const at = { now: Date.now() };
  const queue = tmpQueue(t, at);
  const catalog = fakeCatalog();
  let firstWrite = true;
  const realCreate = catalog.createSource;
  catalog.createSource = async (input) => {
    if (firstWrite) {
      firstWrite = false;
      return { ok: false, status: 503, error: 'the database was unreachable' };
    }
    return realCreate(input);
  };

  const opts = passOptions(t, { catalog, drive: fakeDrive(bytes) });
  queueIngestJob(queue);
  const first = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(first.failed.length, 1, 'the row could not be written, so the job retries');

  const oldPaths = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'clip.mov',
  });
  assert.equal(fs.statSync(oldPaths.finalPath).size, bytes.length, 'the finished file is on disk');

  // Now the clip is renamed in Drive, and the job comes round again (`fail`
  // holds a retry off with a backoff, so wind the clock rather than sleep).
  at.now += 10 * 60 * 1000;
  const renamed = fakeDrive(bytes, { name: 'Wedding — take 2.mov' });
  const second = await runIngest({
    queue, owner: OWNER, ...opts, drive: renamed, catalog,
  });
  assert.equal(second.ingested.length, 1, formatIngestReport(second));
  assert.deepEqual(renamed.calls, [], 'NOT ONE BYTE was fetched again');

  const newPaths = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'Wedding — take 2.mov',
  });
  assert.equal(second.ingested[0].localPath, newPaths.finalPath, 'the catalog points at the current name');
  assert.deepEqual(
    (await findCachedFiles(newPaths.dir)).map((f) => f.path), [newPaths.finalPath],
    'and exactly one copy is on disk — the old name is not left behind as a stray'
  );
});

test('a leftover copy of an OLDER version of the file is cleared up, not counted', async (t) => {
  // Same folder, wrong length: it can only be a previous version of this Drive
  // file, because the folder is named for the id. The old code removed it only
  // when it happened to carry the current name.
  const bytes = crypto.randomBytes(9_000);
  const queue = tmpQueue(t);
  const opts = passOptions(t, { drive: fakeDrive(bytes) });
  const paths = cachePathsFor({
    cacheDir: opts.cacheDir, lane: 'inbox', driveFileId: 'file_1', name: 'clip.mov',
  });
  fs.mkdirSync(paths.dir, { recursive: true });
  const stale = path.join(paths.dir, 'an older cut.mov');
  fs.writeFileSync(stale, crypto.randomBytes(4_321));

  queueIngestJob(queue);
  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ingested.length, 1, formatIngestReport(report));
  assert.equal(fs.existsSync(stale), false, 'the stale copy went');
  assert.deepEqual(
    (await findCachedFiles(paths.dir)).map((f) => f.path), [paths.finalPath],
    'leaving one file, the right one'
  );
});

test('the two documented Drive budgets are actually READ, and junk is refused', async (t) => {
  // The comment said "Override with STUDIO_DRIVE_TIMEOUT_MS /
  // STUDIO_DRIVE_STALL_MS" and neither name was read anywhere in the repo, so
  // both were hard-wired and an operator would have spent an hour setting a
  // variable that did nothing.
  assert.deepEqual(
    resolveDriveTimeouts({}, {}),
    { ok: true, value: { timeoutMs: 30 * 1000, stallMs: 2 * 60 * 1000 } }
  );
  assert.deepEqual(
    resolveDriveTimeouts({}, { STUDIO_DRIVE_TIMEOUT_MS: '5000', STUDIO_DRIVE_STALL_MS: '600000' }),
    { ok: true, value: { timeoutMs: 5000, stallMs: 600_000 } }
  );

  const junk = resolveDriveTimeouts({}, { STUDIO_DRIVE_STALL_MS: '5 minutes' });
  assert.equal(junk.ok, false, 'a junk value is not quietly swapped for the default');
  assert.match(junk.error, /STUDIO_DRIVE_STALL_MS is set to "5 minutes"/);
  assert.match(junk.error, /Fix: set it to a plain millisecond count/);
});

test('a junk Drive budget stops the pass with an alarm, and downloads nothing', async (t) => {
  const queue = tmpQueue(t);
  const drive = fakeDrive(crypto.randomBytes(4_000));
  const opts = passOptions(t, { drive, env: { STUDIO_DRIVE_TIMEOUT_MS: 'thirty seconds' } });
  queueIngestJob(queue);

  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.ok, false);
  assert.equal(report.unchecked.length, 1);
  assert.match(report.unchecked[0], /STUDIO_DRIVE_TIMEOUT_MS is set to "thirty seconds"/);
  assert.deepEqual(drive.calls, [], 'nothing was downloaded on a setting nobody can read');
  assert.equal(queue.listJobs({ stage: STAGE_INGEST_HEALTH })[0].state, 'blocked');
  assert.equal(report.healthStanding, true);
});

test('the stall budget set in the environment is the one the download uses', { timeout: 10_000 }, async (t) => {
  // Reading the variable is only half of it; it has to reach the watchdog.
  // With the wiring missing this does not fail loudly — it waits the hard-wired
  // two minutes, which is why the test carries its own timeout.
  const queue = tmpQueue(t);
  const silent = {
    getMetadata: fakeDrive(crypto.randomBytes(4_000)).getMetadata,
    openStream: async () => ({
      ok: true,
      status: 200,
      rangeHonoured: true,
      stream: new Readable({ read() { /* nothing, ever */ } }),
    }),
  };
  const opts = passOptions(t, { drive: silent, env: { STUDIO_DRIVE_STALL_MS: '60' } });
  queueIngestJob(queue);

  const started = Date.now();
  const report = await runIngest({ queue, owner: OWNER, ...opts });
  assert.equal(report.failed.length, 1, formatIngestReport(report));
  assert.match(report.failed[0].reason, /no bytes arrived from Google Drive/);
  assert.ok(
    Date.now() - started < 30_000,
    'it gave up on the configured 60ms, not on the hard-wired two minutes'
  );
});

test('the metadata budget reaches the real Drive client, which used to drop it', async (t) => {
  // `realDriveClient` had `getMetadata: (fileId) => getIngestMetadata(fileId)`
  // — the options argument was swallowed on the way through, so a caller could
  // pass any budget it liked and the call was always the hard-wired 30s.
  const realToken = googleDrive.getAccessToken;
  const realFetch = globalThis.fetch;
  googleDrive.getAccessToken = async () => ({ ok: true, status: 200, data: { accessToken: 'test' } });
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const socket = setTimeout(() => {
      reject(new Error('the fake fetch was never aborted — the budget did not reach it'));
    }, 5_000);
    if (!opts.signal) return;
    opts.signal.addEventListener('abort', () => {
      clearTimeout(socket);
      reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    });
  });
  t.after(() => {
    googleDrive.getAccessToken = realToken;
    globalThis.fetch = realFetch;
  });

  const res = await realDriveClient().getMetadata('file_1', { timeoutMs: 20 });
  assert.equal(res.ok, false, 'the 20ms budget was honoured rather than dropped');
  assert.equal(res.status, 504);
  assert.match(res.error, /did not answer within 0s/);
});

test('a span is rendered for a person', () => {
  assert.equal(humanDuration(0), '0 seconds');
  assert.equal(humanDuration(1000), '1 second');
  assert.equal(humanDuration(45_000), '45 seconds');
  assert.equal(humanDuration(10 * 60 * 1000), '10 minutes');
  assert.equal(humanDuration(60 * 1000), '1 minute');
  assert.equal(humanDuration(3 * 60 * 60 * 1000), '3 hours');
});

test('a hung Drive metadata call is abandoned with a timeout, not left hanging', async (t) => {
  // The other fetch. One small request, so a whole-call budget is the right
  // shape here — unlike the media stream, where only a stall clock makes sense.
  // No network: the token call and `fetch` are both swapped out, so what is
  // being tested is our own wiring — that a signal is passed, and that the
  // abort comes back as a 504 saying what happened rather than as a crash.
  const realToken = googleDrive.getAccessToken;
  const realFetch = globalThis.fetch;
  googleDrive.getAccessToken = async () => ({ ok: true, status: 200, data: { accessToken: 'test' } });
  let sawSignal = null;
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    sawSignal = opts.signal || null;
    // A real hung fetch holds the event loop open on its socket, and
    // AbortSignal.timeout's own timer deliberately does not — so the fake has
    // to stand in for the socket, or the loop drains before the abort fires.
    const socket = setTimeout(() => {
      reject(new Error('the fake fetch was never aborted — the timeout did not fire'));
    }, 5_000);
    if (!opts.signal) return; // no signal means this would hang for ever
    opts.signal.addEventListener('abort', () => {
      clearTimeout(socket);
      reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    });
  });
  t.after(() => {
    googleDrive.getAccessToken = realToken;
    globalThis.fetch = realFetch;
  });

  const res = await getIngestMetadata('file_1', { timeoutMs: 20 });
  assert.equal(sawSignal !== null, true, 'the call carries a signal at all');
  assert.equal(res.ok, false, 'it answered rather than hanging');
  assert.equal(res.status, 504);
  assert.match(res.error, /did not answer within/);
  assert.match(res.error, /abandoned rather than left hanging/);
});
