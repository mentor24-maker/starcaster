'use strict';

/**
 * The `?v=` asset-pin merge driver (scripts/merge_asset_pins.cjs).
 *
 * Lives under scripts/builder/ because that is the only glob `npm run
 * test:builder` runs — this is repo tooling, not builder code, and moving the
 * glob would sweep in scripts/build-info.test.js, which nothing currently runs
 * and which fails.
 *
 * The behaviour worth protecting is BOTH halves. A driver that resolves
 * everything is worse than no driver at all: it would silently pick a side of
 * a genuine markup disagreement and neither of us would ever see it. So the
 * conflict case is tested as carefully as the clean one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DRIVER = path.join(__dirname, '..', 'merge_asset_pins.cjs');

/** Run the driver over three versions; returns { ok, merged }. */
function mergeWith(base, ours, theirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-driver-test-'));
  try {
    const files = {
      base: path.join(dir, 'base.html'),
      ours: path.join(dir, 'ours.html'),
      theirs: path.join(dir, 'theirs.html'),
    };
    fs.writeFileSync(files.base, base);
    fs.writeFileSync(files.ours, ours);
    fs.writeFileSync(files.theirs, theirs);

    let ok = true;
    try {
      execFileSync('node', [DRIVER, files.base, files.ours, files.theirs, 'layout.html'], { stdio: 'ignore' });
    } catch {
      ok = false;
    }
    return { ok, merged: fs.readFileSync(files.ours, 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BASE = [
  '<link rel="stylesheet" href="/styles.css?v=aaaaaaaa" />',
  '<h1>Header</h1>',
  '<script src="/bundle.js?v=bbbbbbbb"></script>',
  '<footer>Footer</footer>',
  '',
].join('\n');

test('a pin-only difference merges cleanly — the case that used to stop every rebase', () => {
  const ours = BASE.replace('aaaaaaaa', 'eeeeeeee').replace('bbbbbbbb', 'ffffffff');
  const theirs = BASE.replace('aaaaaaaa', 'cccccccc').replace('bbbbbbbb', 'dddddddd');

  const { ok, merged } = mergeWith(BASE, ours, theirs);

  assert.equal(ok, true);
  assert.ok(!merged.includes('<<<<<<<'), 'no conflict markers');
  assert.match(merged, /styles\.css\?v=eeeeeeee/, "our side's pin is kept");
  assert.match(merged, /bundle\.js\?v=ffffffff/);
});

test('each asset keeps its OWN hash even when the merge moves lines', () => {
  // Restoring pins by position rather than by asset is how /styles.css ends up
  // stamped with the bundle's hash, which no build would ever produce.
  const ours = BASE.replace('aaaaaaaa', 'eeeeeeee').replace('bbbbbbbb', 'ffffffff');
  const theirs = BASE
    .replace('aaaaaaaa', 'cccccccc')
    .replace('bbbbbbbb', 'dddddddd')
    .replace('<h1>Header</h1>', '<h1>Header</h1>\n<nav>Menu</nav>');

  const { ok, merged } = mergeWith(BASE, ours, theirs);

  assert.equal(ok, true);
  assert.match(merged, /styles\.css\?v=eeeeeeee/);
  assert.match(merged, /bundle\.js\?v=ffffffff/);
  assert.match(merged, /<nav>Menu<\/nav>/, 'the incoming markup edit survives');
});

test('edits on both sides are both kept', () => {
  const ours = BASE.replace('<footer>Footer</footer>', '<footer>Footer 2026</footer>');
  const theirs = BASE.replace('<h1>Header</h1>', '<h1>Header</h1>\n<nav>Menu</nav>');

  const { ok, merged } = mergeWith(BASE, ours, theirs);

  assert.equal(ok, true);
  assert.match(merged, /Footer 2026/);
  assert.match(merged, /<nav>Menu<\/nav>/);
});

test('a real disagreement on the same line STILL conflicts', () => {
  const ours = BASE.replace('<h1>Header</h1>', '<h1>Main Title</h1>').replace('aaaaaaaa', 'eeeeeeee');
  const theirs = BASE.replace('<h1>Header</h1>', '<h1>Feature Title</h1>').replace('aaaaaaaa', 'cccccccc');

  const { ok, merged } = mergeWith(BASE, ours, theirs);

  assert.equal(ok, false, 'the driver must report failure so git stops');
  assert.ok(merged.includes('<<<<<<<'), 'the human gets conflict markers');
  assert.match(merged, /Main Title/);
  assert.match(merged, /Feature Title/);
});

test('even in a conflicted file the pins themselves are settled', () => {
  const ours = BASE.replace('<h1>Header</h1>', '<h1>Main Title</h1>').replace('aaaaaaaa', 'eeeeeeee');
  const theirs = BASE.replace('<h1>Header</h1>', '<h1>Feature Title</h1>').replace('aaaaaaaa', 'cccccccc');

  const { merged } = mergeWith(BASE, ours, theirs);

  assert.match(merged, /styles\.css\?v=eeeeeeee/);
  assert.ok(!/\?v=@@ASSET_PIN@@/.test(merged), 'no placeholder is ever left in the file');
});

test('a pin for an asset only the incoming side knows is carried over', () => {
  const theirs = BASE.replace(
    '<footer>Footer</footer>',
    '<script src="/new.js?v=12345678"></script>\n<footer>Footer</footer>'
  );

  const { ok, merged } = mergeWith(BASE, BASE, theirs);

  assert.equal(ok, true);
  assert.match(merged, /new\.js\?v=12345678/);
});

test('a file with no pins at all is left to the ordinary merge', () => {
  const base = '<h1>Header</h1>\n';
  const ours = '<h1>Header</h1>\n<p>ours</p>\n';
  const theirs = '<h1>Header</h1>\n<p>theirs</p>\n';

  const { merged } = mergeWith(base, ours, theirs);

  assert.ok(merged.includes('ours') || merged.includes('<<<<<<<'));
});
