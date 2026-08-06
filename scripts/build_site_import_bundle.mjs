#!/usr/bin/env node
/**
 * Rebuild the server-side CJS bundle for the Site Import engine from its
 * TypeScript sources in lib/site-import/. The worker and the node tests
 * require the bundle (lib/site-import/dist/normalize.js); the .ts files are
 * the single source of truth and are covered by `npm run typecheck`.
 * Run after changing lib/site-import/*.ts — or just run
 * `npm run test:site-import`, which rebuilds first.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = [
  path.join(root, 'lib/site-import/normalize.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${path.join(root, 'lib/site-import/dist/normalize.js')}`,
  '--external:cheerio',
  `--tsconfig=${path.join(root, 'tsconfig.json')}`,
];
execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
console.log('Rebuilt lib/site-import/dist/normalize.js');
