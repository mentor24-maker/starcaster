'use strict';

/**
 * Media intake (ticket 86bcfgyxp) — against a scratch Zoom folder, a fake
 * clock and a fake uploader that "uploads" into a scratch Drive folder and
 * reports the MD5 of what it holds, the way Drive does.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const intake = require('../../lib/mediaIntake.js');
const nodeRoles = require('../../lib/nodeRoles.js');
const heartbeat = require('../../lib/nodeHeartbeat.js');

const MIN = 60 * 1000;

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-intake-'));
  const root = path.join(dir, 'Zoom');
  const drive = path.join(dir, 'drive');
  fs.mkdirSync(root);
  fs.mkdirSync(drive);
  return { dir, root, drive, ledgerFile: path.join(dir, 'state', 'ledger.json') };
}

/** Write a recording and backdate it, so it is (or is not) "finished". */
function record(root, folder, file, body, mtimeMs) {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  const p = path.join(root, folder, file);
  fs.writeFileSync(p, body);
  const t = new Date(mtimeMs);
  fs.utimesSync(p, t, t);
  return p;
}

function fakeUploader(drive, { corrupt = false } = {}) {
  const calls = [];
  return {
    calls,
    async upload(local, name) {
      calls.push(name);
      fs.copyFileSync(local, path.join(drive, name));
      if (corrupt) fs.appendFileSync(path.join(drive, name), 'x');
    },
    async remoteMd5(name) {
      return crypto.createHash('md5').update(fs.readFileSync(path.join(drive, name))).digest('hex');
    },
  };
}

/**
 * The first run sets the cutover at its own clock, so a fixture that wants a
 * "new" recording runs once at T0 (nothing yet), then records after T0.
 */
async function primed(s, t0) {
  const up = fakeUploader(s.drive);
  const first = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: t0 });
  assert.equal(first.firstRun, true);
  return up;
}

const T0 = Date.UTC(2026, 9, 9, 18, 0, 0);
const MEETING = '2026-10-09 13.00.00 Dane test 612342203';

test('a new, finished .mp4 is sent once, flat into the Inbox, named for its meeting', async () => {
  const s = scratch();
  const up = await primed(s, T0);
  record(s.root, MEETING, 'video1234.mp4', 'frames', T0 + 5 * MIN);
  const r = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 10 * MIN });
  assert.equal(r.sent.length, 1, intake.renderPass(r));
  assert.deepEqual(up.calls, [`Zoom - ${MEETING} - video1234.mp4`]);
  assert.ok(!up.calls[0].includes('/'), 'a "/" would make rclone file it in a sub-folder the watcher ignores');
});

test('a second run sends nothing', async () => {
  const s = scratch();
  const up = await primed(s, T0);
  record(s.root, MEETING, 'video1234.mp4', 'frames', T0 + 5 * MIN);
  await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 10 * MIN });
  const again = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 25 * MIN });
  assert.equal(again.sent.length, 0);
  assert.equal(again.alreadySent.length, 1);
  assert.equal(up.calls.length, 1, 'uploaded twice');
});

test('a renamed copy of a sent file is not sent again — the ledger keys on the bytes', async () => {
  const s = scratch();
  const up = await primed(s, T0);
  const original = record(s.root, MEETING, 'video1234.mp4', 'same bytes', T0 + 5 * MIN);
  await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 10 * MIN });
  fs.renameSync(path.join(s.root, MEETING), path.join(s.root, '2026-10-09 13.00.00 renamed meeting'));
  record(s.root, 'a copy somewhere else 2026', 'copy.mp4', fs.readFileSync(path.join(s.root, '2026-10-09 13.00.00 renamed meeting', 'video1234.mp4')), T0 + 12 * MIN);
  assert.ok(!fs.existsSync(original));
  const r = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 30 * MIN });
  assert.equal(r.sent.length, 0, intake.renderPass(r));
  assert.equal(r.alreadySent.length, 2);
  assert.equal(up.calls.length, 1);
});

test('a file still being written waits, and goes once it has been left alone for 2 minutes', async () => {
  const s = scratch();
  const up = await primed(s, T0);
  record(s.root, MEETING, 'video1.mp4', 'growing', T0 + 9 * MIN);
  const early = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 10 * MIN });
  assert.equal(early.sent.length, 0);
  assert.match(early.waiting[0].why, /still being written/);
  const later = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 12 * MIN });
  assert.equal(later.sent.length, 1);
});

/**
 * HOW THE PLACEHOLDER CASE IS TESTED, and what is not. A real iCloud
 * placeholder needs an iCloud account and a file evicted by the system; a test
 * cannot make one. What CAN be tested is the rule the code applies — a file
 * whose allocated blocks fall short of its size is not on the disk — by
 * handing the pass a stat that says exactly that, as iCloud's dataless files
 * and part-fetched files both do. The file is never read: the fake hash
 * throws if it is.
 */
test('a placeholder (size without the bytes) is never read or sent', async () => {
  const s = scratch();
  const up = await primed(s, T0);
  const p = record(s.root, MEETING, 'video1.mp4', 'x'.repeat(100000), T0 + 1 * MIN);
  const real = fs.statSync(p);
  const io = {
    ...fs,
    statSync: (f) => (f === p ? Object.assign(Object.create(Object.getPrototypeOf(real)), real, { blocks: 0 }) : fs.statSync(f)),
  };
  const r = await intake.runPass({
    root: s.root,
    ledgerFile: s.ledgerFile,
    uploader: up,
    now: T0 + 30 * MIN,
    io,
    hash: () => { throw new Error('read a placeholder'); },
  });
  assert.equal(r.sent.length, 0);
  assert.match(r.waiting[0].why, /not fully downloaded/);
  assert.equal(up.calls.length, 0);
});

