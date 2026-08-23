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
 * Pure and injectable on purpose: driving the real thing needs a remote, a PR
 * and CI, so the behaviour would go untested in practice (the same reason the
 * force-push property in shipThread.test.js is asserted at source level). Here
 * the decision is a plain function over an injected `queryChecks`, so the
 * empty→empty→passing path the ticket calls for is a real unit test.
 */

/**
 * Classify one `gh pr checks --json bucket` result list.
 *   'none'    — no checks reported yet (empty list)
 *   'failed'  — at least one check failed or was cancelled
 *   'pending' — checks exist and at least one is still running
 *   'passed'  — checks exist and all are pass/skip
 * A failing check outranks a pending one: if anything has already failed there
 * is no point waiting for the rest.
 */
function classifyChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'none';
  const buckets = checks.map((c) => String((c && c.bucket) || '').toLowerCase());
  if (buckets.some((b) => b === 'fail' || b === 'cancel')) return 'failed';
  if (buckets.some((b) => b === 'pending')) return 'pending';
  return 'passed';
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
 *
 * @returns { outcome, checks } where outcome is one of:
 *   'passed'            — safe to merge
 *   'failed'            — a check reported failure
 *   'never_appeared'    — no check ever showed up within the grace window
 *   'timed_out_pending' — checks appeared but were still running at the budget
 */
function waitForChecks({
  queryChecks,
  sleep,
  now,
  appearGraceMs = 3 * 60 * 1000,
  totalBudgetMs = 20 * 60 * 1000,
  pollIntervalMs = 20 * 1000,
  onPoll,
} = {}) {
  if (typeof queryChecks !== 'function') throw new TypeError('waitForChecks needs a queryChecks function');
  if (typeof sleep !== 'function') throw new TypeError('waitForChecks needs a sleep function');
  if (typeof now !== 'function') throw new TypeError('waitForChecks needs a now function');

  const start = now();
  let sawAnyCheck = false;

  for (;;) {
    const checks = queryChecks();
    const state = classifyChecks(checks);
    const elapsed = now() - start;
    if (typeof onPoll === 'function') onPoll(state, checks, elapsed);

    if (state === 'failed') return { outcome: 'failed', checks };
    if (state === 'passed') return { outcome: 'passed', checks };
    if (state === 'pending') sawAnyCheck = true;

    // Still 'none' or 'pending' at this point — decide whether to keep waiting.
    if (elapsed >= totalBudgetMs) {
      return { outcome: sawAnyCheck ? 'timed_out_pending' : 'never_appeared', checks };
    }
    if (state === 'none' && !sawAnyCheck && elapsed >= appearGraceMs) {
      // Nothing has ever shown up and the grace window is spent: this is the
      // "not yet" case the ticket is about — report it as its own thing, never
      // as a failure.
      return { outcome: 'never_appeared', checks };
    }

    sleep(pollIntervalMs);
  }
}

module.exports = { classifyChecks, waitForChecks };
