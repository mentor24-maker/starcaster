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
const HOOKS = ['pre-commit', 'pre-push'];

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
console.log('[hooks] Installed pre-commit → runs pin:assets + convention checks before each commit.');
console.log('[hooks] Installed pre-push  → blocks branches carrying another branch\'s commits.');