test('isFullyLocal: no blocks, or half the blocks, is not local; all of them is', () => {
  assert.equal(intake.isFullyLocal({ size: 1 << 20, blocks: 0 }), false);
  assert.equal(intake.isFullyLocal({ size: 1 << 20, blocks: 1024 }), false);
  assert.equal(intake.isFullyLocal({ size: 1 << 20, blocks: 2048 }), true);
  assert.equal(intake.isFullyLocal({ size: 0, blocks: 0 }), false);
});

test('audio, sidecars, dot-files and iCloud stand-ins are skipped; only the .mp4 goes', async () => {
  const s = scratch();
  const up = await primed(s, T0);
  for (const f of ['audio1.m4a', 'playback.m3u', 'chat.txt', 'recording.conf', 'double_click_to_convert_01.zoom', '.video2.mp4.icloud', '.hidden.mp4']) {
    record(s.root, MEETING, f, f, T0 + 1 * MIN);
  }
  record(s.root, MEETING, 'video1.mp4', 'v', T0 + 1 * MIN);
  const r = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 30 * MIN });
  assert.deepEqual(up.calls, [`Zoom - ${MEETING} - video1.mp4`]);
  assert.equal(r.sent.length, 1);
});

test('history (from before the first run) is not the scheduled pass\'s job', async () => {
  const s = scratch();
  record(s.root, '2020-04-09 15.10.19 my meeting 612342203', 'zoom_0.mp4', 'old', Date.UTC(2020, 3, 9));
  const up = fakeUploader(s.drive);
  const r = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 });
  assert.equal(r.sent.length, 0);
  assert.equal(r.history.length, 1);
  assert.equal(up.calls.length, 0);
});

test('an upload Drive cannot confirm is a failure, and is tried again next pass', async () => {
  const s = scratch();
  await primed(s, T0);
  record(s.root, MEETING, 'video1.mp4', 'v', T0 + 1 * MIN);
  const bad = fakeUploader(s.drive, { corrupt: true });
  const r = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: bad, now: T0 + 30 * MIN });
  assert.equal(r.sent.length, 0);
  assert.match(r.failed[0].why, /checksum/);
  const good = fakeUploader(s.drive);
  const retry = await intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: good, now: T0 + 45 * MIN });
  assert.equal(retry.sent.length, 1, 'a failed upload was recorded as sent');
});

test('an unreadable ledger stops the pass instead of re-sending everything', async () => {
  const s = scratch();
  fs.mkdirSync(path.dirname(s.ledgerFile), { recursive: true });
  fs.writeFileSync(s.ledgerFile, '{ not json');
  await assert.rejects(
    intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: fakeUploader(s.drive), now: T0 }),
    /not JSON/,
  );
});

test('a Zoom folder that cannot be read fails loudly, never as "nothing new"', async () => {
  const s = scratch();
  await assert.rejects(
    intake.runPass({ root: path.join(s.dir, 'missing'), ledgerFile: s.ledgerFile, uploader: fakeUploader(s.drive), now: T0 }),
    /could not read the Zoom folder/,
  );
});

test('backfill dry run lists history with totals and sends nothing; --apply keeps to the allowance', async () => {
  const s = scratch();
  record(s.root, '2019-05-01 10.00.00 oldest', 'video1.mp4', 'a'.repeat(400), Date.UTC(2019, 4, 1));
  record(s.root, '2021-06-01 10.00.00 middle', 'video2.mp4', 'b'.repeat(400), Date.UTC(2021, 5, 1));
  record(s.root, '2026-09-20 10.00.00 newest', 'video3.mp4', 'c'.repeat(400), Date.UTC(2026, 8, 20));
  const up = await primed(s, T0);

  const dry = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up });
  assert.equal(dry.count, 3);
  assert.equal(dry.bytes, 1200);
  assert.match(dry.oldest.folder, /oldest/);
  assert.match(dry.newest.folder, /newest/);
  assert.equal(up.calls.length, 0, 'the dry run uploaded something');
  assert.match(intake.renderBackfill(dry), /DRY RUN/);

  const run1 = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, apply: true, limitBytes: 800 });
  assert.equal(run1.sent.length, 2, intake.renderBackfill(run1));
  assert.equal(run1.deferred, 1);
  assert.match(run1.sent[0].path, /oldest/, 'history goes oldest first');

  const run2 = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, apply: true, limitBytes: 800 });
  assert.equal(run2.sent.length, 1);
  const dryAfter = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up });
  assert.equal(dryAfter.count, 0);
  assert.equal(up.calls.length, 3);
});

test('backfill asks iCloud for a placeholder and leaves it for a later run', async () => {
  const s = scratch();
  const p = record(s.root, '2019-05-01 10.00.00 oldest', 'video1.mp4', 'a'.repeat(100000), Date.UTC(2019, 4, 1));
  const up = await primed(s, T0);
  const real = fs.statSync(p);
  const io = { ...fs, statSync: (f) => (f === p ? Object.assign(Object.create(Object.getPrototypeOf(real)), real, { blocks: 0 }) : fs.statSync(f)) };
  const asked = [];
  const r = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, apply: true, io, requestDownload: (f) => asked.push(f) });
  assert.deepEqual(asked, [p]);
  assert.equal(r.sent.length, 0);
  assert.equal(r.notLocal, 1);
});

