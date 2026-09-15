'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Studio Phase 1 · 3 of 8 (86bbjv684) — the Drive changes-API watcher.
 *
 * Everything here runs against a fake Drive: the point of the slice is what
 * the watcher DOES with what Drive says, and a test that needs a live Google
 * account is a test nobody runs. The fake answers in the same envelope
 * lib/googleDrive.js returns, including the `reason` field Google uses to tell
 * "your credential is dead" apart from "you are going too fast" — both of
 * which arrive as 403.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const {
  watchDrive,
  formatReport,
  classifyDriveFailure,
  isMediaMimeType,
  cursorResource,
  LANES,
  STAGE_INGEST,
  STAGE_WATCH,
  SUBJECT_WATCH,
} = require('../../workers/studio/drive.js');

const INBOX = 'folder_inbox';
const PLATES = 'folder_plates';

function tmpQueueFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-drive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'queue.sqlite');
}

function videoFile(id, name, parent, extra = {}) {
  return {
    id,
    name,
    mimeType: 'video/quicktime',
    trashed: false,
    parents: [parent],
    size: '1024',
    createdTime: '2026-09-15T04:00:00.000Z',
    modifiedTime: '2026-09-15T04:00:00.000Z',
    ...extra,
  };
}

/**
 * A Drive that answers from a script.
 *
 * `pages` is a list of change-pages handed out in order, so a test can make
 * the feed span several pages without inventing a paging protocol of its own.
 */
function fakeDrive({
  pages = [],
  startPageToken = 'START-1',
  account = 'mentor24@gmail.com',
  tokenResult = null,
  folderResult = null,
  changesResult = null,
} = {}) {
  const calls = { getAccessToken: 0, getAccount: 0, getFolder: [], getStartPageToken: 0, listChanges: [] };
  let pageIndex = 0;
  return {
    calls,
    getAccessToken: async () => {
      calls.getAccessToken += 1;
      return tokenResult || { ok: true, status: 200, data: { accessToken: 'tok' } };
    },
    getAccount: async () => {
      calls.getAccount += 1;
      return { ok: true, status: 200, data: { user: { emailAddress: account, displayName: 'Test' } } };
    },
    getFolder: async (_token, folderId) => {
      calls.getFolder.push(folderId);
      if (folderResult) return typeof folderResult === 'function' ? folderResult(folderId) : folderResult;
      return { ok: true, status: 200, data: { id: folderId, name: folderId } };
    },
    getStartPageToken: async () => {
      calls.getStartPageToken += 1;
      return { ok: true, status: 200, data: { startPageToken } };
    },
    listChanges: async (_token, opts) => {
      calls.listChanges.push(opts.pageToken);
      if (changesResult) return typeof changesResult === 'function' ? changesResult(opts) : changesResult;
      const page = pages[pageIndex] || { changes: [], newStartPageToken: `END-${pageIndex}` };
      pageIndex += 1;
      return { ok: true, status: 200, data: page };
    },
  };
}

function run(queue, drive, options = {}) {
  return watchDrive({
    queue,
    drive,
    inboxFolderId: INBOX,
    platesFolderId: PLATES,
    env: {},
    ...options,
  });
}

// ── AC1: a new file in either folder produces exactly one job ───────────────

test('a new file in either watched folder produces exactly one job', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({
    pages: [{
      changes: [
        { fileId: 'f_in', file: videoFile('f_in', 'interview.mov', INBOX) },
        { fileId: 'f_pl', file: videoFile('f_pl', 'screen.mov', PLATES) },
      ],
      newStartPageToken: 'CUR-2',
    }],
  });

  const report = await run(queue, drive);

  assert.equal(report.ok, true);
  assert.equal(report.processed.length, 2);
  const jobs = queue.listJobs({ stage: STAGE_INGEST });
  assert.equal(jobs.length, 2, 'one job per file, no more');
  assert.deepEqual(jobs.map((j) => j.subjectId).sort(), ['f_in', 'f_pl']);
});

test('the same file appearing twice in one feed still makes one job', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  // Drive really does report a file more than once — created, then modified.
  const drive = fakeDrive({
    pages: [{
      changes: [
        { fileId: 'f1', file: videoFile('f1', 'take.mov', INBOX) },
        { fileId: 'f1', file: videoFile('f1', 'take.mov', INBOX) },
      ],
      newStartPageToken: 'CUR-2',
    }],
  });

  const report = await run(queue, drive);

  assert.equal(queue.listJobs({ stage: STAGE_INGEST }).length, 1);
  assert.equal(report.processed.length, 1);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /already waiting/);
});

