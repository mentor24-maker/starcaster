#!/usr/bin/env node
/**
 * Rebuild the server-side CJS bundles in lib/builder/ from the vendored
 * builder domain sources in lib/builder-client/ (single source of truth
 * for both the client bundle and the server normalizers).
 * Run after changing lib/builder-client/builder-template.ts or
 * builder-email-template.ts.
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
const client = path.join(root, 'lib/builder-client');

// Server bundles swap the browser-facing modules for local stubs.
const serverAliases = [
  `--alias:@/lib/current-poll-module=${path.join(root, 'lib/builder/current-poll-stub.js')}`,
  `--alias:@/lib/builder-asset-url=${path.join(root, 'lib/builder/asset-url-stub.js')}`,
];

const bundles = [
  { entry: 'builder-template.ts', outfile: 'lib/builder/template.js' },
  { entry: 'builder-email-template.ts', outfile: 'lib/builder/email-template.js' },
  // Bulk Create resolves a template's shared sections against their live
  // masters, and must use the SAME rules as the interactive editor.
  { entry: 'builder-template-frame.ts', outfile: 'lib/builder/template-frame.js' },
];

// Each bundle's metafile lists the sources esbuild read; together they become
// the build record the operator scripts check before loading this output
// (scripts/lib/build_inputs.cjs — a stale dist crashed an import, 86bctakmc).
const metaDir = mkdtempSync(path.join(os.tmpdir(), 'build-inputs-'));
const metafiles = [];

for (const [i, { entry, outfile }] of bundles.entries()) {
  const metafile = path.join(metaDir, `${i}.json`);
  const args = [
    path.join(client, entry),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${path.join(root, outfile)}`,
    '--external:isomorphic-dompurify',
    '--external:canvas-confetti',
    `--tsconfig=${path.join(root, 'tsconfig.json')}`,
    ...serverAliases,
    `--metafile=${metafile}`,
    ...PORTABLE_BUILD_ARGS,
  ];
  execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
  metafiles.push(JSON.parse(readFileSync(metafile, 'utf8')));
  console.log(`Rebuilt ${outfile}`);
}

const recorded = recordBuildInputs({
  root,
  lib: 'builder-template',
  metafiles,
  extra: [path.relative(root, fileURLToPath(import.meta.url)), 'tsconfig.json'],
});
rmSync(metaDir, { recursive: true, force: true });
console.log(`Recorded ${recorded.count} source files in ${recorded.stamp}`);
