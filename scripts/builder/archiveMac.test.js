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
    'Desktop/repo/.git/HEAD': 'ref: main',
  };
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  fs.mkdirSync(path.join(m24, 'Photos'), { recursive: true });
  fs.writeFileSync(path.join(m24, 'Photos', 'old.jpg'), 'already on drive');

  const run = (...args) => spawnSync('node', [path.join(ROOT, 'scripts', 'archive_mac.mjs'), ...args,
    '--home', home, '--state', state, '--trash', trash,
    '--remote', `m24=${m24}`, '--remote', `gdrive=${gdrive}`], { encoding: 'utf8' });

  try {
    let r = run('plan');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /3 to upload/);
    assert.match(r.stdout, /2 already on a Drive/);

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
    r = run('clear', '--apply');
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
    assert.match(r.stdout, /Would move 2 file/);
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
