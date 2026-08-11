#!/usr/bin/env node
/**
 * Build public/bundle.js from react-entry.js (the campaigns React app).
 * Single source of esbuild args for `npm run build:app`, the full `npm run
 * build`, scripts/build_pinned_assets.mjs and scripts/dev.mjs — the args used
 * to be spelled out in all four, so a flag added to one silently diverged the
 * others. Pass --watch to rebuild on change.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTABLE_BUILD_ARGS } from './esbuild-common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const args = [
  'react-entry.js',
  '--bundle',
  '--outfile=public/bundle.js',
  '--loader:.js=jsx',
  ...PORTABLE_BUILD_ARGS,
];
if (watch) args.push('--watch');

execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
