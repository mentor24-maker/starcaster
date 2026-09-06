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
// How long to wait for a merge to actually land after `gh pr merge` returns —
// and it is only ever SPENT on a pull request GitHub is demonstrably holding
// (a merge queue entry or auto-merge). An unheld OPEN pull request is a merge
// that was refused, and ship says so on the first read, in about a second.
//
// DERIVED, NOT PICKED (round 2 of task 86bbv35cq). It was 15, a number that
// traced to nothing but prose. What a merge queue actually does is run `verify`
// once more on the merged result — the same CI run ship already waits on — so
// the ceiling is the one already measured for that, not a second guess beside
// it. If CI gets slower, both move together.
const MERGE_TIMEOUT_MIN = CI_TIMEOUT_MIN;
const { pickPullRequestCommit, REPIN_SUBJECT, NUDGE_SUBJECT } = require('./builder/pullRequestCommit');
const { waitForChecks } = require('./builder/waitForChecks');
const {
  waitForMerge, mergeTimeLabel, holdLabel, holdIsPending, classifyMergeHold,
  notMergedExplanation, prObservationArgv, parsePrObservation,
} = require('./builder/mergeCompletion');
const { decideAlreadyLive } = require('./builder/shipAlreadyLive');
const {
  branchContentIsInMain, branchTouchedFiles, branchHasMergedPr, mergeBase,
} = require('./lib/repo_state.cjs');
const {
  decideTrailWrite, bodyWithTicketLink, describeTrailResult, prUrl: prUrlFor,
} = require('./builder/shipPrTrail');
const { decidePullRequestTitle } = require('./builder/pullRequestTitle');

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
  // `code` matters for the ClickUp trail step below, which treats exit 4 (the
  // PR body carries no ticket link) differently from every other failure —
  // they need opposite advice, and "not zero" cannot tell them apart.
  return { ok: result.status === 0, code: result.status, out: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}

/**
 * Ask ClickUp for a ticket's name, for the pull-request title.
 *
 * NOT `quiet()`, and the difference is the whole point. `quiet` concatenates
 * stdout and stderr, which is right for the trail step — it wants everything
 * the command said, to print back. Here the stdout IS the title, and
 * `clickup_direct.mjs` writes its rate-limit line to stderr, so `quiet` would
 * glue "ClickUp's own limit: 91 of 100 left this minute" onto the end of every
 * PR name.
 *
 * `--silent` because npm writes its run banner (`> starcaster@1.0.0 clickup`)
 * to stdout, not stderr. `parseTaskName` strips that shape as well, so the
 * title survives an npm that stops honouring the flag.
 *
 * Never throws and never calls fail(): a ClickUp outage falls back to the
 * commit subject and says so, rather than stopping a green branch from
 * shipping.
 */
