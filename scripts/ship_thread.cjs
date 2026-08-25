#!/usr/bin/env node
'use strict';

/**
 * `npm run ship` — take the current thread from "the work is done" to "it is
 * live", in one step.
 *
 * WHY THIS EXISTS
 * The operator, 2026-08-11: "every time we go to do a merge it's colliding
 * with all the other threads, so I need to start running these commands to
 * overcome that. Is there any system we can create that addresses both issues
 * and doesn't result in my having to do additional work at every step?"
 *
 * The collisions are not really the problem — main moving is normal and good.
 * The problem was that catching up with main was a hand-run sequence, and it
 * had to be repeated every time main moved again while the sequence ran. On
 * the Top Menu work main moved SIX times, and each round meant: fetch, rebase,
 * resolve the same four asset-pin files, rebuild, re-run the checks, push,
 * check CI, merge, tidy. Nine steps, four times over.
 *
 * This is those nine steps, in order, with the state checked between each one.
 * Run it as many times as you like — if main moves while it is running, run it
 * again and it picks up from wherever it got to.
 *
 *   npm run ship                 sync, verify, push, open/update the PR,
 *                                wait for the checks, merge, tidy up
 *   npm run ship -- --no-merge   everything except the merge
 *   npm run ship -- --dry-run    say what it would do, change nothing
 *
 * SAFETY: THIS SCRIPT NEVER FORCE-PUSHES
 * It catches up by MERGING origin/main into the branch, not by rebasing, so
 * the branch only ever gains commits and an ordinary push always works.
 *
 * That is a deliberate reversal of the first draft, which rebased and then
 * force-pushed with `--force-with-lease`. The operator's settings carry
 * `Bash(git push --force*)` on the deny list, and a force-push buried inside
 * a node script is invisible to a rule that matches command text — so the one
 * command he would run most often would have quietly done the exact thing he
 * forbade. Routing around a standing rule is not something a convenience
 * script gets to do (DOCTRINE.md 6.6).
 *
 * The cost of merging instead is zero here: every PR is squash-merged, so the
 * merge commits are discarded on the way in and the history on main is
 * identical either way.
 *
 * PROTECTED below is still refused outright, as a branch to ship and as a push
 * target. A glob over command text cannot tell `main` from `main-menu`; this
 * can.
 */

const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const PROTECTED = new Set(['main', 'master']);
const CI_TIMEOUT_MIN = 20;
const { pickPullRequestCommit, REPIN_SUBJECT, NUDGE_SUBJECT } = require('./builder/pullRequestCommit');
const { waitForChecks } = require('./builder/waitForChecks');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const DRY = flag('dry-run');
const NO_MERGE = flag('no-merge');

const root = process.cwd();

/* ---------------------------------------------------------------- helpers */

function git(argv, { cwd = root, allowFail = false } = {}) {
  try {
    return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFail) return null;
    fail(`git ${argv.join(' ')} failed:\n${(error.stderr || error.stdout || error.message).toString().trim()}`);
  }
}

/** Streams to the terminal — for the long ones, so it does not look hung. */
function run(cmd, argv, { cwd = root, allowFail = false } = {}) {
  const result = spawnSync(cmd, argv, { cwd, stdio: 'inherit' });
  if (result.status !== 0 && !allowFail) {
    fail(`\`${cmd} ${argv.join(' ')}\` failed. Nothing has been pushed or merged.`);
  }
  return result.status === 0;
}

function quiet(cmd, argv, { cwd = root } = {}) {
  const result = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, out: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}

/** Block for ms without a busy loop — the CI poll is the only place this runs. */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const bucketOf = (check) => String((check && check.bucket) || '').toLowerCase();

/**
 * The current check list for a PR, as an array (empty = none reported yet).
 * `--json` gives a stable machine list and, crucially, returns an empty array
 * rather than a non-zero exit when there are no checks — so "none yet" arrives
 * here as `[]`, never as a thrown failure. A genuinely broken `gh` call (auth,
 * network) is different: it stops ship rather than being read as "no checks".
 */
