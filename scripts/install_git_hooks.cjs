#!/usr/bin/env node
'use strict';

/**
 * Install scripts/git-hooks/* into the repo's hooks directory.
 * Wired via package.json "prepare" so npm install keeps the hooks current.
 * Resolves the hooks path via git so worktrees (.git is a pointer file,
 * not a directory) and CI checkouts both work; skips quietly when git or
 * a checkout is absent.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const HOOKS = ['pre-commit', 'pre-push', 'post-checkout', 'post-merge'];

if (!fs.existsSync(path.join(root, '.git'))) {
  console.log('[hooks] Skipped — not a git checkout (.git missing).');
  process.exit(0);
}

for (const name of HOOKS) {
  const source = path.join(__dirname, 'git-hooks', name);
  if (!fs.existsSync(source)) {
    console.error('[hooks] Missing hook source:', source);
    process.exit(1);
  }
}

let hooksDir;
try {
  hooksDir = execSync('git rev-parse --git-path hooks', { cwd: root, encoding: 'utf8' }).trim();
  if (!path.isAbsolute(hooksDir)) hooksDir = path.join(root, hooksDir);
} catch {
  console.log('[hooks] Skipped — could not resolve git hooks path.');
  process.exit(0);
}

fs.mkdirSync(hooksDir, { recursive: true });
for (const name of HOOKS) {
  const dest = path.join(hooksDir, name);
  fs.copyFileSync(path.join(__dirname, 'git-hooks', name), dest);
  fs.chmodSync(dest, 0o755);
}
/*
 * Register the merge driver .gitattributes names.
 *
 * It has to happen here rather than in a committed file, because a merge
 * driver is defined in .git/config and git does not read a driver definition
 * from the repository — that would let a cloned repo run arbitrary commands.
 * The consequence to know: .gitattributes without this is not an error, it is
 * a silent fall back to the default merge. So this runs on every install, and
 * `npm run thread` runs a real `npm ci`.
 *
 * .git/config is shared by every worktree, so registering once covers them all.
 */
try {
  const driver = 'node scripts/merge_asset_pins.cjs %O %A %B %P';
  execSync(`git config merge.asset-pins.name ${JSON.stringify('HTML files carrying ?v= asset pins')}`, { cwd: root, stdio: 'ignore' });
  execSync(`git config merge.asset-pins.driver ${JSON.stringify(driver)}`, { cwd: root, stdio: 'ignore' });
  console.log('[hooks] Registered merge driver → ?v= asset pins stop conflicting on every rebase.');
} catch {
  console.log('[hooks] Could not register the asset-pin merge driver — rebases will conflict on ?v= pins as before.');
}

console.log('[hooks] Installed pre-commit    → rebuilds pinned assets, pins ?v=, runs convention checks.');
console.log('[hooks] Installed pre-push     → blocks branches carrying another branch\'s commits.');
console.log('[hooks] Installed post-checkout → rebuilds pinned assets so they match the branch you switched to.');
console.log('[hooks] Installed post-merge    → deletes local branches whose work is now live.');
