#!/usr/bin/env node
'use strict';

/**
 * `npm run tidy` — the button that `npm run map` never had.
 *
 * The map has always reported "already shipped, safe to delete" correctly and
 * then done nothing about it, so six weeks of merged work accumulated into 41
 * local branches, 51 GitHub branches and 10 worktrees before anyone noticed.
 * This acts on exactly what the map reports, using the same shared logic
 * (scripts/lib/repo_state.cjs) so the two can never disagree.
 *
 * What it does, in order:
 *   1. Fetch and prune, so every judgement is made against current GitHub state
 *   2. Fast-forward the local main (a stale main is why new work branches off
 *      old code and then needs rebasing)
 *   3. Remove worktrees whose branch is shipped and whose folder is clean
 *   4. Delete local branches whose every commit is already on main by content
 *
 * What it NEVER touches:
 *   - anything with uncommitted edits, or a branch with unshipped commits
 *   - the worktree you are standing in, or a locked worktree
 *   - main, or any branch checked out in a worktree
 *   - a folder whose branch has no commits yet — that is a workspace someone
 *     just set up, not a leftover
 *   - anything on GitHub (that is now handled by delete_branch_on_merge)
 *
 * Every deletion is appended to .git/tidy-restore.log with the command that
 * puts it back, so nothing is ever actually lost.
 *
 *   node scripts/repo_tidy.cjs [--dry-run] [--branches-only] [--quiet]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  MAIN,
  root,
  git,
  mergeBase,
  branchInventory,
  classifyBranch,
  worktreeInventory,
  mainWorktree,
} = require('./lib/repo_state.cjs');

const dryRun = process.argv.includes('--dry-run');
const branchesOnly = process.argv.includes('--branches-only');
const quiet = process.argv.includes('--quiet');

const done = [];
const skipped = [];

function say(line) {
  if (!quiet) console.log(line);
}

function recordRestore(text) {
  if (dryRun) return;
  try {
    const gitDir = git(['rev-parse', '--git-common-dir'], '.git');
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    fs.appendFileSync(path.join(abs, 'tidy-restore.log'), `${text}\n`);
  } catch {
    // A missing restore log must never stop the cleanup; the reflog still has it.
  }
}

// --- 1. Current facts -------------------------------------------------------

if (!dryRun) git(['fetch', 'origin', '--prune']);
const base = mergeBase();

// --- 2. Fast-forward main ---------------------------------------------------

const worktrees = worktreeInventory();
const mainTree = mainWorktree(worktrees);

if (mainTree && base === `origin/${MAIN}`) {
  const behind = git(['rev-list', '--count', `${MAIN}..origin/${MAIN}`], '0');
  if (Number(behind) > 0) {
    if (mainTree.dirty > 0) {
      // Only tracked edits block a fast-forward; untracked notes are fine.
      const trackedDirty = git(['status', '--porcelain', '--untracked-files=no'], '', mainTree.path);
      if (trackedDirty) {
        skipped.push(`main is ${behind} behind but has uncommitted edits — left alone`);
      } else {
        if (!dryRun) execFileSync('git', ['merge', '--ff-only', `origin/${MAIN}`], { cwd: mainTree.path, stdio: 'ignore' });
        done.push(`caught main up by ${behind} commit(s)`);
      }
    } else {
      if (!dryRun) execFileSync('git', ['merge', '--ff-only', `origin/${MAIN}`], { cwd: mainTree.path, stdio: 'ignore' });
      done.push(`caught main up by ${behind} commit(s)`);
    }
  }
}

// --- 3. Remove finished worktrees -------------------------------------------

const branches = branchInventory();
const classified = new Map(branches.map((b) => [b.name, classifyBranch(b, base)]));

if (!branchesOnly) {
  for (const tree of worktrees) {
    if (tree.isMain) continue;
    if (tree.isCurrent) {
      skipped.push(`${path.basename(tree.path)} — you are standing in it (remove it from another folder)`);
      continue;
    }
    if (tree.locked) {
      skipped.push(`${path.basename(tree.path)} — locked`);
      continue;
    }
    if (tree.dirty > 0) {
      skipped.push(`${path.basename(tree.path)} — ${tree.dirty} uncommitted file(s)`);
      continue;
    }
    if (tree.detached || !tree.branch) {
      skipped.push(`${path.basename(tree.path)} — not on a branch`);
      continue;
    }

    // Only folders whose work has SHIPPED. A branch with no commits yet is a
    // freshly prepared workspace (`npm run thread` just built it, dependencies
    // and all) — deleting that because it is "empty" would be a nasty surprise
    // for someone who stepped away before their first commit.
    const state = classified.get(tree.branch);
    if (!state || state.state !== 'shipped') continue;

    if (!dryRun) {
      try {
        execFileSync('git', ['worktree', 'remove', tree.path], { cwd: root, stdio: 'ignore' });
      } catch {
        skipped.push(`${path.basename(tree.path)} — git refused to remove it`);
        continue;
      }
    }
    done.push(`removed finished worktree ${path.basename(tree.path)}`);
  }
  if (!dryRun) git(['worktree', 'prune']);
}

// --- 4. Delete shipped local branches ---------------------------------------

// Re-read: removing a worktree frees the branch it held.
const stillCheckedOut = new Set(
  worktreeInventory().map((tree) => tree.branch).filter(Boolean)
);

let deleted = 0;
for (const branch of branches) {
  if (!branch.onMac) continue;
  if (branch.name === MAIN) continue;
  if (stillCheckedOut.has(branch.name)) continue;

  const state = classified.get(branch.name);
  if (!state || state.state === 'active') continue;

  const sha = git(['rev-parse', branch.name], '');
  if (!dryRun) {
    recordRestore(`git branch ${branch.name} ${sha}`);
    try {
      // -D, not -d: squash-merging rewrites the commit, so -d refuses on work
      // that is demonstrably already live. classifyBranch is the real check.
      execFileSync('git', ['branch', '-D', branch.name], { cwd: root, stdio: 'ignore' });
    } catch {
      skipped.push(`branch ${branch.name} — git refused to delete it`);
      continue;
    }
  }
  deleted += 1;
}
if (deleted) done.push(`deleted ${deleted} shipped branch${deleted === 1 ? '' : 'es'}`);

// --- Report -----------------------------------------------------------------

const prefix = dryRun ? '[tidy --dry-run] would have' : '[tidy]';

if (!done.length && !skipped.length) {
  say('[tidy] Nothing to clean up — every branch and folder is either live work or already gone.');
} else {
  if (done.length) {
    say(`${prefix}:`);
    done.forEach((line) => say(`  ✓ ${line}`));
  }
  if (skipped.length && !quiet) {
    say('[tidy] Left alone:');
    skipped.forEach((line) => say(`  · ${line}`));
  }
  if (deleted && !dryRun) {
    say('[tidy] Restore commands for anything deleted: .git/tidy-restore.log');
  }
}
