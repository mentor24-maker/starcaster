#!/usr/bin/env node
'use strict';

/**
 * Fail CI / pre-commit when HTML still references stale or unpinned local assets.
 *
 *   npm run check:assets
 */

const fs = require('fs');
const path = require('path');
const {
  hashFile,
  defaultHtmlTargets,
} = require('./pin_asset_versions.cjs');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const ASSET_REF = /(?:src|href)="(\/[^"?#]+\.(?:js|css))(?:\?v=([^"]*))?"/gi;

function checkHtmlFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const problems = [];
  let match;

  while ((match = ASSET_REF.exec(html)) !== null) {
    const urlPath = match[1];
    const version = match[2];
    const localFile = path.join(publicDir, urlPath);
    if (!fs.existsSync(localFile)) continue;

    const expected = hashFile(localFile);
    if (!version) {
      problems.push(`${urlPath} is missing ?v= (expected ?v=${expected})`);
      continue;
    }
    if (version !== expected) {
      problems.push(`${urlPath}?v=${version} is stale (expected ?v=${expected})`);
    }
  }

  return problems;
}

function main() {
  const files = defaultHtmlTargets(root);
  const failures = [];

  for (const filePath of files) {
    const problems = checkHtmlFile(filePath);
    for (const problem of problems) {
      failures.push(`${path.relative(root, filePath)}: ${problem}`);
    }
  }

  if (failures.length) {
    console.error('[check:assets] Stale or missing asset version pins:\n');
    for (const line of failures) console.error(`  - ${line}`);
    console.error('\nRun: npm run pin:assets');
    process.exit(1);
  }

  console.log(`[check:assets] OK — ${files.length} HTML file(s) have current asset hashes.`);
}

main();
