#!/usr/bin/env node
/**
 * Local dev: build HTML + builder bundle first, then watch bundles + start server.
 * Avoids the shell precedence bug where `node server.js` ran in parallel with builds.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
}

function runSync(command, args) {
  execSync([command, ...args].join(' '), { cwd: root, stdio: 'inherit' });
}

// Refuse to start against the live database unless that is deliberate.
//
// The point of the local setup is that production stops being where you find
// out whether something works. Nothing used to ask: a checkout left pointing
// at the cloud started up looking exactly like a local one, and the first
// clue was a change appearing on a client's site.
//
// ALLOW_CLOUD_DEV=1 exists because debugging a production-only problem is a
// real need. Having to type it is the whole control.
const envFile = path.join(root, '.env.local');
let pointedAt = '';
try {
  const match = /^SUPABASE_URL=(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'));
  pointedAt = match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
} catch (_) {
  pointedAt = '';
}
// Shared with the banner and `db:use`, deliberately: the guard must agree
// with the strip across the top of the app about what "local" means.
const { classify } = createRequire(import.meta.url)(path.join(root, 'lib/environmentBanner.js'));
const isLocalDb = classify(pointedAt) === 'local';

if (!isLocalDb && process.env.ALLOW_CLOUD_DEV !== '1') {
  console.error('');
  console.error('  This folder is pointed at ' + (pointedAt || 'no database at all') + '.');
  console.error('');
  console.error('  That is the LIVE database - 21 tenant sites read from it, and');
  console.error('  anything you change while developing is real and immediate.');
  console.error('');
  console.error('  Switch to your own copy:   npm run db:use local');
  console.error('  Or, if you really mean it: ALLOW_CLOUD_DEV=1 npm run dev');
  console.error('');
  process.exit(1);
}

console.log('[dev] Building HTML…');
runSync('npm', ['run', 'build:html']);

console.log('[dev] Building builder bundle…');
runSync('npm', ['run', 'build:builder']);

// Each build script owns its own esbuild args — see scripts/esbuild-common.mjs
// for why watch mode must not respell them here.
const watchers = [
  ['node', ['scripts/build_app_bundle.mjs', '--watch']],
  ['node', ['scripts/build_builder_bundle.mjs', '--watch']],
  ['node', ['scripts/build_styles.mjs', '--watch']],
  ['node', ['scripts/pin_asset_versions.cjs', '--watch']],
];

for (const [cmd, args] of watchers) {
  const child = run(cmd, args, { detached: true });
  child.unref();
}

console.log('[dev] Starting server on http://localhost:3001');
const server = run('node', ['server.js']);

function shutdown() {
  try {
    server.kill('SIGTERM');
  } catch (_) {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