function fetchTaskNameFromClickUp(id) {
  const result = spawnSync('npm', ['run', '--silent', 'clickup', '--', 'task-name', '--task', String(id)], {
    cwd: root, encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    output: `${result.stderr || ''}`.trim(),
  };
}

/** Block for ms without a busy loop — the CI poll is the only place this runs. */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run a command and parse its stdout as JSON, or null.
 *
 * NOT `quiet()`, for the reason `fetchTaskNameFromClickUp` above already
 * documents: `quiet` concatenates stderr onto stdout, which is right when the
 * output is for a person to read and fatal when it is about to be parsed. One
 * `gh` deprecation notice on stderr and `JSON.parse` throws, which this path
 * would read as "the pull request could not be read" — a cannot-tell
 * manufactured out of a perfectly good answer.
 */
function readJson(cmd, argv, { cwd = root } = {}) {
  const result = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  try { return JSON.parse(String(result.stdout || '')); } catch (_) { return null; }
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

/**
 * Ask GitHub whether this pull request conflicts with its base.
 *
 * WHY (2026-09-06, PR #630). Both workflows here trigger on `pull_request`,
 * which GitHub runs against the MERGE of the branch and main. When it believes
 * the two conflict it cannot build that merge, so it creates no run at all —
 * silently. The pull request then looks exactly like one whose checks are
 * merely early, and the remedy for THAT case (an empty nudge commit) cannot
 * help, because the nudge's new head SHA does not merge either.
 *
 * Unlike `queryPullRequestChecks` this never stops ship. It only ever adds a
 * diagnosis to a wait that was going to happen anyway, so a reading that cannot
 * be taken returns null and the wait carries on as it always did — "cannot
 * tell" must not become "conflicting", and it must not become a failure.
 */
function queryPullRequestMergeable(prNumber) {
  const result = spawnSync('gh', ['pr', 'view', String(prNumber), '--json', 'mergeable,mergeStateStatus'], {
    cwd: root, encoding: 'utf8',
  });
  const stdout = (result.stdout || '').trim();
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* an unreadable answer is not a verdict */ }
  return null;
}

// The PR URL spelling moved into `shipPrTrail` (task 86bbq7z1k, round 2). It
// had a second caller there — the repair command a failed trail write prints —
// which printed a bare `--pr 484` that `pr-opened` rejects. One spelling, one
// place, so the command ship is told to run is the command ship itself runs.

let step = 0;
const say = (message) => console.log(message);
const heading = (message) => console.log(`\n[${++step}] ${message}`);

function fail(message) {
  console.error(`\n[ship] Stopped.\n\n${message}\n`);
  process.exit(1);
}

/**
 * Put the Mac back in order once the work is live: main up to date, shipped
 * branches and finished worktrees gone.
 *
 * ONE SPELLING, TWO CALLERS (round 3 of task 86bbv35cq). Step 8 runs it after
 * a merge this run performed; the already-live check at the top runs it after
 * a merge GitHub performed while nobody was watching — which is what makes
 * "run `npm run ship` again and it finishes the tidy-up" a true sentence.
 * Two copies of a cleanup sequence is how one of them quietly stops matching.
 */
function tidyUp() {
  const commonDir = git(['rev-parse', '--git-common-dir']);
  const mainRoot = path.dirname(path.resolve(root, commonDir));
  run('git', ['-C', mainRoot, 'checkout', 'main'], { allowFail: true });
  run('git', ['-C', mainRoot, 'pull', '--ff-only', '--quiet'], { allowFail: true });
  run('npm', ['run', 'tidy'], { cwd: mainRoot, allowFail: true });
}

/* ------------------------------------------------------------- the checks */

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

// The ticket this thread is FOR, stamped onto the branch by `npm run thread`
// and read back by `npm run tidy`. `ship` uses it for the PR trail (step 5b);
// a branch without one still ships, it just says so out loud.
const taskId = git(['config', '--get', `branch.${branch}.clickup-task`], { allowFail: true }) || '';

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

/* --------------------------------------------- 0. is this already live? */

// WHY THIS IS THE FIRST THING (round 3 of task 86bbv35cq). When GitHub holds a
// merge — a merge queue entry, or auto-merge — `gh pr merge` returns success
// and the pull request lands minutes later, with this run long gone. Ship then
// says "run `npm run ship` again and it will see the merge and carry on with
// the tidy-up", and until now that sentence was false: ship looks for an OPEN
// pull request, a merged one is not open, so the rerun fell through to
// `gh pr create` and opened a SECOND pull request for work already live.
//
// It runs BEFORE the catch-up, the rebuild and the push on purpose. Every one
// of those is wrong on a branch that is already in main — the push would even
// re-create the head branch GitHub deleted when it merged.
//
// The decision is in `builder/shipAlreadyLive`, break-tested: it takes BOTH a
// local content reading and GitHub's own merged-pull-request answer, and a
// cannot-tell from either one falls through to the ordinary ship rather than
// skipping it. The local half is free and answers "no" on any mid-flight
// branch, so an ordinary ship never makes the GitHub call at all.
git(['fetch', 'origin', '--quiet']);
const alreadyLive = (() => {
  const here = { name: branch, ref: branch };
  const base = mergeBase();
  const contentInMain = branchContentIsInMain(here, base, root);
  if (contentInMain !== true) return decideAlreadyLive({ contentInMain, mergedPr: null });
  // Only asked on the rare path where the free local reading already said
  // yes, so an ordinary ship still pays nothing. It vetoes the third way to
  // reach `live` (round 4): a branch that changed no files reads as
  // content-in-main, and a reused topic name whose earlier pull request
  // merged supplies the other signal — two yeses on no evidence.
  const touchedFiles = branchTouchedFiles(here, base, root);
  if (touchedFiles === false) return decideAlreadyLive({ contentInMain, mergedPr: null, touchedFiles });
  return decideAlreadyLive({ contentInMain, mergedPr: branchHasMergedPr(branch), touchedFiles });
})();

if (alreadyLive.live) {
  heading('This is already live');
  say(`    ${alreadyLive.why}.`);
  if (DRY) {
    say('    Nothing left to ship. Would clean this folder up and stop.');
    console.log('\n[ship] Dry run finished. Nothing was changed.\n');
    process.exit(0);
  }
  say('    Nothing left to ship — finishing the tidy-up.');
  tidyUp();
  console.log(
    `\n[ship] Done. "${branch}" was already merged into main, so there was nothing to ship.\n` +
    `       This folder has been cleaned up — your next \`npm run thread\` starts fresh.\n`
  );
  process.exit(0);
}

/* ------------------------------------------------------- 1. catch up with main */

heading('Catching up with the live branch');

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
} else {
  const { subject, body } = pickPullRequestCommit(git);
  // THE TITLE COMES FROM THE TICKET (task 86bbqwupk). `subject` is the newest
  // hand-authored commit — still the right answer for an unstamped branch, and
  // still the fallback when ClickUp cannot be reached, but it is a freehand
  // sentence and the operator pairs the Closed list with the deploy list by
  // name. The decision, and every reason it might not use the ticket, live in
  // `builder/pullRequestTitle` where they can be tested without a token.
  const titled = decidePullRequestTitle({
    taskId,
    fallbackSubject: subject,
    fetchTaskName: fetchTaskNameFromClickUp,
  });
  say(titled.message.split('\n').map((line) => `    ${line}`).join('\n'));

  // Both halves of the trail, written at the one moment ship owns the body.
  // `pr-opened` refuses its half until the PR names the ticket, so without this
  // line every ship on a stamped branch would ask for the trail and be told no.
  const prBody = bodyWithTicketLink(body || subject, taskId);
  if (DRY) {
    say(`    Would open a pull request titled: "${titled.title}"`);
  } else {
    const created = quiet('gh', ['pr', 'create', '--title', titled.title, '--body', prBody]);
    if (!created.ok) fail(`Could not open a pull request:\n\n${created.out}`);
    prNumber = (created.out.match(/\/pull\/(\d+)/) || [])[1];
    say(`    Opened #${prNumber || '?'} — ${created.out.split('\n').pop()}`);
  }
}

