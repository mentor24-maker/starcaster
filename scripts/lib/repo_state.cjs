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
 * Does this branch hold any CONTENT that main does not already have?
 *
 * The question `git cherry` cannot answer. Take every path the branch touched
 * since the merge base, then compare those paths between main and the branch
 * tip. Empty diff means main already carries everything the branch did, by
 * whatever route and under whatever commit ids.
 *
 * Comparing only the touched paths is what makes this usable: main has moved on
 * with other people's work, so a whole-tree comparison is never empty and would
 * call every branch active.
 *
 * Conservative in one direction on purpose. If main later changed one of those
 * paths differently, the diff is non-empty and the branch reads as active — so
 * the error is "left a stale branch alone", never "deleted live work".
 *
 * Returns true (shipped), false (has unique content), or null (could not tell).
 */
function branchContentIsInMain(branch, base = mergeBase(), cwd = root) {
  // `null` as the failure value, never a string. `git()` returns its fallback
  // verbatim when the command fails, and any string fallback is
  // indistinguishable from a real answer once `lines()` has trimmed it -- a
  // whitespace sentinel read as "the branch touched no files", which this
  // function reports as SHIPPED. That is a failed probe authorizing a delete,
  // which is the one outcome nothing here may ever produce.
  const mergeBaseSha = git(['merge-base', base, branch.ref], null, cwd);
  if (!mergeBaseSha) return null;

  const touchedRaw = git(['diff', '--name-only', mergeBaseSha, branch.ref], null, cwd);
  if (touchedRaw === null) return null;

  const touched = lines(touchedRaw);
  if (!touched.length) return true; // the branch changed no files at all

  const diff = git(['diff', base, branch.ref, '--', ...touched], null, cwd);
  if (diff === null) return null;
  return diff === '';
}

/**
 * Has GitHub already merged a pull request for this branch?
 *
 * Definitive when it answers, because it is independent of merge strategy — a
 * squash, a rebase and a merge commit all leave the same merged PR behind.
 * Returns true, false, or null when GitHub could not be reached (not
 * authenticated, offline, rate-limited), which must never be read as false.
 */
function branchHasMergedPr(branchName, runGh = defaultGh) {
  const out = runGh(['pr', 'list', '--head', branchName, '--state', 'merged', '--json', 'number']);
  if (out === null) return null;
  try {
    const parsed = JSON.parse(out || '[]');
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return null;
  }
}

function defaultGh(args) {
  try {
    return execFileSync('gh', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Is this branch's work already on main?
 *
 * THREE signals, and a single NEGATIVE one is never enough to call a branch
 * unshipped — that asymmetry is the whole fix.
 *
 * 2026-08-22: the `ecosystem-svg` worktree survived four `tidy` runs even
 * though its PR had merged hours before. `git cherry` compares patch-ids one
 * to one, and a squash-merge of a branch with N >= 2 commits produces ONE
 * commit on main matching none of the N — so cherry reported "+" (unshipped)
 * for every commit, forever. A one-commit branch squashes to a matching
 * patch-id, which is exactly why nobody noticed: the common case works.
 *
 * Order is cheapest-first, and the network is only consulted when the local
 * signals are about to leave a branch alone — which is precisely when a wrong
 * answer costs something:
 *
 *   1. `git cherry`  — no fresh commits, cheap, correct for the common case.
 *   2. content       — does the branch hold anything main lacks?
 *   3. GitHub        — is there a merged PR? Definitive, and strategy-blind.
 *
 * Returns { state, fresh, reason, signals }, where state is:
 *   'empty'   — no commits yet (a prepared workspace, not shipped work)
 *   'shipped' — at least one signal says main already has this
 *   'active'  — every signal that COULD run says the work is still unique
 *   'unknown' — neither the content probe nor GitHub could answer. Callers
 *               must leave the branch alone AND say so: a skip that does not
 *               report is how a sweep gives a false all-clear (DOCTRINE 3.11).
 */
function classifyBranch(branch, base = mergeBase(), { runGh = defaultGh, cwd = root } = {}) {
  const cherry = lines(git(['cherry', base, branch.ref], '', cwd));
  if (!cherry.length) return { state: 'empty', fresh: [], reason: 'no commits yet', signals: {} };

  const fresh = cherry.filter((line) => line.startsWith('+'));
  if (!fresh.length) {
    return { state: 'shipped', fresh: [], reason: 'every commit is already on main', signals: { cherry: true } };
  }

  const content = branchContentIsInMain(branch, base, cwd);
  if (content === true) {
    return {
      state: 'shipped',
      fresh: [],
      reason: 'main already carries everything this branch changed (squash-merged)',
      signals: { cherry: false, content: true },
    };
  }

  // Only now is it worth a network call — and it is asked even when the branch
  // is GONE from GitHub, which is the normal state of a merged branch: GitHub
  // deletes the head branch on merge but keeps the pull request. Skipping the
  // lookup for a branch that is no longer on GitHub would disable the primary
  // signal in precisely the case this whole check exists for.
  const merged = branchHasMergedPr(branch.name, runGh);
  if (merged === true) {
    return {
      state: 'shipped',
      fresh: [],
      reason: 'GitHub has a merged pull request for this branch',
      signals: { cherry: false, content, github: true },
    };
  }

  if (content === null && merged === null) {
    return {
      state: 'unknown',
      fresh,
      reason: 'could not confirm — neither the content check nor GitHub could answer',
      signals: { cherry: false, content: null, github: null },
    };
  }

  return {
    state: 'active',
    fresh,
    reason: 'has commits main does not have',
    signals: { cherry: false, content, github: merged },
  };
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
  branchContentIsInMain,
  branchHasMergedPr,
  worktreeInventory,
  mainWorktree,
  isTaskOpen,
};
