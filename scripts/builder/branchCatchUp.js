'use strict';

/**
 * Ask THIS machine whether a branch really conflicts with main.
 *
 * WHY THIS EXISTS (2026-08-23). The bus-relay handed twelve pull requests to a
 * human in one day for "conflicts with newer work on main". Every one of them
 * merged locally with nothing to resolve. Each hand-off stalls a merge the
 * operator had already authorized.
 *
 * The cause is in this repo's own .gitattributes. Four committed HTML files
 * carry `?v=` cache-busting pins rebuilt from whatever the build produced, so
 * any two branches touching anything bundled collide there even when neither
 * edited a word of markup. `scripts/merge_asset_pins.cjs` resolves them by
 * asset path — but git refuses to run a merge driver defined by a cloned repo,
 * so it lives in .git/config and `scripts/install_git_hooks.cjs` registers it
 * on every install. GITHUB THEREFORE CANNOT RUN IT. GitHub does a plain merge,
 * sees two different hashes on one line, and reports a conflict.
 *
 * (The WORK-LOG.md `union` driver in the same file is git's own built-in, so
 * GitHub does honour that one. Only asset-pins is invisible to it.)
 *
 * The relay was right to refuse — resolving a conflict blind is exactly what a
 * script must never do (task 86bbjd5nn, binding). It was asking the wrong
 * machine. It runs on a node that HAS the driver, so it can find out for real
 * instead of taking GitHub's word.
 *
 * WHAT THIS IS NOT. It does not resolve conflicts. It attempts an ordinary
 * merge and reports what happened. If anything conflicts, it aborts, cleans up
 * and says so — the hand-off proceeds exactly as before. The only case it
 * changes is the one where the merge is CLEAN here and GitHub said it was not,
 * and nothing but the missing driver can explain that difference.
 *
 * THE FAILURE RULE. Every outcome that is not a proven-clean merge is a
 * hand-off. Wrong repo, missing driver, failed fetch, failed push, a merge that
 * somehow does not contain main — all of them hand over. A check that could not
 * run reports "cannot tell", never a pass (DOCTRINE 3.11).
 *
 * AND IT NEVER FORCE-PUSHES. The push is a fast-forward of the branch onto a
 * merge commit that already contains it, so an ordinary push always works. If
 * the remote branch moved underneath us the push is REJECTED rather than
 * forced, which is the correct outcome — a force-push inside a script is
 * invisible to the operator's own deny rule (DOCTRINE 6.6), and this file is
 * not allowed to route around a standing decision either.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

/** The driver .gitattributes names for the pin files. Absent = we are blind. */
const PIN_DRIVER_KEY = 'merge.asset-pins.driver';

/**
 * Outcomes. Only `clean` authorizes a push; everything else hands over, and
 * `reason` is written for the operator, not for a log grep.
 */
const CODES = Object.freeze({
  CLEAN: 'clean',
  NEEDS_REBUILD: 'needs-rebuild',
  REAL_CONFLICT: 'real-conflict',
  WRONG_REPO: 'wrong-repo',
  NO_DRIVER: 'no-driver',
  FETCH_FAILED: 'fetch-failed',
  WORKTREE_FAILED: 'worktree-failed',
  NOT_ANCESTOR: 'not-ancestor',
  PUSH_FAILED: 'push-failed',
});

/**
 * Paths whose contents end up INSIDE a `?v=`-pinned asset.
 *
 * WHY THIS LIST EXISTS (2026-08-24). The first version of this module pushed
 * whatever merged cleanly. That is the wrong question. The asset-pins merge
 * driver resolves a pin collision by restoring each pin BY ASSET PATH, which is
 * exactly right when only the markup moved — and exactly wrong when `main`
 * changed the asset underneath. The restored pin then names the pre-merge
 * build, no rebuild ever runs, and the pushed tree's pins do not match a clean
 * build of it. CI's "Asset pins match a clean build" step fails.
 *
 * It did that to three green branches in one pass (#401, #403, #411), all
 * triggered by one commit that edited `public/js/projectContext.js`. It looks
 * like the branch's own fault, and it costs a full CI cycle to discover.
 *
 * THE BUG WAS THE AUTHORIZATION, not the merge: the push was authorized by
 * "the merge was clean", and clean-merge is a different question from
 * builds-clean.
 *
 * Derived from what the committed HTML actually pins:
 *   /js/*.js, /shared/*.js, /app.js  — served straight out of public/
 *   /styles.css                      — built from src/css/**
 *   /builder-bundle.js               — builder-react-entry.tsx, components/**,
 *                                      lib/builder-client/**
 *   /bundle.js                       — react-entry.js + campaigns components
 *
 * A list like this rots the moment someone adds a pinned asset with a new
 * source, so branchCatchUp.test.js reads every pinned URL out of the committed
 * HTML and fails if any of them maps to a path this list does not cover.
 */
