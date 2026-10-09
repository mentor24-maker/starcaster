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
