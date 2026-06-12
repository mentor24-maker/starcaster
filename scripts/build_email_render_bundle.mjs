#!/usr/bin/env node
/**
 * Bundle the vendored builder email renderer into a server-side CJS module
 * (lib/builder/email-render.js) so Express routes can render Builder email
 * templates without an ESM/TS loader. Same pattern as build_template_bundle.mjs.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = [
  path.join(root, 'lib/builder-client/builder-email-render.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${path.join(root, 'lib/builder/email-render.js')}`,
  '--external:isomorphic-dompurify',
  '--external:canvas-confetti',
  `--tsconfig=${path.join(root, 'tsconfig.json')}`,
  `--alias:@/lib/current-poll-module=${path.join(root, 'lib/builder/current-poll-stub.js')}`,
  `--alias:@/lib/builder-asset-url=${path.join(root, 'lib/builder/asset-url-stub.js')}`,
];

execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
console.log('Rebuilt lib/builder/email-render.js');
