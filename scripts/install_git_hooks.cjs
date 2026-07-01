#!/usr/bin/env node
'use strict';

/**
 * Install scripts/git-hooks/pre-commit into .git/hooks/pre-commit (local only).
 * Wired via package.json "prepare" so npm install keeps the hook current.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const gitDir = path.join(root, '.git');
const source = path.join(__dirname, 'git-hooks', 'pre-commit');
const dest = path.join(gitDir, 'hooks', 'pre-commit');

if (!fs.existsSync(gitDir)) {
  console.log('[hooks] Skipped — not a git checkout (.git missing).');
  process.exit(0);
}

if (!fs.existsSync(source)) {
  console.error('[hooks] Missing hook source:', source);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(source, dest);
fs.chmodSync(dest, 0o755);
console.log('[hooks] Installed pre-commit → auto-runs pin:assets before each commit.');
