#!/usr/bin/env node
'use strict';

/**
 * Pin ?v=<content-hash> on every local /path/*.js and /path/*.css reference in HTML.
 *
 * Scans all public/*.html plus src/layout.html by default — no manual file list.
 * Safe to run repeatedly (idempotent when artifacts are unchanged).
 *
 * Usage:
 *   node scripts/pin_asset_versions.cjs
 *   node scripts/pin_asset_versions.cjs --watch   # dev: re-pin when bundles change
 *   node scripts/pin_asset_versions.cjs --stage    # git pre-commit: pin + stage updated HTML
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

function hashFile(filePath) {
  return crypto
    .createHash('md5')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .slice(0, 8);
}

/** Rewrite local script/link asset URLs with a content hash query string. */
function pinHtmlAssetVersions(html, assetsPublicDir = publicDir) {
  return html.replace(
    /((?:src|href)=")(\/[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")/gi,
    (match, attrOpen, urlPath, attrClose) => {
      const localFile = path.join(assetsPublicDir, urlPath);
      if (!fs.existsSync(localFile)) return match;
      const hash = hashFile(localFile);
      return `${attrOpen}${urlPath}?v=${hash}${attrClose}`;
    }
  );
}

function defaultHtmlTargets(projectRoot = root) {
  const targets = [];
  const pub = path.join(projectRoot, 'public');
  if (fs.existsSync(pub)) {
    for (const name of fs.readdirSync(pub)) {
      if (name.endsWith('.html')) targets.push(path.join(pub, name));
    }
  }
  const layout = path.join(projectRoot, 'src', 'layout.html');
  if (fs.existsSync(layout)) targets.push(layout);
  return targets.sort();
}

function pinAssetVersions(options = {}) {
  const projectRoot = options.root || root;
  const pubDir = path.join(projectRoot, 'public');
  const files = options.files || defaultHtmlTargets(projectRoot);
  const results = [];

  for (const filePath of files) {
    const before = fs.readFileSync(filePath, 'utf8');
    const after = pinHtmlAssetVersions(before, pubDir);
    if (after !== before) {
      fs.writeFileSync(filePath, after, 'utf8');
      results.push({ filePath, changed: true });
    } else {
      results.push({ filePath, changed: false });
    }
  }

  return results;
}

function logPinResults(results) {
  const changed = results.filter((r) => r.changed);
  if (!changed.length) {
    console.log('[pin:assets] All HTML asset references are current.');
    return;
  }
  console.log(`[pin:assets] Updated ${changed.length} file(s):`);
  for (const { filePath } of changed) {
    console.log(`  ${path.relative(root, filePath)}`);
  }
}

function watchAssets() {
  const assets = ['styles.css', 'builder-bundle.js', 'bundle.js'];
  let timer = null;

  function schedulePin() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      logPinResults(pinAssetVersions());
    }, 120);
  }

  for (const name of assets) {
    const assetPath = path.join(publicDir, name);
    if (!fs.existsSync(assetPath)) continue;
    fs.watch(assetPath, schedulePin);
  }

  console.log('[pin:assets] Watching public/{styles.css,builder-bundle.js,bundle.js}');
}

function isGitIgnored(filePath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', filePath], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function stageChangedFiles(results) {
  // Generated HTML (app-shell, legal pages) is gitignored — pin it on disk
  // but never stage it. Only hand-authored tracked files get staged.
  const changed = results.filter((r) => r.changed && !isGitIgnored(r.filePath));
  if (!changed.length) return;
  for (const { filePath } of changed) {
    execFileSync('git', ['add', '--', filePath], { cwd: root, stdio: 'ignore' });
  }
  console.log(`[pin:assets] Staged ${changed.length} updated HTML file(s) for commit.`);
}

if (require.main === module) {
  const results = pinAssetVersions();
  logPinResults(results);
  if (process.argv.includes('--stage')) stageChangedFiles(results);
  if (process.argv.includes('--watch')) watchAssets();
}

module.exports = {
  hashFile,
  pinHtmlAssetVersions,
  defaultHtmlTargets,
  pinAssetVersions,
};
