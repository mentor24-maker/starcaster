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

module.exports = {
  MAIN,
  root,
  git,
  lines,
  mergeBase,
  branchInventory,
  classifyBranch,
  worktreeInventory,
  mainWorktree,
};
