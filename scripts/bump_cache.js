#!/usr/bin/env node
/**
 * scripts/bump_cache.js
 * Usage: node scripts/bump_cache.js [label]
 *
 * Replaces every ?v=... query stamp on <script> and <link> tags in
 * src/layout.html with a new version, then rebuilds public/app-shell.html.
 *
 * Examples:
 *   node scripts/bump_cache.js            → uses a timestamp  e.g. ?v=1751200000
 *   node scripts/bump_cache.js my-fix     → ?v=my-fix
 */

'use strict';

const fs = require('fs');
const path = require('path');

const layoutPath = path.join(__dirname, '../src/layout.html');

const label = process.argv[2]
  ? String(process.argv[2]).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40)
  : String(Math.floor(Date.now() / 1000));

let html = fs.readFileSync(layoutPath, 'utf8');

// Replace existing ?v=... stamps
html = html.replace(/(\.(js|css))\?v=[^"'\s>]*/g, `$1?v=${label}`);

// Add ?v= to script/link tags that have no stamp yet
html = html.replace(
  /(src|href)="(\/[^"]+\.(js|css))(?!\?v=)"/g,
  `$1="$2?v=${label}"`
);

fs.writeFileSync(layoutPath, html, 'utf8');
console.log(`✓ Bumped all ?v= stamps to v=${label} in src/layout.html`);

// Rebuild app-shell.html
require('./build_html');
