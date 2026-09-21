'use strict';

/**
 * Tests for lib/archiveRoute.js and scripts/archive_route.mjs — unzip what Drive
 * is missing, upload it, verify it, and only then delete the zip (ticket
 * 86bbvr0xv, slice 2 of 86bbvqh4z).
 *
 * The end-to-end block at the bottom runs the real script against scratch
 * folders standing in for MaxOne and both Drives (rclone treats a local folder
 * as a target). It checks both directions: a zip whose files all reached a
 * "Drive" is deleted, and the SAME zip is kept when one uploaded file is
 * removed from the Drive before `clear` runs — the delete is decided by what is
 * on Drive now, not by what the run remembers doing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const route = require('../../lib/archiveRoute.js');

const ROOT = path.resolve(__dirname, '..', '..');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

test('origin: the Personal-folder downloads go home, everything else is "unknown"', () => {
  assert.equal(route.origin('Google Drive Download/Personal/Family-20260112T223646Z-1-016.zip').kind, 'personal');
  assert.deepEqual(route.origin('Personal/Personal-20260112T210451Z-1-065.zip'), { kind: 'personal', stripPrefix: 'Personal/' });
  assert.equal(route.origin('Personal/Personal Social Circles-20260112T210328Z-1-001.zip').kind, 'personal');
  // Named like Personal but not a Drive download: no evidence, so no guess.
  assert.deepEqual(route.origin('Personal/Screenshots.zip'), { kind: 'unknown', dir: 'Personal' });
  assert.deepEqual(route.origin('ISITAS-20260113T030114Z-1-001.zip'), { kind: 'unknown', dir: '' });
});

test('destination: video → mentorofaio, the rest → mentor24, by origin', () => {
  const home = route.destination('Google Drive Download/Personal/Family-1.zip', 'Family/Kids/a.pdf');
  assert.deepEqual([home.remote, home.rootId, home.path], ['m24:', route.M24_PERSONAL_ID, 'Family/Kids/a.pdf']);
  const homeVid = route.destination('Google Drive Download/Personal/Family-1.zip', 'Family/Kids/b.MOV');
  assert.deepEqual([homeVid.remote, homeVid.rootId, homeVid.path], ['gdrive:', '', 'Mentor/Personal/Family/Kids/b.MOV']);
  const stripped = route.destination('Personal/Personal-20260112T210451Z-1-065.zip', 'Personal/Finance/x.pdf');
  assert.equal(stripped.path, 'Finance/x.pdf');
  const unk = route.destination('Personal/Screenshots.zip', 'Screenshots/s.png');
  assert.deepEqual([unk.remote, unk.rootId, unk.path], ['m24:', '', 'Restored from MaxOne/Personal/Screenshots/s.png']);
  const unkVid = route.destination('ISITAS-1.zip', 'ISITAS/clip.mp4');
  assert.deepEqual([unkVid.remote, unkVid.path], ['gdrive:', 'Archives-from-maxone/ISITAS/clip.mp4']);
});

function entries() {
  return [
    { location: 'maxone', path: 'A.zip', size: 100, hash: 'zipA' },
    { location: 'maxone', container: 'A.zip', path: 'A/on-drive.jpg', size: 10, hash: 'h1' },
    { location: 'maxone', container: 'A.zip', path: 'A/new.pdf', size: 11, hash: 'h2' },
    { location: 'maxone', container: 'A.zip', path: 'A/unique-by-size.mov', size: 12 },
    { location: 'maxone', container: 'A.zip', path: 'A/empty.txt', size: 0 },
    { location: 'maxone', container: 'A.zip', path: 'A/broken.jpg', size: 13, error: 'bad CRC' },
    { location: 'maxone', container: 'B.zip', path: 'B/new-copy.pdf', size: 11, hash: 'h2' },
    { location: 'maxone', path: 'C.zip', size: 50, hash: 'zipC' },
    { location: 'maxone', container: 'C.zip', path: 'C/x.jpg', size: 14, hash: 'h9' },
    { location: 'maxone', container: 'D.zip', path: '../escape.txt', size: 3, hash: 'h8' },
    { location: 'mentor24', path: 'Somewhere/on-drive.jpg', size: 10, hash: 'h1' },
    { location: 'mentorofaio', path: 'Zips/C.zip', size: 50, hash: 'zipC' },
    { location: 'mac', container: 'M.zip', path: 'mac-only.pdf', size: 20, hash: 'h7' },
  ];
}

test('plan: every MaxOne member lands in exactly one state, with a reason', () => {
  const rows = route.plan(entries());
  const by = Object.fromEntries(rows.map((r) => [`${r.zip}::${r.member}`, r]));
  assert.equal(by['A.zip::A/on-drive.jpg'].action, 'SKIP');
  assert.match(by['A.zip::A/on-drive.jpg'].reason, /already on Drive: mentor24: Somewhere\/on-drive.jpg/);
  assert.equal(by['A.zip::A/new.pdf'].action, 'UPLOAD');
  assert.equal(by['A.zip::A/unique-by-size.mov'].action, 'UPLOAD');
  assert.equal(by['A.zip::A/unique-by-size.mov'].dest.remote, 'gdrive:');
  assert.equal(by['A.zip::A/empty.txt'].action, 'SKIP');
  assert.equal(by['A.zip::A/broken.jpg'].action, 'HOLD');
  // The same bytes in a second zip are uploaded once, not twice.
  assert.equal(by['B.zip::B/new-copy.pdf'].action, 'SKIP');
  assert.match(by['B.zip::B/new-copy.pdf'].reason, /same file is uploaded from A.zip → A\/new.pdf/);
  // A zip whose own bytes are on Drive needs nothing unzipped.
  assert.match(by['C.zip::C/x.jpg'].reason, /the zip itself is on Drive/);
  assert.equal(by['D.zip::../escape.txt'].action, 'HOLD');
  // The Mac is slice 3's; nothing of it is planned here.
  assert.ok(!rows.some((r) => r.zip === 'M.zip'));
  assert.equal(rows.length, 8);
});

test('resolveClashes: two uploads to one path get distinct names', () => {
  const rows = [
    { action: 'UPLOAD', dest: { remote: 'm24:', rootId: '', path: 'R/a.pdf' } },
    { action: 'UPLOAD', dest: { remote: 'm24:', rootId: '', path: 'R/A.pdf' } },
    { action: 'UPLOAD', dest: { remote: 'gdrive:', rootId: '', path: 'R/a.pdf' } },
  ];
  route.resolveClashes(rows);
  assert.equal(rows[0].dest.path, 'R/a.pdf');
  assert.equal(rows[1].dest.path, 'R/A (from MaxOne 2).pdf');
  assert.equal(rows[2].dest.path, 'R/a.pdf');
  assert.equal(route.destinationClashes(rows).length, 0);
});

test('clearable: only when every content-bearing file is on a Drive NOW', () => {
  const rows = route.plan(entries()).filter((r) => r.zip === 'A.zip' && r.action !== 'HOLD');
  const zip = { hash: 'zipA', size: 100 };
  const all = new Set(['h1:10', 'h2:11', 'hU:12']);
  const hashOf = (r) => (r.member === 'A/unique-by-size.mov' ? 'hU' : undefined);
  assert.equal(route.clearable(rows, zip, (h, s) => all.has(`${h}:${s}`), hashOf).ok, true);
  // One uploaded file vanished from Drive: kept, and it says which.
  const missing = route.clearable(rows, zip, (h, s) => all.has(`${h}:${s}`) && h !== 'h2', hashOf);
  assert.equal(missing.ok, false);
  assert.match(missing.blockers.join(), /A\/new.pdf/);
  // Never uploaded, so no fingerprint for the unique-by-size file: kept.
  assert.equal(route.clearable(rows, zip, (h) => h !== 'zipA', () => undefined).ok, false);
  // A HOLD row keeps the zip whatever else is true.
  const withHold = route.plan(entries()).filter((r) => r.zip === 'A.zip');
  assert.equal(route.clearable(withHold, zip, () => true, () => 'x').ok, false);
  // The zip's own copy on Drive settles it — but only if that copy is still there.
  const c = route.plan(entries()).filter((r) => r.zip === 'C.zip');
  assert.equal(route.clearable(c, { hash: 'zipC', size: 50 }, (h) => h === 'zipC').ok, true);
  assert.equal(route.clearable(c, { hash: 'zipC', size: 50 }, () => false).ok, false);
});

// ---------------------------------------------------------------------------
const haveTools = spawnSync('rclone', ['version']).status === 0 && spawnSync('python3', ['-c', 'import zipfile']).status === 0;

test('end to end: upload, verify, clear — and keep a zip whose copy went missing', { skip: !haveTools && 'rclone or python3 not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-route-'));
  const maxone = path.join(tmp, 'maxone');
  const m24 = path.join(tmp, 'm24');
  const gdrive = path.join(tmp, 'gdrive');
  const state = path.join(tmp, 'state');
  for (const d of [maxone, m24, gdrive, path.join(maxone, 'Google Drive Download', 'Personal')]) fs.mkdirSync(d, { recursive: true });

  const files = {
    'Family/old.jpg': 'already on mentor24',
    'Family/letter.pdf': 'a letter nobody backed up',
    'Family/party.mov': 'video bytes',
  };
  fs.mkdirSync(path.join(m24, 'Old'), { recursive: true });
  fs.writeFileSync(path.join(m24, 'Old', 'old.jpg'), files['Family/old.jpg']);
  const zipRel = 'Google Drive Download/Personal/Family-20260112T223646Z-1-001.zip';
  const zipAbs = path.join(maxone, zipRel);
  const py = spawnSync('python3', ['-c', 'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor k,v in json.load(sys.stdin).items(): z.writestr(k,v)\nz.close()', zipAbs], { input: JSON.stringify(files) });
  assert.equal(py.status, 0, String(py.stderr));

  const index = [
    { location: 'maxone', path: zipRel, size: fs.statSync(zipAbs).size, hash: 'zipnotondrive' },
    ...Object.entries(files).map(([p, v]) => ({ location: 'maxone', container: zipRel, path: p, size: Buffer.byteLength(v), hash: p.endsWith('.mov') ? undefined : md5(v) })),
    { location: 'mentor24', path: 'Old/old.jpg', size: Buffer.byteLength(files['Family/old.jpg']), hash: md5(files['Family/old.jpg']) },
  ];
  fs.writeFileSync(path.join(tmp, 'index.jsonl'), index.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const run = (...args) => spawnSync('node', [path.join(ROOT, 'scripts', 'archive_route.mjs'), ...args,
    '--index', path.join(tmp, 'index.jsonl'), '--state', state, '--maxone', maxone,
    '--remote', `m24=${m24}`, '--remote', `gdrive=${gdrive}`], { encoding: 'utf8' });

  let r = run('plan');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 to upload/);

  r = run('run');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // Routed by kind, to the original Personal folder (a sub-folder here, by id).
  assert.equal(fs.readFileSync(path.join(m24, route.M24_PERSONAL_ID, 'Family', 'letter.pdf'), 'utf8'), files['Family/letter.pdf']);
  assert.equal(fs.readFileSync(path.join(gdrive, 'Mentor', 'Personal', 'Family', 'party.mov'), 'utf8'), files['Family/party.mov']);
  assert.ok(!fs.existsSync(path.join(m24, route.M24_PERSONAL_ID, 'Family', 'old.jpg')), 'a file already on Drive was uploaded again');
  assert.ok(!fs.existsSync(path.join(maxone, '.archive-route-staging')), 'staging was not cleaned up');
  assert.ok(fs.existsSync(zipAbs), 'run deleted the zip — only clear --apply may');

  // A second run has nothing left to do.
  r = run('run');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /0 file\(s\) still to upload/);

  // Break it: the uploaded video disappears from Drive. The zip must be KEPT.
  // (Moved OUT of the Drive, not renamed inside it: presence is by fingerprint,
  // so a renamed copy still counts — correctly.)
  const vid = path.join(gdrive, 'Mentor', 'Personal', 'Family', 'party.mov');
  const aside = path.join(tmp, 'party.mov.aside');
  fs.renameSync(vid, aside);
  r = run('clear', '--apply');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /KEEP .*party\.mov/);
  assert.ok(fs.existsSync(zipAbs), 'deleted a zip whose video is not on Drive');

  // Restore it: now the zip goes, and the record says where everything is.
  fs.renameSync(aside, vid);
  r = run('clear');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /WOULD DELETE/);
  assert.ok(fs.existsSync(zipAbs), 'the dry run deleted something');
  r = run('clear', '--apply');
  assert.equal(r.status, 0, r.stdout);
  assert.ok(!fs.existsSync(zipAbs));
  const rec = fs.readFileSync(path.join(state, 'record.tsv'), 'utf8');
  assert.match(rec, /Family\/letter\.pdf.*mentor24: Personal \(the original, 2016 folder\)\/Family\/letter\.pdf \(verified\).*deleted/);
  assert.match(rec, /Family\/old\.jpg.*already on Drive: mentor24: Old\/old\.jpg/);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('run refuses to guess when MaxOne is not there', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-route-'));
  const r = spawnSync('node', [path.join(ROOT, 'scripts', 'archive_route.mjs'), 'run', '--state', tmp, '--maxone', path.join(tmp, 'nope')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /CANNOT TELL — MaxOne is not mounted/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