// ── AC2: the cursor persists, and a restart re-emits nothing ────────────────

test('the first ever run starts watching from now and replays nothing', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());

  const drive = fakeDrive({ startPageToken: 'START-42' });
  const report = await run(queue, drive);

  assert.equal(report.cursor.initialised, true);
  assert.equal(report.processed.length, 0, 'the whole history of the account is NOT queued');
  assert.equal(queue.getCursor(cursorResource('')), 'START-42');
  assert.equal(drive.calls.listChanges.length, 0, 'no changes are read before a baseline exists');
});

test('the page token survives a restart, and nothing already seen is re-emitted', async (t) => {
  const file = tmpQueueFile(t);

  // --- first process: consume one change and advance the cursor ---
  const first = openQueue(file);
  first.setCursor(cursorResource(''), 'CUR-1');
  const driveA = fakeDrive({
    pages: [{ changes: [{ fileId: 'f1', file: videoFile('f1', 'a.mov', INBOX) }], newStartPageToken: 'CUR-2' }],
  });
  const reportA = await run(first, driveA);
  assert.equal(reportA.processed.length, 1);
  assert.equal(first.getCursor(cursorResource('')), 'CUR-2');
  const jobIdA = reportA.processed[0].jobId;
  // Finish the job, so the queue's live-job guard is NOT what makes the second
  // pass quiet — the cursor has to be doing the work on its own.
  const claimed = first.claim('worker-1', { stages: [STAGE_INGEST] });
  assert.equal(claimed.id, jobIdA);
  assert.equal(first.complete(claimed.id, 'worker-1'), true);
  first.close();

  // --- a completely new process against the same file ---
  const second = openQueue(file);
  t.after(() => second.close());
  assert.equal(second.getCursor(cursorResource('')), 'CUR-2', 'the cursor survived the restart');

  const driveB = fakeDrive({ pages: [{ changes: [], newStartPageToken: 'CUR-3' }] });
  const reportB = await run(second, driveB);

  assert.deepEqual(driveB.calls.listChanges, ['CUR-2'], 'it resumed from the saved token, not from the start');
  assert.equal(reportB.processed.length, 0, 'the file already seen is not queued a second time');
  assert.equal(second.listJobs({ stage: STAGE_INGEST }).length, 1);
});

test('a transient failure leaves the cursor where it was, so no page is stepped over', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({ changesResult: { ok: false, status: 500, error: 'backend hiccup' } });
  const report = await run(queue, drive);

  assert.equal(report.ok, false);
  assert.equal(queue.getCursor(cursorResource('')), 'CUR-1', 'the page will be read again next pass');
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].reason, /could not be read/);
  assert.equal(report.blocked, null, 'a 500 is not somebody\'s fault to fix');
});

test('paging walks every page and saves the caught-up token at the end', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'P1');

  const drive = fakeDrive({
    pages: [
      { changes: [{ fileId: 'f1', file: videoFile('f1', 'a.mov', INBOX) }], nextPageToken: 'P2' },
      { changes: [{ fileId: 'f2', file: videoFile('f2', 'b.mov', INBOX) }], newStartPageToken: 'P3' },
    ],
  });

  const report = await run(queue, drive);

  assert.deepEqual(drive.calls.listChanges, ['P1', 'P2']);
  assert.equal(report.processed.length, 2);
  assert.equal(queue.getCursor(cursorResource('')), 'P3');
});

// ── AC3: a plate is marked, and is never queued for transcription ───────────

test('a file in /Studio/Plates/ is marked plate and is not for transcription', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({
    pages: [{
      changes: [
        { fileId: 'f_pl', file: videoFile('f_pl', 'screen.mov', PLATES) },
        { fileId: 'f_in', file: videoFile('f_in', 'cam.mov', INBOX) },
      ],
      newStartPageToken: 'CUR-2',
    }],
  });

  await run(queue, drive);

  const byId = new Map(queue.listJobs({ stage: STAGE_INGEST }).map((j) => [j.subjectId, j]));

  const plate = byId.get('f_pl');
  assert.equal(plate.payload.layerRole, 'plate');
  assert.equal(plate.payload.transcribe, false, 'a plate is never sent for transcription');
  assert.equal(plate.payload.lane, 'plates');

  const footage = byId.get('f_in');
  assert.equal(footage.payload.transcribe, true);
  assert.equal(
    footage.payload.layerRole,
    null,
    'the inbox folder does not say whether footage is the background or the subject, '
    + 'so the watcher states nothing rather than guessing'
  );
});

