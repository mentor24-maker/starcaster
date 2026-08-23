'use strict';

/**
 * Guard: a vitest test must never (transitively) require a GENERATED server lib.
 *
 * WHY (the incident)
 * 2026-08-22, PR #343 (Sync 5/7). Every local gate was green — typecheck,
 * test:builder 490/490, test:builder-ui 1102/1102, conventions — and CI's
 * `verify` job was RED. `lib/builder-client/section-drift.test.ts` did
 * `require("../builder/document.js")`, and document.js line 3 requires
 * `./template`, and `lib/builder/template.js` is a gitignored GENERATED
 * artifact. CI's order is the whole story:
 *
 *   npm ci → check:syntax → check:css → typecheck → npx vitest run → npm run build → … → test:builder
 *
 * `npx vitest run` happens BEFORE `npm run build`, so at vitest time the
 * generated artifacts do not exist. On any developer machine they already do —
 * which is why this shape of test passes locally forever and fails CI forever.
 *
 * THE RULE
 * vitest (components/**, lib/builder-client/**) tests TypeScript sources only.
 * Anything that must require a generated server lib (anything under lib/builder/)
 * belongs in the NODE suite (scripts/builder/*.test.js, run by `npm run
 * test:builder`), which CI runs AFTER the build.
 *
 * WHY A GRAPH WALK, NOT A GREP
 * The offending require was INDIRECT: the test reached lib/builder/document.js,
 * a committed source, whose own require pulled in the generated template.js. A
 * grep of the test file would have to know document.js re-exports a generated
 * file. So this follows relative imports from each test file and fails as soon
 * as the chain reaches anything under lib/builder/. It resolves against the
 * built tree (the dev/worktree machine has the artifacts), so document.js →
 * template.js resolves exactly as it will at CI vitest time — where it breaks.
 *
 * HOW TO PROVE A FIX
 *   mv lib/builder/template.js /tmp/ && npx vitest run   # must stay clean
 * and, for this guard: add a vitest test that requires lib/builder/…, run this
 * check, watch it fail; remove it, watch it pass.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIB_BUILDER_PREFIX = `lib${path.sep}builder${path.sep}`;
const EXTS = ['', '.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

/**
 * The vitest include globs (kept in step with vitest.config.ts): any *.test.ts
 * under lib/builder-client, and any *.test.ts(x) under components. If that
 * config changes, this must too — a comment the config also carries.
 */
function isVitestTestFile(relPosix) {
  if (/^lib\/builder-client\/.*\.test\.ts$/.test(relPosix)) return true;
  if (/^components\/.*\.test\.tsx?$/.test(relPosix)) return true;
  return false;
}

/** lib/builder/ but NOT lib/builder-client/ (a distinct source tree). */
function isUnderLibBuilder(absPath) {
  const rel = path.relative(ROOT, absPath);
  return rel.startsWith(LIB_BUILDER_PREFIX);
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of EXTS) {
    const candidate = base + ext;
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep trying */ }
  }
  return null;
}

// import x from 'y' / export … from 'y' / import 'y' / require('y') / import('y')
// The from-clause uses [^;]*? rather than [\s\S]*? so it cannot span from one
// statement across a `;` into a LATER `from` — which would swallow an
// in-between side-effect `import 'y';` and drop it. A multiline named import
// carries no `;` before its `from`, so [^;] still spans its newlines.
const SPEC_RE = /(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;

function specifiersIn(text) {
  const specs = [];
  for (const m of text.matchAll(SPEC_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * Follow relative imports out of `entryFile`; return the chain to the first
 * file reached under lib/builder/, or null. Injectable readFile/resolve so the
 * node test can drive it on a synthetic tree.
 */
function reachesLibBuilder(entryFile, opts = {}) {
  const readFile = opts.readFile || ((f) => fs.readFileSync(f, 'utf8'));
  const resolve = opts.resolve || resolveRelative;
  const under = opts.isUnderLibBuilder || isUnderLibBuilder;
  const visited = new Set();
  const stack = [[entryFile, [entryFile]]];
  while (stack.length) {
    const [file, chain] = stack.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    let text;
    try { text = readFile(file); } catch { continue; }
    for (const spec of specifiersIn(text)) {
      if (!spec.startsWith('.')) continue; // bare / package imports cannot reach lib/builder
      const resolved = resolve(file, spec);
      if (!resolved) continue;
      const nextChain = [...chain, resolved];
      if (under(resolved)) return nextChain;
      stack.push([resolved, nextChain]);
    }
  }
  return null;
}

function listVitestTestFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      const relPosix = path.relative(ROOT, abs).split(path.sep).join('/');
      if (isVitestTestFile(relPosix)) out.push(abs);
    }
  };
  walk(path.join(ROOT, 'components'));
  walk(path.join(ROOT, 'lib', 'builder-client'));
  return out;
}

function run(/* { all } */) {
  const failures = [];
  const notes = [];
  const tests = listVitestTestFiles();
  for (const testFile of tests) {
    const chain = reachesLibBuilder(testFile);
    if (chain) {
      const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
      const via = chain.map(rel).join('  →  ');
      failures.push(
        `vitest test reaches a generated server lib: ${rel(testFile)}\n` +
        `  require chain: ${via}\n` +
        `  vitest runs BEFORE the build, so lib/builder/* does not exist yet at vitest time — this\n` +
        `  passes locally (you have the artifacts) and always fails CI. Move a test that must require\n` +
        `  a generated lib into the NODE suite (scripts/builder/*.test.js, run by npm run test:builder,\n` +
        `  which CI runs after the build). See docs/DOCTRINE.md and CLAUDE.md landmine 14.`
      );
    }
  }
  return { failures, notes };
}

module.exports = { run, reachesLibBuilder, isVitestTestFile, isUnderLibBuilder, specifiersIn };
