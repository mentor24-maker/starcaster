#!/usr/bin/env node
/**
 * scripts/bump_cache.js  (emergency override)
 * Usage: node scripts/bump_cache.js [label]
 *
 * Normally you don't need this — the build stamps every <script> and <link>
 * with an MD5 hash of the file contents, so the cache busts itself whenever
 * a file changes.
 *
 * Use this only if you need to force-bust the cache for a file whose
 * content on disk hasn't changed (e.g. the CDN cached a corrupt version):
 *
 *   npm run bust              → stamps everything with a Unix timestamp
 *   npm run bust my-label     → stamps everything with a named label
 *
 * HOW IT WORKS (rewritten 2026-08-24, task 86bbkh1nn). It used to stamp the
 * label into src/layout.html — committed SOURCE — and then re-pin, which
 * immediately overwrote the label with content hashes again. Two problems:
 * the force-bust never actually reached the built shell (a silent no-op,
 * verified on both branches during review), and once src/layout.html stopped
 * being a pin target the label just sat there dirtying committed source,
 * invisible to CI. Now it rebuilds first and stamps the label onto the
 * GENERATED public/*.html afterwards, touching no committed file and
 * actually delivering the label to what gets served.
 *
 * Scope honestly stated: this affects the machine it runs on. On Vercel the
 * HTML is regenerated at deploy, so the production force-bust is a redeploy —
 * this script is for a local or self-hosted serve.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

/**
 * Only GENERATED files may be stamped. Anything git tracks is committed
 * source, and writing a throwaway label into committed source is the exact
 * bug this script was rewritten to remove — invisible to CI, restored as
 * conflict churn. Asking git is the honest test; a hand-kept list of which
 * public/*.html are generated would rot the day one moves (task 86bbkh288
 * moves four of them).
 */
function trackedHtml() {
  try {
    const out = execFileSync('git', ['ls-files', '--', 'public/*.html'], { cwd: root, encoding: 'utf8' });
    return new Set(out.split('\n').filter(Boolean).map((p) => path.basename(p)));
  } catch {
    // If git cannot answer, stamp nothing rather than risk committed source.
    return null;
  }
}

const label = process.argv[2]
  ? String(process.argv[2]).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40)
  : String(Math.floor(Date.now() / 1000));

// Rebuild first, so the stamp lands on current output and nothing re-pins
// over it afterwards.
require('./build_html');

const tracked = trackedHtml();
if (tracked === null) {
  console.error('✗ Could not ask git which public/*.html files are committed — stamping nothing rather than risk writing a label into committed source.');
  process.exit(1);
}

let stamped = 0;
const skipped = [];
for (const name of fs.readdirSync(publicDir)) {
  if (!name.endsWith('.html')) continue;
  if (tracked.has(name)) { skipped.push(name); continue; }
  const file = path.join(publicDir, name);
  let html = fs.readFileSync(file, 'utf8');
  const next = html
    .replace(/(\.(js|css))\?v=[^"'\s>]*/g, `$1?v=${label}`)
    .replace(/(src|href)="(\/[^"]+\.(js|css))(?!\?v=)"/g, `$1="$2?v=${label}"`);
  if (next !== html) {
    fs.writeFileSync(file, next, 'utf8');
    stamped += 1;
  }
}
console.log(`✓ Force-stamped ?v=${label} onto ${stamped} generated public/*.html file(s). No committed file was touched.`);
if (skipped.length) {
  console.log(`  Skipped ${skipped.length} committed file(s) (git-tracked, so they are source, not output): ${skipped.join(', ')}`);
}
console.log('  (Production note: Vercel regenerates these at deploy — the production force-bust is a redeploy.)');