test('the lane table itself keeps plates out of transcription', () => {
  assert.equal(LANES.plates.layerRole, 'plate');
  assert.equal(LANES.plates.transcribe, false);
  assert.equal(LANES.inbox.layerRole, null);
  assert.equal(LANES.inbox.transcribe, true);
});

// ── AC4: a dead credential blocks once, with the fix, and never storms ──────

test('an expired token produces one blocked job naming the fix, not a crash', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());

  const drive = fakeDrive({
    tokenResult: { ok: false, status: 401, error: 'invalid_grant: token has been expired or revoked' },
  });

  const report = await run(queue, drive);

  assert.equal(report.ok, false);
  assert.ok(report.blocked, 'it filed a blocked job rather than throwing');
  assert.equal(report.blocked.kind, 'auth');
  assert.match(report.blocked.reason, /re-mint the refresh token/, 'the reason names the actual fix');

  const blocked = queue.listJobs({ state: 'blocked' });
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].stage, STAGE_WATCH);
  assert.match(blocked[0].lastError, /expired or has been revoked/);
});

test('a token that stays broken never piles up blocked jobs', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());

  const drive = fakeDrive({ tokenResult: { ok: false, status: 401, error: 'invalid_grant' } });

  // The watcher runs on a timer, so a broken credential is rediscovered on
  // every pass. Ten passes must still be one blocked job.
  for (let i = 0; i < 10; i += 1) await run(queue, drive);

  assert.equal(queue.listJobs({ state: 'blocked' }).length, 1, 'one alarm, not ten');
  assert.equal(queue.counts().pending, 0, 'and nothing was queued to retry against a wall');
});

test('a quota refusal blocks as quota, not as a dead credential', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({
    changesResult: {
      ok: false,
      status: 403,
      error: 'User rate limit exceeded',
      reason: 'userRateLimitExceeded',
    },
  });

  const report = await run(queue, drive);

  assert.equal(report.blocked.kind, 'quota');
  assert.match(report.blocked.reason, /clears on its own/);
  assert.doesNotMatch(report.blocked.reason, /re-mint/, 'nobody should be sent to rotate a healthy token');
});

test('a clean pass stands the alarm down and says so', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const broken = fakeDrive({ tokenResult: { ok: false, status: 401, error: 'invalid_grant' } });
  await run(queue, broken);
  assert.equal(queue.listJobs({ state: 'blocked' }).length, 1);

  const fixed = fakeDrive({ pages: [{ changes: [], newStartPageToken: 'CUR-2' }] });
  const report = await run(queue, fixed);

  assert.equal(report.ok, true);
  assert.equal(report.recovered, true, 'it reports that it just recovered');
  assert.equal(queue.listJobs({ state: 'blocked' }).length, 0, 'the stale alarm is gone');
});

// ── the account trap ────────────────────────────────────────────────────────

test('a folder the credential cannot see blocks naming BOTH accounts', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());

  const drive = fakeDrive({
    account: 'mentor24@gmail.com',
    folderResult: (id) => (id === PLATES
      ? { ok: false, status: 404, error: 'File not found: folder_plates.', reason: 'notFound' }
      : { ok: true, status: 200, data: { id, name: id } }),
  });

  const report = await run(queue, drive);

  assert.ok(report.blocked);
  assert.equal(report.blocked.kind, 'missing');
  assert.match(report.blocked.reason, /mentor24@gmail\.com/, 'it names the token\'s account');
  assert.match(report.blocked.reason, /\/Studio\/Plates\//, 'and which folder could not be reached');
  assert.match(report.blocked.reason, /share that folder|account that actually owns/);
});

test('the account is reported even when the pass goes perfectly', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({ account: 'mentorofaio@gmail.com', pages: [{ changes: [], newStartPageToken: 'CUR-2' }] });
  const report = await run(queue, drive);

  assert.equal(report.account, 'mentorofaio@gmail.com');
  assert.match(formatReport(report), /mentorofaio@gmail\.com/);
});

