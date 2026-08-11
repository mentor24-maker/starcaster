#!/usr/bin/env node
/**
 * Rebuild exactly the build artifacts that carry a ?v= content hash in the
 * HTML shells — public/styles.css, public/builder-bundle.js, public/bundle.js
 * and public/js/richtext-vendor.js.
 *
 * Why this exists: pin_asset_versions.cjs hashes whatever is sitting in
 * public/. If those files are stale (source edited but never rebuilt) or
 * belong to a different branch, it pins a hash nobody else can reproduce —
 * which either ships a dead cache-buster or shows up as unrelated churn in
 * the next commit. Rebuilding first makes the pin a function of the source.
 *
 * Fast on purpose (~1s total) so the git hooks can call it every time.
 *
 *   node scripts/build_pinned_assets.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A folder with no dependencies of its own must NOT build. npx would resolve
// esbuild by walking up to the parent checkout and bundle against ITS
// node_modules, writing artifacts full of ../../../ paths that then look
// committable. That is exactly what a brand-new worktree hit: post-checkout
// fires before `npm ci` has run, so the folder was born with poisoned bundles.
if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.log('[build:assets] Skipped — no node_modules in this folder yet. Run `npm ci` first.');
  process.exit(0);
}

/**
 * [label, command, args] — each writes one hash-pinned artifact.
 *
 * Every entry delegates to the one script that owns that artifact's esbuild
 * args. Spelling the args out here as well is how they drift: the flag that
 * keeps a build reproducible across worktrees (see scripts/esbuild-common.mjs)
 * would land in one copy and not the other, and the mismatch only surfaces in
 * CI, on files the change never touched.
 */
const BUILDS = [
  ['styles.css', 'node', ['scripts/build_styles.mjs']],
  ['bundle.js', 'node', ['scripts/build_app_bundle.mjs']],
  ['builder-bundle.js', 'node', ['scripts/build_builder_bundle.mjs']],
  ['js/richtext-vendor.js', 'node', ['scripts/build_richtext_bundle.mjs']],
];

for (const [label, cmd, args] of BUILDS) {
  try {
    execFileSync(cmd, args, { cwd: root, stdio: 'pipe' });
  } catch (err) {
    console.error(`[build:assets] Failed to rebuild ${label}.`);
    console.error(String(err.stderr || err.stdout || err.message).trim());
    console.error('\nIf dependencies are missing, run: npm install');
    process.exit(1);
  }
}

console.log(`[build:assets] Rebuilt ${BUILDS.length} hash-pinned artifact(s) from source.`);
