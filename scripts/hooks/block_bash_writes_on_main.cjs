#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook (Bash). Blocks a Bash command that writes
 * tracked SOURCE while the main checkout is on `main` — the gap the
 * Edit/Write hook (block_edits_on_main.cjs) cannot see, because heredocs and
 * python/node writes go through Bash. Best-effort and conservative: the real
 * guarantee is the pre-commit refusal. Exit 2 = block. ALLOW_MAIN_EDITS=1
 * bypasses.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const { shouldBlockBashOnMain } = require(path.join(__dirname, '..', 'builder', 'mainGuard.js'));

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function main(input) {
  if (process.env.ALLOW_MAIN_EDITS === '1') process.exit(0);
  let payload;
  try { payload = JSON.parse(input); } catch { process.exit(0); }
  const command = String(payload?.tool_input?.command || '');
  if (!command) process.exit(0);

  // Decide from where the command ACTUALLY runs, not where the session
  // started. The Bash tool's cwd persists across calls, so a session that
  // began in the main folder and cd'd into a worktree runs later commands in
  // the worktree — payload.cwd carries that. Keying off CLAUDE_PROJECT_DIR
  // (session start = main) instead would block every legitimate in-worktree
  // write. Same precedence the other hooks use (explain_denied_commands,
  // require_sql_handoff).
  const cwd = String(payload?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const onMain = currentBranch(cwd) === 'main';
  const verdict = shouldBlockBashOnMain(command, { onMain });
  if (!verdict.block) process.exit(0);

  process.stderr.write(
    `BLOCKED: this command writes tracked source (${verdict.reason}) while the main\n` +
    `checkout is on "main", which auto-deploys to production. Work belongs in a worktree:\n` +
    `  npm run thread <topic>            # new worktree + branch off origin/main\n` +
    `  cd .claude/worktrees/<topic>      # then run your command there\n` +
    `(If you really are operating in a worktree, cd into it first so the path is unambiguous.\n` +
    ` Deliberate one-off on main: prefix with ALLOW_MAIN_EDITS=1 and say why.)\n`
  );
  process.exit(2);
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => main(stdin));