const PIN_SOURCE_PATHS = Object.freeze([
  'public/js/',
  'public/shared/',
  'public/app.js',
  'src/css/',
  'components/',
  'lib/builder-client/',
  'builder-react-entry.tsx',
  'react-entry.js',
]);

/**
 * Which of these changed files feed a pinned asset?
 *
 * Pure, so the decision is testable without a repository.
 */
function pinnedAssetSourcesIn(changedPaths) {
  return (Array.isArray(changedPaths) ? changedPaths : [])
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .filter((p) => PIN_SOURCE_PATHS.some((prefix) => (
      prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix
    )));
}

function defaultRunGit(args, { cwd } = {}) {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: out.status === 0,
    stdout: String(out.stdout || '').trim(),
    stderr: String(out.stderr || '').trim(),
  };
}

/**
 * "owner/name" out of any remote URL git accepts — https, ssh, scp-style, with
 * or without a trailing .git.
 */
function parseRepoFromRemoteUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const stripped = raw.replace(/\.git$/i, '');
  const m = stripped.match(/[:/]([^/:]+)\/([^/]+)$/);
  return m ? `${m[1]}/${m[2]}` : '';
}

/**
 * Is the pin driver actually registered on this machine?
 *
 * This matters more than it looks. Without it git falls back to the default
 * merge SILENTLY — the same answer GitHub gives — so a "conflict" here would
 * prove nothing at all. Asking the config is the only honest test; the file
 * existing on disk is not one.
 */
function assetPinDriverInstalled(runGit = defaultRunGit, cwd = process.cwd()) {
  const res = runGit(['config', '--get', PIN_DRIVER_KEY], { cwd });
  return Boolean(res.ok && res.stdout);
}

/** Which files git left with conflict markers. */
function conflictedFiles(runGit, cwd) {
  const res = runGit(['diff', '--name-only', '--diff-filter=U'], { cwd });
  return res.ok && res.stdout ? res.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Merge `base` into `branch` in a throwaway worktree and, if it is clean, push
 * the result.
 *
 * Isolated on purpose: a detached worktree in a temp directory touches no
 * existing checkout, switches nobody's branch, and cannot pick up another
 * thread's uncommitted edits. (.git/config is shared across worktrees, which
 * is exactly why the driver is available inside it.)
 *
 * @returns {{ code: string, ok: boolean, reason: string, files?: string[] }}
 *   `ok` is true only for CLEAN.
 */