test('rcloneUploader uploads into the Inbox by folder id and reads Drive\'s checksum back', async () => {
  const seen = [];
  const up = intake.rcloneUploader({
    remote: 'gdrive:',
    folderId: 'INBOX',
    run: async (args) => { seen.push(args); return { status: 0, stdout: 'abc123  Zoom - m - v.mp4\n', stderr: '' }; },
  });
  await up.upload('/tmp/v.mp4', 'Zoom - m - v.mp4');
  assert.equal(await up.remoteMd5('Zoom - m - v.mp4'), 'abc123');
  assert.deepEqual(seen[0], ['copyto', '/tmp/v.mp4', 'gdrive:Zoom - m - v.mp4', '--drive-root-folder-id', 'INBOX']);
  const failing = intake.rcloneUploader({ run: async () => ({ status: 127, stdout: '', stderr: 'rclone: not found' }) });
  await assert.rejects(failing.upload('/tmp/v.mp4', 'n'), /exit 127.*not found/);
});

test('meetingFolderTime reads Zoom\'s folder names', () => {
  const t = intake.meetingFolderTime('2020-04-09 15.10.19 my meeting 612342203');
  assert.equal(new Date(t).getFullYear(), 2020);
  assert.equal(intake.meetingFolderTime('not a meeting'), null);
});

test('media-intake is the MacBook\'s, and the roll call says why it is not beating yet', () => {
  assert.equal(nodeRoles.ROLES['media-intake'].owner, 'macbook-pro');
  assert.ok(heartbeat.NOT_REPORTING_WHY['media-intake'] || heartbeat.BEAT_EMITTERS['media-intake']);
});

test('the installer\'s plist is valid, runs the runner every 15 minutes, and names no secret', () => {
  const plist = execFileSync('bash', [path.join(__dirname, '..', 'install_media_intake.sh'), '--print-plist'], { encoding: 'utf8' });
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(plist, /scripts\/run_media_intake\.sh/);
  assert.doesNotMatch(plist, /doppler|TOKEN|SECRET/i);
  if (process.platform === 'darwin') {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-plist-')), 'p.plist');
    fs.writeFileSync(file, plist);
    execFileSync('plutil', ['-lint', file]);
  }
});

// --- round 1 of review: the lock must not outlive its run ---------------------

test('a lock naming a live, unrelated process taken hours ago is taken over', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-lock-'));
  const lockFile = path.join(dir, 'run.lock');
  // What a shutdown mid-pass leaves: the old run's number, now reused by a
  // system process that answers EPERM (read as alive).
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 1, startedAt: new Date(T0 - 5 * 60 * MIN).toISOString() }));
  const lock = intake.acquireLock(dir, { now: T0, pid: 4242, alive: () => true, commandOf: () => '/sbin/launchd' });
  assert.equal(lock.ok, true, 'a leftover lock turned the pass away');
  assert.equal(lock.tookOver.holder, 1);
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid, 4242);
  lock.release();
  assert.ok(!fs.existsSync(lockFile));
});

test('a fresh lock held by an unrelated live process is taken over — pid reuse after a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-lock-'));
  fs.writeFileSync(path.join(dir, 'run.lock'), JSON.stringify({ pid: 77, startedAt: new Date(T0 - 5 * MIN).toISOString() }));
  const lock = intake.acquireLock(dir, { now: T0, pid: 4242, alive: () => true, commandOf: () => '/usr/libexec/syspolicyd' });
  assert.equal(lock.ok, true);
  assert.match(lock.tookOver.why, /not a media-intake run/);
});

test('the first version\'s bare-number lock is aged by the file\'s own time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-lock-'));
  const lockFile = path.join(dir, 'run.lock');
  fs.writeFileSync(lockFile, '1');
  const old = new Date(T0 - 4 * 60 * MIN);
  fs.utimesSync(lockFile, old, old);
  const lock = intake.acquireLock(dir, { now: T0, pid: 4242, alive: () => true, commandOf: () => null });
  assert.equal(lock.ok, true);
  assert.match(lock.tookOver.why, /longer than any pass runs/);
});

test('a real run still holding the lock is respected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-lock-'));
  fs.writeFileSync(path.join(dir, 'run.lock'), JSON.stringify({ pid: 77, startedAt: new Date(T0 - 10 * MIN).toISOString() }));
  const lock = intake.acquireLock(dir, {
    now: T0, pid: 4242, alive: () => true, commandOf: () => 'node scripts/media_intake.mjs --backfill zoom --apply',
  });
  assert.equal(lock.ok, false);
  assert.equal(lock.holder, 77);
});

test('a run that was taken over does not delete its successor\'s lock on the way out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-lock-'));
  const first = intake.acquireLock(dir, { now: T0, pid: 100, alive: () => true, commandOf: () => 'node media_intake.mjs' });
  const second = intake.acquireLock(dir, { now: T0 + 4 * 60 * MIN, pid: 200, alive: () => true, commandOf: () => 'node media_intake.mjs' });
  assert.equal(second.ok, true);
  first.release();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'run.lock'), 'utf8')).pid, 200);
});

test('the runner records no beat for a pass skipped because of the lock', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'run_media_intake.sh'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'media_intake.mjs'), 'utf8');
  assert.match(script, /still going[^\n]*\n\s*process\.exit\(3\)/, 'a locked pass must exit 3, not 0');
  const beatAt = runner.indexOf('--beat');
  const beatGuard = runner.lastIndexOf('if [ "$status" -eq 0 ]', beatAt);
  assert.ok(beatGuard >= 0 && beatGuard < beatAt, 'the beat is only for exit 0');
  assert.match(runner, /"\$status" -eq 3[\s\S]*?exit 0/);
  assert.match(script, /process\.once\(signal/, 'the lock is released on SIGTERM');
});

// --- round 1 of review: history must not send a recording still being written

