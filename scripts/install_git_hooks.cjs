#!/usr/bin/env node
'use strict';

/**
 * Install scripts/git-hooks/pre-commit into the repo's hooks directory.
 * Wired via package.json "prepare" so npm install keeps the hook current.
 * Resolves the hooks path via git so worktrees (.git is a pointer file,
 * not a directory) and CI checkouts both work; skips quietly when git or
 * a checkout is absent.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const source = path.join(__dirname, 'git-hooks', 'pre-commit');

if (!fs.existsSync(path.join(root, '.git'))) {
  console.log('[hooks] Skipped — not a git checkout (.git missing).');
  process.exit(0);
}

if (!fs.existsSync(source)) {
  console.error('[hooks] Missing hook source:', source);
  process.exit(1);
}

let hooksDir;
try {
  hooksDir = execSync('git rev-parse --git-path hooks', { cwd: root, encoding: 'utf8' }).trim();
  if (!path.isAbsolute(hooksDir)) hooksDir = path.join(root, hooksDir);
} catch {
  console.log('[hooks] Skipped — could not resolve git hooks path.');
  process.exit(0);
}

const dest = path.join(hooksDir, 'pre-commit');
fs.mkdirSync(hooksDir, { recursive: true });
fs.copyFileSync(source, dest);
fs.chmodSync(dest, 0o755);
console.log('[hooks] Installed pre-commit → runs pin:assets + convention checks before each commit.');