test('nothing configured to watch is a blocked job, not a quiet success', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());

  const report = await watchDrive({
    queue,
    drive: fakeDrive(),
    inboxFolderId: '',
    platesFolderId: '',
    env: {},
  });

  assert.ok(report.blocked);
  assert.match(report.blocked.reason, /STUDIO_DRIVE_INBOX_FOLDER_ID/);
});

test('one folder configured and one missing still watches the one, and says the other is unwatched', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({
    pages: [{ changes: [{ fileId: 'f1', file: videoFile('f1', 'a.mov', INBOX) }], newStartPageToken: 'CUR-2' }],
  });
  const report = await watchDrive({
    queue, drive, inboxFolderId: INBOX, platesFolderId: '', env: {},
  });

  assert.equal(report.processed.length, 1);
  assert.equal(report.unchecked.length, 1);
  assert.match(report.unchecked[0], /Plates.*not configured|STUDIO_DRIVE_PLATES_FOLDER_ID/);
});

// ── AC5: every outcome carries a reason (DOCTRINE 3.11) ─────────────────────

test('everything the watcher declines to queue says why', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({
    pages: [{
      changes: [
        { fileId: 'f_ok', file: videoFile('f_ok', 'good.mov', INBOX) },
        { fileId: 'f_gone', removed: true },
        { fileId: 'f_trash', file: videoFile('f_trash', 'bin.mov', INBOX, { trashed: true }) },
        { fileId: 'f_dir', file: videoFile('f_dir', 'a folder', INBOX, { mimeType: 'application/vnd.google-apps.folder' }) },
        { fileId: 'f_pdf', file: videoFile('f_pdf', 'notes.pdf', INBOX, { mimeType: 'application/pdf' }) },
        { fileId: 'f_else', file: videoFile('f_else', 'holiday.mov', 'some_other_folder') },
        { fileId: '', file: null },
      ],
      newStartPageToken: 'CUR-2',
    }],
  });

  const report = await run(queue, drive);

  assert.equal(report.processed.length, 1);

  // Declined, but IN a watched folder: named one by one, because this is the
  // handful of lines somebody actually reads.
  assert.equal(report.skipped.length, 3);
  for (const item of report.skipped) {
    assert.ok(item.reason && item.reason.length > 10, `a skip with no usable reason: ${JSON.stringify(item)}`);
    assert.ok(item.lane, 'a skip inside a watched folder says which folder it was in');
  }
  assert.match(report.skipped.find((s) => s.fileId === 'f_trash').reason, /trash/);
  assert.match(report.skipped.find((s) => s.fileId === 'f_dir').reason, /folder, not a file/);
  assert.match(report.skipped.find((s) => s.fileId === 'f_pdf').reason, /not video or audio/);

  // Not Studio business at all: counted by category, never listed by name.
  assert.equal(report.ignored.count, 3);
  assert.equal(
    Object.values(report.ignored.byReason).reduce((a, b) => a + b, 0),
    report.ignored.count,
    'the categories account for every ignored change — none is dropped'
  );

  // And the same facts survive into the thing a person actually reads.
  const text = formatReport(report);
  assert.match(text, /1 queued, 3 skipped, 0 failed, 3 not Studio files/);
  assert.match(text, /notes\.pdf/);
});

test('an account full of unrelated files does not drown the report', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  // The feed is account-wide. On the real account this is a 227GB archive
  // ticking over, and a line each would bury the one file that matters.
  const noise = Array.from({ length: 2000 }, (_, i) => ({
    fileId: `n${i}`,
    file: videoFile(`n${i}`, `holiday ${i}.mov`, 'some_other_folder'),
  }));
  const drive = fakeDrive({
    pages: [{
      changes: [...noise, { fileId: 'real', file: videoFile('real', 'the take.mov', INBOX) }],
      newStartPageToken: 'CUR-2',
    }],
  });

  const report = await run(queue, drive);
  const text = formatReport(report);

  assert.equal(report.processed.length, 1);
  assert.equal(report.ignored.count, 2000, 'every one is still accounted for');
  assert.equal(report.ignored.sample.length, 5, 'but only a handful are kept as examples');
  assert.ok(text.split('\n').length < 20, `the report stayed readable (${text.split('\n').length} lines)`);
  assert.match(text, /the take\.mov/, 'and the file that matters is still in it');
  assert.match(text, /ignored  2000 change\(s\)/);
});

