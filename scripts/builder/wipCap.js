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
 * The ticket statuses that mean "this work is genuinely in flight".
 *
 * WHY THIS LIST AND NOT "IS THE PR OPEN" (2026-08-25, task 86bbm4zwd). The
 * first version counted every open PR, and on the morning of 2026-08-25 that
 * deadlocked the build loop for four consecutive hourly passes: seven PRs open
 * against a cap of five, of which FIVE should never have counted — three whose
 * tickets had been sent back to `Queued` for rework (so the cap was blocking
 * the only thing that could close them) and two zombies whose tickets were
 * already `Live`, shipped by a different PR.
 *
 * The cap asks "how many PRs are open?" when it means "how much work is in
 * flight". Those are the same number only when every open PR has a ticket
 * somebody is moving, and they diverge in two entirely ordinary situations —
 * a send-back and an abandoned duplicate. Both were present.
 *
 * `Queued` is deliberately NOT here: a queued ticket with an open PR is rework
 * waiting to be claimed, and counting it is what caused the deadlock. `Live`
 * is not here either — the work shipped; the PR is a leftover.
 */
const IN_FLIGHT_STATUSES = Object.freeze(['building', 'in review', 'ready to launch']);

/**
 * The ClickUp task id a pull request declares in its body.
 *
 * Reliable because `pr-opened` REFUSES to record a PR whose body carries no
 * link back to its ticket — so every PR the loops open has one by
 * construction. A PR without one is hand-made, and is reported rather than
 * counted (see classifyPrs).
 */
function ticketIdFromPrBody(body) {
  const m = /app\.clickup\.com\/t\/(?:\d+\/)?([a-z0-9]+)/i.exec(String(body || ''));
  return m ? m[1] : null;
}

/**
 * Split open PRs by what their ticket says, so the message can name the split
 * rather than a bare total. A bare total is what made the deadlock invisible
 * for four passes: "7 open, cap 5" is true and useless.
 *
 * `ticketStatusById` is a plain object of id -> status string. A PR whose
 * ticket is absent from it is `unknown` — reported, never counted.
 */
function classifyPrs({ prs, ticketStatusById } = {}) {
  const byId = ticketStatusById && typeof ticketStatusById === 'object' ? ticketStatusById : {};
  const groups = { inFlight: [], queued: [], live: [], unknown: [] };
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!pr || typeof pr !== 'object') continue;
    if (String(pr.state || 'OPEN').toUpperCase() !== 'OPEN') continue;
    const id = ticketIdFromPrBody(pr.body);
    const status = id ? String(byId[id] || '').trim().toLowerCase() : '';
    if (!id || !status) groups.unknown.push(pr.number);
    else if (IN_FLIGHT_STATUSES.includes(status)) groups.inFlight.push(pr.number);
    else if (status === 'queued') groups.queued.push(pr.number);
    else groups.live.push(pr.number);
  }
  return groups;
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
function wipDecision({ prs, cap, ticketStatusById } = {}) {
  const limit = Number.isInteger(cap) ? cap : DEFAULT_WIP_CAP;

  // No ticket statuses supplied — ClickUp could not be read, or an older
  // caller. Fall back to counting every open PR, which is the pre-2026-08-25
  // behaviour: MORE restrictive, never less. Failing toward the cap costs some
  // idle time; failing away from it costs the churn the cap exists to prevent.
  if (!ticketStatusById || typeof ticketStatusById !== 'object') {
    const openCount = countOpenPrs(prs);
    const capped = openCount >= limit;
    return {
      claim: !capped, code: capped ? 3 : 0, openCount, inFlight: openCount, cap: limit,
      groups: null,
      message: capped
        ? `WIP cap reached — ${openCount} PR(s) open, cap ${limit}. Not claiming; the merge side is the bottleneck.\n` +
          'This is a normal outcome, not a failure. Ticket statuses were NOT available, so every open PR was\n' +
          `counted — the conservative reading. Raise it with ${CAP_ENV} for an experiment.`
        : `${openCount} PR(s) open, cap ${limit} — room to claim another (ticket statuses unavailable; counted them all).`,
    };
  }

  const groups = classifyPrs({ prs, ticketStatusById });
  const inFlight = groups.inFlight.length;
  const notCounted = groups.queued.length + groups.live.length + groups.unknown.length;

  // The split, always — a bare total is what hid the 2026-08-25 deadlock.
  const parts = [];
  if (groups.queued.length) parts.push(`${groups.queued.length} queued for rework (#${groups.queued.join(', #')})`);
  if (groups.live.length) parts.push(`${groups.live.length} whose ticket is already live (#${groups.live.join(', #')})`);
  if (groups.unknown.length) parts.push(`${groups.unknown.length} with no ticket found (#${groups.unknown.join(', #')})`);
  const tail = notCounted ? `\n${notCounted} open PR(s) not counted: ${parts.join('; ')}.` : '';

  if (inFlight >= limit) {
    return {
      claim: false, code: 3, openCount: countOpenPrs(prs), inFlight, cap: limit, groups,
      message:
        `WIP cap reached — ${inFlight} in flight, cap ${limit}. Not claiming; the merge side is the bottleneck.${tail}\n` +
        'This is a normal outcome, not a failure. Work queued beyond the merge rate does not ship sooner —\n' +
        `it goes stale, and every merge re-dates every open branch. Raise it with ${CAP_ENV} for an experiment.`,
    };
  }

  return {
    claim: true, code: 0, openCount: countOpenPrs(prs), inFlight, cap: limit, groups,
    message: `${inFlight} in flight, cap ${limit} — room to claim another.${tail}`,
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
  IN_FLIGHT_STATUSES,
  resolveCap,
  ticketIdFromPrBody,
  classifyPrs,
  countOpenPrs,
  wipDecision,
  undeterminedDecision,
};
