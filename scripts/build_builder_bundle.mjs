#!/usr/bin/env node
/**
 * Build public/builder-bundle.js from builder-react-entry.tsx.
 * Single source of esbuild args for npm run build:builder and scripts/dev.mjs.
 * Pass --watch to rebuild on change.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

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

execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
if (!watch) console.log('Rebuilt public/builder-bundle.js');
