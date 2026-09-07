'use strict';

/**
 * Deciding when `npm run ship` may move past CI — and, the whole reason this
 * exists, telling "the checks have not appeared yet" apart from "the checks
 * failed".
 *
 * WHY THIS EXISTS
 * Twice on 2026-08-20 (PRs #356 and #358) ship reached the CI step seconds
 * after pushing, GitHub had not yet registered a single check on the branch,
 * and `gh pr checks --watch` returned non-zero straight away with "no checks
 * reported on the ... branch". Ship read that as a failure and stopped, and an
 * operator reading "The checks did not pass" believes something broke — when in
 * fact nothing had run yet. Both times the fix was to run ship again ~30s later.
 *
 * The distinction the old code could not make: an EMPTY check list right after a
 * push means "not yet", not "failed". So ship now polls for the checks to APPEAR
 * (a short grace window, because they normally show within seconds), then
 * watches them to completion (the full budget), and only ever calls it a failure
 * when a check actually reports one — never on absence.
 *
 * WHY ABSENCE IS NOT ALWAYS TEMPORARY (2026-08-23, PRs #387 and #389)
 * The original note above assumed a missing check is a GitHub delay that clears
 * itself. Two PRs proved otherwise. Both were opened with `gh pr create` and
 * then received a SECOND push about fifteen seconds later — a work-log commit in
 * #387, a force-push in #389. In both, the `opened` run and that second push's
 * run are BOTH absent from `gh run list`; the branch then sat checkless for
 * half an hour until an unrelated push finally produced a run. So the state is
 * not "not yet": with no further push, no run is ever created, `ship` waits on
 * nothing, and the merge-on-comment gate refuses the PR forever.
 *
 * The recovery is a fresh push — a new head SHA fires `synchronize` and GitHub
 * makes the run. That is what `nudge` is for: once the appear-grace window is
 * spent, this asks the caller to push something, ONCE, and gives the checks one
 * more window to show up. Waiting longer, or re-running ship, cannot help;
 * only a new commit can.
 *
 * AND THERE IS A SECOND CAUSE, WITH THE OPPOSITE REMEDY (2026-09-06, PR #630)
 * A checkless pull request looks identical whichever cause it has, and until
 * this was written the code knew only the first one — so it spent its whole
 * grace window, pushed a nudge commit that could not possibly help, spent
 * another window, and then told the operator to go and check whether Actions
 * was enabled for the repository. All three of those are wrong advice here.
 *
 * Both workflows in this repo trigger on `pull_request`, which GitHub runs
 * against the MERGE of the branch and its base. When it believes the pull
 * request conflicts (`mergeable: CONFLICTING` / `mergeStateStatus: DIRTY`) it
 * cannot build that merge ref, so it creates no run at all — no error, no
 * skipped run, no annotation, just absence. On #630 two pushes eleven minutes
 * apart produced nothing while other pull requests in the same repo started
 * full runs in between them, and `git merge-tree --write-tree` said the merge
 * was clean; the thing that started the checks was merging `origin/main` in.
 *
 * So absence is now interrogated rather than assumed: while no check has ever
 * appeared, this asks GitHub whether the pull request is conflicting, and if it
 * is, stops at once with its own outcome (`blocked_conflicting`) instead of
 * waiting or nudging. A nudge commit is the remedy for the FIRST cause only;
 * firing it at this one burns the grace window and changes nothing, because
 * the new head SHA still cannot be merged either.
 *
 * AND "NO CHECK" MEANS NO CHECK OF OURS (round 2, same task). The first version
 * of that guard was unreachable in this repository and nobody could see it,
 * because it waited for an EMPTY check list and a pull request here is never
 * empty — Vercel posts rows on every one of them. `classifyChecks` below is
 * what fixes it: it now knows which rows came from this repository's own
 * workflows, so "no checks" means what the guard always meant by it.
 *
 * ONLY WHILE NO CHECK HAS EVER APPEARED, and that scope is load-bearing. A
 * conflicting head stops GitHub CREATING runs; it does not remove runs it has
 * already made. Measured on 2026-09-06: PR #637 read `CONFLICTING` / `DIRTY`
 * with all four of its checks passing, because they were created before the
 * branch went stale. Probing once checks exist would report that fully green
 * board as blocked — and it would be answering a question that is not this
 * function's anyway, since the merge gate refuses a `DIRTY` head on its own.
 *
 * Pure and injectable on purpose: driving the real thing needs a remote, a PR
 * and CI, so the behaviour would go untested in practice (the same reason the
 * force-push property in shipThread.test.js is asserted at source level). Here
 * the decision is a plain function over an injected `queryChecks`, so the
 * empty→empty→passing path the ticket calls for is a real unit test.
 */

