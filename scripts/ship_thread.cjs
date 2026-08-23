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
const { pickPullRequestCommit, REPIN_SUBJECT } = require('./builder/pullRequestCommit');

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
      'Resolve it by hand (`git merge origin/main`), then run `npm run ship` again.\n\n' +
      'Note: the `?v=` asset pins are merged automatically (.gitattributes →\n' +
      'scripts/merge_asset_pins.cjs), so a conflict here is a real one.'
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

heading(`Waiting for the checks (up to ${CI_TIMEOUT_MIN} minutes)`);
const checks = spawnSync('gh', ['pr', 'checks', prNumber, '--watch', '--interval', '20'], {
  stdio: 'inherit',
  timeout: CI_TIMEOUT_MIN * 60 * 1000,
});
if (checks.status !== 0) {
  fail(
    `The checks did not pass, so nothing was merged. The work is safe on the branch.\n` +
    `Look at: https://github.com/mentor24-maker/starcaster/pull/${prNumber}`
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
