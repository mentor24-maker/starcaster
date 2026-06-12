#!/usr/bin/env node
/**
 * Local dev: build HTML + builder bundle first, then watch bundles + start server.
 * Avoids the shell precedence bug where `node server.js` ran in parallel with builds.
 */
import { spawn, execSync } from 'node:child_process';
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

console.log('[dev] Building HTML…');
runSync('npm', ['run', 'build:html']);

console.log('[dev] Building builder bundle…');
runSync('npm', ['run', 'build:builder']);

const watchers = [
  ['npx', ['esbuild', 'react-entry.js', '--bundle', '--outfile=public/bundle.js', '--loader:.js=jsx', '--watch']],
  ['node', ['scripts/build_builder_bundle.mjs', '--watch']],
  ['npx', ['esbuild', 'src/css/main.css', '--bundle', '--outfile=public/styles.css', '--watch']],
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