/**
 * Is this row one of the repository's OWN workflow runs, rather than a
 * third-party status posted onto the commit?
 *
 * WHY THIS EXISTS (2026-09-06, round 2 of task 86bbvqkr1). The conflicting-head
 * guard below was written to fire when no check had appeared, and it could
 * never fire at all — because "no checks" in this repository does not mean an
 * empty list. Vercel posts its own rows (`Vercel`, `Vercel Preview Comments`)
 * on every pull request whatever GitHub Actions does, so the incident this
 * whole file was extended for looked like this:
 *
 *   Vercel Preview Comments   completed   success        <- and nothing else
 *
 * Four rows of nothing-happened read as `passed`, the probe ran zero times, and
 * ship fell through to the merge step on a pull request with NO CI green at
 * all. GitHub then refused the merge on the dirty head — a third message, for
 * neither of the two causes, which is worse than the bug it replaced.
 *
 * THE DISCRIMINATOR IS STRUCTURAL, NOT A LIST OF NAMES. A GitHub Actions check
 * RUN belongs to a workflow and carries its name; a commit STATUS posted by an
 * outside service belongs to no workflow and carries an empty one. Measured on
 * 2026-09-06 with `gh pr checks 639 --json name,bucket,state,workflow`:
 *
 *   {"name":"verify",                 "workflow":"CI"}
 *   {"name":"review-gate",            "workflow":"review-gate"}
 *   {"name":"Vercel",                 "workflow":""}
 *   {"name":"Vercel Preview Comments","workflow":""}
 *
 * So this asks the structural question rather than matching `verify` and
 * `review-gate` by name. A named list would be wrong the day a workflow is
 * added or renamed, and wrong SILENTLY — the new workflow's rows would read as
 * third-party, which is this same bug with a different trigger.
 */
function isWorkflowCheck(check) {
  return String((check && check.workflow) || '').trim() !== '';
}

/**
 * Classify one `gh pr checks --json bucket,workflow` result list.
 *   'none'    — no run of one of THIS repository's workflows has appeared yet
 *               (an empty list, or a list holding only third-party rows)
 *   'failed'  — at least one check failed or was cancelled
 *   'pending' — the repo's checks exist and at least one is still running
 *   'passed'  — the repo's checks exist and everything is pass/skip
 *
 * TWO ORDERING DECISIONS, both load-bearing.
 *
 * Absence of the repo's own checks outranks a third-party verdict. A list of
 * nothing but Vercel rows is `none` even when one of them failed, because "our
 * CI has not run" is the truer and more useful statement about that pull
 * request — and it is the state that lets the conflicting-head probe below ask
 * why. Neither answer merges anything, so nothing is risked by preferring the
 * more diagnostic one.
 *
 * But once the repo's checks DO exist, a failure anywhere — third-party rows
 * included — still outranks pending and passed. That is the conservative half
 * and it is deliberately unchanged: a failed Vercel deployment has always
 * stopped ship, and a fix aimed at a missing-checks bug does not get to quietly
 * start merging failed deployments.
 *
 * @throws TypeError when given a non-empty list in which no row carries a
 * `workflow` property at all. That means the caller did not ask `gh` for the
 * field, so which rows are CI cannot be determined — and the honest answer is
 * not `none`. Reporting `none` there would tell ship that a fully green pull
 * request has no checks, which is a CANNOT TELL rendered as a verdict, the
 * exact defect this round is fixing. It throws rather than returning a fourth
 * state because it can only happen by editing the `--json` list, so it fires on
 * the first poll of the first run and can never reach the operator quietly.
 */
function classifyChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'none';
  if (!checks.some((c) => c && typeof c === 'object' && 'workflow' in c)) {
    throw new TypeError(
      'classifyChecks was given check rows with no `workflow` field, so it cannot tell the ' +
      "repository's own CI runs from third-party rows like Vercel's. Ask `gh pr checks` for it: " +
      '--json bucket,name,state,workflow'
    );
  }
  const buckets = checks.map((c) => String((c && c.bucket) || '').toLowerCase());
  if (!checks.some(isWorkflowCheck)) return 'none';
  if (buckets.some((b) => b === 'fail' || b === 'cancel')) return 'failed';
  if (buckets.some((b) => b === 'pending')) return 'pending';
  return 'passed';
}