test('a page with neither token leaves the cursor alone and says it could not tell', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({ changesResult: { ok: true, status: 200, data: { changes: [] } } });
  const report = await run(queue, drive);

  assert.equal(queue.getCursor(cursorResource('')), 'CUR-1');
  assert.equal(report.unchecked.length, 1);
  assert.match(report.unchecked[0], /neither nextPageToken nor newStartPageToken/);
});

test('a runaway feed stops at the page ceiling and says there is more waiting', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'P0');

  // Always another page, never a caught-up token.
  let n = 0;
  const drive = fakeDrive({
    changesResult: () => { n += 1; return { ok: true, status: 200, data: { changes: [], nextPageToken: `P${n}` } }; },
  });

  const report = await run(queue, drive, { maxPages: 3 });

  assert.equal(report.pagesRead, 3);
  assert.match(report.unchecked.join(' '), /more changes waiting/);
  assert.equal(queue.getCursor(cursorResource('')), 'P3', 'and it resumes from where it stopped');
});

// ── the small pieces, pinned directly ───────────────────────────────────────

test('403 means two different things and they are told apart', () => {
  assert.equal(classifyDriveFailure({ status: 403, reason: 'userRateLimitExceeded' }).kind, 'quota');
  assert.equal(classifyDriveFailure({ status: 403, reason: 'insufficientFilePermissions' }).kind, 'permission');
  assert.equal(classifyDriveFailure({ status: 401 }).kind, 'auth');
  assert.equal(classifyDriveFailure({ status: 429 }).kind, 'quota');
  assert.equal(classifyDriveFailure({ status: 404 }).kind, 'missing');
  assert.equal(classifyDriveFailure({ status: 503 }).kind, 'transient');
});

test('only video and audio are media', () => {
  assert.equal(isMediaMimeType('video/mp4'), true);
  assert.equal(isMediaMimeType('audio/wav'), true);
  assert.equal(isMediaMimeType('image/png'), false);
  assert.equal(isMediaMimeType(''), false);
  assert.equal(isMediaMimeType(null), false);
});

test('one changes feed is one cursor', () => {
  assert.equal(cursorResource(''), 'changes:my-drive');
  assert.equal(cursorResource('shared_123'), 'changes:shared_123');
});

test('nothing is scheduled at module scope', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'workers', 'studio', 'drive.js'), 'utf8');
  assert.doesNotMatch(src, /^\s*setInterval\(/m, 'DOCTRINE 5.2 — a module-scope timer hangs every test');
  assert.doesNotMatch(src, /^\s*setTimeout\(/m);
});

// ── the real client: what it actually ASKS Drive ─────────────────────────────
/**
 * Every test above drives a fake, which proves what the watcher DOES with an
 * answer and nothing at all about the question. These four drive the real
 * lib/googleDrive.js against a stubbed `fetch` so a typo in a query string
 * fails here rather than on the Mini at 3am.
 */
const googleDrive = require('../../lib/googleDrive.js');

function withStubbedFetch(t, handler) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return handler(String(url), init);
  };
  t.after(() => { globalThis.fetch = original; });
  return seen;
}

const okJson = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(body),
});

test('listDriveChanges asks for the cursor, the parents and the removals', async (t) => {
  const seen = withStubbedFetch(t, () => okJson({ changes: [], newStartPageToken: 'X' }));

  const res = await googleDrive.listDriveChanges('tok', { pageToken: 'CUR-9', pageSize: 250 });
  assert.equal(res.ok, true);

  const url = new URL(seen[0].url);
  assert.equal(url.pathname, '/drive/v3/changes');
  assert.equal(url.searchParams.get('pageToken'), 'CUR-9');
  assert.equal(url.searchParams.get('pageSize'), '250');
  assert.equal(url.searchParams.get('includeRemoved'), 'true', 'a deletion must arrive, or the watcher cannot skip it');
  const fields = url.searchParams.get('fields');
  // `parents` is the field the whole lane decision rests on; without it every
  // file looks like it is outside both watched folders and nothing is queued.
  assert.match(fields, /parents/);
  assert.match(fields, /trashed/);
  assert.match(fields, /nextPageToken/);
  assert.match(fields, /newStartPageToken/);
  assert.equal(seen[0].init.headers.Authorization, 'Bearer tok');
});

