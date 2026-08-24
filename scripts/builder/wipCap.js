'use strict';

/**
 * Should loop-build claim another ticket, or is the merge side already full?
 *
 * WHY THIS EXISTS (2026-08-24). Branch protection is `strict: true` — a branch
 * must be current with `main` before it can merge. That rule is right: it
 * guarantees the tests that passed ran against exactly what becomes live, and
 * `main` auto-deploys to production.
 *
 * ITS COST IS QUADRATIC IN THE NUMBER OF OPEN PRs. Every merge invalidates
 * every other open branch, so with N open each merge dates N-1 branches, each
 * needing its own catch-up and its own CI run. On 2026-08-23 with 24 open PRs
 * a single merge dated 23 branches, and the relay spent most of its work
 * re-catching-up branches that were stale again before they could be used.
 *
 * Double the open PRs and you quadruple the churn. That is why the intuitive
 * fix — more build loops, more machines — makes throughput WORSE.
 *
 * Throughput is min(build rate, review rate, merge rate). Merge is the
 * slowest, so work queued beyond the merge rate does not ship sooner; it rots,
 * and rotting costs real work. Capping work in progress does not slow
 * delivery. It removes the churn that was eating the merge side's capacity.
 *
 * It also makes the queue honest: "26 queued, 5 in flight" is true. "26 queued
 * and 24 half-built" is not.
 */

/**
 * Where to start. Five is not measured — it is a starting point chosen to sit
 * comfortably above the observed merge rate (about 1.25/hour before the
 * in-pass merge fix, task 86bbk2fb5) while leaving room for review turnaround.
 * Raise it when the merge side demonstrably keeps up; lower it if the catch-up
 * churn is still visible. Override for experiments with CLAUDE_LOOP_WIP_CAP.
 */
const DEFAULT_WIP_CAP = 5;

const CAP_ENV = 'CLAUDE_LOOP_WIP_CAP';

/**
 * The cap in force. A malformed or negative override is ignored rather than
 * obeyed — a typo in an env var must not silently switch the loop off.
 */
function resolveCap(env = process.env) {
  const raw = String(env?.[CAP_ENV] ?? '').trim();
  if (!raw) return DEFAULT_WIP_CAP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_WIP_CAP;
  return n;
}

/**
 * How many of these pull requests are actually in flight.
 *
 * OPEN only. Counting a merged or closed PR silently halves the effective cap
 * and the loop stops for no reason; missing one doubles it and the churn comes
 * back. `gh pr list --state open` already filters, but the count is derived
 * here so a caller that passes everything still gets the right answer.
 */
function countOpenPrs(prs) {
  return (Array.isArray(prs) ? prs : [])
    // A null or non-object entry is not a pull request. The first version used
    // `pr?.state || 'OPEN'`, which turned every null in the list into an open
    // PR and would have capped the loop on garbage.
    .filter((pr) => pr && typeof pr === 'object')
    .filter((pr) => String(pr.state || 'OPEN').toUpperCase() === 'OPEN')
    .length;
}

/**
 * @returns {{ claim: boolean, code: 0|3, openCount: number, cap: number, message: string }}
 *   `code` mirrors the node-role guard: 0 = go ahead, 3 = a normal decline.
 */
function wipDecision({ prs, cap } = {}) {
  const openCount = countOpenPrs(prs);
  const limit = Number.isInteger(cap) ? cap : DEFAULT_WIP_CAP;

  if (openCount >= limit) {
    return {
      claim: false,
      code: 3,
      openCount,
      cap: limit,
      message:
        `WIP cap reached — ${openCount} PR(s) open, cap ${limit}. Not claiming; the merge side is the bottleneck.\n` +
        'This is a normal outcome, not a failure. Work queued beyond the merge rate does not ship sooner —\n' +
        `it goes stale, and every merge re-dates every open branch. Raise it with ${CAP_ENV} for an experiment.`,
    };
  }

  return {
    claim: true,
    code: 0,
    openCount,
    cap: limit,
    message: `${openCount} PR(s) open, cap ${limit} — room to claim another.`,
  };
}

/**
 * What to do when the count itself could not be read.
 *
 * DELIBERATELY FAILS OPEN, and this is the one place that differs from
 * `node:owns`. That guard protects a check-then-act claim, where guessing
 * wrong means two machines building the same ticket — a correctness problem,
 * so it must refuse. This one is a THROUGHPUT optimisation: guessing wrong
 * costs some catch-up churn, while refusing on a transient `gh` failure would
 * stop all work outright. So it proceeds — and says loudly that it is
 * proceeding without knowing, which is the part that must never be silent.
 */
function undeterminedDecision(why) {
  return {
    claim: true,
    code: 1,
    openCount: null,
    cap: null,
    message:
      `Could not count open PRs (${why}), so the work-in-progress cap was NOT applied this pass.\n` +
      'Proceeding, because refusing on a transient failure would stop all work — but this pass is\n' +
      'unbounded by the cap and that is worth noticing if it repeats.',
  };
}

module.exports = {
  DEFAULT_WIP_CAP,
  CAP_ENV,
  resolveCap,
  countOpenPrs,
  wipDecision,
  undeterminedDecision,
};
