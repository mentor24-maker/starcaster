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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** [label, command, args] — each writes one hash-pinned artifact. */
const BUILDS = [
  ['styles.css', 'npx', ['esbuild', 'src/css/main.css', '--bundle', '--outfile=public/styles.css']],
  ['bundle.js', 'npx', ['esbuild', 'react-entry.js', '--bundle', '--outfile=public/bundle.js', '--loader:.js=jsx']],
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