/* -------------------------------------------- 5b. record the PR on the ticket */

// WHY SHIP DOES THIS (task 86bbq7z1k). The review gate confirms that a ticket
// RECORDS its PR, by reading the newest `PR opened:` line off it
// (`loopTrail.prTrailLanded`). No line means CANNOT TELL, which is never a
// pass. The loops have written that line since task 86bbjt18r; ship never did,
// and ship is the hand lane and the fast-track lane's step 7 — so once branch
// protection is ticked, every hand-shipped PR would be blocked on a comment
// nobody remembered to post.
//
// It is a command rather than a line in the lane docs for the same reason the
// loop traces became commands: a written step is followed most of the time, and
// nothing notices the times it is not.
//
// This runs BEFORE the CI wait and the merge, so the trail exists even on a run
// that later stops on a red check — and it never stops the ship itself. A
// ClickUp outage is not a reason to abandon a green, mergeable PR; but it is
// said LOUDLY, because a silently missing trail is the entire defect here.
heading('Recording the pull request on its ClickUp ticket');
const trail = decideTrailWrite({ taskId, prNumber });
if (DRY && taskId && !prNumber) {
  // A dry run has not opened the PR, so there is no number to decide about yet.
  // Saying "no pull-request number could be read" here would report a problem
  // that only exists because nothing was done.
  say(`    Would open the pull request, then record it on ticket ${taskId}.`);
} else if (!trail.write) {
  say(trail.message.split('\n').map((line) => `    ${line}`).join('\n'));
} else if (DRY) {
  say(`    Would record PR #${trail.prNumber} on ticket ${trail.taskId}.`);
} else {
  // --if-missing because ship is meant to be re-run whenever main moves under
  // it, and a plain pr-opened would leave one identical line per catch-up
  // round. It asks the merge step's own reader whether this PR is already
  // findable here — a line written by a loop, or by hand, counts the same.
  const recorded = quiet('npm', [
    'run', 'clickup', '--', 'pr-opened',
    '--task', trail.taskId, '--pr', prUrlFor(trail.prNumber), '--if-missing',
  ]);
  const told = describeTrailResult({
    taskId: trail.taskId, prNumber: trail.prNumber, code: recorded.code, output: recorded.out,
  });
  say(told.message.split('\n').map((line) => `    ${line}`).join('\n'));
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

const prUrl = prUrlFor(prNumber);
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
  queryMergeable: () => queryPullRequestMergeable(prNumber),
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

// THE CONFLICTING HEAD (2026-09-06, PR #630). Handled before `never_appeared`
// because it IS a "no checks appeared" case — just one with a completely
// different cause and the opposite remedy. Ship already merges main in at step
// 1, so getting here means main moved during the build and verify above, which
// take minutes; running ship again does that catch-up and is the whole fix.
if (wait.outcome === 'blocked_conflicting') {
  const seen = wait.mergeable || {};
  fail(
    `GitHub says this pull request conflicts with main (mergeable: ${seen.mergeable || 'CONFLICTING'},\n` +
    `mergeStateStatus: ${seen.mergeStateStatus || 'DIRTY'}), and it will not run ANY checks on a pull\n` +
    `request it believes is conflicting — the workflows here run against the merge of the branch\n` +
    `and main, and it cannot build that merge. So the checks are not late. They are not coming.\n\n` +
    `An empty "nudge" commit does NOT fix this one. That is the remedy for the other way a pull\n` +
    `request ends up checkless, and here it would only add a head SHA that does not merge either.\n\n` +
    `Nothing was merged; the work is safe on the branch. Bring main in and the checks start:\n\n` +
    `  npm run ship\n\n` +
    `— it merges origin/main into this branch first, which is exactly what was missing. If it\n` +
    `reports the branch is ALREADY up to date with main and GitHub still calls it conflicting,\n` +
    `that is GitHub's stale mergeability cache rather than a real disagreement; push any new\n` +
    `commit (\`git commit --allow-empty -m "Recompute mergeability" && git push\`) to make it\n` +
    `work the answer out again.\n\n` +
    `Look at: ${prUrl}`
  );
}
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

// ── D2: a merge asks the pause switch (decided 2026-09-03, task 86bbu2uhq) ──
// The audit's finding C1: the doctrine said both "before merging anything,
// run pipeline check" and "no pause to merge". Dane decided it as
// recommended: you never PAUSE the line in order to merge — but every merge
// still ASKS the switch, ship included, because the session that collided
// with the operator (PR #432) was a hand-driven one that never looked.
// Fails safe like every other actor: an unreadable switch counts as paused.
heading('Asking the pause switch');
const deck = quiet('npm', ['run', '--silent', 'pipeline', '--', 'check']);
if (!deck.ok) {
  fail(
    'The pipeline switch says stop — nothing was merged. In its own words:\n' +
    `${deck.out}\n` +
    "A pause is Dane's deck, and resume is his call (`npm run pipeline -- resume --operator-asked`).\n" +
    'The work is safe on the branch — run `npm run ship` again once the line is running.'
  );
}
say(`    ${deck.out.split('\n')[0]}`);

// ── D3: the review gate is STATED, never enforced here (task 86bbu2uhq) ─────
// The full fold into the one merge gate waits for a driving incident, as
// recommended. What a merge may not do any more is happen with nothing said
// about what the review side concluded — the lines below are the read-only
// `waiting` reader's own words, reprinted, never a re-derivation.
if (taskId) {
  const gate = quiet('npm', ['run', '--silent', 'clickup', '--', 'waiting', '--task', String(taskId)]);
  const gateLines = gate.out.split('\n').filter((l) => /status:|last word:|VERDICT:/.test(l));
  if (gate.ok && gateLines.length) {
    say('    review gate context:');
    for (const l of gateLines) say(`      ${l.trim()}`);
  } else {
    say(`    review gate context: could not be read (${gate.ok ? 'no verdict lines in the answer' : `exit ${gate.code}`}) — said out loud, and merging anyway: the gate is reported here, not enforced.`);
  }
} else {
  say('    review gate context: this branch carries no ticket stamp, so there is nothing to read it from.');
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

// `gh pr merge` EXITING 0 IS NOT A MERGE (task 86bbv35cq). Under a merge queue
// it enqueues and returns at once, leaving the pull request OPEN for as long as
// the queue takes — so reading the state back one instant later, as this used
// to, would fail every single run with "The merge did not complete" while the
// merge was in fact under way. Wait for the state GitHub actually reports.
// With no queue — today's state — the first read already says MERGED and this
// returns before it ever sleeps, so nothing here costs an ordinary ship a
// second.
// AND "STILL OPEN" IS NOT "ENQUEUED" (round 2). The observation asks GitHub,
// in the same read as the state, whether anything is actually holding this
// pull request — a merge queue entry or auto-merge. If nothing is, the merge
// was refused and this says so at once, which is the accurate one-second
// answer ship gave before any of this. Only a pull request GitHub is really
// holding is worth waiting on.
//
// `main`'s protection has `strict: true`, so a branch that falls behind
// between the CI wait above and the merge call below is refused exactly this
// way — and it is the commonest refusal there is, which is why announcing it
// as a queue wait mattered.
const repoSlug = (() => {
  const seen = readJson('gh', ['repo', 'view', '--json', 'nameWithOwner']);
  return (seen && seen.nameWithOwner) || '';
})();

// A READ THAT CANNOT SUCCEED IS NOT WORTH TWENTY MINUTES (round 3). Without a
// repository slug every observation below is blind by construction — the
// GraphQL query is asked about owner "" — so the wait would poll the full
// MERGE_TIMEOUT_MIN, eighty reads, and then report `unknown` with a message
// that already named this as the likelier cause. It is knowable before the
// first poll, so it is answered before the first poll.
if (!repoSlug) {
  fail(
    `This folder's GitHub repository could not be identified (\`gh repo view\` gave nothing),\n` +
    `so whether PR #${prNumber} merged cannot be read at all — not merged, and not failed either.\n\n` +
    'The merge command was already sent, so GitHub may well have merged it. Nothing else has\n' +
    'been changed. Check `gh auth status`, then run `npm run ship` again — it sees an\n' +
    'already-merged branch now and finishes the tidy-up.'
  );
}
let lastMergeReport = '';
const mergeWait = waitForMerge({
  now: () => Date.now(),
  sleep: sleepMs,
  timeoutMs: MERGE_TIMEOUT_MIN * 60 * 1000,
  readPr: () => parsePrObservation(readJson('gh', prObservationArgv(repoSlug, prNumber))),
  // IT ONLY ANNOUNCES A WAIT IT IS ACTUALLY TAKING (round 3). This fired on
  // any `open` read, BEFORE the hold was classified, so a refused merge — the
  // commonest ending on a repo with no queue — printed "#625 is queued to
  // merge" and then, one line below, "still OPEN and nothing is holding it".
  // Two adjacent lines contradicting each other, the false one being round 1's
  // own sentence surviving one line above its correction. The hold arrives as
  // the third argument for exactly this: nothing here may name a queue the
  // observation has not established.
  onPoll: (state, elapsed, prJson) => {
    if (state === 'merged' || state === 'closed') return;
    const mins = Math.round(elapsed / 60000);
    if (state === 'open' && !holdIsPending(classifyMergeHold(prJson))) return;
    const line = state === 'open'
      ? `    #${prNumber} has not merged yet — ${holdLabel(classifyMergeHold(prJson))}. Waiting (${mins}m).`
      : `    Could not read #${prNumber} from GitHub just now — trying again (${mins}m).`;
    if (line !== lastMergeReport) { say(line); lastMergeReport = line; }
  },
});

if (mergeWait.outcome === 'not-merged') {
  // A FAILURE, answered promptly and named truthfully — but `not-merged` is
  // TWO readings, and only one of them is an observed refusal (round 4).
  // hold 'none' really was refused; hold 'unknown' means the hold field never
  // came back, so the merge did not happen and WHY is not known. This block
  // used to assert a refusal for both, one line below a line that had just
  // said the hold could not be read, and its advice ("main moved again, run
  // ship again") is misdirection on the reading it could not take. The split
  // is in mergeCompletion, beside the classifier that creates the two.
  const said = notMergedExplanation(mergeWait.hold);
  fail(
    `The merge did not complete — PR #${prNumber} is still OPEN and ` +
    `${holdLabel(mergeWait.hold)}.\n\n` +
    `${said.cause}\n\n` +
    `Nothing else has been changed. ${said.advice}`
  );
}
if (mergeWait.outcome === 'queued') {
  // NOT a failure and NOT a success — the third answer, and now only reachable
  // when GitHub really is holding the pull request. The merge is under way;
  // nothing here may claim it, and nothing here may undo it.
  fail(
    `PR #${prNumber} is QUEUED to merge, not merged yet — ${holdLabel(mergeWait.hold)}, ` +
    `and it was still open after ${MERGE_TIMEOUT_MIN} minutes.\n\n` +
    'Nothing has gone wrong and nothing else has been changed. GitHub is still working\n' +
    'through the merge, and it will land on its own — you do not have to do anything to\n' +
    'make that happen.\n\n' +
    'All that is left afterwards is the tidy-up. Run `npm run ship` again once it has\n' +
    'landed: it checks first whether this branch is already in main, and when it is, it\n' +
    'cleans this folder up and stops without opening anything.'
  );
}
if (mergeWait.outcome === 'unknown') {
  fail(
    `Could not read PR #${prNumber} from GitHub at all (${mergeWait.failedReads} attempt(s) came back blind),\n` +
    'so whether it merged is unknown — not merged, and not failed either.\n\n' +
    'Nothing else has been changed. Check `gh auth status`, then run `npm run ship` again:\n' +
    'if the merge did land, it sees this branch is already in main and finishes the tidy-up;\n' +
    'if it did not, it picks up where this run stopped.'
  );
}
if (mergeWait.outcome === 'closed') {
  fail(`PR #${prNumber} was CLOSED without merging. Nothing else has been changed.`);
}
say(`    Merged #${prNumber} at ${mergeTimeLabel(mergeWait.mergedAt)}. It is live once Vercel finishes deploying.`);

/* ---------------------------------------------------------------- 8. tidy */

heading('Tidying up');
tidyUp();

console.log(
  `\n[ship] Done. #${prNumber} is merged and main is up to date.\n` +
  `       This folder has been cleaned up — your next \`npm run thread\` starts fresh.\n`
);
