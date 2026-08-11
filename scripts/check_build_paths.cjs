#!/usr/bin/env node
/**
 * Fail if a built bundle carries a module path that escapes the repo.
 *
 * esbuild annotates each bundled module with its path (`// node_modules/x.js`).
 * Those paths are relative to the repo root, so they should never start with
 * `../`. When they do, the build resolved its dependencies OUTSIDE this folder
 * — in practice because `node_modules` is a symlink to another checkout, which
 * esbuild follows to the real location unless `--preserve-symlinks` is set.
 *
 * Why that matters here specifically: the `?v=` cache busters in the HTML
 * shells are content hashes of these very files (pin_asset_versions.cjs). A
 * bundle built through a symlink hashes differently from the same source built
 * anywhere else, so it pins a version no clean build can reproduce. CI's
 * "Asset pins match a clean build" step then fails on artifacts the change
 * never touched — which reads as a mystery, not as a folder-layout problem.
 * That is exactly how PR #149 (2026-08-10) burned a round trip.
 *
 * This checks the OUTCOME rather than the flag, so a new build script that
 * forgets scripts/esbuild-common.mjs is caught too.
 *
 *   node scripts/check_build_paths.cjs [--quiet]
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const quiet = process.argv.includes('--quiet');

/** The artifacts whose bytes become a `?v=` pin. */
const ARTIFACTS = [
  'public/bundle.js',
  'public/builder-bundle.js',
  'public/js/richtext-vendor.js',
  'public/styles.css',
];

// Matches a leading path comment that walks out of the repo, in either the JS
// line-comment form or the CSS block-comment form esbuild emits.
const ESCAPING_PATH = /^\s*(?:\/\/|\/\*)\s*\.\.\//;

const offenders = [];
const missing = [];

for (const rel of ARTIFACTS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    missing.push(rel);
    continue;
  }

  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (ESCAPING_PATH.test(lines[i])) {
      offenders.push({ rel, line: i + 1, text: lines[i].trim() });
      break; // One example per file is enough to make the point.
    }
  }
}

if (offenders.length === 0) {
  if (!quiet) {
    const checked = ARTIFACTS.length - missing.length;
    console.log(`[check:build-paths] OK — ${checked} built artifact(s) reference only in-repo paths.`);
    if (missing.length) {
      console.log(`[check:build-paths] Not built yet (skipped): ${missing.join(', ')}`);
    }
  }
  process.exit(0);
}

console.error('\n[check:build-paths] Build output points outside this folder.\n');
for (const o of offenders) {
  console.error(`  ✗ ${o.rel}:${o.line}`);
  console.error(`      ${o.text}`);
}

const nodeModules = path.join(root, 'node_modules');
let isSymlink = false;
try {
  isSymlink = fs.lstatSync(nodeModules).isSymbolicLink();
} catch {
  // node_modules missing entirely — the message below still applies.
}

console.error(
  '\n  What this means: this folder builds its bundles from dependencies that\n' +
    "  live somewhere else, so the files it produces don't match the ones a\n" +
    '  clean build produces. The ?v= cache busters in the HTML are hashes of\n' +
    '  these files, so committing now pins versions CI will reject.\n'
);

if (isSymlink) {
  let target = '(unreadable)';
  try {
    target = fs.readlinkSync(nodeModules);
  } catch {
    // Fall through with the placeholder.
  }
  console.error(`  Cause: node_modules is a shortcut to ${target}\n`);
  console.error('  Fix — give this folder its own copy (takes a minute, ~270MB):\n');
  console.error('      rm node_modules && npm ci && npm run build\n');
} else {
  console.error(
    '  node_modules is a real folder here, so a build script is likely missing\n' +
      '  the shared settings in scripts/esbuild-common.mjs. Add\n' +
      '  PORTABLE_BUILD_ARGS (CLI) or PORTABLE_BUILD_OPTIONS (JS API) to it,\n' +
      '  then re-run: npm run build\n'
  );
}

process.exit(1);
