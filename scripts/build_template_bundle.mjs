#!/usr/bin/env node
/**
 * Rebuild the server-side CJS bundles in lib/builder/ from the vendored
 * builder domain sources in lib/builder-client/ (single source of truth
 * for both the client bundle and the server normalizers).
 * Run after changing lib/builder-client/builder-template.ts or
 * builder-email-template.ts.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
];

for (const { entry, outfile } of bundles) {
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
  ];
  execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
  console.log(`Rebuilt ${outfile}`);
}