test('backfill --apply waits for a recording still being written, then sends the finished one', async () => {
  const s = scratch();
  // Before the first scheduled pass: no cutover, so a meeting Zoom is
  // converting right now counts as history too.
  const p = record(s.root, MEETING, 'video1.mp4', 'half', T0 - 30 * 1000);
  const up = fakeUploader(s.drive);
  const r = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, apply: true, now: T0 });
  assert.equal(r.sent.length, 0, intake.renderBackfill(r));
  assert.match(r.waiting[0].why, /still being written/);
  assert.equal(up.calls.length, 0, 'a half-written recording was uploaded');

  fs.writeFileSync(p, 'half and the rest');
  const t = new Date(T0 + 1 * MIN);
  fs.utimesSync(p, t, t);
  const later = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, apply: true, now: T0 + 10 * MIN });
  assert.equal(later.sent.length, 1, intake.renderBackfill(later));
  assert.equal(fs.readFileSync(path.join(s.drive, later.sent[0].as), 'utf8'), 'half and the rest');
});

test('backfill: a path sent at one size and since grown is offered again, not skipped as known', async () => {
  const s = scratch();
  const p = record(s.root, MEETING, 'video1.mp4', 'part', T0 - 10 * MIN);
  const up = fakeUploader(s.drive);
  await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, apply: true, now: T0 });
  fs.writeFileSync(p, 'part plus more');
  const t = new Date(T0 - 5 * MIN);
  fs.utimesSync(p, t, t);
  const dry = await intake.runBackfill({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 });
  assert.equal(dry.count, 1, 'the grown recording was hidden as already sent');
});

// --- Apple Photos: the Studio album (ticket 86bcfgyy6) ----------------------

/**
 * A fake Photos library. `query` deliberately returns EVERY item, not only the
 * album's — a stand-in for an osxphotos that reads `--album` loosely — so the
 * "only the album" test proves the filter in lib/mediaIntake.js itself.
 */
function fakePhotos(items, { albums = ['Studio', 'Family'] } = {}) {
  const exported = [];
  const created = [];
  return {
    exported,
    created,
    items,
    async albums() { return albums; },
    async createAlbum(name) { created.push(name); },
    async query() { return items.map(({ body, ...rest }) => rest); },
    async exportOriginal(item, dir) {
      exported.push(item.uuid);
      const src = items.find((i) => i.uuid === item.uuid);
      const p = path.join(dir, src.original_filename);
      fs.writeFileSync(p, src.body);
      return p;
    },
  };
}

function photoItem(uuid, { albums = ['Studio'], ismovie = true, body = `bytes of ${uuid}`, name = `${uuid}.MOV` } = {}) {
  return { uuid, albums, ismovie, body, original_filename: name, date: '2026-10-09T18:04:11.123000-06:00' };
}

function photosRun(s, photos, uploader, extra = {}) {
  return intake.runPhotos({
    photos, ledgerFile: s.ledgerFile, uploader, stagingDir: path.join(s.dir, 'state', 'photos-export'), ...extra,
  });
}

test('photos: a video in the Studio album is sent once; a photo is skipped and counted', async () => {
  const s = scratch();
  const up = fakeUploader(s.drive);
  const photos = fakePhotos([
    photoItem('V1', { name: 'IMG_0001.MOV' }),
    photoItem('P1', { ismovie: false, name: 'IMG_0002.HEIC' }),
    photoItem('P2', { ismovie: false, name: 'IMG_0003.HEIC' }),
  ]);
  const first = await photosRun(s, photos, up);
  assert.deepStrictEqual(first.sent.map((x) => x.as), ['Photos - 2026-10-09 18.04.11 - IMG_0001.MOV']);
  assert.strictEqual(first.photosSkipped, 2);
  assert.deepStrictEqual(photos.exported, ['V1'], 'photos are never exported');
  assert.ok(fs.existsSync(path.join(s.drive, 'Photos - 2026-10-09 18.04.11 - IMG_0001.MOV')));
  assert.match(intake.renderPhotos(first), /sent 1, already sent 0, failed 0, photos skipped \(only videos are sent\) 2/);

  const second = await photosRun(s, photos, up);
  assert.strictEqual(second.sent.length, 0);
  assert.strictEqual(second.alreadySent.length, 1);
  assert.strictEqual(up.calls.length, 1, 'uploaded exactly once');
  assert.deepStrictEqual(fs.readdirSync(path.join(s.dir, 'state', 'photos-export')), [], 'the export copy is deleted');
});

test('photos: only the Studio album — a family video is never exported or sent', async () => {
  const s = scratch();
  const up = fakeUploader(s.drive);
  const photos = fakePhotos([
    photoItem('FAM', { albums: ['Family'] }),
    photoItem('NONE', { albums: [] }),
    photoItem('V1', { albums: ['Family', 'Studio'] }),
  ]);
  const report = await photosRun(s, photos, up);
  assert.deepStrictEqual(photos.exported, ['V1']);
  assert.strictEqual(report.sent.length, 1);
  assert.strictEqual(report.outsideAlbum, 2);
});

test('photos: re-adding a sent video to the album sends nothing and does not even export it', async () => {
  const s = scratch();
  const up = fakeUploader(s.drive);
  const items = [photoItem('V1')];
  const photos = fakePhotos(items);
  await photosRun(s, photos, up);
  items.length = 0; // taken out of the album
  await photosRun(s, photos, up);
  items.push(photoItem('V1')); // and put back — Photos keeps its id
  const back = await photosRun(s, photos, up);
  assert.strictEqual(back.sent.length, 0);
  assert.strictEqual(back.alreadySent.length, 1);
  assert.deepStrictEqual(photos.exported, ['V1'], 'exported once, ever');
  assert.strictEqual(up.calls.length, 1);
});

