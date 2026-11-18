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

const fs = require('fs');
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

/**
 * The block exactly as §6.5 specifies: plain text, never fenced. `ref` is
 * `main` for a merged file, or the pushed commit (or, before the push, the
 * branch) for a file only on a branch.
 */
function renderBlock(ref, file) {
  return `${BANNER_OPEN}\n\n${blockUrl(ref, file)}\n\n${BANNER_CLOSE}`;
}

/**
 * The message with every fenced code block removed. A block inside a fence
 * renders its link as dead text (operator, 2026-08-12: "can you make that link
 * clickable?"), so a fenced block is not a hand-off, and a path quoted inside a
 * fence is quoting, not asking him to run anything.
 */
function splitFences(message) {
  const prose = [];
  const fenced = [];
  let fence = null;
  let body = [];
  for (const line of String(message || '').split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) {
        fenced.push(body.join('\n'));
        fence = null;
        body = [];
      } else {
        body.push(line);
      }
      continue;
    }
    if (m) { fence = m[1]; continue; }
    prose.push(line);
  }
  if (fence) fenced.push(body.join('\n')); // an unclosed fence still renders as code
  return { prose: prose.join('\n'), fenced };
}

function proseOf(message) {
  return splitFences(message).prose;
}

const isCommit = (ref) => /^[0-9a-f]{7,40}$/i.test(String(ref || ''));

/**
 * Has this message handed off `file` with a link whose ref `acceptRef` allows?
 * Both the banner and the file's own GitHub URL must be in the prose -- a
 * banner alone, a URL alone, or either inside a code fence is the failure.
 */
function handsOffWith(message, file, acceptRef) {
  const prose = proseOf(message);
  if (!prose.includes(BANNER_OPEN)) return false;
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${REMOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^\\s/]+)/${escaped}(?![\\w.-])`, 'g');
  for (const m of prose.matchAll(re)) {
    if (acceptRef(m[1])) return true;
  }
  return false;
}

/**
 * Has this message already handed off a file THIS BRANCH adds? Its link names
 * the branch or a commit. A link by `main` is refused: the file is not on main
 * yet (or main has an older copy), which is the broken-link trap §6.5 records.
 */
function messageHandsOff(message, branch, file) {
  return handsOffWith(message, file, (ref) => ref === branch || isCommit(ref));
}

/**
 * Has this message handed off a file that is ALREADY ON MAIN -- merged, and
 * waiting to be run in production? Its link names `main` or a commit; a branch
 * link is refused, because merged branches are deleted and the link dies.
 */
function messageHandsOffMerged(message, file) {
  return handsOffWith(message, file, (ref) => ref === 'main' || isCommit(ref));
}

/**
 * Every docs/SQL file this message names outside a code fence (or inside a
 * fence that holds the SQL handoff block's banner), as its
 * repository path, in the order named. A bare file name, a repo-relative path,
 * a markdown link and a GitHub URL all count, as long as `docs/SQL/<name>`
 * exists in this checkout -- so talk about some other `.sql` file is not
 * mistaken for a hand-off.
 *
 * WHY: on 2026-11-17 a card said "Run docs/SQL/video_reel_spinner_setup.sql in
 * Supabase" for a file merged a day earlier (SC-832). The Stop hook above only
 * ever asked about SQL the branch ADDS, and stood aside on main, so a reply
 * pointing at merged-but-unapplied SQL -- the usual case -- was never checked.
 */
function mentionedSqlFiles(message, root) {
  const found = [];
  // A fence that carries the banner is a hand-off put where its link cannot
  // be clicked, not a quotation -- so its files count, and then fail.
  const { prose, fenced } = splitFences(message);
  const scanned = [prose, ...fenced.filter((body) => body.includes(BANNER_OPEN))].join('\n');
  for (const m of scanned.matchAll(/[\w.-]+\.sql(?![\w])/gi)) {
    const file = `${SQL_DIR}${m[0]}`;
    if (found.includes(file)) continue;
    if (root && fs.existsSync(path.join(root, file))) found.push(file);
  }
  return found;
}

/** Is `file` on origin/main, so a `main` link opens it? */
function onMain(root, file) {
  return Boolean(tryGit(['cat-file', '-t', `origin/main:${file}`], root));
}

/** The pushed commit to link a branch's file by, or '' when it is not pushed. */
function pushedCommit(root) {
  return isPushed(root) ? tryGit(['rev-parse', '--short=12', 'HEAD'], root) : '';
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
  messageHandsOffMerged,
  mentionedSqlFiles,
  proseOf,
  onMain,
  pushedCommit,
  isCommit,
};
