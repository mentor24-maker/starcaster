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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTABLE_BUILD_ARGS } from './esbuild-common.mjs';

const { recordBuildInputs } = createRequire(import.meta.url)('./lib/build_inputs.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const bundles = [
  { entry: 'normalize.ts', outfile: 'normalize.js' },
  { entry: 'crawl.ts', outfile: 'crawl.js' },
  { entry: 'capture-playwright.ts', outfile: 'capture-playwright.js' },
  { entry: 'map.ts', outfile: 'map.js' },
  { entry: 'reconcile.ts', outfile: 'reconcile.js' },
  { entry: 'image-topup.ts', outfile: 'image-topup.js' },
  { entry: 'columns.ts', outfile: 'columns.js' },
  { entry: 'surfaces.ts', outfile: 'surfaces.js' },
];

// Each bundle's metafile lists the sources esbuild read; together they become
// the build record the operator scripts check before loading this output
// (scripts/lib/build_inputs.cjs — a stale dist crashed an import, 86bctakmc).
const metaDir = mkdtempSync(path.join(os.tmpdir(), 'build-inputs-'));
const metafiles = [];

for (const [i, { entry, outfile }] of bundles.entries()) {
  const metafile = path.join(metaDir, `${i}.json`);
  const args = [
    path.join(root, 'lib/site-import', entry),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'lib/site-import/dist', outfile)}`,
    '--external:cheerio',
    '--external:playwright',
    `--tsconfig=${path.join(root, 'tsconfig.json')}`,
    `--metafile=${metafile}`,
    ...PORTABLE_BUILD_ARGS,
  ];
  execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
  metafiles.push(JSON.parse(readFileSync(metafile, 'utf8')));
  console.log(`Rebuilt lib/site-import/dist/${outfile}`);
}

const recorded = recordBuildInputs({
  root,
  lib: 'site-import',
  metafiles,
  extra: [path.relative(root, fileURLToPath(import.meta.url)), 'tsconfig.json'],
});
rmSync(metaDir, { recursive: true, force: true });
console.log(`Recorded ${recorded.count} source files in ${recorded.stamp}`);
