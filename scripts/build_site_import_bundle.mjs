#!/usr/bin/env node
/**
 * Rebuild the server-side CJS bundles for the Site Import engine from its
 * TypeScript sources in lib/site-import/. The worker and the node tests
 * require these bundles (lib/site-import/dist/*.js); the .ts files are the
 * single source of truth and are covered by `npm run typecheck`.
 * Run after changing lib/site-import/*.ts — or just run
 * `npm run test:site-import`, which rebuilds first.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const bundles = [
  { entry: 'normalize.ts', outfile: 'normalize.js' },
  { entry: 'crawl.ts', outfile: 'crawl.js' },
  { entry: 'capture-playwright.ts', outfile: 'capture-playwright.js' },
];

for (const { entry, outfile } of bundles) {
  const args = [
    path.join(root, 'lib/site-import', entry),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'lib/site-import/dist', outfile)}`,
    '--external:cheerio',
    '--external:playwright',
    `--tsconfig=${path.join(root, 'tsconfig.json')}`,
  ];
  execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
  console.log(`Rebuilt lib/site-import/dist/${outfile}`);
}
