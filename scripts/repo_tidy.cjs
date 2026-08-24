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
 *   3. Remove worktrees whose branch is shipped and whose folder is clean —
 *      OR whose stamped ClickUp task has closed (Charter Q1, 2026-08-18):
 *      `npm run thread` stamps the task it was started for onto the branch,
 *      and a thread whose task closed without shipping (redirected,
 *      abandoned, decided against) is cleaned up here too, not left orphaned
 *      forever just because its commits never reached main.
 *   4. Delete local branches whose every commit is already on main by content
 *      — or, same as above, whose stamped task has closed.
 *
 * What it NEVER touches:
 *   - anything with uncommitted edits, or a branch with unshipped commits
 *     UNLESS that branch's stamped ClickUp task has confirmed-closed
 *   - the worktree you are standing in, or a locked worktree
 *   - main, or any branch checked out in a worktree
 *   - a folder whose branch has no commits yet and carries no closed-task
 *     stamp — that is a workspace someone just set up, not a leftover
 *   - anything on GitHub (that is now handled by delete_branch_on_merge)
 *   - a branch whose ClickUp status could not be determined (network, auth,
 *     rate limit) — "unknown" is never treated as "closed"; only a clean,
 *     confirmed read authorizes a delete (scripts/lib/repo_state.cjs,
 *     `isTaskOpen`)
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
  isTaskOpen,
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
// Charter Q1 (Task-closes-thread): a branch whose stamped ClickUp task has
// closed is eligible for cleanup EVEN IF `classifyBranch` calls it 'active'
// (unshipped commits) — that is precisely the abandoned-thread case this
// exists for. One `isTaskOpen` call per stamped branch, reused by both loops
// below rather than asked twice. A branch with no stamp is 'unknown' and
// never affected — this is additive to the existing shipped-branch cleanup,
// never a replacement for it.
const taskStates = new Map(
  branches.map((b) => [b.name, b.clickupTaskId ? isTaskOpen(b.clickupTaskId) : 'unknown'])
);

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

    // Only folders whose work has SHIPPED — or whose ClickUp task has closed,
    // meaning the thread was abandoned or redirected rather than shipped.
    // A branch with no commits yet is a freshly prepared workspace (`npm run
    // thread` just built it, dependencies and all) — deleting that because it
    // is "empty" would be a nasty surprise for someone who stepped away
    // before their first commit; a closed task overrides that too, since an
    // empty workspace for a task that is already closed has nothing left to
    // start.
    const state = classified.get(tree.branch);
    const closedTask = taskStates.get(tree.branch) === 'closed';
    if (!closedTask && (!state || state.state !== 'shipped')) {
      // Say WHY. A skip that does not report is how a sweep gives a false
      // all-clear (DOCTRINE 3.11): on 2026-08-22 the ecosystem-svg worktree
      // survived four tidy runs and was never once named in the output, so
      // "Left alone: (nothing about it)" read as "nothing left to do".
      skipped.push(`${path.basename(tree.path)} — ${state ? state.reason : 'branch state unknown'}`);
      continue;
    }

    if (!dryRun) {
      try {
        execFileSync('git', ['worktree', 'remove', tree.path], { cwd: root, stdio: 'ignore' });
      } catch {
        skipped.push(`${path.basename(tree.path)} — git refused to remove it`);
        continue;
      }
    }
    const shippedNotClosed = state && state.state === 'shipped';
    const label = shippedNotClosed
      ? `removed finished worktree ${path.basename(tree.path)}`
      : `removed worktree ${path.basename(tree.path)} — its ClickUp task ` +
        `${branches.find((b) => b.name === tree.branch)?.clickupTaskId} closed`;
    done.push(label);
  }
  if (!dryRun) git(['worktree', 'prune']);
}

// --- 4. Delete shipped local branches ---------------------------------------

// Re-read: removing a worktree frees the branch it held.
const stillCheckedOut = new Set(
  worktreeInventory().map((tree) => tree.branch).filter(Boolean)
);

let deleted = 0;
let deletedForClosedTask = 0;
for (const branch of branches) {
  if (!branch.onMac) continue;
  if (branch.name === MAIN) continue;
  if (stillCheckedOut.has(branch.name)) continue;

  const state = classified.get(branch.name);
  const closedTask = taskStates.get(branch.name) === 'closed';
  // Shipped/empty branches always qualified; a closed task now ALSO
  // qualifies an 'active' (unshipped) branch — the abandoned-thread case.
  // 'unknown' never qualifies: it means no signal could answer, which is the
  // one case where deleting would be a guess.
  if (!closedTask && (!state || state.state === 'active' || state.state === 'unknown')) {
    skipped.push(`branch ${branch.name} — ${state ? state.reason : 'branch state unknown'}`);
    continue;
  }

  const abandonedForClosedTask = state?.state === 'active' && closedTask;
  const sha = git(['rev-parse', branch.name], '');
  if (!dryRun) {
    const restoreLine = abandonedForClosedTask
      ? `git branch ${branch.name} ${sha}  # ClickUp task ${branch.clickupTaskId} closed, never shipped`
      : `git branch ${branch.name} ${sha}`;
    recordRestore(restoreLine);
    try {
      // -D, not -d: squash-merging rewrites the commit, so -d refuses on work
      // that is demonstrably already live. classifyBranch is the real check.
      execFileSync('git', ['branch', '-D', branch.name], { cwd: root, stdio: 'ignore' });
    } catch {
      skipped.push(`branch ${branch.name} — git refused to delete it`);
      continue;
    }
  }
  if (abandonedForClosedTask) deletedForClosedTask += 1;
  else deleted += 1;
}
if (deleted) done.push(`deleted ${deleted} shipped branch${deleted === 1 ? '' : 'es'}`);
if (deletedForClosedTask) {
  done.push(
    `deleted ${deletedForClosedTask} branch${deletedForClosedTask === 1 ? '' : 'es'} whose ClickUp task closed ` +
    `before shipping`
  );
}

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
