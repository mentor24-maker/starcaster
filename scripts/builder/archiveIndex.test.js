'use strict';

/**
 * Tests for lib/archiveIndex.js and scripts/archive_index.mjs — which copies of
 * the archive are the same file (ticket 86bbvr0wh).
 *
 * The acceptance test the ticket names is the last block: plant a known
 * duplicate under a different name and confirm it is paired, then plant a
 * near-miss (same name, same size, one byte different) and confirm it is NOT.
 * Both directions, or the report is not evidence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const idx = require('../../lib/archiveIndex.js');

const ROOT = path.resolve(__dirname, '..', '..');

test('skipReason drops OS bookkeeping and regenerated folders, keeps content', () => {
  assert.equal(idx.skipReason('Photos/.DS_Store'), 'system file');
  assert.equal(idx.skipReason('__MACOSX/Photos/._IMG_1.JPG'), 'inside __MACOSX/');
  assert.equal(idx.skipReason('code/node_modules/x/index.js'), 'inside node_modules/');
  assert.equal(idx.skipReason('Photos/._IMG_1.JPG'), 'macOS resource fork (._ file)');
  assert.equal(idx.skipReason('Photos/IMG_1.JPG'), null);
  // A FILE merely named like a skipped folder elsewhere in its name is kept.
  assert.equal(idx.skipReason('notes/node_modules.txt'), null);
});

test('mediaKind routes by extension, case-insensitively', () => {
  assert.equal(idx.mediaKind('a/IMG_1436.MOV'), 'video');
  assert.equal(idx.mediaKind('b.heic'), 'photo');
  assert.equal(idx.mediaKind('c.m4a'), 'audio');
  assert.equal(idx.mediaKind('d.pdf'), 'other');
  assert.equal(idx.mediaKind('noext'), 'other');
});

test('only sizes shared by two or more entries need hashing; zero never does', () => {
  const need = idx.sizesNeedingHash([
    { size: 10 }, { size: 10 }, { size: 11 }, { size: 0 }, { size: 0 },
  ]);
  assert.deepEqual([...need], [10]);
});

test('a duplicate needs a matching hash AND size — a name match means nothing', () => {
  const a = idx.analyze([
    { location: 'mac', path: 'x/IMG_1.JPG', size: 5, hash: 'aaa' },
    { location: 'maxone', path: 'y/IMG_1.JPG', size: 5, hash: 'bbb' },
    { location: 'mentor24', path: 'z/renamed.jpg', size: 5, hash: 'aaa' },
  ]);
  assert.equal(a.sets.length, 1);
  const set = a.sets[0];
  assert.deepEqual([set.keeper.path, ...set.others.map((o) => o.path)].sort(), ['x/IMG_1.JPG', 'z/renamed.jpg']);
  assert.equal(a.uniqueCount, 2);
});

test('keeper is the copy already at its destination: video → mentorofaio, rest → mentor24', () => {
  const video = idx.pickKeeper([
    { location: 'maxone', path: 'a.mov', size: 1 },
    { location: 'mentor24', path: 'b.mov', size: 1 },
    { location: 'mentorofaio', path: 'deep/folder/c.mov', size: 1 },
  ]);
  assert.equal(video.location, 'mentorofaio');
  const photo = idx.pickKeeper([
    { location: 'mentorofaio', path: 'a.jpg', size: 1 },
    { location: 'mentor24', path: 'deep/b.jpg', size: 1 },
  ]);
  assert.equal(photo.location, 'mentor24');
  // A loose copy always beats one trapped in a zip, even on a "better" location.
  const loose = idx.pickKeeper([
    { location: 'mentor24', container: 'z.zip', path: 'a.jpg', size: 1 },
    { location: 'maxone', path: 'a.jpg', size: 1 },
  ]);
  assert.equal(loose.location, 'maxone');
});

test('keeper does not depend on listing order', () => {
  const copies = [
    { location: 'mac', path: 'b/x.pdf', size: 1 },
    { location: 'mac', path: 'a/x.pdf', size: 1 },
  ];
  assert.equal(idx.pickKeeper(copies).path, idx.pickKeeper(copies.slice().reverse()).path);
});

test('a shared size with no hash is COULD NOT READ, never unique', () => {
  const a = idx.analyze([
    { location: 'mac', path: 'a', size: 7, hash: 'h' },
    { location: 'maxone', path: 'b', size: 7 },
  ]);
  assert.equal(a.unreadable.length, 1);
  assert.equal(a.unreadable[0].path, 'b');
  assert.equal(a.uniqueBySize.length, 0);
});

test('native Google files and errors land in their own buckets, never silently', () => {
  const a = idx.analyze([
    { location: 'mentor24', path: 'Doc', size: 0, native: true },
    { location: 'mac', path: 'locked', size: 3, error: 'EACCES' },
    { location: 'mac', path: 'empty', size: 0 },
    { location: 'mac', path: 'lone', size: 9 },
  ]);
  assert.equal(a.native.length, 1);
  assert.equal(a.unreadable.length, 1);
  assert.equal(a.empty, 1);
  assert.equal(a.uniqueBySize.length, 1);
});

test('zip verdicts: ON DRIVE, PARTLY, ELSEWHERE, CANNOT TELL', () => {
  const entries = [
    // z1: its one member is on Drive → ON DRIVE
    { location: 'maxone', path: 'z1.zip', size: 100, zipFile: true },
    { location: 'maxone', container: 'z1.zip', path: 'a.jpg', size: 10, hash: 'A' },
    { location: 'mentor24', path: 'Photos/a-renamed.jpg', size: 10, hash: 'A' },
    // z2: one member on Drive, one nowhere (unique size) → PARTLY
    { location: 'maxone', path: 'z2.zip', size: 101, zipFile: true },
    { location: 'maxone', container: 'z2.zip', path: 'a.jpg', size: 10, hash: 'A' },
    { location: 'maxone', container: 'z2.zip', path: 'only.mov', size: 12345 },
    // z3: its member exists only as a loose Mac file → ELSEWHERE
    { location: 'maxone', path: 'z3.zip', size: 102, zipFile: true },
    { location: 'maxone', container: 'z3.zip', path: 'b.pdf', size: 20, hash: 'B' },
    { location: 'mac', path: 'Desktop/b.pdf', size: 20, hash: 'B' },
    // z4: could not be opened → CANNOT TELL
    { location: 'maxone', path: 'z4.zip', size: 103, zipFile: true, listError: 'cannot open zip: bad magic' },
  ];
  const a = idx.analyze(entries);
  const byPath = Object.fromEntries(idx.classifyZips(entries, a).map((z) => [z.path, z]));
  assert.equal(byPath['z1.zip'].verdict, 'ON DRIVE');
  assert.equal(byPath['z2.zip'].verdict, 'PARTLY');
  assert.deepEqual(byPath['z2.zip'].missing.map((m) => m.path), ['only.mov']);
  assert.equal(byPath['z3.zip'].verdict, 'ELSEWHERE');
  assert.equal(byPath['z4.zip'].verdict, 'CANNOT TELL');
});

test('a member whose only copy is inside the SAME zip does not count as a copy', () => {
  const entries = [
    { location: 'maxone', path: 'z.zip', size: 100, zipFile: true },
    { location: 'maxone', container: 'z.zip', path: 'a.jpg', size: 10, hash: 'A' },
    { location: 'maxone', container: 'z.zip', path: 'copy-of-a.jpg', size: 10, hash: 'A' },
  ];
  const a = idx.analyze(entries);
  // Two identical members: each IS the other's copy, but both live and die with
  // the zip — so the zip is not redundant.
  const [z] = idx.classifyZips(entries, a);
  assert.equal(z.verdict, 'PARTLY');
  assert.equal(z.missing.length, 2);
});

test('proposed removals list loose extra copies only, each with its keeper', () => {
  const a = idx.analyze([
    { location: 'maxone', path: 'IMG.MOV', size: 50, hash: 'V' },
    { location: 'mentorofaio', path: 'Video/IMG.MOV', size: 50, hash: 'V' },
    { location: 'maxone', container: 'z.zip', path: 'IMG.MOV', size: 50, hash: 'V' },
  ]);
  const r = idx.proposedRemovals(a);
  assert.equal(r.maxone.count, 1);
  assert.equal(r.maxone.items[0].keeper.location, 'mentorofaio');
  assert.equal(r.mentorofaio.count, 0);
});

test('the report always has a Could-not-read section, even when it is empty', () => {
  const { markdown } = idx.renderReport([{ location: 'mac', path: 'lone', size: 9 }], { ranAt: 'now', sources: [] });
  assert.match(markdown, /## Could not read\n\nNothing\./);
});

// ---------------------------------------------------------------------------
// The ticket's own test, end to end through the real script: plant a
// duplicate under another name, plant a near-miss, both inside and outside a
// zip, and read the report back.
const havePython = spawnSync('python3', ['--version']).status === 0;
const haveZip = spawnSync('zip', ['-v']).status === 0;

test('end to end: a renamed duplicate is paired, a one-byte near-miss is not', { skip: !(havePython && haveZip) && 'needs python3 and zip' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-index-'));
  const a = path.join(tmp, 'a');
  const b = path.join(tmp, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const body = 'the quick brown fox jumps over the lazy dog\n';
  fs.writeFileSync(path.join(a, 'IMG_0001.JPG'), body);
  fs.writeFileSync(path.join(b, 'holiday.jpg'), body); // same bytes, new name
  // Near-miss: SAME name, SAME size, one byte different.
  fs.writeFileSync(path.join(b, 'IMG_0001.JPG'), body.replace('fox', 'fix'));
  // And a zip on "a" whose member is a copy of the loose file on "b".
  fs.writeFileSync(path.join(tmp, 'member.jpg'), body);
  assert.equal(spawnSync('zip', ['-q', path.join(a, 'archive.zip'), 'member.jpg'], { cwd: tmp }).status, 0);

  const out = path.join(tmp, 'out');
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'archive_index.mjs'), '--root', `a=${a}`, '--root', `b=${b}`, '--out', out], { encoding: 'utf8' });
  const r = run();
  assert.equal(r.status, 0, r.stderr + r.stdout);

  const dups = fs.readFileSync(path.join(out, 'duplicates.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  const sets = new Map();
  for (const row of dups) {
    if (!sets.has(row[0])) sets.set(row[0], []);
    sets.get(row[0]).push(`${row[5]}:${row[6] ? `${row[6]}::` : ''}${row[7]}`);
  }
  assert.equal(sets.size, 1, `expected one duplicate set, got ${JSON.stringify([...sets.values()])}`);
  assert.deepEqual([...sets.values()][0].sort(), ['a:IMG_0001.JPG', 'a:archive.zip::member.jpg', 'b:holiday.jpg']);
  // The near-miss shares a name with a member of the set and is NOT in it.
  assert.ok(!dups.some((row) => row[5] === 'b' && row[7] === 'IMG_0001.JPG'));

  // Rerunning gives the same answer (from the cache).
  const first = fs.readFileSync(path.join(out, 'duplicates.tsv'), 'utf8');
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(path.join(out, 'duplicates.tsv'), 'utf8'), first);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('end to end: a location that is not there is CANNOT TELL (exit 2), not an empty report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-index-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'archive_index.mjs'), '--root', `gone=${path.join(tmp, 'nope')}`, '--out', path.join(tmp, 'out')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /CANNOT TELL/);
  assert.ok(!fs.existsSync(path.join(tmp, 'out', 'report.md')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a Google Doc that rclone presents as a .docx with Size -1 is native, not unreadable', () => {
  // The shape the first real run met 1,199 times (2026-09-21).
  assert.deepEqual(
    idx.classifyDriveRow({ Path: 'Alphire Agency System.docx', Size: -1, MimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    { size: 0, native: true },
  );
  assert.deepEqual(idx.classifyDriveRow({ Path: 'a.jpg', Size: 5, Hashes: { md5: 'abc' } }), { size: 5, hash: 'abc' });
  // A real file with bytes and no checksum is still a could-not-read.
  assert.equal(idx.classifyDriveRow({ Path: 'b.mov', Size: 5 }).error, 'Drive supplied no checksum');
});

test('an iCloud-only file (error -11) is named as such, not as "Unknown system error"', () => {
  const err = Object.assign(new Error('Unknown system error -11: Unknown system error -11, read'), { errno: -11, code: 'Unknown system error -11' });
  assert.match(idx.readErrorReason(err), /^in iCloud only/);
  assert.match(idx.readErrorReason({ code: 'EACCES' }), /refused access/);
  assert.equal(idx.readErrorReason({ code: 'EIO' }), 'could not read: EIO');
});

// ---------------------------------------------------------------------------
// Ticket 86bcfgyyw: iCloud Drive and the archived Trash join the default
// places, MaxOne leaves them, and a file whose bytes are in iCloud is counted as
// NOT CHECKED — never unique, never a duplicate.

test('the default places drop MaxOne and add iCloud Drive, the archived Trash and a not-checked Photos line', () => {
  const d = idx.defaultPlaces('HOME', ['Desktop - Dane’s MacBook Pro (2)', 'Music']);
  const locations = d.roots.map((r) => r.location);
  assert.ok(!locations.includes('maxone'), 'MaxOne is the Time Machine drive now, not an archive');
  assert.ok(!d.roots.some((r) => r.root.startsWith('/Volumes/')));
  assert.deepEqual(d.roots.filter((r) => r.location === 'mac').map((r) => r.root), [
    'HOME/Desktop', 'HOME/Documents', 'HOME/Downloads', 'HOME/Desktop - Dane’s MacBook Pro (2)',
  ]);
  assert.deepEqual(d.roots.find((r) => r.location === 'icloud'), { location: 'icloud', root: 'HOME/Library/Mobile Documents/com~apple~CloudDocs' });
  assert.deepEqual(d.roots.find((r) => r.location === 'mac-trash'), { location: 'mac-trash', root: 'HOME/.Trash/Archived-from-Mac-20261004-0327', optional: true });
  assert.deepEqual(d.remotes, [['mentor24', 'm24:'], ['mentorofaio', 'gdrive:']]);
  assert.equal(d.notChecked.length, 1);
  assert.equal(d.notChecked[0].location, 'photos');
  assert.match(d.notChecked[0].why, /^not checked/);
});

test('the older ".name.icloud" stub names the real file; nothing else is a stub', () => {
  assert.equal(idx.icloudStubTarget('Zoom/2020-04-09 call/.zoom_0.mp4.icloud'), 'Zoom/2020-04-09 call/zoom_0.mp4');
  assert.equal(idx.icloudStubTarget('.Report.pdf.icloud'), 'Report.pdf');
  assert.equal(idx.icloudStubTarget('Report.pdf.icloud'), null);
  assert.equal(idx.icloudStubTarget('.hidden'), null);
});

test('an iCloud-only file is NOT CHECKED: never unique, never a duplicate, never empty', () => {
  const a = idx.analyze([
    // Same size and even a hash matching a real file: still not a duplicate,
    // because its bytes were never read here.
    { location: 'icloud', path: 'Zoom/a.mp4', size: 50, hash: 'V', placeholder: true },
    { location: 'mentorofaio', path: 'Studio/a.mp4', size: 50, hash: 'V' },
    // A size nothing else has: would be "unique by size" if it were read.
    { location: 'icloud', path: 'Zoom/b.mp4', size: 12345, placeholder: true },
    // An old-style stub carries no size at all: not "empty".
    { location: 'icloud', path: 'Zoom/c.mp4', size: 0, placeholder: true },
  ]);
  assert.deepEqual(a.notChecked.map((e) => e.path), ['Zoom/a.mp4', 'Zoom/b.mp4', 'Zoom/c.mp4']);
  assert.equal(a.uniqueBySize.length, 0);
  assert.equal(a.sets.length, 0);
  assert.equal(a.empty, 0);
  const place = idx.placeSummary([], a, []).length; // no entries → no rows
  assert.equal(place, 0);
});

test('each place gets one line: where it belongs, only copy, not checked', () => {
  const entries = [
    // A Mac video with a copy on mentorofaio, where video belongs.
    { location: 'mac', path: 'Desktop/talk.mov', size: 50, hash: 'V' },
    { location: 'mentorofaio', path: 'Studio/talk.mov', size: 50, hash: 'V' },
    // A Mac PDF whose only other copy is on the WRONG Drive: neither line.
    { location: 'mac', path: 'Documents/tax.pdf', size: 30, hash: 'P' },
    { location: 'mentorofaio', path: 'misc/tax.pdf', size: 30, hash: 'P' },
    // The only copy anywhere: by size, and by hash.
    { location: 'mac', path: 'Desktop/lone.jpg', size: 7777 },
    { location: 'mac', path: 'Desktop/hashed-lone.jpg', size: 40, hash: 'L' },
    // Not checked.
    { location: 'icloud', path: 'Zoom/x.mp4', size: 900, placeholder: true },
    { location: 'icloud', path: 'Docs/y.pdf', size: 40, hash: 'Y' },
  ];
  // hashed-lone shares a size with y.pdf, so both were hashed; neither matches.
  const a = idx.analyze(entries);
  const rows = Object.fromEntries(idx.placeSummary(entries, a, [
    { location: 'mac', root: '~/Desktop' },
    { location: 'photos', root: '~/Pictures/Photos Library.photoslibrary', error: 'not checked — no permission' },
  ]).map((r) => [r.location, r]));
  assert.equal(rows.mac.files, 4);
  assert.equal(rows.mac.atHome, 1);
  assert.equal(rows.mac.onlyHere, 2);
  assert.equal(rows.mac.onlyHereBytes, 7777 + 40);
  assert.equal(rows.mac.notChecked, 0);
  assert.equal(rows.icloud.notChecked, 1);
  assert.equal(rows.icloud.onlyHere, 1);
  assert.equal(rows.mentorofaio.atHome, 1, 'the mentorofaio video IS where it belongs');
  assert.deepEqual(rows.photos.problems, ['not checked — no permission']);

  const { markdown } = idx.renderReport(entries, { ranAt: 'now', sources: [{ location: 'photos', root: 'Photos', error: 'not checked — no permission' }] });
  assert.match(markdown, /## Each place, in one line/);
  assert.match(markdown, /- \*\*mac\*\*: 4 files, .*; 1 \(50 B\) have a confirmed copy where they belong; 2 \(7\.8 KB\) are the only copy; 0 \(0 B\) not checked\./);
  assert.match(markdown, /- \*\*photos\*\* \(Photos\): not checked — no permission\./);
  assert.match(markdown, /\*\*In iCloud only, not checked:\*\* 1 files, 900 B/);
  assert.match(markdown, /## In iCloud only — not checked\n\nThese files/);
});

test('end to end: an iCloud stub is listed as not checked and the run says so in its exit code', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-index-'));
  const icloud = path.join(tmp, 'icloud');
  fs.mkdirSync(path.join(icloud, 'Zoom'), { recursive: true });
  fs.writeFileSync(path.join(icloud, 'Zoom', '.zoom_0.mp4.icloud'), 'bplist00 stub');
  fs.writeFileSync(path.join(icloud, 'notes.txt'), 'here on the disk\n');
  const out = path.join(tmp, 'out');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'archive_index.mjs'), '--root', `icloud=${icloud}`, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'one file was not checked, so not every entry was settled');
  assert.match(r.stdout, /1 in iCloud only, not checked/);
  const notChecked = fs.readFileSync(path.join(out, 'not-checked.tsv'), 'utf8').trim().split('\n').slice(1);
  assert.deepEqual(notChecked.map((l) => l.split('\t').slice(0, 2)), [['icloud', 'Zoom/zoom_0.mp4']]);
  const report = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
  assert.match(report, /- \*\*icloud\*\* \([^)]*\): 2 files, .*; 1 \(17 B\) are the only copy; 1 \(0 B\) not checked\./);
  fs.rmSync(tmp, { recursive: true, force: true });
});