test('photos: the same bytes under a second Photos id are not sent again', async () => {
  const s = scratch();
  const up = fakeUploader(s.drive);
  const photos = fakePhotos([photoItem('V1', { body: 'same' }), photoItem('V2', { body: 'same', name: 'copy.MOV' })]);
  const report = await photosRun(s, photos, up);
  assert.strictEqual(report.sent.length, 1);
  assert.strictEqual(report.alreadySent.length, 1);
  assert.strictEqual(up.calls.length, 1);
  const { ledger } = intake.readLedger(s.ledgerFile);
  assert.ok(ledger.photos.V1 && ledger.photos.V2, 'both ids recorded, so neither is exported again');
});

test('photos: a failed export or upload is a failure, recorded nowhere, and tried again next pass', async () => {
  const s = scratch();
  const photos = fakePhotos([photoItem('V1')]);
  const bad = await photosRun(s, photos, fakeUploader(s.drive, { corrupt: true }));
  assert.strictEqual(bad.failed.length, 1);
  assert.match(bad.failed[0].why, /checksum/);
  assert.deepStrictEqual(intake.readLedger(s.ledgerFile).ledger.photos, {});
  const good = await photosRun(s, photos, fakeUploader(s.drive));
  assert.strictEqual(good.sent.length, 1);
});

test('photos: no Studio album — it is made, and nothing is sent; failing to make it is a failure', async () => {
  const s = scratch();
  const photos = fakePhotos([photoItem('V1')], { albums: ['Family'] });
  const made = await photosRun(s, photos, fakeUploader(s.drive));
  assert.strictEqual(made.albumCreated, true);
  assert.deepStrictEqual(photos.created, ['Studio']);
  assert.strictEqual(made.sent.length, 0);
  assert.match(intake.renderPhotos(made), /so one was made/);

  const refused = fakePhotos([], { albums: [] });
  refused.createAlbum = async () => { throw new Error('not allowed to send Apple events'); };
  const r = await photosRun(s, refused, fakeUploader(s.drive));
  assert.strictEqual(r.failed.length, 1);
  assert.match(r.failed[0].why, /no album called "Studio".*not allowed/);
});

test('photos: without the permission the pass reports CANNOT READ PHOTOS with the fix — never "0 new videos"', async () => {
  const s = scratch();
  const calls = [];
  const eperm = Object.assign(new Error('Operation not permitted'), { code: 'EPERM' });
  const photos = intake.osxphotosAdapter({
    run: async (...a) => { calls.push(a); return { status: 0, stdout: '{}' }; },
    library: '/L/Photos Library.photoslibrary',
    io: { ...fs, readdirSync: () => { throw eperm; } },
  });
  await assert.rejects(photosRun(s, photos, fakeUploader(s.drive)), (err) => {
    assert.ok(err instanceof intake.PhotosUnreadable);
    assert.match(err.message, /^CANNOT READ PHOTOS — macOS refused access/);
    assert.match(err.fix, /Privacy & Security › Full Disk Access/);
    return true;
  });
  assert.strictEqual(calls.length, 0, 'osxphotos is not even asked once the library is known to be blocked');
});

test('photos adapter: osxphotos refusing, hanging or missing all read as CANNOT READ PHOTOS', async () => {
  const io = { ...fs, readdirSync: () => [] };
  const cases = [
    [{ status: 2, stderr: "Error: Invalid value for '--library': Path '/L' is not readable." }, /refused the library/],
    [{ status: null, timedOut: true, stdout: '' }, /did not answer within/],
    [{ status: 127, stderr: 'spawn osxphotos ENOENT' }, /not installed/],
    [{ status: 0, stdout: 'not json' }, /did not print JSON/],
  ];
  for (const [res, why] of cases) {
    const photos = intake.osxphotosAdapter({ run: async () => res, library: '/L', io });
    await assert.rejects(photos.albums(), (err) => {
      assert.ok(err instanceof intake.PhotosUnreadable, `${why}: ${err && err.message}`);
      assert.match(err.message, /^CANNOT READ PHOTOS — /);
      assert.match(err.message, why);
      return true;
    });
  }
});

test('photos adapter: every osxphotos call names the library (without it, osxphotos hangs when blocked)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxp-'));
  const calls = [];
  const photos = intake.osxphotosAdapter({
    library: '/L',
    io: { ...fs, readdirSync: (p) => (p === '/L' ? [] : fs.readdirSync(p)) },
    run: async (bin, args) => {
      calls.push(args);
      if (args[0] === 'albums') return { status: 0, stdout: '{"albums": {"Studio": 1}, "shared albums": {}}' };
      if (args[0] === 'query') return { status: 0, stdout: '[]' };
      fs.writeFileSync(path.join(args[1], 'IMG_1.MOV'), 'x');
      fs.writeFileSync(path.join(args[1], '.osxphotos_export.db'), 'db');
      return { status: 0, stdout: '' };
    },
  });
  assert.deepStrictEqual(await photos.albums(), ['Studio']);
  await photos.query('Studio');
  const file = await photos.exportOriginal({ uuid: 'U', original_filename: 'IMG_1.MOV' }, dir);
  assert.strictEqual(file, path.join(dir, 'IMG_1.MOV'));
  for (const args of calls) assert.deepStrictEqual(args.slice(-2), ['--library', '/L'], args.join(' '));
  assert.ok(calls[1].includes('--album') && calls[1].includes('Studio'));
  assert.ok(calls[2].includes('--download-missing') && calls[2].includes('--skip-edited'), 'originals, from iCloud if needed');
});