/**
 * Classify one `gh pr view --json mergeable,mergeStateStatus` reading.
 *   'conflicting' — GitHub believes the branch and its base disagree, so it
 *                   will not build a merge ref and will not run a check
 *   'mergeable'   — it can build the merge ref; absence of checks is the OTHER
 *                   cause, and a nudge commit is the remedy
 *   'unknown'     — no reading, an unparseable one, or GitHub's genuine
 *                   `UNKNOWN`, which is what it returns for the first seconds
 *                   after a push while it computes mergeability
 *
 * BOTH fields are read, and either one is enough. GitHub sets them together
 * (`CONFLICTING` comes with `DIRTY`), but they are separate fields on separate
 * schedules and reading only one of them would make this guard depend on which
 * half of GitHub's answer arrived first.
 *
 * `UNKNOWN` is deliberately NOT conflicting. It is the ordinary state for a
 * few seconds after every push, so treating it as a conflict would abandon the
 * wait on almost every healthy pull request — the caller keeps waiting and
 * asks again on the next poll, which is why this is polled rather than read
 * once.
 */
function classifyMergeable(reading) {
  if (!reading) return 'unknown';
  const merge = String((typeof reading === 'string' ? reading : reading.mergeable) || '').toUpperCase();
  const state = String((typeof reading === 'string' ? '' : reading.mergeStateStatus) || '').toUpperCase();
  if (merge === 'CONFLICTING' || state === 'DIRTY') return 'conflicting';
  if (merge === 'MERGEABLE') return 'mergeable';
  return 'unknown';
}

/**
 * Wait for CI, distinguishing "not appeared yet" from "failed".
 *
 * @param queryChecks  () => Array   the current check list (empty = none yet)
 * @param sleep        (ms) => void  block for ms
 * @param now          () => number  epoch ms
 * @param appearGraceMs   how long to wait for the FIRST check to appear
 * @param totalBudgetMs   overall ceiling once checks are running
 * @param pollIntervalMs  gap between polls
 * @param onPoll       (state, checks, elapsedMs) => void  progress hook
 * @param nudge        () => boolean  optional: push something so GitHub creates
 *                     a run. Called AT MOST ONCE, only after the grace window
 *                     has passed with no check ever appearing. Return falsy (or
 *                     throw) if the push could not be made.
 * @param nudgeGraceMs how long to wait for a check after nudging; defaults to
 *                     appearGraceMs.
 * @param queryMergeable () => ({ mergeable, mergeStateStatus }) | null
 *                     optional: ask GitHub whether the pull request conflicts.
 *                     Polled only while no check has ever appeared. Omit it and
 *                     the behaviour is exactly what it was before this existed.
 *                     It may return null, or throw, when no reading can be
 *                     taken — that is treated as "unknown", never as "clean".
 * @param conflictingConfirmations how many CONSECUTIVE conflicting readings it
 *                     takes to return `blocked_conflicting`. Defaults to 2,
 *                     because GitHub's mergeability is cached and the first
 *                     reading after a push can describe the branch as it was
 *                     before it — which would make the catch-up merge that
 *                     FIXES a conflicting head look like it had not worked.
 *
 * @returns { outcome, checks, nudged, mergeable } where outcome is one of:
 *   'passed'              — safe to merge
 *   'failed'              — a check reported failure
 *   'blocked_conflicting' — no check appeared and GitHub says the pull request
 *                           conflicts, so no check ever will. The remedy is a
 *                           catch-up merge of the base branch, NOT a nudge
 *                           commit (2026-09-06, PR #630)
 *   'never_appeared'      — no check ever showed up, and a nudge (if one was
 *                           available) did not produce one either
 *   'timed_out_pending'   — checks appeared but were still running at the budget
 * `nudged` says whether the extra push was actually made, so the caller can
 * tell "nothing has been tried yet" from "we pushed and GitHub still made no
 * run" — two very different things to put in front of an operator.
 * `mergeable` is the last reading taken, or null if none was, so the caller can
 * say WHICH remedy applies instead of listing both and letting a person guess.
 */
