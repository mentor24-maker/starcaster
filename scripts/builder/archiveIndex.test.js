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