test('photos: an iCloud-only video macOS will not download says PERMISSION DENIED with the fix, and goes once it is local', async () => {
  // IMG_1978.MOV on 2026-10-12 (ticket 86bcgxhgc): osxphotos exits 0 having
  // exported nothing, because tccd refused the Apple Events it needs to ask
  // Photos for the original. The adapter here is the REAL one; only osxphotos
  // is faked — first as that refusal, then as the original having come down.
  const s = scratch();
  let local = false;
  const item = { ...photoItem('IMG1978', { name: 'IMG_1978.MOV' }), ismissing: true };
  delete item.body;
  const photos = intake.osxphotosAdapter({
    library: '/L',
    io: { ...fs, readdirSync: (p) => (p === '/L' ? [] : fs.readdirSync(p)) },
    run: async (bin, args) => {
      if (args[0] === 'albums') return { status: 0, stdout: '{"albums": {"Studio": 1}}' };
      if (args[0] === 'query') return { status: 0, stdout: JSON.stringify([{ ...item, ismissing: !local }]) };
      if (local) fs.writeFileSync(path.join(args[1], 'IMG_1978.MOV'), 'the original');
      return { status: 0, stdout: local ? 'Exporting 1 photo' : 'Exporting 1 photo\nExported 0 photos' };
    },
  });
  const refused = await photosRun(s, photos, fakeUploader(s.drive));
  assert.strictEqual(refused.failed.length, 1);
  assert.match(refused.failed[0].why, /^PERMISSION DENIED — the original is only in iCloud/);
  assert.match(refused.failed[0].fix, /Photos › Settings › iCloud › choose "Download Originals to this Mac"/);
  const text = intake.renderPhotos(refused);
  assert.match(text, /FAILED {3}Photos IMG_1978\.MOV \(IMG1978\) — PERMISSION DENIED/);
  assert.match(text, /\n {4}FIX: On the MacBook: Photos › Settings › iCloud/);
  assert.doesNotMatch(text, /may not have come down/, 'the old guess is gone');
  assert.deepStrictEqual(intake.readLedger(s.ledgerFile).ledger.photos, {}, 'recorded nowhere, so tried again');

  local = true; // Dane opened it in Photos, or turned on "Download Originals"
  const sent = await photosRun(s, photos, fakeUploader(s.drive));
  assert.strictEqual(sent.failed.length, 0);
  assert.strictEqual(sent.sent.length, 1);
});

test('photos adapter: "exported nothing" names the cause it can see, and never guesses', () => {
  const refusedByMacOS = intake.exportedNothing({ ismissing: false }, '', 'execution error: Not authorized to send Apple events to Photos. (-1743)');
  assert.match(refusedByMacOS.message, /^PERMISSION DENIED/, 'an Apple Events refusal in either stream is a permission denial');
  assert.ok(refusedByMacOS.fix);

  const onThisMac = intake.exportedNothing({ ismissing: false }, 'boom');
  assert.match(onThisMac.message, /the original IS on this Mac.*boom/);
  assert.strictEqual(onThisMac.fix, undefined);

  const unknown = intake.exportedNothing({});
  assert.match(unknown.message, /did not say whether the original is on this Mac or only in iCloud/);
  for (const err of [onThisMac, unknown]) assert.doesNotMatch(err.message, /PERMISSION DENIED|may not have come down/);
});

test('photos: the Drive name carries the date taken, and no slash survives', () => {
  assert.strictEqual(intake.photosDriveName({ date: '2026-10-09T18:04:11-06:00', original_filename: 'a/b.MOV' }),
    'Photos - 2026-10-09 18.04.11 - a-b.MOV');
  assert.strictEqual(intake.photosDriveName({ original_filename: 'IMG_9.MOV' }), 'Photos - IMG_9.MOV');
});

// --- the Drive sign-in ticket (task SC-879) ---------------------------------

const signin = require('../../lib/driveSigninTicket.js');

// What rclone printed on the MacBook on 2026-11-18, word for word in its shape.
const REFUSED_STDERR = [
  '2026/11/18 12:22:04 ERROR : Zoom - m - v.mp4: Failed to copy: couldn\'t fetch token: invalid_grant: '
    + 'maybe token expired? - try refreshing with "rclone config reconnect gdrive:"',
  '2026/11/18 12:22:04 ERROR : Attempt 1/3 failed with 1 errors',
  '2026/11/18 12:22:05 ERROR : Attempt 2/3 failed with 1 errors',
  '2026/11/18 12:22:06 ERROR : Attempt 3/3 failed with 1 errors',
].join('\n');
// rclone wraps EVERY token failure in "maybe token expired?", a dead network included.
const NETWORK_STDERR = 'Failed to copy: couldn\'t fetch token: Post "https://oauth2.googleapis.com/token": '
  + 'dial tcp: lookup oauth2.googleapis.com: no such host: maybe token expired? - try refreshing with '
  + '"rclone config reconnect gdrive:"';

test('a refused Drive sign-in is told apart from every other rclone failure', async () => {
  assert.equal(intake.isSigninRefusal(REFUSED_STDERR), true);
  assert.equal(intake.isSigninRefusal('oauth2: "invalid_grant" "Token has been expired or revoked."'), true);
  assert.equal(intake.isSigninRefusal(NETWORK_STDERR), false, 'a DNS failure is not "sign in again"');
  assert.equal(intake.isSigninRefusal('googleapi: Error 403: The user\'s Drive storage quota has been exceeded'), false);

  const refused = intake.rcloneUploader({ run: async () => ({ status: 1, stdout: '', stderr: REFUSED_STDERR }) });
  // The refusal is on the FIRST line; the message keeps only the last three. It must still be seen.
  const err = await refused.upload('/tmp/v.mp4', 'v.mp4').then(() => null, (e) => e);
  assert.equal(err.signinRefused, true);
  assert.match(err.message, /Google refused the Drive sign-in/);

  const blip = intake.rcloneUploader({ run: async () => ({ status: 1, stdout: '', stderr: NETWORK_STDERR }) });
  const other = await blip.upload('/tmp/v.mp4', 'v.mp4').then(() => null, (e) => e);
  assert.ok(other && !other.signinRefused);

  assert.deepEqual(await intake.rcloneUploader({ run: async () => ({ status: 0, stdout: '' }) }).probe(), { ok: true });
  const probed = await refused.probe();
  assert.equal(probed.ok, false);
  assert.equal(probed.signinRefused, true);
});

