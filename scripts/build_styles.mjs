#!/usr/bin/env node
/**
 * Build public/styles.css from src/css/main.css and its partials.
 * Single source of esbuild args for `npm run build:styles`, `npm run
 * build:css`, the full `npm run build`, scripts/build_pinned_assets.mjs and
 * scripts/dev.mjs. Pass --watch to rebuild on change.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTABLE_BUILD_ARGS } from './esbuild-common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const args = [
  'src/css/main.css',
  '--bundle',
  '--outfile=public/styles.css',
  ...PORTABLE_BUILD_ARGS,
];
if (watch) args.push('--watch');

execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
