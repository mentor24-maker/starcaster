'use strict';

/**
 * Tests for lib/archiveMac.js and scripts/archive_mac.mjs — copy what Drive is
 * missing from the Mac's Desktop, Downloads and old Desktop folder, verify it,
 * and only then move the copies into the Trash (ticket 86bbvr0yr, slice 3 of
 * 86bbvqh4z).
 *
 * The end-to-end block runs the real script against a scratch "home" and two
 * scratch folders standing in for the Drives (rclone treats a local folder as a
 * target). It checks both directions: a file whose copy is on a "Drive" moves,
 * and the SAME file stays when its copy is taken off the Drive before `clear`
 * runs — or when the file on the Mac changed after it was uploaded.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const mac = require('../../lib/archiveMac.js');

const ROOT = path.resolve(__dirname, '..', '..');

test('destination: video → mentorofaio, the rest → mentor24, mirroring the Mac folder', () => {
  assert.deepEqual(mac.destination('Desktop', 'Zoom/call.MP4'), { remote: 'gdrive:', path: 'Archives-from-mac/Desktop/Zoom/call.MP4', reason: 'video → mentorofaio' });
  const doc = mac.destination('Desktop - Dane’s MacBook Pro (2)', 'Clients/a.pdf');
  assert.deepEqual([doc.remote, doc.path], ['m24:', 'Restored from Mac/Desktop - Dane’s MacBook Pro (2)/Clients/a.pdf']);
});

function files() {
  return [
    { folder: 'Desktop', rel: 'on-drive.jpg', size: 10, hash: 'h1' },
    { folder: 'Desktop', rel: 'new.pdf', size: 11, hash: 'h2' },
    { folder: 'Downloads', rel: 'new-copy.pdf', size: 11, hash: 'h2' },
    { folder: 'Desktop', rel: 'clip.mov', size: 12, hash: 'h3' },
    { folder: 'Desktop', rel: 'empty.txt', size: 0 },
    { folder: 'Desktop', rel: '.DS_Store', size: 6, hash: 'h4' },
    { folder: 'Desktop', rel: 'repo/.git/HEAD', size: 7, hash: 'h5' },
    { folder: 'Desktop', rel: 'ISITAS/placeholder.txt', size: 520, dataless: true },
    { folder: 'Desktop', rel: 'locked.pdf', size: 9, error: 'EACCES' },
  ];
}

test('plan: every file lands in exactly one state, with a reason', () => {
  const drive = new Map([['h1:10', 'mentor24: Photos/on-drive.jpg']]);
  const rows = mac.plan(files(), drive);
  const by = Object.fromEntries(rows.map((r) => [mac.rowId(r), r]));
  assert.equal(rows.length, files().length, 'a file went missing from the plan');
  assert.equal(by['Desktop/on-drive.jpg'].action, 'SKIP');
  assert.match(by['Desktop/on-drive.jpg'].reason, /already on Drive: mentor24: Photos\/on-drive\.jpg/);
  assert.equal(by['Desktop/new.pdf'].action, 'UPLOAD');
  assert.equal(by['Desktop/new.pdf'].dest.remote, 'm24:');
  // The second copy of the same bytes is not uploaded twice.
  assert.equal(by['Downloads/new-copy.pdf'].action, 'SKIP');
  assert.equal(by['Downloads/new-copy.pdf'].sameAs, 'Desktop/new.pdf');
  assert.equal(by['Desktop/clip.mov'].dest.remote, 'gdrive:');
  assert.equal(by['Desktop/empty.txt'].reason, 'empty (0 bytes)');
  assert.equal(by['Desktop/.DS_Store'].reason, 'system file');
  assert.match(by['Desktop/repo/.git/HEAD'].reason, /inside \.git/);
  // A placeholder is never read — reading it would download it.
  assert.equal(by['Desktop/ISITAS/placeholder.txt'].action, 'HOLD');
  assert.match(by['Desktop/ISITAS/placeholder.txt'].reason, /placeholder/);
  assert.equal(by['Desktop/locked.pdf'].action, 'HOLD');
});

test('fits: a Drive without room (plus the spare) refuses; what is already verified does not count', () => {
  const rows = mac.plan([{ folder: 'Desktop', rel: 'big.pdf', size: 10 * 1024 ** 3, hash: 'b' }], new Map());
  const tight = mac.fits(rows, { 'm24:': 12 * 1024 ** 3, 'gdrive:': 1e15 });
  assert.equal(tight.ok, false);
  assert.match(tight.lines[0], /DOES NOT FIT/);
  assert.equal(mac.fits(rows, { 'm24:': 16 * 1024 ** 3, 'gdrive:': 1e15 }).ok, true);
  const ledger = new Map([['Desktop/big.pdf', { verified: true }]]);
  assert.equal(mac.fits(rows, { 'm24:': 1, 'gdrive:': 1e15 }, ledger).ok, false, 'the spare still has to be free');
  assert.equal(mac.fits(rows, { 'm24:': 6 * 1024 ** 3, 'gdrive:': 1e15 }, ledger).ok, true);
  // An unreadable quota is not "plenty of room".
  assert.equal(mac.fits(rows, { 'm24:': null, 'gdrive:': 1e15 }).ok, false);
});

test('clearable: only bytes on a Drive now, in their current form, may leave', () => {
  const drive = new Set(['h2:11']);
  const present = (h, s) => drive.has(`${h}:${s}`);
  const up = { folder: 'Desktop', rel: 'new.pdf', size: 11, hash: 'h2', action: 'UPLOAD' };
  assert.equal(mac.clearable(up, { size: 11, hash: 'h2' }, present).ok, true);
  assert.match(mac.clearable(up, { size: 11, hash: 'h9' }, present).why, /changed since the plan/);
  assert.match(mac.clearable({ ...up, hash: 'h3', size: 12 }, { size: 12, hash: 'h3' }, present).why, /no copy/);
  assert.equal(mac.clearable(up, null, present).gone, true);
  assert.equal(mac.clearable({ ...up, action: 'HOLD', reason: 'placeholder' }, { size: 11, hash: 'h2' }, present).ok, false);
  assert.equal(mac.clearable({ ...up, rel: 'repo/.git/x', action: 'SKIP', reason: 'inside .git/' }, { size: 11, hash: 'h2' }, present).ok, false, 'broke up a .git folder');
});

test('batches: one (Drive, folder) per batch, capped by count and bytes', () => {
  const r = (folder, rel, size, remote) => ({ folder, rel, size, dest: { remote } });
  const b = mac.batches([r('Desktop', 'a', 5, 'm24:'), r('Desktop', 'b', 5, 'gdrive:'), r('Desktop', 'c', 5, 'm24:'), r('Downloads', 'd', 5, 'm24:'), r('Desktop', 'e', 5, 'm24:')], 2, 100);
  assert.deepEqual(b.map((x) => [x.remote, x.folder, x.rows.map((y) => y.rel).join('')]), [
    ['m24:', 'Desktop', 'ac'], ['gdrive:', 'Desktop', 'b'], ['m24:', 'Downloads', 'd'], ['m24:', 'Desktop', 'e'],
  ]);
  const big = mac.batches([r('Desktop', 'a', 60, 'm24:'), r('Desktop', 'b', 60, 'm24:')], 500, 100);
  assert.equal(big.length, 2, 'a batch ran past its byte cap');
});

const haveRclone = spawnSync('rclone', ['version']).status === 0;

test('end to end: upload, verify, clear into the Trash — and keep what is not safely on Drive', { skip: !haveRclone && 'rclone not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-mac-'));
  const home = path.join(tmp, 'home');
  const m24 = path.join(tmp, 'm24');
  const gdrive = path.join(tmp, 'gdrive');
  const state = path.join(tmp, 'state');
  const trash = path.join(tmp, 'trash');
  const put = (rel, body) => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };
  for (const d of [m24, gdrive]) fs.mkdirSync(d, { recursive: true });
  const shot = 'Screenshots/Screenshot 2025-08-23 at 11.37.08\u202fPM.png'; // the character every macOS screenshot name carries (86bc4x5wh)
  const files = {
    'Desktop/letter.pdf': 'a letter',
    'Desktop/party.mov': 'video bytes',
    [`Desktop - Dane’s MacBook Pro (2)/${shot}`]: 'png bytes',
    'Downloads/letter copy.pdf': 'a letter',
    'Downloads/old.jpg': 'already on drive',
    'Desktop/locked/stuck.jpg': 'also on drive',
    'Desktop/repo/.git/HEAD': 'ref: main',
  };
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  fs.mkdirSync(path.join(m24, 'Photos'), { recursive: true });
  fs.writeFileSync(path.join(m24, 'Photos', 'old.jpg'), 'already on drive');
  fs.writeFileSync(path.join(m24, 'Photos', 'stuck.jpg'), 'also on drive');

  const run = (...args) => spawnSync('node', [path.join(ROOT, 'scripts', 'archive_mac.mjs'), ...args,
    '--home', home, '--state', state, '--trash', trash,
    '--remote', `m24=${m24}`, '--remote', `gdrive=${gdrive}`], { encoding: 'utf8' });

  try {
    let r = run('plan');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /3 to upload/);
    assert.match(r.stdout, /3 already on a Drive/);

    r = run('run');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(fs.readFileSync(path.join(m24, 'Restored from Mac', 'Desktop', 'letter.pdf'), 'utf8'), 'a letter');
    assert.equal(fs.readFileSync(path.join(gdrive, 'Archives-from-mac', 'Desktop', 'party.mov'), 'utf8'), 'video bytes');
    assert.equal(fs.readFileSync(path.join(m24, 'Restored from Mac', 'Desktop - Dane’s MacBook Pro (2)', shot), 'utf8'), 'png bytes');
    assert.ok(!fs.existsSync(path.join(m24, 'Restored from Mac', 'Downloads')), 'a duplicate was uploaded twice');
    assert.ok(fs.existsSync(path.join(home, 'Desktop', 'letter.pdf')), 'run moved a file — only clear --apply may');

    r = run('run');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /0 file\(s\) still to upload/);

    // Break it two ways: the video's copy leaves the Drive, and the letter on
    // the Mac is edited after its upload. Both must stay.
    const vid = path.join(gdrive, 'Archives-from-mac', 'Desktop', 'party.mov');
    fs.renameSync(vid, path.join(tmp, 'party.mov.aside'));
    fs.writeFileSync(path.join(home, 'Desktop', 'letter.pdf'), 'a letter, edited');
    // And a folder macOS will not let us move out of — Google Drive's own
    // .tmp.driveupload is locked like this, and the first real run crashed
    // on it 25 GB in (2026-10-03). It must stay, be named, and stop nothing.
    const locked = path.join(home, 'Desktop', 'locked');
    fs.chmodSync(locked, 0o555);
    r = run('clear', '--apply');
    fs.chmodSync(locked, 0o755);
    assert.ok(fs.existsSync(path.join(locked, 'stuck.jpg')), 'a file macOS refused to move went missing');
    assert.match(r.stdout, /macOS would not move it \(EACCES\)/);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /changed since the plan/);
    assert.match(r.stdout, /no copy with this fingerprint/);
    assert.ok(fs.existsSync(path.join(home, 'Desktop', 'party.mov')), 'moved a video whose copy is gone');
    assert.ok(fs.existsSync(path.join(home, 'Desktop', 'letter.pdf')), 'moved a file edited since its upload');
    // What WAS safe went, into the Trash, keeping its folder.
    assert.equal(fs.readFileSync(path.join(trash, 'Downloads', 'old.jpg'), 'utf8'), 'already on drive');
    assert.ok(!fs.existsSync(path.join(home, 'Downloads', 'old.jpg')));
    // The duplicate was never uploaded itself, but its bytes are on Drive (as
    // Desktop/letter.pdf, unedited there), so it may go.
    assert.equal(fs.readFileSync(path.join(trash, 'Downloads', 'letter copy.pdf'), 'utf8'), 'a letter');
    assert.equal(fs.readFileSync(path.join(trash, 'Desktop - Dane’s MacBook Pro (2)', shot), 'utf8'), 'png bytes');
    assert.ok(fs.existsSync(path.join(home, 'Desktop', 'repo', '.git', 'HEAD')), 'broke up a .git folder');

    // Restore both: now everything that has a copy goes, and the dry run moves nothing.
    fs.renameSync(path.join(tmp, 'party.mov.aside'), vid);
    fs.writeFileSync(path.join(home, 'Desktop', 'letter.pdf'), 'a letter');
    r = run('clear');
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /Would move 3 file/);
    assert.ok(fs.existsSync(path.join(home, 'Desktop', 'party.mov')), 'the dry run moved something');
    r = run('clear', '--apply');
    assert.equal(r.status, 0, r.stdout);
    assert.ok(!fs.existsSync(path.join(home, 'Desktop', 'party.mov')));
    const rec = fs.readFileSync(path.join(state, 'record.tsv'), 'utf8');
    assert.match(rec, /letter\.pdf.*upload \(verified\).*mentor24: Restored from Mac\/Desktop\/letter\.pdf.*moved to the Trash/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('plan refuses to guess when a folder is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-mac-'));
  try {
    fs.mkdirSync(path.join(tmp, 'Desktop'));
    const r = spawnSync('node', [path.join(ROOT, 'scripts', 'archive_mac.mjs'), 'plan', '--home', tmp, '--state', path.join(tmp, 's')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /CANNOT TELL — .*Downloads is not there/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Dedupe (ticket 86bcfgyza, media intake 5 of 5): the archived Trash folder and
// archive:index's proposed MacBook removals. Nothing leaves the Mac unless its
// bytes are on a Drive at the moment it goes — re-read, not taken from a report.

test('trashVerdict: on a Drive now → delete; nowhere → back home; anything unsure → held', () => {
  const present = (h, s) => h === 'h1' && s === 10;
  assert.equal(mac.trashVerdict({ size: 10, hash: 'h1' }, present, true).action, 'DELETE');
  assert.equal(mac.trashVerdict({ size: 10, hash: 'h2' }, present, true).action, 'RESTORE');
  assert.match(mac.trashVerdict({ size: 10, hash: 'h2' }, present, false).why, /another file now sits/);
  assert.equal(mac.trashVerdict({ size: 10, hash: 'h2' }, present, false).action, 'HOLD', 'would overwrite a file to put one back');
  assert.equal(mac.trashVerdict({ size: 10, dataless: true }, present, true).action, 'HOLD');
  assert.equal(mac.trashVerdict({ size: 10, error: 'EACCES' }, present, true).action, 'HOLD');
  assert.equal(mac.trashVerdict({ size: 10 }, present, true).action, 'HOLD', 'no fingerprint is not a match');
  assert.equal(mac.trashVerdict({ size: 0, hash: '' }, present, true).action, 'RESTORE', 'an empty file has nothing on Drive to match');
  assert.equal(mac.trashVerdict(null, present, true).action, 'GONE');
});

test('stillSafe: the second look holds back anything changed or no longer on a Drive', () => {
  const dry = { hash: 'h1', size: 10 };
  const present = (h, s) => h === 'h1' && s === 10;
  assert.equal(mac.stillSafe(dry, { size: 10, hash: 'h1' }, present).ok, true);
  assert.match(mac.stillSafe(dry, { size: 10, hash: 'h1' }, () => false).why, /Drive copy is gone/);
  assert.match(mac.stillSafe(dry, { size: 10, hash: 'h9' }, () => true).why, /changed since the dry run/);
  assert.equal(mac.stillSafe(dry, { size: 10, dataless: true }, present).ok, false);
  assert.equal(mac.stillSafe(dry, null, present).gone, true);
});

test('reportRows: only MacBook rows; a file that is not the report refuses', () => {
  const t = 'location\tpath\tbytes\thash\tkeeper\nmac\tZoom/a.mp4\t12\th1\tmentorofaio: Zoom/a.mp4\nicloud\tb.pdf\t3\th2\tmentor24: b.pdf\nmac-trash\tDesktop/c\t4\th3\tmentor24: c\n';
  const r = mac.reportRows(t);
  assert.deepEqual(r.rows, [{ path: 'Zoom/a.mp4', size: 12, hash: 'h1', keeper: 'mentorofaio: Zoom/a.mp4' }]);
  assert.deepEqual(r.other, { icloud: 1, 'mac-trash': 1 });
  assert.match(mac.reportRows('set\thash\n1\tx\n').error, /no location, path, bytes, keeper column/);
});

test('reportVerdicts: the matching copy moves only with a Drive copy; a namesake with other bytes is never touched', () => {
  const row = { path: 'a.pdf', size: 5, hash: 'h1', keeper: 'icloud: a.pdf' };
  const on = () => true;
  const v = mac.reportVerdicts(row, [{ folder: 'Desktop', size: 5, hash: 'h1' }, { folder: 'Documents', size: 7, hash: 'h9' }], on);
  assert.deepEqual(v.map((x) => [x.folder, x.action]), [['Desktop', 'MOVE']], 'acted on a different file that shares the path');
  assert.match(mac.reportVerdicts(row, [{ folder: 'Desktop', size: 5, hash: 'h1' }], () => false)[0].why, /no copy on either Drive right now \(the report's keeper: icloud: a\.pdf\)/);
  assert.match(mac.reportVerdicts(row, [{ folder: 'Desktop', size: 6, hash: 'h8' }], on)[0].why, /changed since the report/);
  assert.equal(mac.reportVerdicts(row, [{ folder: 'Desktop', size: 5, dataless: true }], on)[0].action, 'HOLD');
});

test('restoreLine: each change logs the command that undoes it, quoted for any name', () => {
  assert.equal(mac.restoreLine({ kind: 'deleted', original: "/h/Desktop/Dane's.pdf", driveCopy: 'mentor24: Restored from Mac/Desktop/Dane\'s.pdf' }),
    "rclone copyto 'm24:Restored from Mac/Desktop/Dane'\\''s.pdf' '/h/Desktop/Dane'\\''s.pdf'");
  assert.equal(mac.restoreLine({ kind: 'moved', from: '/h/Desktop/a b.mov', to: '/h/.Trash/x/Desktop/a b.mov' }),
    "mkdir -p '/h/Desktop' && mv -n '/h/.Trash/x/Desktop/a b.mov' '/h/Desktop/a b.mov'");
  assert.equal(mac.driveRef('mentorofaio: Zoom/a.mp4'), 'gdrive:Zoom/a.mp4');
  assert.equal(mac.driveRef('icloud: a'), null);
});

function scratch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-dedupe-'));
  const home = path.join(tmp, 'home');
  const m24 = path.join(tmp, 'm24');
  const gdrive = path.join(tmp, 'gdrive');
  const state = path.join(tmp, 'state');
  for (const d of [home, m24, gdrive, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads')]) fs.mkdirSync(d, { recursive: true });
  const put = (root, rel, body) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };
  const run = (...args) => spawnSync('node', [path.join(ROOT, 'scripts', 'archive_mac.mjs'), ...args,
    '--home', home, '--state', state, '--remote', `m24=${m24}`, '--remote', `gdrive=${gdrive}`], { encoding: 'utf8' });
  return { tmp, home, m24, gdrive, state, put, run };
}

test('trash: the dry run changes nothing; --apply empties exactly its list, re-verified, and puts back what has no copy', { skip: !haveRclone && 'rclone not installed' }, () => {
  const s = scratch();
  const archived = path.join(s.home, mac.ARCHIVED_TRASH);
  const T = (rel) => path.join(archived, rel);
  try {
    s.put(archived, 'Desktop/safe.pdf', 'safe bytes');
    s.put(archived, 'Downloads/clip.mov', 'clip bytes');
    s.put(archived, 'Desktop/copy-gone.pdf', 'copy will vanish');
    s.put(archived, 'Desktop/edited.pdf', 'original text');
    s.put(archived, 'Desktop/only-here.pdf', 'no drive copy');
    s.put(archived, 'Downloads/taken.pdf', 'no drive copy either');
    s.put(s.home, 'Downloads/taken.pdf', 'a newer file in its old place');
    s.put(s.m24, 'Restored from Mac/Desktop/safe.pdf', 'safe bytes');
    s.put(s.gdrive, 'Archives-from-mac/Downloads/clip.mov', 'clip bytes');
    const vanishing = s.put(s.m24, 'Restored from Mac/Desktop/copy-gone.pdf', 'copy will vanish');
    s.put(s.m24, 'Restored from Mac/Desktop/edited.pdf', 'original text');

    let r = s.run('trash');
    assert.equal(r.status, 1, r.stderr + r.stdout); // one is held: its old place is taken
    assert.match(r.stdout, /4 re-verified on a Drive just now/);
    assert.match(r.stdout, /1 with no Drive copy/);
    assert.match(r.stdout, /1 held back/);
    assert.match(r.stdout, /another file now sits where it came from/);
    for (const f of ['Desktop/safe.pdf', 'Downloads/clip.mov', 'Desktop/only-here.pdf']) assert.ok(fs.existsSync(T(f)), `the dry run changed ${f}`);
    assert.ok(!fs.existsSync(path.join(s.home, 'Desktop', 'only-here.pdf')), 'the dry run moved a file back');

    // Between the dry run and --apply: one Drive copy disappears, one file is
    // edited, and a new file (also on Drive) arrives that the dry run never saw.
    fs.rmSync(vanishing);
    fs.writeFileSync(T('Desktop/edited.pdf'), 'edited text');
    s.put(archived, 'Desktop/late.pdf', 'late bytes');
    s.put(s.m24, 'late.pdf', 'late bytes');

    r = s.run('trash', '--apply');
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout, /Emptied 2 file\(s\)/);
    assert.ok(!fs.existsSync(T('Desktop/safe.pdf')));
    assert.ok(!fs.existsSync(T('Downloads/clip.mov')));
    // The Drive copy went after the dry run: the file must survive, listed as held back.
    assert.ok(fs.existsSync(T('Desktop/copy-gone.pdf')), 'deleted a file whose Drive copy is gone');
    assert.match(r.stdout, /held back: its Drive copy is gone/);
    assert.ok(fs.existsSync(T('Desktop/edited.pdf')), 'deleted a file whose bytes no longer match Drive');
    assert.match(r.stdout, /held back: it changed since the dry run/);
    assert.ok(fs.existsSync(T('Desktop/late.pdf')), 'deleted a file the dry run never listed');
    // No Drive copy: back where it came from; the occupied one stays put.
    assert.equal(fs.readFileSync(path.join(s.home, 'Desktop', 'only-here.pdf'), 'utf8'), 'no drive copy');
    assert.equal(fs.readFileSync(path.join(s.home, 'Downloads', 'taken.pdf'), 'utf8'), 'a newer file in its old place');
    assert.ok(fs.existsSync(T('Downloads/taken.pdf')));
    const undo = fs.readFileSync(path.join(s.state, 'restore.log'), 'utf8');
    assert.match(undo, /rclone copyto 'm24:Restored from Mac\/Desktop\/safe\.pdf' '.*\/home\/Desktop\/safe\.pdf'/);
    // Putting a file back is undone by returning it to the Trash folder.
    assert.match(undo, /mv -n '.*\/home\/Desktop\/only-here\.pdf' '.*Archived-from-Mac-20261004-0327\/Desktop\/only-here\.pdf'/);
  } finally {
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});

test('trash --apply refuses with no dry run, and an emptied folder is not an error', { skip: !haveRclone && 'rclone not installed' }, () => {
  const s = scratch();
  try {
    let r = s.run('trash');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /already emptied/);
    s.put(path.join(s.home, mac.ARCHIVED_TRASH), 'Desktop/a.pdf', 'a');
    r = s.run('trash', '--apply');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no trash dry run/);
    assert.ok(fs.existsSync(path.join(s.home, mac.ARCHIVED_TRASH, 'Desktop', 'a.pdf')));
  } finally {
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});

test('report: MacBook copies on a Drive move to the Trash; the rest stay, each with its reason', { skip: !haveRclone && 'rclone not installed' }, () => {
  const s = scratch();
  const crypto = require('node:crypto');
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  const trash = path.join(s.tmp, 'trash');
  try {
    s.put(s.home, 'Documents/Zoom/call.mp4', 'call bytes');
    s.put(s.gdrive, 'Zoom/call.mp4', 'call bytes');
    s.put(s.home, 'Desktop/icloud-only.pdf', 'icloud bytes');
    s.put(s.home, 'Downloads/changed.pdf', 'changed now');
    const report = path.join(s.tmp, 'archive-index');
    s.put(report, 'proposed-removals.tsv', [
      'location\tpath\tbytes\thash\tkeeper',
      `mac\tZoom/call.mp4\t10\t${md5('call bytes')}\tmentorofaio: Zoom/call.mp4`,
      `mac\ticloud-only.pdf\t12\t${md5('icloud bytes')}\ticloud: icloud-only.pdf`,
      `mac\tchanged.pdf\t8\t${md5('was this')}\tmentor24: changed.pdf`,
      `mac\tgone.pdf\t3\t${md5('xyz')}\tmentor24: gone.pdf`,
      `icloud\tother.pdf\t1\t${md5('o')}\tmentor24: other.pdf`,
    ].join('\n') + '\n');

    let r = s.run('report', '--report', report);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout, /4 MacBook copy\(ies\) proposed as extra; 1 already gone/);
    assert.match(r.stdout, /Not touched here: 1 in icloud/);
    assert.match(r.stdout, /1 re-verified on a Drive just now/);
    assert.match(r.stdout, /no copy on either Drive right now/);
    assert.match(r.stdout, /changed since the report/);
    assert.ok(fs.existsSync(path.join(s.home, 'Documents', 'Zoom', 'call.mp4')), 'the dry run moved a file');

    r = s.run('report', '--apply', '--trash', trash);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout, /Moved 1 file/);
    assert.equal(fs.readFileSync(path.join(trash, 'Documents', 'Zoom', 'call.mp4'), 'utf8'), 'call bytes');
    assert.ok(fs.existsSync(path.join(s.home, 'Desktop', 'icloud-only.pdf')), 'moved a file whose only other copy is iCloud');
    assert.ok(fs.existsSync(path.join(s.home, 'Downloads', 'changed.pdf')));
    assert.match(fs.readFileSync(path.join(s.state, 'restore.log'), 'utf8'), /mv -n '.*trash\/Documents\/Zoom\/call\.mp4' '.*\/home\/Documents\/Zoom\/call\.mp4'/);
  } finally {
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});