test('a pass whose upload is refused reports it as a sign-in refusal; an ordinary failure does not', async () => {
  const s = scratch();
  const now = Date.parse('2026-11-18T19:22:00Z');
  record(s.root, '2026-11-18 12.16.00 test 1', 'video1.mp4', 'a', now - 10 * MIN);
  const ledgerFile = s.ledgerFile;
  // Cutover before the recording, so it counts as new.
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.writeFileSync(ledgerFile, JSON.stringify({ ...intake.readLedger(ledgerFile).ledger, cutoverAt: new Date(now - 60 * MIN).toISOString() }));

  const refusedUp = intake.rcloneUploader({ run: async () => ({ status: 1, stdout: '', stderr: REFUSED_STDERR }) });
  const report = await intake.runPass({ root: s.root, ledgerFile, uploader: refusedUp, now });
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].signinRefused, true);
  assert.deepEqual(signin.signinVerdict([report]), { verdict: 'refused', waiting: 1 });

  const blipUp = intake.rcloneUploader({ run: async () => ({ status: 1, stdout: '', stderr: NETWORK_STDERR }) });
  const blipReport = await intake.runPass({ root: s.root, ledgerFile, uploader: blipUp, now });
  assert.equal(blipReport.failed.length, 1);
  assert.equal(blipReport.failed[0].signinRefused, undefined);
  assert.equal(signin.signinVerdict([blipReport]).verdict, 'unknown');

  assert.equal(signin.signinVerdict([{ sent: [{}], failed: [] }]).verdict, 'working');
  assert.equal(signin.signinVerdict([{ sent: [], failed: [] }]).verdict, 'unknown');
});

function fakeWriter(result = { ok: true, id: 'SC-1', url: 'http://tracker/t/SC-1' }) {
  const calls = [];
  const write = async (rendered, remembered) => { calls.push({ rendered, remembered }); return result; };
  return { calls, write };
}

test('the sign-in ticket: written once on a refusal, not rewritten for nothing new, cleared when it works', async () => {
  const broke = Date.parse('2026-11-18T19:22:00Z');
  const w = fakeWriter();

  const first = await signin.report({ state: {}, verdict: 'refused', waiting: 1, now: broke, write: w.write });
  assert.equal(first.outcome, 'written');
  assert.equal(w.calls.length, 1);
  const body = w.calls[0].rendered.body;
  assert.equal(w.calls[0].rendered.assign, true, 'Dane is assigned while it is broken');
  assert.match(body, /Nov 18/);
  assert.match(body, /12:22 PM MST/, 'the date it broke, in Mountain time');
  assert.match(body, /rclone config reconnect gdrive:/);
  assert.match(body, /mentorofaio/);
  assert.match(body, /1 recording waiting/);

  // Fifteen minutes later, still refused, nothing new: no rewrite, and the date stays the FIRST refusal.
  const second = await signin.report({ state: first.state, verdict: 'refused', waiting: 1, now: broke + 15 * MIN, write: w.write });
  assert.equal(second.outcome, 'unchanged');
  assert.equal(w.calls.length, 1);
  assert.equal(second.state.brokenSince, new Date(broke).toISOString());

  // A pass that reached Drive neither way changes nothing.
  const quiet = await signin.report({ state: second.state, verdict: 'unknown', write: w.write });
  assert.equal(quiet.outcome, 'nothing');
  assert.equal(w.calls.length, 1);

  // A second recording waiting is news: rewritten, same date.
  const more = await signin.report({ state: quiet.state, verdict: 'refused', waiting: 2, now: broke + 30 * MIN, write: w.write });
  assert.equal(more.outcome, 'written');
  assert.match(w.calls[1].rendered.body, /2 recordings waiting/);
  assert.match(w.calls[1].rendered.body, /12:22 PM MST/);
  assert.equal(w.calls[1].remembered, 'SC-1', 'the ticket it wrote is the one it rewrites');

  // He signs in again; the next upload works: cleared, unassigned.
  const fixed = await signin.report({ state: more.state, verdict: 'working', now: broke + 60 * MIN, write: w.write });
  assert.equal(fixed.outcome, 'written');
  assert.equal(w.calls[2].rendered.assign, false, 'Dane is unassigned once it works');
  assert.match(w.calls[2].rendered.body, /Nothing needed/);
  assert.equal(fixed.state.brokenSince, null);

  // Working again and again: never rewritten.
  const still = await signin.report({ state: fixed.state, verdict: 'working', now: broke + 75 * MIN, write: w.write });
  assert.equal(still.outcome, 'unchanged');
  assert.equal(w.calls.length, 3);
});

