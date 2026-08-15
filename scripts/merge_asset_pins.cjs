#!/usr/bin/env node
'use strict';

/**
 * Git merge driver for the HTML files that carry `?v=` asset pins.
 *
 * THE PROBLEM IT REMOVES
 * `src/layout.html`, `public/about.html`, `public/site.html` and
 * `public/builder-preview.html` are committed, and every one of them carries
 * cache-busting hashes rebuilt from whatever CSS and JS the build produced
 * (landmine 8). So ANY two branches that touch styling or bundles change the
 * same handful of lines in the same files, and every rebase stops on them —
 * even when neither branch edited a word of the actual markup.
 *
 * Measured on 2026-08-11 while shipping the Top Menu work: main moved six
 * times during one piece of work, and of the conflicts across three rebases,
 * every single one in the final round and most in the others was this and
 * nothing else. The resolution was mechanical every time: take either side,
 * rebuild, carry on. That is what this automates.
 *
 * HOW IT WORKS
 * A pin is noise, so it is taken out of the comparison entirely:
 *
 *   1. every `?v=<hash>` in base/ours/theirs is replaced with a placeholder,
 *   2. the three placeholder-ed versions get an ordinary three-way merge,
 *   3. the pins are put back by ASSET PATH — `/styles.css` gets whatever
 *      `/styles.css` was pinned to in ours, falling back to theirs.
 *
 * Step 3 is the part that matters: restoring by path rather than by position
 * means a merge that moved lines around still stamps each asset with its own
 * hash. The value itself does not have to be right — `npm run build:assets`
 * (pre-commit, and the `build` script) re-pins from the built files, and
 * `npm run check:assets` fails CI if a clean build disagrees. What matters is
 * that the file is never left holding a placeholder or another asset's hash.
 *
 * REAL CONFLICTS STILL CONFLICT. If two branches genuinely edit the same
 * markup, the three-way merge in step 2 fails and this driver reports failure
 * exactly like the default one, conflict markers and all. It only ever
 * silences the pins.
 *
 * Registered by scripts/install_git_hooks.cjs (npm `prepare`), because the
 * driver definition lives in .git/config, which is not a committed file —
 * .gitattributes alone would name a driver that does not exist and git would
 * silently fall back to the default merge.
 *
 * Called by git as: node scripts/merge_asset_pins.cjs %O %A %B %P
 *   %O  ancestor version   %A  ours (and the file to write)
 *   %B  theirs             %P  the real pathname, for messages
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const [, , basePath, oursPath, theirsPath, displayPath] = process.argv;

if (!basePath || !oursPath || !theirsPath) {
  console.error('[merge-asset-pins] Called without %O %A %B — check the driver definition in .git/config.');
  process.exit(1);
}

const label = displayPath || oursPath;

/** `/styles.css?v=8ae1e3af` — the hash is 8+ hex chars after `?v=`. */
const PIN = /\?v=[0-9a-fA-F]+/g;
/** Same, with the asset path in front of it, so pins can be keyed by asset. */
const PIN_WITH_PATH = /([^"'\s<>()]+?)\?v=([0-9a-fA-F]+)/g;
const PLACEHOLDER = '?v=@@ASSET_PIN@@';
const PLACEHOLDER_WITH_PATH = /([^"'\s<>()]+?)\?v=@@ASSET_PIN@@/g;

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`[merge-asset-pins] Could not read ${file}: ${error.message}`);
    process.exit(1);
  }
};

const base = read(basePath);
const ours = read(oursPath);
const theirs = read(theirsPath);

// Nothing to gain if neither side carries a pin — hand it straight back to
// git's own merge so this driver can never make a normal file worse.
if (!PIN.test(ours) && !PIN.test(theirs)) {
  process.exit(runPlainMerge());
}
PIN.lastIndex = 0;

/** asset path -> pinned hash, for putting the pins back afterwards. */
function pinMap(source) {
  const map = new Map();
  for (const match of source.matchAll(PIN_WITH_PATH)) {
    map.set(match[1], match[2]);
  }
  return map;
}

const oursPins = pinMap(ours);
const theirsPins = pinMap(theirs);

const strip = (source) => source.replace(PIN, PLACEHOLDER);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-pin-merge-'));
const tmp = (name, contents) => {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, contents);
  return file;
};

let conflicted = false;
let merged;

try {
  const strippedBase = tmp('base', strip(base));
  const strippedOurs = tmp('ours', strip(ours));
  const strippedTheirs = tmp('theirs', strip(theirs));

  // `git merge-file -p` prints the merge; a non-zero exit is the number of
  // conflict hunks, and the output still carries the markers, which is what
  // we want to hand back so a human sees the real disagreement.
  try {
    merged = execFileSync(
      'git',
      ['merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'theirs',
        strippedOurs, strippedBase, strippedTheirs],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (error) {
    if (typeof error.status !== 'number' || error.status < 0 || error.stdout == null) {
      console.error(`[merge-asset-pins] git merge-file failed on ${label}: ${error.message}`);
      process.exit(1);
    }
    conflicted = true;
    merged = error.stdout;
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Put the pins back, keyed by the asset each one belongs to. Ours first —
// that is the side the working tree is built from — then theirs. A pin for an
// asset neither side knew is left at zeros; the next build stamps it, and
// check:assets would fail the commit if it somehow did not.
let restoredFromTheirs = 0;
let unknown = 0;

merged = merged.replace(PLACEHOLDER_WITH_PATH, (whole, assetPath) => {
  if (oursPins.has(assetPath)) return `${assetPath}?v=${oursPins.get(assetPath)}`;
  if (theirsPins.has(assetPath)) {
    restoredFromTheirs += 1;
    return `${assetPath}?v=${theirsPins.get(assetPath)}`;
  }
  unknown += 1;
  return `${assetPath}?v=00000000`;
});

fs.writeFileSync(oursPath, merged);

if (conflicted) {
  console.error(
    `[merge-asset-pins] ${label} has a real conflict outside its ?v= pins — ` +
    'resolve the marked section by hand. The pins themselves were merged for you.'
  );
  process.exit(1);
}

const notes = [];
if (restoredFromTheirs) notes.push(`${restoredFromTheirs} pin(s) taken from the incoming side`);
if (unknown) notes.push(`${unknown} pin(s) zeroed for the next build to stamp`);
console.log(
  `[merge-asset-pins] ${label} merged automatically` +
  (notes.length ? ` (${notes.join(', ')})` : '') + '.'
);

process.exit(0);

/** The default behaviour, for a file this driver has no business touching. */
function runPlainMerge() {
  try {
    execFileSync('git', ['merge-file', oursPath, basePath, theirsPath], { stdio: 'ignore' });
    return 0;
  } catch (error) {
    return typeof error.status === 'number' && error.status > 0 ? 1 : 1;
  }
}
