#!/usr/bin/env node
/**
 * Build public/builder-bundle.js from builder-react-entry.tsx.
 * Single source of esbuild args for npm run build:builder and scripts/dev.mjs.
 * Pass --watch to rebuild on change.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

if (!watch) {
  // Rewrite the bundle version query string in both HTML shells so browsers
  // always load the new bundle (admin shell + public site shell).
  const bundlePath = path.join(root, 'public/builder-bundle.js');
  const hash = createHash('md5').update(readFileSync(bundlePath)).digest('hex').slice(0, 8);
  const htmlFiles = [
    path.join(root, 'public/app-shell.html'),
    path.join(root, 'public/site.html'),
  ];
  for (const htmlPath of htmlFiles) {
    try {
      const updated = readFileSync(htmlPath, 'utf8')
        .replace(/builder-bundle\.js\?v=[^"']*/g, `builder-bundle.js?v=${hash}`);
      writeFileSync(htmlPath, updated);
    } catch { /* file may not exist in all environments */ }
  }
  console.log(`Rebuilt public/builder-bundle.js (v=${hash})`);
}
