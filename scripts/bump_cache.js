#!/usr/bin/env node
/**
 * scripts/bump_cache.js  (emergency override)
 * Usage: node scripts/bump_cache.js [label]
 *
 * Normally you don't need this — build_html.js automatically stamps every
 * <script> and <link> with an MD5 hash of the file contents, so the cache
 * busts itself whenever a file changes.
 *
 * Use this only if you need to force-bust the cache for a file whose
 * content on disk hasn't changed (e.g. the CDN cached a corrupt version):
 *
 *   npm run bust              → stamps everything with a Unix timestamp
 *   npm run bust my-label     → stamps everything with a named label
 *
 * This overwrites the auto-hashes with a fixed label in layout.html and
 * then rebuilds app-shell.html.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const layoutPath = path.join(__dirname, '../src/layout.html');

const label = process.argv[2]
  ? String(process.argv[2]).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40)
  : String(Math.floor(Date.now() / 1000));

let html = fs.readFileSync(layoutPath, 'utf8');
html = html.replace(/(\.(js|css))\?v=[^"'\s>]*/g, `$1?v=${label}`);
html = html.replace(/(src|href)="(\/[^"]+\.(js|css))(?!\?v=)"/g, `$1="$2?v=${label}"`);
fs.writeFileSync(layoutPath, html, 'utf8');
console.log(`✓ Force-stamped all ?v= to v=${label} in src/layout.html`);
console.log('  Run npm run build:html to restore automatic content-hash stamping.');

require('./build_html');