test('a shared drive is asked about as a shared drive', async (t) => {
  const seen = withStubbedFetch(t, () => okJson({ changes: [] }));
  await googleDrive.listDriveChanges('tok', { pageToken: 'C', driveId: 'shared_9' });
  const url = new URL(seen[0].url);
  assert.equal(url.searchParams.get('driveId'), 'shared_9');
  assert.equal(url.searchParams.get('corpora'), 'drive');
  assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
});

test('listDriveChanges refuses a missing cursor instead of reading from nowhere', async (t) => {
  const seen = withStubbedFetch(t, () => okJson({}));
  const res = await googleDrive.listDriveChanges('tok', { pageToken: '' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(seen.length, 0, 'and it did not call Drive at all');
});

test('the account and folder lookups ask the right endpoints', async (t) => {
  const seen = withStubbedFetch(t, () => okJson({ user: { emailAddress: 'a@b.c' }, id: 'f1' }));

  await googleDrive.getDriveAccount('tok');
  assert.match(seen[0].url, /\/drive\/v3\/about\?fields=user/);

  await googleDrive.getDriveFolder('tok', 'folder_1');
  assert.match(seen[1].url, /\/drive\/v3\/files\/folder_1\?/);
  assert.match(seen[1].url, /supportsAllDrives=true/);

  await googleDrive.getDriveStartPageToken('tok', {});
  assert.match(seen[2].url, /\/drive\/v3\/changes\/startPageToken/);
});

test('Google\'s own error reason survives the request helper', async (t) => {
  withStubbedFetch(t, () => ({
    ok: false,
    status: 403,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      error: { message: 'User rate limit exceeded', errors: [{ reason: 'userRateLimitExceeded' }] },
    }),
  }));

  const res = await googleDrive.listDriveChanges('tok', { pageToken: 'C' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'userRateLimitExceeded');
  // And the watcher reads that reason the way this slice depends on.
  assert.equal(classifyDriveFailure(res).kind, 'quota');
});

// ── round 2: the failure paths, each one reproduced before it was fixed ─────
//
// Every test below started life as a scratch script the review pass wrote to
// make the real `watchDrive` misbehave against a scripted Drive. None of them
// could be reached by walking the happy path, which is why the first two
// rounds of this ticket shipped with all four defects green.

test('a file that could not be queued holds the cursor, so the next pass still gets it', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  // The queue refuses exactly once, the way a busy SQLite does.
  let refuseNext = true;
  const flaky = {
    ...queue,
    enqueue: (job) => {
      if (refuseNext) {
        refuseNext = false;
        throw new Error('SQLITE_BUSY: database is locked');
      }
      return queue.enqueue(job);
    },
  };
  const page = {
    changes: [{ fileId: 'x1', file: videoFile('x1', 'shoot.mp4', INBOX) }],
    newStartPageToken: 'CUR-2',
  };

  const a = await run(flaky, fakeDrive({ pages: [page] }));
  assert.equal(a.ok, false);
  assert.equal(a.failed.length, 1);
  assert.equal(a.cursorHeld, true, 'and it says out loud that it did not step over the page');
  assert.equal(
    queue.getCursor(cursorResource('')), 'CUR-1',
    'THE POINT: Drive never re-reports an unchanged file, so advancing here loses it for good'
  );
  assert.match(formatReport(a), /cursor was NOT advanced/);

  // Because the cursor never moved, the same page arrives again — and this
  // time the queue takes it.
  const b = await run(flaky, fakeDrive({ pages: [page] }));
  assert.equal(b.processed.length, 1, 'the footage is picked up rather than lost');
  assert.equal(queue.getCursor(cursorResource('')), 'CUR-2', 'and now the cursor may move');
  assert.equal(queue.listJobs({ stage: STAGE_INGEST }).length, 1, 'exactly one job, still');
});