function catchUpBranchLocally({
  repo,
  branch,
  base = 'main',
  cwd = process.cwd(),
  runGit = defaultRunGit,
  makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-catchup-')),
  removeDir = (dir) => fs.rmSync(dir, { recursive: true, force: true }),
} = {}) {
  const branchName = String(branch || '').trim();
  if (!branchName) {
    return { code: CODES.WRONG_REPO, ok: false, reason: 'no branch name was given' };
  }

  // 1. Are we even in the right repository? The queue carries work for more
  //    than one (starcaster, normie, pulse, vault). Catching a branch up in
  //    the wrong checkout is not a mistake worth risking to save a hand-off.
  const remote = runGit(['remote', 'get-url', 'origin'], { cwd });
  const here = parseRepoFromRemoteUrl(remote.ok ? remote.stdout : '');
  if (!here || (repo && here.toLowerCase() !== String(repo).toLowerCase())) {
    return {
      code: CODES.WRONG_REPO,
      ok: false,
      reason: `this checkout is ${here || 'an unknown repo'}, but the PR is on ${repo || '(unknown)'} — not catching it up from here`,
    };
  }

  // 2. Without the driver we would just be reproducing GitHub's answer.
  if (!assetPinDriverInstalled(runGit, cwd)) {
    return {
      code: CODES.NO_DRIVER,
      ok: false,
      reason: `the ${PIN_DRIVER_KEY} merge driver is not registered on this machine, so a local merge proves nothing GitHub has not already said — run "npm install" here`,
    };
  }

  // 3. Fresh refs, or we would be merging a stale main into a stale branch and
  //    calling the result current.
  const fetched = runGit(['fetch', 'origin', branchName, base], { cwd });
  if (!fetched.ok) {
    return { code: CODES.FETCH_FAILED, ok: false, reason: `could not fetch ${branchName} and ${base} (${fetched.stderr.slice(0, 200)})` };
  }

  const parent = makeTempDir();
  const tree = path.join(parent, 'wt');
  let added = false;
  try {
    const add = runGit(['worktree', 'add', '--detach', tree, `origin/${branchName}`], { cwd });
    if (!add.ok) {
      return { code: CODES.WORKTREE_FAILED, ok: false, reason: `could not open a scratch worktree (${add.stderr.slice(0, 200)})` };
    }
    added = true;

    // 4. An ordinary merge. Never a rebase: the branch may only ever gain
    //    commits, so the push below stays a fast-forward.
    const merged = runGit(['merge', `origin/${base}`, '--no-edit'], { cwd: tree });
    if (!merged.ok) {
      const files = conflictedFiles(runGit, tree);
      runGit(['merge', '--abort'], { cwd: tree });
      return {
        code: CODES.REAL_CONFLICT,
        ok: false,
        files,
        reason: files.length
          ? `it genuinely conflicts, in ${files.length} file(s): ${files.join(', ')}`
          : `the merge failed (${merged.stderr.slice(0, 200)})`,
      };
    }

    // 5. Prove the result actually contains main before pushing it anywhere.
    const contains = runGit(['merge-base', '--is-ancestor', `origin/${base}`, 'HEAD'], { cwd: tree });
    if (!contains.ok) {
      return { code: CODES.NOT_ANCESTOR, ok: false, reason: `the merged tree does not contain ${base} — refusing to push it` };
    }

    // 6. Did the merge bring in a change to anything a `?v=` pin hashes?
    //    If so the pins in this tree name the PRE-merge build, and pushing it
    //    turns a green branch red on a step that reads like the branch's own
    //    fault. Re-pinning properly needs a real `npm ci` in this scratch
    //    worktree — about two minutes per branch, on a pass that runs hourly —
    //    so this detects and hands over with the exact fix instead. A named
    //    next step beats a red check discovered twenty minutes later.
    const broughtIn = runGit(['diff', '--name-only', `origin/${branchName}`, 'HEAD'], { cwd: tree });
    if (broughtIn === null || !broughtIn.ok) {
      return { code: CODES.NOT_ANCESTOR, ok: false, reason: 'could not list what the merge brought in, so could not tell whether the asset pins are stale — not pushing' };
    }
    const stale = pinnedAssetSourcesIn(broughtIn.stdout.split('\n'));
    if (stale.length) {
      const shown = stale.slice(0, 3).join(', ') + (stale.length > 3 ? `, and ${stale.length - 3} more` : '');
      return {
        code: CODES.NEEDS_REBUILD,
        ok: false,
        files: stale,
        reason: `${base} merged cleanly, but it changed ${stale.length} file(s) behind a ?v= asset pin (${shown}), so the pins in the merged tree name the old build. Pushing it would fail CI's clean-build check. A session needs: git merge origin/${base}, npm run build, commit the changed HTML, push.`,
      };
    }

    // 7. Fast-forward only, by construction. No --force, ever.
    const pushed = runGit(['push', 'origin', `HEAD:refs/heads/${branchName}`], { cwd: tree });
    if (!pushed.ok) {
      return {
        code: CODES.PUSH_FAILED,
        ok: false,
        reason: `the catch-up merged cleanly but could not be pushed (${pushed.stderr.slice(0, 200)}) — if the branch moved, the next pass will pick it up`,
      };
    }

    return { code: CODES.CLEAN, ok: true, reason: `${base} merged into ${branchName} with no conflict; the branch is caught up and CI will re-run` };
  } finally {
    if (added) {
      runGit(['worktree', 'remove', '--force', tree], { cwd });
      runGit(['worktree', 'prune'], { cwd });
    }
    try { removeDir(parent); } catch { /* a leftover temp dir is not worth failing over */ }
  }
}

module.exports = {
  CODES,
  PIN_DRIVER_KEY,
  PIN_SOURCE_PATHS,
  pinnedAssetSourcesIn,
  parseRepoFromRemoteUrl,
  assetPinDriverInstalled,
  catchUpBranchLocally,
};
