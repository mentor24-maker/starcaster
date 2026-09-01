#!/usr/bin/env node
'use strict';
/**
 * Parse gate for the hand-written JavaScript nothing else parses.
 *
 * WHY THIS EXISTS — PART ONE: public/js/
 * Most of this repo gets parsed by something as a side effect of normal work:
 * the React builder is bundled by esbuild, and routes/ is `require`d by the
 * node tests. `public/js/` is neither — those files are plain <script src>
 * tags in src/layout.html, they are excluded from tsconfig.json, and there is
 * no linter. So until this ran, the first thing to ever parse them was a
 * user's browser.
 *
 * That is not theoretical: pageHeadingNav.js sat on main unparseable for
 * months (three object keys missing their opening quote). A syntax error
 * discards the WHOLE file, so every back-link in the admin app silently did
 * nothing, and no check in the project noticed.
 *
 * WHY THIS EXISTS — PART TWO: scripts/ and lib/
 * The same hole, one floor down. On 2026-08-30, fast-tracking 86bbmg2tq,
 * `git merge origin/main` hit a content conflict in `scripts/clickup_direct.mjs`
 * where both branches had added lines in the same place. Resolving it by
 * keeping both sides fused two separate `const { ... } = X;` statements into
 * one — perfectly valid to git, a SyntaxError to node. Nothing would have
 * caught it: this gate read only public/js/, `test:builder` reads
 * clickup_direct.mjs as TEXT and never executes it, and check_conventions
 * skips added-line checks during a merge. A file every loop pass runs could
 * have reached main green, and the next loop pass would have died on line 1 —
 * every ticket stuck, with no verdict written anywhere. It was caught only
 * because an agent happened to run `node --check` by hand.
 *
 * Many of these files are one-shot tools nothing imports, so "the tests would
 * have caught it" is false for most of the tree.
 *
 * WHAT IT CATCHES
 * Syntax errors only — the file-is-completely-dead class. It cannot see a
 * typo like `App.assset.foo()`, which parses fine and fails only when that
 * line runs. Catching those needs a linter, which is a much larger
 * conversation given ~98k lines of legacy vanilla JS.
 *
 * WHAT IT SKIPS, AND WHY THAT MATTERS
 * Generated artifacts (scripts/lib/generated_files.cjs). They are esbuild's
 * own output, so a syntax error there would have failed the build that made
 * them — and under landmine 14 they do not EXIST at CI time, because this gate
 * runs before `npm run build`. A checker that insisted on reading them would
 * pass locally forever and fail CI forever.
 *
 * Parsing is done with esbuild (already a build dependency) because it handles
 * both ES modules and CommonJS in a single process — the whole sweep is a
 * fraction of a second for ~700 files.
 *
 * Usage:  node scripts/check_syntax.cjs [--quiet]
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { isGenerated } = require('./lib/generated_files.cjs');

const ROOT = path.resolve(__dirname, '..');

/**
 * Hand-written browser JS: flat directories, `.js` only, loaded by <script src>.
 * Generated bundles in here are skipped by `isGenerated` like everything else —
 * there is no second mechanism. This scan used to carry its own basename
 * skip-list beside it; that was redundant with the artifact list, so it is gone.
 */
const BROWSER_DIRS = ['public/js', 'public/shared'];

/**
 * Hand-written node JS: scanned RECURSIVELY, and `.mjs`/`.cjs` count. These
 * are the scripts the loops, the hooks and the server libraries run.
 */
const NODE_DIRS = ['scripts', 'lib'];
const NODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * Never descend into these, wherever they appear. Deliberately short: a
 * skip-by-folder-name is a silent exclusion nobody can audit, so generated
 * output is skipped by the declared artifact list instead (isGenerated), not
 * by guessing that a folder called "dist" holds build output.
 */
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** Flat scan: every `.js` directly inside `dir`. */
function collectFlat(dir, { root = ROOT } = {}) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `${dir}/${entry.name}`)
    .filter((rel) => !isGenerated(rel))
    .sort();
}

/** Recursive scan: every `.js`/`.mjs`/`.cjs` under `dir`. */
function collectDeep(dir, { root = ROOT } = {}) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const found = [];
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(absDir, entry.name), `${relDir}/${entry.name}`);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!NODE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const rel = `${relDir}/${entry.name}`;
      if (isGenerated(rel)) continue;
      found.push(rel);
    }
  };
  walk(abs, dir);
  return found.sort();
}

/** Every file this gate is responsible for, repo-relative and deduplicated. */
function collectFiles({ root = ROOT } = {}) {
  const browser = BROWSER_DIRS.flatMap((dir) => collectFlat(dir, { root }));
  const node = NODE_DIRS.flatMap((dir) => collectDeep(dir, { root }));
  return [...new Set([...browser, ...node])];
}

/** Parse each file; return one entry per file that will not parse. */
function parseAll(files, { root = ROOT } = {}) {
  const failures = [];
  for (const rel of files) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    try {
      esbuild.transformSync(source, { loader: 'js', sourcefile: rel });
    } catch (err) {
      const detail = err?.errors?.[0];
      failures.push({
        file: rel,
        message: detail?.text || err?.message || 'Unknown syntax error',
        line: detail?.location?.line,
        column: detail?.location?.column,
        lineText: detail?.location?.lineText,
      });
    }
  }
  return failures;
}

function run({ root = ROOT, quiet = false } = {}) {
  const files = collectFiles({ root });
  const failures = parseAll(files, { root });

  if (!failures.length) {
    if (!quiet) console.log(`[check:syntax] OK — ${files.length} hand-written JS file(s) parse cleanly.`);
    return { files, failures };
  }

  console.error(`\n[check:syntax] ${failures.length} file(s) will not parse.`);
  console.error('A syntax error throws away the ENTIRE file, so everything it defines is dead —');
  console.error('in the browser for public/, and on the first line of the next run for scripts/ and lib/.\n');
  for (const failure of failures) {
    const where = failure.line ? `${failure.file}:${failure.line}:${failure.column ?? 0}` : failure.file;
    console.error(`  ${where}`);
    console.error(`    ${failure.message}`);
    if (failure.lineText) console.error(`    > ${failure.lineText.trim()}`);
    console.error('');
  }
  return { files, failures };
}

if (require.main === module) {
  const { failures } = run({ quiet: process.argv.includes('--quiet') });
  process.exit(failures.length ? 1 : 0);
}

module.exports = {
  BROWSER_DIRS,
  NODE_DIRS,
  NODE_EXTENSIONS,
  SKIP_DIRS,
  collectFlat,
  collectDeep,
  collectFiles,
  parseAll,
  run,
};
