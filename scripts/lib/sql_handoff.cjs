'use strict';

/**
 * Shared logic for the SQL handoff block (DOCTRINE.md §6.5).
 *
 * WHY THIS IS CODE AND NOT A REMINDER
 * §6.5 has been written down and binding since 2026-08-12, and on 2026-08-14
 * an agent still handed the operator a repo-relative path — the exact failure
 * the rule documents as "the trap this replaced". A rule an agent has to
 * remember to read is not a control; it is a hope. This module makes the block
 * correct by construction, and scripts/hooks/require_sql_handoff.cjs makes
 * forgetting it impossible.
 *
 * Used by:
 *   - scripts/hooks/require_sql_handoff.cjs   (Stop hook — refuses the turn)
 *   - scripts/sql_handoff.cjs                 (`npm run sql:handoff` — prints it)
 *
 * One module so the two can never disagree about what counts as new SQL or
 * what the block looks like, the same reason `map` and `tidy` share theirs.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const REMOTE = 'https://github.com/mentor24-maker/starcaster/blob';
const BANNER_OPEN = '#################### RUN SQL IN SUPABASE ####################';
const BANNER_CLOSE = '##########################################################';
const SQL_DIR = 'docs/SQL/';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

function repoRoot(cwd) {
  return tryGit(['rev-parse', '--show-toplevel'], cwd);
}

function currentBranch(cwd) {
  return tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

/**
 * SQL files this branch introduces or changes relative to origin/main --
 * committed, staged, or still untracked. Untracked counts because the block is
 * often written in the same turn as the file, before any commit exists.
 */
function newSqlFiles(cwd) {
  const root = repoRoot(cwd);
  if (!root) return [];

  const found = new Set();
  const collect = (out) => {
    for (const line of String(out || '').split('\n')) {
      const file = line.trim();
      if (file.startsWith(SQL_DIR) && file.endsWith('.sql')) found.add(file);
    }
  };

  // Committed on this branch but not on origin/main. Falls back to a plain
  // diff when the merge base is unknown (a fresh clone with no origin/main).
  const base = tryGit(['merge-base', 'origin/main', 'HEAD'], root);
  if (base) collect(tryGit(['diff', '--name-only', `${base}..HEAD`], root));

  // Uncommitted: staged, unstaged, and untracked.
  collect(tryGit(['diff', '--name-only', 'HEAD'], root));
  collect(tryGit(['diff', '--name-only', '--cached'], root));
  collect(tryGit(['ls-files', '--others', '--exclude-standard'], root));

  return [...found].sort();
}

/**
 * Is this branch's HEAD actually on the remote? The block's whole job is to
 * get the operator to a file on GitHub; emitting the URL before pushing hands
 * him a 404, which is the same round trip §6.5 exists to stop.
 */
function isPushed(cwd) {
  const root = repoRoot(cwd);
  const branch = currentBranch(root || cwd);
  if (!root || !branch || branch === 'HEAD') return false;

  const remoteSha = tryGit(['rev-parse', `origin/${branch}`], root);
  if (!remoteSha) return false;
  const localSha = tryGit(['rev-parse', 'HEAD'], root);
  if (!localSha) return false;
  if (remoteSha === localSha) return true;

  // Local ahead is fine only if the SQL files themselves are already pushed;
  // treat any divergence as not-pushed rather than guessing.
  return false;
}

function blockUrl(branch, file) {
  return `${REMOTE}/${branch}/${file}`;
}

/** The block exactly as §6.5 specifies: plain text, never fenced. */
function renderBlock(branch, file) {
  return `${BANNER_OPEN}\n\n${blockUrl(branch, file)}\n\n${BANNER_CLOSE}`;
}

/**
 * Has this message already handed off `file`? Requires both the banner and
 * that file's branch-qualified URL — a banner alone, or a URL pointing at
 * main, is the failure mode we are catching.
 */
function messageHandsOff(message, branch, file) {
  const text = String(message || '');
  if (!text.includes(BANNER_OPEN)) return false;
  return text.includes(blockUrl(branch, file));
}

module.exports = {
  BANNER_OPEN,
  BANNER_CLOSE,
  SQL_DIR,
  repoRoot,
  currentBranch,
  newSqlFiles,
  isPushed,
  blockUrl,
  renderBlock,
  messageHandsOff,
};
