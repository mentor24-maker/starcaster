#!/usr/bin/env node
/**
 * Build public/builder-bundle.js from builder-react-entry.tsx.
 * Single source of esbuild args for npm run build:builder and scripts/dev.mjs.
 * Pass --watch to rebuild on change.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { pinAssetVersions } = require('./pin_asset_versions.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const versionOnly = process.argv.includes('--version-only');

const args = [
  'builder-react-entry.tsx',
  '--bundle',
  '--outfile=public/builder-bundle.js',
  '--jsx=automatic',
  '--loader:.js=jsx',
  '--tsconfig=tsconfig.json',
];
if (watch) args.push('--watch');
else args.push('--minify');

if (!versionOnly) {
  execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
}

if (!watch) {
  const results = pinAssetVersions({ root });
  const changed = results.filter((r) => r.changed);
  console.log(
    changed.length
      ? `Pinned asset versions in ${changed.length} HTML file(s)`
      : 'Asset versions already current in all HTML shells'
  );
}
