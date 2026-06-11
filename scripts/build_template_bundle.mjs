#!/usr/bin/env node
/**
 * Rebuild lib/builder/template.js from Normie builder-template.ts.
 * Run after pulling Normie builder domain changes.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const normie = path.resolve(root, '..', 'normie');

const args = [
  path.join(normie, 'lib/builder-template.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${path.join(root, 'lib/builder/template.js')}`,
  '--external:isomorphic-dompurify',
  '--external:canvas-confetti',
  `--alias:@/lib/builder-hex-color=${path.join(normie, 'lib/builder-hex-color.ts')}`,
  `--alias:@/lib/confetti-effect=${path.join(normie, 'lib/confetti-effect.ts')}`,
  `--alias:@/lib/current-poll-module=${path.join(root, 'lib/builder/current-poll-stub.js')}`,
  `--alias:@/lib/builder-reminder-module=${path.join(normie, 'lib/builder-reminder-module.ts')}`,
  `--alias:@/lib/module-game-audience=${path.join(normie, 'lib/module-game-audience.ts')}`,
  `--alias:@/lib/module-trigger=${path.join(normie, 'lib/module-trigger.ts')}`,
  `--alias:@/lib/headline-rotator=${path.join(normie, 'lib/headline-rotator.ts')}`,
  `--alias:@/lib/builder-asset-url=${path.join(root, 'lib/builder/asset-url-stub.js')}`,
  `--alias:@/lib/sanitize-html=${path.join(normie, 'lib/sanitize-html.ts')}`,
  `--alias:@/lib/rich-text-image=${path.join(normie, 'lib/rich-text-image.ts')}`,
  `--alias:@/lib/game-reminder=${path.join(normie, 'lib/game-reminder.ts')}`,
  `--alias:@/lib/game-audience=${path.join(normie, 'lib/game-audience.ts')}`,
  `--alias:@/lib/builder-template=${path.join(normie, 'lib/builder-template.ts')}`,
];

execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit', cwd: root });
console.log('Rebuilt lib/builder/template.js');
