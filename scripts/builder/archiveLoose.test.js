'use strict';

/**
 * Tests for lib/archiveLoose.js and scripts/archive_loose.mjs — the loose
 * files on MaxOne that were never inside a zip: where each goes, and the count
 * slice 4's erase is gated on (ticket 86bc75y9r).
 *
 * The end-to-end block at the bottom runs the real script against scratch
 * folders standing in for MaxOne and both Drives (rclone treats a local folder
 * as a target). It checks both directions: after `run`, `status` counts 0
 * missing; and when one uploaded file is removed from the "Drive", the SAME
 * status names it — the count is decided by what is on Drive now, not by what
 * the run remembers doing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const loose = require('../../lib/archiveLoose.js');

const ROOT = path.resolve(__dirname, '..', '..');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

test('destination: video → mentorofaio, the rest → mentor24, mirroring the MaxOne folder', () => {
  const vid = loose.destination('Google Drive Download/Personal/Family/Videos/2012/gifts.mp4');
  assert.deepEqual([vid.remote, vid.rootId, vid.path], ['gdrive:', '', 'Archives-from-maxone/Google Drive Download/Personal/Family/Videos/2012/gifts.mp4']);
  const doc = loose.destination('Personal/Finance/loan.xlsx');
  assert.deepEqual([doc.remote, doc.rootId, doc.path], ['m24:', '', 'Restored from MaxOne/Personal/Finance/loan.xlsx']);
  const top = loose.destination('IMG_1439.HEIC');
  assert.equal(top.path, 'Restored from MaxOne/IMG_1439.HEIC');
});

function entries() {
  return [
    { location: 'maxone', path: 'A/on-drive.jpg', size: 10, hash: 'h1' },
    { location: 'maxone', path: 'A/new.pdf', size: 11, hash: 'h2' },
    { location: 'maxone', path: 'B/new-copy.pdf', size: 11, hash: 'h2' },
    { location: 'maxone', path: 'A/clip.mov', size: 12, hash: 'h3' },
    { location: 'maxone', path: 'A/unhashed.mov', size: 13 },
    { location: 'maxone', path: 'A/empty.txt', size: 0 },
    { location: 'maxone', path: 'A/.DS_Store', size: 5, hash: 'h4' },
    { location: 'maxone', path: 'A/broken.jpg', size: 14, error: 'EIO' },
    // What the indexer actually writes for a folder it could not open: size 0
    // AND an error. Size-first ordering filed this as "empty" (ticket 86bc7eh7m).
    { location: 'maxone', path: 'A/Locked Videos', size: 0, error: 'folder could not be listed: EPERM' },
    { location: 'maxone', path: 'A/same-name.pdf', size: 15, hash: 'h5' },
    // Zips and their members are slice 2's, never planned here.
    { location: 'maxone', path: 'A/Z.zip', size: 100, hash: 'zipA' },
    { location: 'maxone', container: 'A/Z.zip', path: 'inside.pdf', size: 16, hash: 'h6' },
    // Drive rows: one copy of on-drive.jpg, and a DIFFERENT file already at same-name.pdf's destination.
    { location: 'mentor24', path: 'Somewhere/on-drive.jpg', size: 10, hash: 'h1' },
    { location: 'mentor24', path: 'Restored from MaxOne/A/same-name.pdf', size: 99, hash: 'other' },
    // The Mac is slice 3's.
    { location: 'mac', path: 'mac-only.pdf', size: 20, hash: 'h7' },
  ];
}

test('plan: every loose MaxOne file lands in exactly one state, with a reason', () => {
  const rows = loose.plan(entries(), loose.takenPaths(entries()));
  const by = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.equal(by['A/on-drive.jpg'].action, 'SKIP');
  assert.match(by['A/on-drive.jpg'].reason, /already on Drive: mentor24: Somewhere\/on-drive.jpg/);
  assert.equal(by['A/new.pdf'].action, 'UPLOAD');
  assert.equal(by['A/new.pdf'].dest.remote, 'm24:');
  // The same bytes in a second place are uploaded once, not twice.
  assert.equal(by['B/new-copy.pdf'].action, 'SKIP');
  assert.match(by['B/new-copy.pdf'].reason, /same file is uploaded from A\/new.pdf/);
  assert.equal(by['A/clip.mov'].action, 'UPLOAD');
  assert.equal(by['A/clip.mov'].dest.remote, 'gdrive:');
  // No fingerprint means it cannot be verified after upload: held, not guessed.
  assert.equal(by['A/unhashed.mov'].action, 'HOLD');
  assert.equal(by['A/empty.txt'].action, 'SKIP');
  assert.equal(by['A/.DS_Store'].action, 'SKIP');
  assert.equal(by['A/broken.jpg'].action, 'HOLD');
  // An unreadable folder is size 0 with an error: HELD, never "empty".
  assert.equal(by['A/Locked Videos'].action, 'HOLD');
  assert.match(by['A/Locked Videos'].reason, /could not be read: folder could not be listed/);
  // A different file already sits where this one would land: renamed, never overwritten or skipped.
  assert.equal(by['A/same-name.pdf'].action, 'UPLOAD');
  assert.equal(by['A/same-name.pdf'].dest.path, 'Restored from MaxOne/A/same-name (from MaxOne 2).pdf');
  assert.match(by['A/same-name.pdf'].dest.reason, /renamed because a different file/);
  // Zips, zip members and the Mac are other slices'.
  assert.ok(!by['A/Z.zip'] && !by['inside.pdf'] && !by['mac-only.pdf']);
  assert.equal(rows.length, 10);
  const s = loose.summarize(rows);
  assert.deepEqual([s.upload, s.onDrive, s.hold, s.video], [3, 2, 3, 1]);
});

test('batches: one Drive per batch, capped by count and bytes', () => {
  const rows = [
    { path: 'a', size: 3, action: 'UPLOAD', dest: { remote: 'm24:' } },
    { path: 'b', size: 3, action: 'UPLOAD', dest: { remote: 'gdrive:' } },
    { path: 'c', size: 3, action: 'UPLOAD', dest: { remote: 'm24:' } },
    { path: 'd', size: 3, action: 'UPLOAD', dest: { remote: 'm24:' } },
  ];
  const b = loose.batches(rows, 2, 100);
  assert.deepEqual(b.map((x) => [x.remote, x.rows.map((r) => r.path)]), [['m24:', ['a', 'c']], ['gdrive:', ['b']], ['m24:', ['d']]]);
  assert.equal(loose.batches(rows, 100, 5).length, 4);
});

test('fits: a Drive without room (plus the spare) refuses; what is verified does not count', () => {
  const rows = [
    { path: 'a', size: 10, action: 'UPLOAD', dest: { remote: 'm24:' } },
    { path: 'b', size: 10, action: 'UPLOAD', dest: { remote: 'gdrive:' } },
  ];
  assert.equal(loose.fits(rows, { 'm24:': loose.SPARE_BYTES + 10, 'gdrive:': loose.SPARE_BYTES + 10 }).ok, true);
  assert.equal(loose.fits(rows, { 'm24:': loose.SPARE_BYTES + 9, 'gdrive:': loose.SPARE_BYTES + 10 }).ok, false);
  assert.equal(loose.fits(rows, { 'm24:': null, 'gdrive:': loose.SPARE_BYTES + 10 }).ok, false);
  const ledger = new Map([['a', { verified: true }]]);
  assert.equal(loose.fits(rows, { 'm24:': loose.SPARE_BYTES, 'gdrive:': loose.SPARE_BYTES + 10 }, ledger).ok, true);
});

test('verdict: backed up means the bytes are on a Drive NOW, and every miss has a reason', () => {
  const all = loose.looseEntries(entries());
  const present = new Set(['h1:10', 'h2:11', 'h3:12', 'hU:13', 'h5:15']);
  const hashOf = (e) => (e.path === 'A/unhashed.mov' ? 'hU' : '');
  const v = loose.verdict(all, hashOf, (h, s) => present.has(`${h}:${s}`));
  assert.equal(v.total, 10);
  assert.equal(v.noCopyNeeded, 2);
  assert.equal(v.backedUp, 6);
  assert.deepEqual(v.missing.map((m) => m.path), ['A/broken.jpg', 'A/Locked Videos']);
  assert.match(v.missing[0].reason, /could not be read/);
  // The unreadable FOLDER (size 0 + error) is named as missing with its error,
  // not counted as "needs no copy" — that was the green light over unseen files.
  assert.match(v.missing[1].reason, /could not be read on MaxOne: folder could not be listed: EPERM/);
  assert.equal(v.ok, false);
  // One file vanished from Drive: it is named, whatever the ledger remembers.
  const gone = loose.verdict(all, hashOf, (h, s) => present.has(`${h}:${s}`) && h !== 'h3');
  assert.ok(gone.missing.some((m) => m.path === 'A/clip.mov' && /no copy with this fingerprint/.test(m.reason)));
  // No fingerprint at all: it says what to run.
  const blind = loose.verdict(all, () => '', () => true);
  assert.ok(blind.missing.some((m) => m.path === 'A/unhashed.mov' && /run "plan"/.test(m.reason)));
});

// ---------------------------------------------------------------------------
const haveRclone = spawnSync('rclone', ['version']).status === 0;

test('end to end: hash, upload, read back — and the count names what is not on Drive', { skip: !haveRclone && 'rclone not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-loose-'));
  const maxone = path.join(tmp, 'maxone');
  const m24 = path.join(tmp, 'm24');
  const gdrive = path.join(tmp, 'gdrive');
  const state = path.join(tmp, 'state');
  for (const d of [path.join(maxone, 'Personal', 'Family'), path.join(m24, 'Old'), gdrive]) fs.mkdirSync(d, { recursive: true });

  const files = {
    'Personal/Family/old.jpg': 'already on mentor24',
    'Personal/Family/letter.pdf': 'a letter nobody backed up',
    'Personal/Family/party.mov': 'video bytes, unique by size so never hashed',
    'Personal/Family/twin.pdf': 'a letter nobody backed up',
  };
  for (const [p, v] of Object.entries(files)) fs.writeFileSync(path.join(maxone, p), v);
  fs.writeFileSync(path.join(m24, 'Old', 'old.jpg'), files['Personal/Family/old.jpg']);

  const index = [
    ...Object.entries(files).map(([p, v]) => ({ location: 'maxone', path: p, size: Buffer.byteLength(v), hash: p.endsWith('.mov') ? undefined : md5(v) })),
    { location: 'mentor24', path: 'Old/old.jpg', size: Buffer.byteLength(files['Personal/Family/old.jpg']), hash: md5(files['Personal/Family/old.jpg']) },
  ];
  fs.writeFileSync(path.join(tmp, 'index.jsonl'), index.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const run = (...args) => spawnSync('node', [path.join(ROOT, 'scripts', 'archive_loose.mjs'), ...args,
    '--index', path.join(tmp, 'index.jsonl'), '--state', state, '--maxone', maxone,
    '--remote', `m24=${m24}`, '--remote', `gdrive=${gdrive}`], { encoding: 'utf8' });

  // Before anything: the count says exactly what is missing, and why.
  let r = run('status');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /3 NOT on a Drive/);
  assert.match(r.stdout, /party\.mov .*no fingerprint yet/);

  r = run('plan');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // The unhashed video was fingerprinted off "MaxOne" and planned, not held; the twin is uploaded once.
  assert.match(r.stdout, /2 to upload/);
  assert.match(r.stdout, /1 video/);
  assert.match(r.stdout, /2 already on a Drive \(or a duplicate/);

  r = run('run');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(fs.readFileSync(path.join(m24, 'Restored from MaxOne', 'Personal', 'Family', 'letter.pdf'), 'utf8'), files['Personal/Family/letter.pdf']);
  assert.equal(fs.readFileSync(path.join(gdrive, 'Archives-from-maxone', 'Personal', 'Family', 'party.mov'), 'utf8'), files['Personal/Family/party.mov']);
  assert.ok(!fs.existsSync(path.join(m24, 'Restored from MaxOne', 'Personal', 'Family', 'old.jpg')), 'a file already on Drive was uploaded again');
  assert.ok(!fs.existsSync(path.join(m24, 'Restored from MaxOne', 'Personal', 'Family', 'twin.pdf')), 'the same bytes were uploaded twice');
  for (const p of Object.keys(files)) assert.ok(fs.existsSync(path.join(maxone, p)), `run removed ${p} from MaxOne — nothing here may delete`);

  // A second run has nothing left to do.
  r = run('run');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /0 file\(s\) still to upload/);

  // The count: everything is on a Drive now (the twin by its uploaded double).
  r = run('status');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 NOT on a Drive/);
  assert.match(r.stdout, /4 have a byte-identical copy/);

  // Break it: the uploaded video disappears from Drive. The count must say so,
  // even though the ledger still remembers verifying it.
  const vid = path.join(gdrive, 'Archives-from-maxone', 'Personal', 'Family', 'party.mov');
  fs.rmSync(vid);
  r = run('status');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /1 NOT on a Drive/);
  assert.match(r.stdout, /MISSING +Personal\/Family\/party\.mov .*no copy with this fingerprint/);
  assert.ok(fs.existsSync(path.join(state, 'missing.tsv')));

  // Recovery: `run` trusts its ledger, so a copy lost from Drive AFTER it was
  // verified is re-uploaded by clearing the ledger and running again — status
  // is the truth, the ledger is only the run's own memory.
  fs.rmSync(path.join(state, 'ledger.jsonl'));
  r = run('run');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(vid), 'the lost video was not re-uploaded');
  r = run('status');
  assert.equal(r.status, 0, r.stdout);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan and run refuse to guess when MaxOne is not mounted', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-loose-'));
  fs.writeFileSync(path.join(tmp, 'index.jsonl'), '');
  const r = spawnSync('node', [path.join(ROOT, 'scripts', 'archive_loose.mjs'), 'plan', '--index', path.join(tmp, 'index.jsonl'), '--state', path.join(tmp, 's'), '--maxone', path.join(tmp, 'nope')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /CANNOT TELL/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