test('a pass that could not confirm a folder does not stand a real alarm down', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  // Pass 1: a genuine permission refusal on the Inbox raises the alarm.
  await run(queue, fakeDrive({
    folderResult: (id) => (id === INBOX
      ? { ok: false, status: 403, reason: 'insufficientPermissions', error: 'no access' }
      : { ok: true, status: 200, data: { id, name: id } }),
  }));
  assert.equal(queue.listJobs({ state: 'blocked' }).length, 1, 'the permission problem is on the board');

  // Pass 2: the folder check itself cannot be made at all. The account-wide
  // changes feed reads fine, so every other reading this pass takes is clean —
  // which is exactly what made the old code declare victory.
  const report = await run(queue, fakeDrive({
    folderResult: { ok: false, status: 502, error: 'Bad gateway' },
    pages: [{ changes: [], newStartPageToken: 'CUR-2' }],
  }));

  assert.equal(report.failed.length, 0, 'nothing actually failed...');
  assert.equal(report.blind.length, 2, '...but neither folder could be confirmed');
  assert.equal(report.ok, false, 'so this is not a clean pass');
  assert.equal(report.recovered, false, 'and it has not earned the right to say Drive is readable');
  assert.equal(
    queue.listJobs({ state: 'blocked' }).length, 1,
    'the permission problem is untouched and still standing'
  );

  const printed = formatReport(report);
  assert.match(printed, /COULD NOT TELL/, 'and it reads as a could-not-tell, not a failure and not a pass');
  assert.doesNotMatch(printed, /Drive is readable again/);
});

test('an unreachable OAuth host is not reported as a dead credential', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());

  const report = await run(queue, fakeDrive({
    tokenResult: { ok: false, status: 502, error: 'Could not reach Google OAuth: fetch failed' },
  }));

  // Stopping the pass is right — a watcher with no token is blind. Naming the
  // wrong fix is not: re-minting a refresh token that was fine costs an
  // afternoon and does not help.
  assert.equal(report.blocked.kind, 'transient', 'filed as what it is');
  assert.doesNotMatch(report.blocked.reason, /re-mint/i);
  assert.doesNotMatch(report.blocked.reason, /expired or has been revoked/i);
  assert.match(report.blocked.reason, /Could not reach Google OAuth/);
});

test('a real credential failure still names the credential fix', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());

  const report = await run(queue, fakeDrive({
    tokenResult: { ok: false, status: 401, error: 'invalid_grant' },
  }));
  assert.equal(report.blocked.kind, 'auth');
  assert.match(report.blocked.reason, /re-mint/i, 'the fix above must not have broken this one');
});

// ── the Account trap: one changes feed is one drive ─────────────────────────

test('a watched folder on another drive blocks instead of reading the wrong feed', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({
    folderResult: (id) => ({ ok: true, status: 200, data: { id, name: id, driveId: '0ABCsharedDrive' } }),
    pages: [{ changes: [], newStartPageToken: 'CUR-2' }],
  });
  const report = await run(queue, drive);

  assert.equal(report.ok, false);
  assert.equal(report.blocked.kind, 'wrong_drive');
  assert.match(report.blocked.reason, /0ABCsharedDrive/, 'it names the drive the folder is actually on');
  assert.match(report.blocked.reason, /STUDIO_DRIVE_ID/, 'and the setting that fixes it');
  assert.equal(
    drive.calls.listChanges.length, 0,
    'and it never read the wrong feed — a permanently dead watcher used to render as a clean pass'
  );
});

test('the same folder is watched normally once the drive matches', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource('0ABCsharedDrive'), 'CUR-1');

  const report = await run(queue, fakeDrive({
    folderResult: (id) => ({ ok: true, status: 200, data: { id, name: id, driveId: '0ABCsharedDrive' } }),
    pages: [{
      changes: [{ fileId: 'f1', file: videoFile('f1', 'a.mov', INBOX) }],
      newStartPageToken: 'CUR-2',
    }],
  }), { driveId: '0ABCsharedDrive' });

  assert.equal(report.blocked, null, 'a matching drive is not an error');
  assert.equal(report.ok, true);
  assert.equal(report.processed.length, 1);
});

test('both lanes pointed at one folder blocks instead of filing everything as a plate', async (t) => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  queue.setCursor(cursorResource(''), 'CUR-1');

  const drive = fakeDrive({
    pages: [{
      changes: [{ fileId: 'f1', file: videoFile('f1', 'interview.mov', INBOX) }],
      newStartPageToken: 'CUR-2',
    }],
  });
  const report = await watchDrive({
    queue, drive, inboxFolderId: INBOX, platesFolderId: INBOX, env: {},
  });

  assert.equal(report.blocked.kind, 'same_folder');
  assert.match(report.blocked.reason, /never transcribed/, 'it says what the damage would be');
  assert.equal(report.processed.length, 0, 'and nothing was queued as a plate in the meantime');
  assert.equal(drive.calls.getAccessToken, 0, 'caught before a single Drive call');
});
