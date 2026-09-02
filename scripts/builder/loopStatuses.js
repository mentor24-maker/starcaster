'use strict';

/**
 * The Loop Queue's statuses, and the order loop-build drains them.
 *
 * WHY THIS EXISTS (2026-08-31, task 86bbr1u9v). Until today a ticket sent back
 * by review returned to `Queued`, where it was INDISTINGUISHABLE FROM WORK
 * THAT WAS NEVER STARTED. Three things followed, all of them measured:
 *
 *   1. It was invisible. "52 queued, 1 in review" read as 52 fresh tickets;
 *      six of them were half-built with open pull requests. Finding that out
 *      took a morning of reading logs by hand.
 *   2. It lost its place in line. A sent-back ticket re-entered the priority
 *      contest from scratch, so normal-priority rework never won against fresh
 *      high-priority work. #419 (Aug 25), #446, #447 and #449 did not go stale
 *      by accident — THE CLAIM RULE DID IT TO THEM.
 *   3. The cap could not report honestly. `wip-check` said "1 in flight, cap
 *      5" while five real branches sat open, because `Queued` is deliberately
 *      not counted — and it must not be, or the cap blocks the only work that
 *      could clear it (the 2026-08-25 deadlock, task 86bbm4zwd).
 *
 * So a send-back now lands in its own status, `Rework`, and this module is the
 * ONE place that says so. The name is Dane's call, 2026-08-31: "Recycle" was
 * rejected because recycling loses the thing's form, and here the branch, the
 * PR, the commits and the review notes all survive intact; "Send-back" was
 * rejected because it names the transition, and every other status on this
 * list names a state.
 *
 * WHY ONE MODULE AND NOT A STRING IN EACH CALLER. The status is read by the
 * claim gate, the pacing curve, the WIP cap, the pause sweep, the pulse and
 * the weekly report. `wipCap.ticketIdFromPrBody` already carries a comment
 * about the cost of two functions disagreeing about the same string; six would
 * be worse. A status list that drifts fails the way this ticket's own bug
 * failed — silently, and in the direction of looking fine.
 */

/** The Loop Queue's statuses, in the order the pipeline moves through them. */
const REWORK = 'rework';
const QUEUED = 'queued';
const BUILDING = 'building';
const IN_REVIEW = 'in review';
const READY_TO_LAUNCH = 'ready to launch';
const NEEDS_YOUR_INPUT = 'needs your input';
const LIVE = 'live';

/**
 * How the statuses are spelled when they are WRITTEN — ClickUp matches
 * case-insensitively on the way in, but a status printed back to a human
 * should read the way the board reads.
 */
const DISPLAY = Object.freeze({
  [REWORK]: 'Rework',
  [QUEUED]: 'Queued',
  [BUILDING]: 'Building',
  [IN_REVIEW]: 'In review',
  [READY_TO_LAUNCH]: 'Ready to launch',
  [NEEDS_YOUR_INPUT]: 'Needs your input',
  [LIVE]: 'Live',
});

/** The board's line-up, left to right, for anything that renders the stages. */
const STAGE_ORDER = Object.freeze([
  'Rework', 'Queued', 'Building', 'In review', 'Needs your input', 'Ready to launch', 'Live',
]);

/**
 * What loop-build may claim, IN DRAIN ORDER — rework before fresh work.
 *
 * This is the half of the ticket that actually fixes the staleness. A queue
 * that merely SHOWS rework separately, while still claiming by priority across
 * both tiers, reproduces consequence 2 above on day one: a normal-priority
 * rework ticket still never wins against fresh urgent work.
 *
 * Finishing half-built work is cheaper than starting new work — the branch
 * exists, the review notes exist, and every day it waits costs another
 * catch-up merge against a moving `main` (branch protection is `strict:true`,
 * so every merge dates every open branch; see wipCap.js).
 */
const CLAIMABLE_BY_BUILD = Object.freeze([REWORK, QUEUED]);

/** ClickUp's priority names, best first. Anything unrecognised sorts last. */
const PRIORITY_RANK = Object.freeze({ urgent: 1, high: 2, normal: 3, low: 4 });
const PRIORITY_UNKNOWN = 9;

/** Lower-case a status off a ClickUp task, whatever shape it arrived in. */
function statusOf(task) {
  if (typeof task === 'string') return task.trim().toLowerCase();
  return String(task?.status?.status ?? '').trim().toLowerCase();
}

/** Is this a status loop-build may claim from? */
function isClaimableByBuild(status) {
  return CLAIMABLE_BY_BUILD.includes(String(status ?? '').trim().toLowerCase());
}

/**
 * Which tier a status claims in: 0 = rework, 1 = queued, null = not claimable.
 * `null` rather than a large number on purpose — a caller that sorts on this
 * must decide what to do with a ticket that is not in the contest at all,
 * rather than have it silently sort to the end and look claimable.
 */
function claimTier(status) {
  const s = String(status ?? '').trim().toLowerCase();
  const at = CLAIMABLE_BY_BUILD.indexOf(s);
  return at === -1 ? null : at;
}

/** ClickUp's dates arrive as strings; a missing one sorts oldest. */
function createdAt(task) {
  const n = Number(task?.date_created);
  return Number.isFinite(n) ? n : 0;
}

function priorityRank(task) {
  return PRIORITY_RANK[String(task?.priority?.priority ?? '').toLowerCase()] ?? PRIORITY_UNKNOWN;
}

/**
 * The claim order, as a comparator: every `Rework` ticket before every
 * `Queued` one, and within each tier the rule that tier deserves.
 *
 * REWORK IGNORES PRIORITY, AND THAT IS DELIBERATE. Priority is a statement
 * about what to START; rework is not started, it is finished. Ordering rework
 * by priority would recreate the same starvation one tier down — the two-week
 * old normal-priority send-back losing to the fresh urgent one, which is
 * exactly what #419 has been doing since 25 August. Oldest first, full stop.
 *
 * `Queued` keeps the rule it has always had: priority, then oldest. Nothing
 * about fresh work changed.
 *
 * A ticket in neither tier sorts after both, but see `claimTier` — a caller
 * should filter first rather than lean on that.
 */
function compareForClaim(a, b) {
  const ta = claimTier(statusOf(a));
  const tb = claimTier(statusOf(b));
  const ra = ta === null ? CLAIMABLE_BY_BUILD.length : ta;
  const rb = tb === null ? CLAIMABLE_BY_BUILD.length : tb;
  if (ra !== rb) return ra - rb;
  // Within rework, age alone. Within queued, priority then age.
  if (ra === claimTier(QUEUED)) {
    const pa = priorityRank(a);
    const pb = priorityRank(b);
    if (pa !== pb) return pa - pb;
  }
  return createdAt(a) - createdAt(b);
}

/**
 * Every ticket loop-build could claim, in the order it should claim them.
 * Pure, and non-mutating — the caller's array is left alone.
 */
function claimOrder(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter((t) => t && typeof t === 'object' && isClaimableByBuild(statusOf(t)))
    .slice()
    .sort(compareForClaim);
}

module.exports = {
  REWORK,
  QUEUED,
  BUILDING,
  IN_REVIEW,
  READY_TO_LAUNCH,
  NEEDS_YOUR_INPUT,
  LIVE,
  DISPLAY,
  STAGE_ORDER,
  CLAIMABLE_BY_BUILD,
  PRIORITY_RANK,
  PRIORITY_UNKNOWN,
  statusOf,
  isClaimableByBuild,
  claimTier,
  compareForClaim,
  claimOrder,
};