function waitForChecks({
  queryChecks,
  sleep,
  now,
  appearGraceMs = 3 * 60 * 1000,
  totalBudgetMs = 20 * 60 * 1000,
  pollIntervalMs = 20 * 1000,
  onPoll,
  nudge,
  nudgeGraceMs,
  queryMergeable,
  conflictingConfirmations = 2,
} = {}) {
  if (typeof queryChecks !== 'function') throw new TypeError('waitForChecks needs a queryChecks function');
  if (typeof sleep !== 'function') throw new TypeError('waitForChecks needs a sleep function');
  if (typeof now !== 'function') throw new TypeError('waitForChecks needs a now function');

  const start = now();
  const graceAfterNudge = typeof nudgeGraceMs === 'number' ? nudgeGraceMs : appearGraceMs;
  let sawAnyCheck = false;
  let nudged = false;
  let nudgedAt = 0;
  let mergeable = null;
  let conflictingReadings = 0;

  for (;;) {
    const checks = queryChecks();
    const state = classifyChecks(checks);
    const elapsed = now() - start;
    if (typeof onPoll === 'function') onPoll(state, checks, elapsed);

    if (state === 'failed') return { outcome: 'failed', checks, nudged, mergeable };
    if (state === 'passed') return { outcome: 'passed', checks, nudged, mergeable };
    if (state === 'pending') sawAnyCheck = true;

    // ASK WHY THE CHECKS ARE ABSENT BEFORE WAITING OUT THE WINDOW (PR #630).
    // A pull request GitHub calls conflicting gets no runs at all, and no
    // amount of waiting or nudging changes that — the nudge's new head SHA
    // cannot be merged either. This runs BEFORE the budget and grace checks
    // below on purpose: reaching either of those first would report the wrong
    // cause and, worse, hand out the wrong remedy.
    if (state === 'none' && !sawAnyCheck && typeof queryMergeable === 'function') {
      let reading = null;
      try {
        reading = queryMergeable();
      } catch (_) {
        // A reading that cannot be taken is not a verdict. Fall through to the
        // ordinary waiting path, which never calls absence a pass.
        reading = null;
      }
      if (reading) mergeable = reading;
      if (classifyMergeable(reading) === 'conflicting') {
        // CONFIRM IT BEFORE ACTING ON IT. GitHub's mergeability is a cached
        // computation, so the reading taken in the first seconds after a push
        // can still describe the branch as it was BEFORE that push. The costly
        // case is precisely the recovery: you merge origin/main in to fix a
        // conflicting head, ship polls immediately, GitHub answers with the
        // stale CONFLICTING, and ship stops to tell you to do the thing you
        // just did. A second agreeing reading one poll later costs one poll
        // interval on a genuinely conflicting pull request — which is stopping
        // anyway — and removes that whole false stop.
        conflictingReadings += 1;
        if (conflictingReadings >= conflictingConfirmations) {
          return { outcome: 'blocked_conflicting', checks, nudged, mergeable };
        }
      } else {
        // Any other answer — mergeable, UNKNOWN, or no reading at all — breaks
        // the run. Confirmation means CONSECUTIVE readings; counting them
        // cumulatively would let two conflicting answers half an hour apart,
        // with a clean one in between, add up to a verdict.
        conflictingReadings = 0;
      }
    }

    // Still 'none' or 'pending' at this point — decide whether to keep waiting.
    if (elapsed >= totalBudgetMs) {
      return { outcome: sawAnyCheck ? 'timed_out_pending' : 'never_appeared', checks, nudged, mergeable };
    }
    if (state === 'none' && !sawAnyCheck && elapsed >= appearGraceMs) {
      // Nothing has ever shown up and the grace window is spent. Waiting longer
      // does not help — with no new push GitHub never creates a run (#387/#389).
      if (!nudged && typeof nudge === 'function') {
        let pushed = false;
        try {
          // Boolean(), not `!== false`. The contract above says a nudge returns
          // FALSY when the push could not be made, and `!== false` honours only
          // one of the falsy values -- a nudge that returns undefined (an
          // ordinary `function nudge() { ... }` with no return, which is what a
          // future caller writes by accident) would be recorded as a successful
          // push. Ship would then tell the operator to go check whether Actions
          // is enabled, about a push that never happened. Ship's own nudge
          // returns explicit booleans, so nothing is broken today; this is a
          // trap laid for the next caller.
          pushed = Boolean(nudge());
        } catch (_) {
          pushed = false;
        }
        if (!pushed) return { outcome: 'never_appeared', checks, nudged: false, mergeable };
        nudged = true;
        nudgedAt = now();
      } else if (!nudged) {
        // No nudge available: report it as its own thing, never as a failure.
        return { outcome: 'never_appeared', checks, nudged: false, mergeable };
      } else if (now() - nudgedAt >= graceAfterNudge) {
        // We pushed and GitHub STILL made no run. That is not a delay any more.
        return { outcome: 'never_appeared', checks, nudged: true, mergeable };
      }
    }

    sleep(pollIntervalMs);
  }
}

module.exports = { classifyChecks, classifyMergeable, isWorkflowCheck, waitForChecks };