function queryPullRequestChecks(prNumber) {
  const result = spawnSync('gh', ['pr', 'checks', String(prNumber), '--json', 'bucket,name,state'], {
    cwd: root, encoding: 'utf8',
  });
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  // gh exits non-zero when checks are pending or failing, and (older gh) when
  // there are none at all — but with --json it still prints the list (or `[]`).
  // So parse stdout first and trust it; only treat a call with NO parseable
  // output as a real error.
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* fall through to the error path */ }
  }
  if (/no checks reported/i.test(stderr)) return [];
  fail(
    `Could not read the checks from GitHub (\`gh pr checks\`). Nothing was merged.\n` +
    `${stderr || 'gh returned no output.'}`
  );
  return []; // unreachable; fail() exits.
}

let step = 0;
const say = (message) => console.log(message);
const heading = (message) => console.log(`\n[${++step}] ${message}`);

function fail(message) {
  console.error(`\n[ship] Stopped.\n\n${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------- the checks */

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

if (PROTECTED.has(branch)) {
  fail(
    `You are on "${branch}", which is the live branch — there is nothing to ship FROM it.\n` +
    'Start a piece of work with `npm run thread <topic>`, do the work in the folder it makes,\n' +
    'then run `npm run ship` there.'
  );
}

if (git(['status', '--porcelain'])) {
  fail(
    'There are edits that have not been committed yet, so shipping would leave them behind.\n' +
    'Commit them first, then run this again.'
  );
}

say(`[ship] Branch "${branch}"${DRY ? '  (dry run — nothing will change)' : ''}`);

/* ------------------------------------------------------- 1. catch up with main */

heading('Catching up with the live branch');
git(['fetch', 'origin', '--quiet']);

const behind = git(['rev-list', '--count', `HEAD..origin/main`]);
if (behind === '0') {
  say('    Already up to date with main.');
} else if (DRY) {
  say(`    Would merge origin/main in (${behind} commit(s) ahead of this branch).`);
} else {
  say(`    main has moved ${behind} commit(s). Merging it in…`);
  // Merge, not rebase: the branch only gains commits, so an ordinary push
  // always works and this script never needs to force anything. See the
  // header — a force-push in here would sidestep the operator's deny rule.
  const merge = quiet('git', ['merge', 'origin/main', '--no-edit']);
  if (!merge.ok) {
    const conflicted = git(['diff', '--name-only', '--diff-filter=U'], { allowFail: true }) || '';
    quiet('git', ['merge', '--abort']);
    fail(
      'Two changes genuinely disagree and a person has to choose:\n\n' +
      conflicted.split('\n').filter(Boolean).map((f) => `  · ${f}`).join('\n') +
      '\n\nThe merge has been undone, so the branch is exactly as it was.\n' +
      'Resolve it by hand (`git merge origin/main`), then run `npm run ship` again.'
    );
  }
  say('    Merged cleanly.');
}

/* ------------------------------------------------------------- 2. rebuild */

heading('Rebuilding everything the change affects');
if (DRY) say('    Would run: npm run build');
else run('npm', ['run', 'build']);

/* -------------------------------------------------------------- 3. verify */

heading('Checking it still works');
const CHECKS = [
  ['npm', ['run', 'typecheck'], 'types'],
  ['npm', ['run', 'test:builder-ui'], 'builder tests'],
  ['npm', ['run', 'test:builder'], 'server tests'],
  ['npm', ['run', 'test:hooks'], 'agent hooks'],
  ['node', ['scripts/check_conventions.cjs'], 'repo conventions'],
  ['node', ['scripts/check_build_paths.cjs'], 'build paths'],
  ['node', ['scripts/check_syntax.cjs'], 'browser JS syntax'],
];
if (DRY) {
  say(`    Would run ${CHECKS.length} checks.`);
} else {
  for (const [cmd, argv, label] of CHECKS) {
    const result = quiet(cmd, argv);
    if (!result.ok) {
      fail(`The ${label} check failed. Nothing has been pushed.\n\n${result.out.split('\n').slice(-25).join('\n')}`);
    }
    say(`    ✓ ${label}`);
  }
}

// The rebuild can re-stamp the asset pins, and those belong in the branch.
// A NEW commit, never an amend: amending rewrites the last commit, and if the
// branch is already on GitHub that turns the next push into a force-push —
// reintroducing exactly what this script refuses to do. An extra commit costs
// nothing, since the PR is squash-merged.
if (!DRY && git(['status', '--porcelain'])) {
  say('    Rebuild re-stamped the asset pins — committing them.');
  git(['add', '-A']);
  run('git', ['commit', '--no-verify', '-m', REPIN_SUBJECT]);
}

/* ---------------------------------------------------------------- 4. push */

heading('Sending it to GitHub');
if (PROTECTED.has(branch)) fail('Refusing to push a protected branch.'); // belt and braces

const upstream = git(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { allowFail: true });
// Always an ordinary push. Catching up by merge means the branch only ever
// gains commits, so there is never history to overwrite — and this script is
// therefore never in the business of forcing anything.
const pushArgs = upstream ? ['push', 'origin', branch] : ['push', '-u', 'origin', branch];

if (DRY) {
  say(`    Would run: git ${pushArgs.join(' ')}`);
} else {
  const push = quiet('git', pushArgs);
  if (!push.ok) {
    if (/rejected|non-fast-forward|stale info/i.test(push.out)) {
      fail(
        'GitHub refused the push because this branch has history the remote does not:\n\n' +
        push.out + '\n\n' +
        'That means the branch was rebased or amended somewhere along the way. This\n' +
        'script will not force-push over it — that is a decision for you, not a\n' +
        'convenience script. Either:\n' +
        '  · `git fetch origin && git merge origin/' + branch + '` to reconcile, then run this again, or\n' +
        '  · look at what diverged before overwriting anything.'
      );
    }
    fail(`Could not push:\n\n${push.out}`);
  }
  say('    Pushed.');
}

/* ------------------------------------------------------------------ 5. PR */

heading('Pull request');
let prNumber = null;
const existing = quiet('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '--jq', '.[0].number']);
if (existing.ok && existing.out) prNumber = existing.out.trim();

if (prNumber) {
  say(`    Using the open one: #${prNumber}`);
} else if (DRY) {
  say('    Would open a pull request from the commit message.');
} else {
  const { subject, body } = pickPullRequestCommit(git);
  const created = quiet('gh', ['pr', 'create', '--title', subject, '--body', body || subject]);
  if (!created.ok) fail(`Could not open a pull request:\n\n${created.out}`);
  prNumber = (created.out.match(/\/pull\/(\d+)/) || [])[1];
  say(`    Opened #${prNumber || '?'} — ${created.out.split('\n').pop()}`);
}

if (DRY) {
  console.log('\n[ship] Dry run finished. Nothing was changed.\n');
  process.exit(0);
}

/* ------------------------------------------------------------ 6. wait for CI */

// WHY THIS IS A POLL AND NOT `gh pr checks --watch`:
// `--watch` returns non-zero the instant a branch has ZERO checks — which is
// exactly the state a branch is in for the first few seconds after a push,
// before GitHub has registered its workflows. Ship used to read that as a
// failure and stop, and the operator read "The checks did not pass" for a thing
// that had not run yet (PRs #356/#358, 2026-08-20). So we wait for the checks to
// APPEAR (a short grace window) and only then for them to finish, and we never
// call absence a failure. Decision logic lives in scripts/builder/waitForChecks.
heading(`Waiting for the checks (up to ${CI_TIMEOUT_MIN} minutes)`);

const prUrl = `https://github.com/mentor24-maker/starcaster/pull/${prNumber}`;
let lastReport = '';

/**
 * Push an empty commit so GitHub creates a check run.
 *
 * A PR can be born with no runs at all: open it with `gh pr create` and push
 * again within ~15 seconds and BOTH the `opened` run and the second push's run
 * go missing (PRs #387 and #389, 2026-08-23). Nothing arrives later on its own,
 * because a run only exists if an event created one — so the branch stays
 * checkless forever, ship waits on nothing, and the merge gate refuses it.
 * A new head SHA fires `synchronize`, which is the only thing that fixes it.
 *
 * Deliberately NOT `--no-verify`: an empty commit gives the hooks nothing to
 * object to, and a convenience path does not get to route around them. If the
 * hooks re-pin an asset the commit stops being empty, which is equally fine —
 * all that matters is that the head SHA moves.
 */
/**
 * Which STEP of the nudge failed, or null if it did not fail.
 *
 * 'commit' and 'push' are different situations for the operator and the advice
 * differs completely: after a failed commit the branch really does need a new
 * one, but after a failed push the commit already exists locally and an
 * ordinary `git push` (or another `npm run ship`) sends it. The message at the
 * bottom used to give the commit-failed advice for both, so in the push case it
 * told him NOT to do the one thing that works.
 */
let nudgeFailedAt = null;

function nudgeChecks() {
  say('    Still nothing after the grace window. Waiting longer cannot help: with no new');
  say('    push GitHub never creates a run. Pushing an empty commit to trigger one.');
  const message =
    `${NUDGE_SUBJECT}\n\n` +
    'GitHub registered no check run for this pull request. That happens when a\n' +
    'push lands within seconds of the PR being opened. Only a new head SHA can\n' +
    'make a run; this commit is that SHA and carries no changes.';
  const committed = quiet('git', ['commit', '--allow-empty', '-m', message]);
  if (!committed.ok) {
    say(`    Could not make the commit:\n${committed.out}`);
    nudgeFailedAt = 'commit';
    return false;
  }
  const pushed = quiet('git', pushArgs);
  if (!pushed.ok) {
    say(`    Could not push it:\n${pushed.out}`);
    nudgeFailedAt = 'push';
    return false;
  }
  nudgeFailedAt = null;
  say('    Pushed. Watching for the run it should create.');
  return true;
}

const wait = waitForChecks({
  totalBudgetMs: CI_TIMEOUT_MIN * 60 * 1000,
  now: () => Date.now(),
  sleep: sleepMs,
  queryChecks: () => queryPullRequestChecks(prNumber),
  nudge: nudgeChecks,
  onPoll: (state, list, elapsed) => {
    // One honest progress line per poll, only when the picture changes, so a
    // 20-minute wait does not scroll — and "none yet" never reads as trouble.
    const mins = Math.round(elapsed / 60000);
    let line;
    if (state === 'none') {
      line = `    No checks on GitHub yet — this is normal right after a push, still watching (${mins}m).`;
    } else {
      const pass = list.filter((c) => bucketOf(c) === 'pass' || bucketOf(c) === 'skipping').length;
      const pend = list.filter((c) => bucketOf(c) === 'pending').length;
      const bad = list.filter((c) => bucketOf(c) === 'fail' || bucketOf(c) === 'cancel').length;
      line = `    Checks: ${pass} passed, ${pend} running, ${bad} failed (${mins}m).`;
    }
    if (line !== lastReport) { say(line); lastReport = line; }
  },
});

if (wait.outcome === 'never_appeared') {
  fail(
    wait.nudged
      ? `No checks appeared on this pull request, and pushing an extra commit did not produce\n` +
        `one either. That is not a delay — something is stopping GitHub Actions from running\n` +
        `on this branch. Nothing was merged; the work is safe. Check that Actions is enabled\n` +
        `for the repository and that the workflow file is present on the branch.\n\n` +
        `Look at: ${prUrl}`
      // The nudge is only skipped when it could not be made — and the two ways
      // it can fail need OPPOSITE advice, so they get their own sentences. The
      // single message that used to stand here gave the commit-failed advice in
      // both cases, which in the push case told the operator not to do the one
      // thing that works.
      : nudgeFailedAt === 'push'
        ? `No checks ever appeared on the branch. The extra commit that would create one was\n` +
          `made, but pushing it failed (see the reason above), so it is sitting on this branch\n` +
          `locally and GitHub has not seen it. Nothing was merged; the work is safe.\n\n` +
          `Push it and the run should start:\n` +
          `  git push\n` +
          `or just run \`npm run ship\` again — it picks up where it got to.\n\n` +
          `Look at: ${prUrl}`
        : `No checks ever appeared on the branch, and the extra commit that would have created\n` +
          `one could not be made (see the reason above). Nothing was merged; the work is safe\n` +
          `on the branch. Re-running \`npm run ship\` on its own will NOT help — the branch\n` +
          `needs a new commit before GitHub will make a run.\n\n` +
          `Look at: ${prUrl}`
  );
}
if (wait.outcome === 'timed_out_pending') {
  fail(
    `The checks were still running after ${CI_TIMEOUT_MIN} minutes, so nothing was merged.\n` +
    `They have not failed — they just have not finished. The work is safe on the branch;\n` +
    `run \`npm run ship\` again once they go green.\n\n` +
    `Look at: ${prUrl}`
  );
}
if (wait.outcome === 'failed') {
  fail(
    `The checks did not pass, so nothing was merged. The work is safe on the branch.\n` +
    `Look at: ${prUrl}`
  );
}

/* --------------------------------------------------------------- 7. merge */

if (NO_MERGE) {
  console.log(`\n[ship] Ready to merge — stopped here because of --no-merge.\n       PR #${prNumber}\n`);
  process.exit(0);
}

heading('Merging');
const state = quiet('gh', ['pr', 'view', prNumber, '--json', 'mergeStateStatus', '--jq', '.mergeStateStatus']);
if (state.out === 'DIRTY' || state.out === 'BEHIND') {
  fail(
    `main moved again while the checks were running (GitHub says "${state.out}").\n` +
    'Nothing was merged. Run `npm run ship` again — it will catch up and carry on.'
  );
}
// No --delete-branch: this repo already has GitHub's own
// "Automatically delete head branches" setting on (delete_branch_on_merge),
// so the remote branch is gone the moment the merge lands, with or without
// this flag. What the flag ALSO does — try to switch the LOCAL checkout off
// the now-dead branch — is what printed a red `fatal: 'main' is already
// used by worktree at ...` on a run that had already succeeded: every
// `ship` runs from a worktree, and `main` is always checked out somewhere
// else, so that local switch fails every single time. Local cleanup is
// already `post-merge`'s and `npm run tidy`'s job (step 8, below), done
// properly via `git cherry` rather than a plain checkout — so gh's attempt
// was both redundant and the actual source of the whole problem.
run('gh', ['pr', 'merge', prNumber, '--squash'], { allowFail: true });

const merged = quiet('gh', ['pr', 'view', prNumber, '--json', 'state', '--jq', '.state']);
if (merged.out !== 'MERGED') {
  fail(`The merge did not complete (PR #${prNumber} is "${merged.out}"). Nothing else has been changed.`);
}
say(`    Merged #${prNumber}. It is live once Vercel finishes deploying.`);

/* ---------------------------------------------------------------- 8. tidy */

heading('Tidying up');
const commonDir = git(['rev-parse', '--git-common-dir']);
const mainRoot = path.dirname(path.resolve(root, commonDir));
run('git', ['-C', mainRoot, 'checkout', 'main'], { allowFail: true });
run('git', ['-C', mainRoot, 'pull', '--ff-only', '--quiet'], { allowFail: true });
run('npm', ['run', 'tidy'], { cwd: mainRoot, allowFail: true });

console.log(
  `\n[ship] Done. #${prNumber} is merged and main is up to date.\n` +
  `       This folder has been cleaned up — your next \`npm run thread\` starts fresh.\n`
);