test('a sign-in ticket that could not be written is reported as NOT sent, and tried again next pass', async () => {
  const now = Date.parse('2026-11-18T19:22:00Z');
  const failing = fakeWriter({ ok: false, why: 'the tracker on the Mini did not answer' });
  const out = await signin.report({ state: {}, verdict: 'refused', waiting: 1, now, write: failing.write });
  assert.equal(out.outcome, 'failed');
  assert.match(out.lines.join('\n'), /could NOT write/);
  assert.match(out.lines.join('\n'), /has NOT been told/);
  assert.match(out.lines.join('\n'), /did not answer/);
  assert.doesNotMatch(out.lines.join('\n'), /wrote the/);
  assert.equal(out.state.ticket, undefined, 'a failed write is not remembered as written');
  assert.equal(out.state.brokenSince, new Date(now).toISOString(), 'but the date it broke is kept');

  // A writer that throws is the same failure, never a crash.
  const throwing = await signin.report({ state: {}, verdict: 'refused', write: async () => { throw new Error('door exited 1'); } });
  assert.equal(throwing.outcome, 'failed');

  const ok = fakeWriter();
  const retry = await signin.report({ state: out.state, verdict: 'refused', waiting: 1, now: now + 15 * MIN, write: ok.write });
  assert.equal(retry.outcome, 'written', 'the next pass tries again');
  assert.match(ok.calls[0].rendered.body, /12:22 PM MST/, 'still dated from the first refusal');
});

test('a dry run prints the sign-in ticket it would write and writes nothing', async () => {
  const w = fakeWriter();
  const out = await signin.report({ state: {}, verdict: 'refused', waiting: 0, dryRun: true, write: w.write });
  assert.equal(out.outcome, 'dry-run');
  assert.equal(w.calls.length, 0);
  assert.match(out.lines.join('\n'), /would write the "Google Drive sign-in needed on the MacBook" ticket \(assign Dane: true\)/);
  assert.deepEqual(out.state, {}, 'nothing remembered');
});

test('a probe while broken: working clears, a refusal stays, anything else tells nothing', () => {
  assert.equal(signin.probeVerdict({ ok: true }).verdict, 'working');
  assert.deepEqual(signin.probeVerdict({ ok: false, signinRefused: true }, 3), { verdict: 'refused', waiting: 3 });
  assert.equal(signin.probeVerdict({ ok: false, signinRefused: false, why: 'no such host' }).verdict, 'unknown');
});

// --- SC-878: the Photos album pass is off; Zoom alone decides the exit -------

/** A Studio album holding one video macOS will not download (the 2026-11-18 shape). */
function unsendableAlbum() {
  const photos = fakePhotos([photoItem('IMG2114', { name: 'IMG_2114.MOV' })]);
  photos.exportOriginal = async () => {
    throw new Error('PERMISSION DENIED — the original is only in iCloud and macOS will not let this job download it');
  };
  return photos;
}

/** One scheduled pass after a primed first run, with a new finished Zoom take waiting. */
async function scheduledPass(s, photos, photosEnabled) {
  const up = await primed(s, T0);
  record(s.root, MEETING, 'video1.mp4', 'a finished zoom take', T0 + 5 * MIN);
  const lines = [];
  return intake.runScheduledPass({
    zoom: () => intake.runPass({ root: s.root, ledgerFile: s.ledgerFile, uploader: up, now: T0 + 10 * MIN }),
    photos: () => photosRun(s, photos, up),
    photosEnabled,
    say: (l) => lines.push(l),
    warn: (l) => lines.push(l),
  }).then((r) => ({ ...r, lines, up }));
}

test('SC-878: with the album pass off, an unsendable album video no longer fails the pass', async () => {
  const s = scratch();
  const photos = unsendableAlbum();
  const r = await scheduledPass(s, photos, intake.photosAlbumEnabled({}));
  assert.strictEqual(r.code, 0, r.lines.join('\n'));
  assert.strictEqual(r.reports.length, 1, 'only the Zoom report');
  assert.strictEqual(r.reports[0].sent.length, 1, 'the Zoom half still sends');
  assert.deepStrictEqual(photos.exported, [], 'Photos was never touched');
  assert.match(r.lines.join('\n'), /Photos album "Studio": OFF \(retired 2026-11-25, SC-878\)/);
});

test('SC-878: switched back on, the same unsendable album video fails the pass (so the runner posts and does not beat)', async () => {
  const s = scratch();
  const r = await scheduledPass(s, unsendableAlbum(), intake.photosAlbumEnabled({ MEDIA_INTAKE_PHOTOS_ALBUM: '1' }));
  assert.strictEqual(r.code, 1);
  assert.match(r.lines.join('\n'), /FAILED {3}Photos IMG_2114\.MOV \(IMG2114\) — PERMISSION DENIED/);
});

test('SC-878: the album opt-in is off unless set to a yes value', () => {
  for (const v of [undefined, '', '0', 'no', 'off', 'false']) {
    assert.strictEqual(intake.photosAlbumEnabled({ MEDIA_INTAKE_PHOTOS_ALBUM: v }), false, `"${v}" switched it on`);
  }
  for (const v of ['1', 'on', 'YES', ' true ']) {
    assert.strictEqual(intake.photosAlbumEnabled({ MEDIA_INTAKE_PHOTOS_ALBUM: v }), true, `"${v}" left it off`);
  }
  assert.strictEqual(intake.photosAlbumEnabled({}), false);
});

test('SC-878: a Zoom failure still fails the pass with the album off', async () => {
  const r = await intake.runScheduledPass({
    zoom: async () => { throw new Error('iCloud folder missing'); },
    photos: async () => { throw new Error('must not run'); },
    photosEnabled: false,
  });
  assert.strictEqual(r.code, 1);
});

test('SC-878: the scheduled script reads the opt-in rather than always running Photos', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'media_intake.mjs'), 'utf8');
  assert.match(script, /photosEnabled: intake\.photosAlbumEnabled\(process\.env\)/);
  assert.doesNotMatch(script, /^\s*const report = await intake\.runPhotos\(/m, 'the script calls runPhotos directly again');
});
