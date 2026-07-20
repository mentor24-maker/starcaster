#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook (Edit|Write|NotebookEdit).
 * Blocks edits while the working tree is on the `main` branch, which
 * auto-deploys to production. Forces a topic branch first. Exit 2 = block.
 *
 * Escape hatch: set ALLOW_MAIN_EDITS=1 to bypass (say so and why, per
 * CLAUDE.md's SKIP_CONVENTIONS convention).
 */

const path = require('path');
const { execFileSync } = require('child_process');

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return ''; // not a git repo / detached — don't block
  }
}

function main(input) {
  if (process.env.ALLOW_MAIN_EDITS === '1') process.exit(0);

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // unparseable — don't block
  }

  const filePath = String(payload?.tool_input?.file_path || payload?.tool_input?.notebook_path || '');
  const root = String(process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..'));

  // Only guard edits inside this repo; ignore scratchpad/temp writes elsewhere.
  if (filePath) {
    const rel = path.relative(root, path.resolve(filePath));
    if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0);
  }

  if (currentBranch(root) !== 'main') process.exit(0);

  process.stderr.write(
    `BLOCKED: you are on the "main" branch, which auto-deploys to production on push.\n` +
    `Make a topic branch first so this work stays off the live site until it's ready:\n` +
    `  git checkout -b <short-topic-name>   # e.g. fix/social-post-copy\n` +
    `Your uncommitted changes come with you onto the new branch — nothing is lost.\n` +
    `(Override for a deliberate one-off: prefix the command with ALLOW_MAIN_EDITS=1.)\n`
  );
  process.exit(2);
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => main(stdin));
