'use strict';

/**
 * Shared answers to "what is the state of this repo's branches and worktrees".
 *
 * Used by BOTH `npm run map` (which reports) and `npm run tidy` (which acts).
 * They must never disagree: for months the map correctly said "already shipped,
 * safe to delete" while nothing ever deleted anything, and 41 local + 51 GitHub
 * branches piled up over six weeks. A second opinion in the cleanup script is
 * how a janitor deletes something the report called active, so there is only
 * one opinion and it lives here.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const MAIN = 'main';

/**
 * The branch-scoped git config key `npm run thread` stamps a ClickUp task id
 * onto (Charter Q1). It is defined HERE, in the shared repo-state module,
 * on purpose: PR #344 (Task-closes-thread) is the WRITER and the reconciler
 * (Charter Q2) is a READER, and a magic key read and written by two scripts
 * in two PRs must have exactly one definition or they silently drift apart —
 * the very failure repo_state.cjs itself exists to prevent (see the header).
 * When #344 lands, its own copy of this constant/reader resolves against
 * this one; keep a single definition.
 */
const CLICKUP_TASK_STAMP_KEY = (branchName) => `branch.${branchName}.clickup-task`;

/**
 * The ClickUp task id stamped on a branch, or '' for an unstamped branch
 * (made by hand, or predating the stamp). cwd is PINNED to the repo root:
 * under launchd/cron the process cwd is `/`, where `git config` finds no
 * repo and every read fails silently — a branch check that is permanently
 * inert while printing plausible output. branchInventory() already pins cwd
 * this way; this reader must too.
 */
function stampedTaskId(branchName) {
  return git(['config', '--get', CLICKUP_TASK_STAMP_KEY(branchName)], '');
}

function git(args, fallback = '', cwd = root) {
  try {
    // stderr ignored: several probes are expected to fail on refs that do not
    // exist, and their noise would clutter the report.
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * What a branch will actually merge into. The local copy of main is routinely
 * out of date, and comparing against it is how shipped work looks unshipped.
 */
function mergeBase() {
  return git(['rev-parse', '--verify', '--quiet', `origin/${MAIN}`], '')
    ? `origin/${MAIN}`
    : MAIN;
}

/** Every branch anywhere — on this Mac, on GitHub, or both. */
function branchInventory() {
  const local = lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], ''));
  // Full refnames, not short ones: the short name of refs/remotes/origin/HEAD
  // is plain "origin", which would otherwise show up as a branch.
  const remote = lines(git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/'], ''))
    .map((ref) => ref.replace(/^refs\/remotes\/origin\//, ''))
    .filter((name) => name && name !== 'HEAD');

  const names = Array.from(new Set([...local, ...remote])).filter((name) => name !== MAIN);
  return names.sort().map((name) => {
    const onMac = local.includes(name);
    const onGitHub = remote.includes(name);
    return {
      name,
      onMac,
      onGitHub,
      ref: onMac ? name : `origin/${name}`,
      where: onMac && onGitHub
        ? 'on your Mac and GitHub'
        : (onMac ? 'on your Mac only' : 'on GitHub only'),
      // Stamped by `npm run thread` (Charter Q1) — branch-scoped git config,
      // so it reads back the same regardless of which worktree (if any) this
      // branch is currently checked out in. '' for a branch predating the
      // stamp, or one made by hand outside `npm run thread`.
      clickupTaskId: onMac ? git(['config', '--get', `branch.${name}.clickup-task`], '') : '',
    };
  });
}

/**
 * Is this branch's work already on main?
 *
 * `git cherry` marks a commit "-" when the same change already exists upstream
 * under a different commit id. That is the ONLY correct test here, because
 * squash-merging rewrites the commit: `git branch -d` looks at a shipped branch
 * and refuses, which is precisely why nobody ever deleted anything.
 *
 * Returns { state: 'empty' | 'shipped' | 'active', fresh: string[] }.
 */
function classifyBranch(branch, base = mergeBase()) {
  const cherry = lines(git(['cherry', base, branch.ref], ''));
  if (!cherry.length) return { state: 'empty', fresh: [] };

  const fresh = cherry.filter((line) => line.startsWith('+'));
  if (!fresh.length) return { state: 'shipped', fresh: [] };

  return { state: 'active', fresh };
}

/** Every worktree, with the facts that decide whether it is safe to remove. */
function worktreeInventory() {
  const raw = git(['worktree', 'list', '--porcelain'], '');
  const entries = [];
  let entry = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (entry) entries.push(entry);
      entry = { path: line.slice('worktree '.length).trim(), branch: null, locked: false, detached: false };
    } else if (!entry) {
      continue;
    } else if (line.startsWith('branch ')) {
      entry.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line.trim() === 'detached') {
      entry.detached = true;
    } else if (line.startsWith('locked')) {
      entry.locked = true;
    }
  }
  if (entry) entries.push(entry);

  const here = path.resolve(process.cwd());
  return entries.map((item) => {
    const dirty = lines(git(['status', '--porcelain'], '', item.path)).length;
    return {
      ...item,
      isMain: item.branch === MAIN,
      // Compares the resolved path so running from a subdirectory still counts.
      isCurrent: here === path.resolve(item.path) || here.startsWith(path.resolve(item.path) + path.sep),
      dirty,
    };
  });
}

/** The path of the worktree holding `main`, if any — where a ff-merge must run. */
function mainWorktree(worktrees = worktreeInventory()) {
  return worktrees.find((w) => w.isMain) || null;
}

/**
 * Is a branch's stamped ClickUp task (Charter Q1) still open?
 *
 * `clickup_direct.mjs task-open` uses THREE exit codes on purpose — 0 open,
 * 1 confirmed closed, 3 could not tell (network/auth/rate-limit) — because a
 * caller here is deciding whether to DELETE a branch. Collapsing "could not
 * tell" into either open or closed would be wrong in one direction or the
 * other; only a clean, confirmed 1 may ever say 'closed'.
 *
 * Returns 'open' | 'closed' | 'unknown'. A branch with no stamp at all (made
 * by hand, or predating this feature) is 'unknown' too — never touched by
 * the closed-task cleanup path.
 */
function isTaskOpen(taskId) {
  if (!taskId) return 'unknown';
  try {
    execFileSync('npm', ['run', 'clickup', '--', 'task-open', '--task', taskId], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return 'open';
  } catch (err) {
    // Exit 1 alone is NOT enough to believe "closed". `npm run` and `doppler`
    // both exit 1 on their OWN failures (not logged in, secrets unreachable)
    // before the script even runs, and that must never authorize a delete.
    // Require the command's positive marker — it prints `open:   false` only
    // when it actually confirmed the task is closed/gone. Exit 1 without that
    // marker is an unknown, not a closed. (The command itself now exits 3, not
    // 1, on a network/auth failure — this is belt-and-braces behind it.)
    const printed = `${err.stdout || ''}`;
    if (err.status === 1 && /open:\s*false/.test(printed)) return 'closed';
    return 'unknown';
  }
}

module.exports = {
  MAIN,
  root,
  CLICKUP_TASK_STAMP_KEY,
  stampedTaskId,
  git,
  lines,
  mergeBase,
  branchInventory,
  classifyBranch,
  worktreeInventory,
  mainWorktree,
  isTaskOpen,
};
