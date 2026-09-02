'use strict';

const loopStatuses = require('./loopStatuses.js');

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
 * `Rework` and `Queued` are deliberately NOT here: a ticket in either with an
 * open PR is work waiting to be CLAIMED, and counting it is what caused the
 * deadlock. `Live` is not here either — the work shipped; the PR is a
 * leftover.
 *
 * `Rework` did not exist until 2026-08-31 (task 86bbr1u9v). Before it a
 * sent-back ticket sat in `Queued`, so this file had to INFER "that one is
 * rework" from the ticket being queued — which is precisely why it could not
 * tell a send-back from work nobody had started. It reads the real status now.
 * Dane took the recommendation that rework stays uncounted, for the reason
 * above: the cap answers "how many NEW things may I start", and rework is not
 * new. That is not a licence to omit it silently, which is the whole point of
 * the new status — `wipDecision` names the rework count in BOTH its messages.
 *
 * `Needs your input` IS here (review round 1). It is operator-held, exactly
 * like `Ready to launch` which was never in doubt: a ticket parked on Dane
 * with an open PR is real work occupying the merge pipeline, and its branch
 * still needs catching up every time something lands. Counting it is also the
 * honest answer — if his inbox is full, the pipeline genuinely is full, and a
 * cap that hid that would be lying in the more dangerous direction.
 */
const IN_FLIGHT_STATUSES = Object.freeze([
  'building', 'in review', 'ready to launch', 'needs your input',
]);

/** Statuses that mean the work is finished and the PR is a leftover. */
const TERMINAL_STATUSES = Object.freeze(['live', 'complete', 'closed', 'done']);

/**
 * Where `id` appears in `haystack` as a WHOLE id rather than as part of a
 * longer alphanumeric run, or -1. Both are lowercase already.
 *
 * Plain scanning rather than a built regex: a ClickUp id is alphanumeric, so
 * it needs no escaping, and building ~140 regexes per pull request to answer
 * a substring question is work for nothing.
 */
function indexOfWholeId(haystack, id) {
  for (let from = 0; ;) {
    const at = haystack.indexOf(id, from);
    if (at === -1) return -1;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = haystack[at + id.length] || '';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return at;
    from = at + 1;
  }
}

/**
 * The ClickUp task id a pull request declares in its body, lowercased.
 *
 * Reliable because `pr-opened` REFUSES to record a PR whose body carries no
 * link back to its ticket — so every PR the loops open has one by
 * construction. A PR without one is hand-made, and is reported rather than
 * counted (see classifyPrs).
 *
 * READ IT EXACTLY AS LOOSELY AS THAT GATE ACCEPTS IT (2026-08-25, review
 * round 2). The gate is `prBodyCarriesTicket` in scripts/builder/loopTrail.js,
 * and it takes the full URL **or a bare task id**, case-insensitively. This
 * used to demand the URL and capture it verbatim, so a body reading
 * `ClickUp: 86bbm4zwd` — or a URL in the mixed case ClickUp's own UI hands
 * out — passed `pr-opened` and then landed in `unknown` here, uncounted.
 * That is the cap failing OPEN, the direction this ticket calls dangerous.
 * Two functions disagreeing about the same string is what makes a bug like
 * that arrive later and silently, so they are matched deliberately.
 *
 * @param {string} body        the pull request body
 * @param {Iterable<string>} [knownIds]  every ticket id in the queue, which is
 *   what makes a BARE id findable at all — without a URL there is nothing in
 *   the text marking one alphanumeric word as an id, so it is recognised by
 *   being one we know. Omitted, only the URL form resolves.
 */
function ticketIdFromPrBody(body, knownIds) {
  const text = String(body || '');
  const m = /app\.clickup\.com\/t\/(?:\d+\/)?([a-z0-9]+)/i.exec(text);
  if (m) return m[1].toLowerCase();

  const hay = text.toLowerCase();
  // The EARLIEST id mentioned wins, so the answer does not depend on the order
  // ClickUp happened to return the queue in. A body naming two tickets is
  // already odd; giving it an unstable answer would make it unreproducible too.
  let best = null;
  for (const raw of knownIds || []) {
    const id = String(raw || '').trim().toLowerCase();
    if (!id) continue;
    const at = indexOfWholeId(hay, id);
    if (at !== -1 && (best === null || at < best.at)) best = { id, at };
  }
  return best ? best.id : null;
}

/**
 * Split open PRs by what their ticket says, so the message can name the split
 * rather than a bare total. A bare total is what made the deadlock invisible
 * for four passes: "7 open, cap 5" is true and useless.
 *
 * `ticketStatusById` is a plain object of id -> status string; its keys are
 * lowercased here, because `ticketIdFromPrBody` lowercases what it reads and a
 * mixed-case key would then miss (review round 2).
 *
 * FIVE buckets do not count, and they are kept APART on purpose:
 *
 *   rework        a send-back the loop must be free to claim FIRST
 *   queued        fresh work the loop must be free to claim
 *   live          the work shipped elsewhere; the PR is a leftover
 *   unknown       no ticket could be found for the PR at all
 *   unrecognised  a ticket WAS found, in a status this file does not know
 *
 * `rework` and `queued` are two buckets and not one because they are two
 * different statements — "five branches are half-built and waiting to be
 * finished" and "five tickets have a stray PR against work nobody started"
 * call for opposite responses. Collapsing them is the reading that made
 * "1 in flight" true and useless while five branches sat open.
 *
 * The last two used to share one bucket reported as "no ticket found", which
 * is a false statement about the second: it sends the reader hunting for a
 * missing ClickUp link that is not missing. That is verbatim the shape review
 * round 1 rejected for `live`, so it gets the same treatment — say the thing
 * you actually know, including the status you did not recognise.
 */
function classifyPrs({ prs, ticketStatusById } = {}) {
  const source = ticketStatusById && typeof ticketStatusById === 'object' ? ticketStatusById : {};
  const byId = Object.create(null);
  for (const [k, v] of Object.entries(source)) byId[String(k).trim().toLowerCase()] = v;
  const knownIds = Object.keys(byId);

  const groups = { inFlight: [], rework: [], queued: [], live: [], unknown: [], unrecognised: [] };
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!pr || typeof pr !== 'object') continue;
    if (String(pr.state || 'OPEN').toUpperCase() !== 'OPEN') continue;
    const id = ticketIdFromPrBody(pr.body, knownIds);
    // Kept in the casing ClickUp gave it, so the message can quote it back.
    const raw = id ? String(byId[id] ?? '').trim() : '';
    const status = raw.toLowerCase();
    if (!id || !status) groups.unknown.push(pr.number);
    else if (IN_FLIGHT_STATUSES.includes(status)) groups.inFlight.push(pr.number);
    // The REAL status, not "queued means rework". Until task 86bbr1u9v there
    // was no other way to tell, and that guess is the bug this ticket closes.
    else if (status === loopStatuses.REWORK) groups.rework.push(pr.number);
    else if (status === loopStatuses.QUEUED) groups.queued.push(pr.number);
    else if (TERMINAL_STATUSES.includes(status)) groups.live.push(pr.number);
    // A status nobody anticipated: not counted, and NOT called "live" — that
    // label is a claim about the work having shipped, and a wrong claim here
    // is what this ticket exists to stop.
    else groups.unrecognised.push({ number: pr.number, status: raw });
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
  const notCounted = groups.rework.length + groups.queued.length + groups.live.length
    + groups.unknown.length + groups.unrecognised.length;

  // The split, always — a bare total is what hid the 2026-08-25 deadlock.
  const parts = [];
  // Rework leads the list, and is named as rework rather than as "queued",
  // because it is the number this ticket exists to stop hiding: half-finished
  // branches with review notes already on them.
  if (groups.rework.length) parts.push(`${groups.rework.length} in rework, waiting to be re-claimed (#${groups.rework.join(', #')})`);
  if (groups.queued.length) parts.push(`${groups.queued.length} queued with a PR already open (#${groups.queued.join(', #')})`);
  if (groups.live.length) parts.push(`${groups.live.length} whose ticket is already live (#${groups.live.join(', #')})`);
  if (groups.unknown.length) parts.push(`${groups.unknown.length} with no ticket found (#${groups.unknown.join(', #')})`);
  // Said separately from "no ticket found", because a ticket WAS found here
  // (review round 2). Reporting a missing ClickUp link that is not missing
  // sends the reader after drift that does not exist — and naming the status
  // is what turns this line into something actionable: either the status list
  // in this file is out of date, or someone typed a status by hand.
  if (groups.unrecognised.length) {
    parts.push(`${groups.unrecognised.length} whose ticket is in an unrecognised status (`
      + groups.unrecognised.map((u) => `#${u.number} — "${u.status}"`).join('; ') + ')');
  }
  const tail = notCounted ? `\n${notCounted} open PR(s) not counted: ${parts.join('; ')}.` : '';

  // The rework count goes in the HEADLINE of both messages, not only in the
  // tail (task 86bbr1u9v, acceptance criterion 3). "1 in flight, cap 5" while
  // five real branches sat open is the statement the Rework status exists to
  // end, and a number that appears only in a trailing clause is a number that
  // gets skimmed. Zero is stated too: a clause that vanishes when it is zero
  // tells the reader nothing about whether it was checked at all.
  const reworkPhrase = `${groups.rework.length} in rework`;

  if (inFlight >= limit) {
    return {
      claim: false, code: 3, openCount: countOpenPrs(prs), inFlight, rework: groups.rework.length, cap: limit, groups,
      message:
        `WIP cap reached — ${inFlight} in flight, cap ${limit} (${reworkPhrase}, which never counts). ` +
        `Not claiming; the merge side is the bottleneck.${tail}\n` +
        'This is a normal outcome, not a failure. Work queued beyond the merge rate does not ship sooner —\n' +
        `it goes stale, and every merge re-dates every open branch. Raise it with ${CAP_ENV} for an experiment.`,
    };
  }

  return {
    claim: true, code: 0, openCount: countOpenPrs(prs), inFlight, rework: groups.rework.length, cap: limit, groups,
    message: `${inFlight} in flight, cap ${limit} (${reworkPhrase}, which never counts) — room to claim another.${tail}`,
  };
}

/**
 * The ONE reading of "is the merge side full?", shared by every caller.
 *
 * WHY THIS EXISTS (2026-08-31, task 86bbq8br2). `wip-check` and
 * `next-interval` both answered that question, from the same module, and
 * reached OPPOSITE answers for eight months' worth of a morning: the claim
 * gate said "4 in flight, cap 5 — room to claim another" while the sleep timer
 * wrote "the work-in-progress cap is full" into the log and slept the maximum
 * hour, with 38 tickets claimable.
 *
 * The cause was not a wrong rule. It was two call sites: `next-interval` asked
 * GitHub for `number,state` and called `wipDecision` with no
 * `ticketStatusById`, so it took the documented conservative fallback — count
 * EVERY open PR — while `wip-check` asked for `body` too, read the queue, and
 * correctly excluded the four PRs whose tickets were `Queued` for rework. Both
 * behaved exactly as written. They were simply not the same reading.
 *
 * That is the failure mode `ticketIdFromPrBody` already carries a comment
 * about — two functions disagreeing about the same string — so the fix is
 * structural rather than a matching edit in two places: the reading happens
 * HERE, once, and a caller supplies only the two I/O calls.
 *
 * What is deliberately NOT shared is the direction each caller fails in, which
 * is a real difference and not duplication:
 *
 *   - `wip-check` fails OPEN. Refusing on a transient `gh` hiccup would stop
 *     all work; the cost of guessing wrong is some catch-up churn.
 *   - `next-interval` fails toward CAPPED. Its pass has already run and the
 *     only question is how long to sleep, so the safe direction is the long
 *     one.
 *
 * So this returns `determined:false` and says why, rather than choosing.
 *
 * @param {object} opts
 * @param {() => Promise<object[]|null>} opts.listOpenPrs  open PRs, each with
 *   `number`, `state` AND `body` — `classifyPrs` matches a PR to its ticket
 *   through the body, so a caller that omits it gets the statuses-unavailable
 *   fallback no matter how well the queue read went.
 * @param {() => Promise<object|null>} opts.readTicketStatuses  id -> status
 *   string for the Loop Queue, closed tickets INCLUDED (a zombie PR's ticket
 *   is `Live`, and without it the PR reports as "no ticket found").
 * @param {number} [opts.cap]
 * @returns {Promise<{determined:boolean, why:string|null, decision:object|null,
 *   statusesAvailable:boolean, queueFailure:string|null}>}
 */
async function probeCap({ listOpenPrs, readTicketStatuses, cap } = {}) {
  const limit = Number.isInteger(cap) ? cap : DEFAULT_WIP_CAP;

  let prs = null;
  let why = null;
  try {
    prs = typeof listOpenPrs === 'function' ? await listOpenPrs() : null;
  } catch (err) {
    why = String(err?.message || err);
  }
  // Not an array = not a count. There is no conservative reading of "we do not
  // know how many PRs are open", so the caller is told and decides.
  if (!Array.isArray(prs)) {
    return {
      determined: false,
      why: why || 'the open pull requests could not be listed',
      decision: null,
      statusesAvailable: false,
      queueFailure: null,
    };
  }

  let ticketStatusById;
  let queueFailure = null;
  try {
    const read = typeof readTicketStatuses === 'function' ? await readTicketStatuses() : null;
    if (read && typeof read === 'object' && Object.keys(read).length) ticketStatusById = read;
    else queueFailure = 'no tasks came back';
  } catch (err) {
    queueFailure = String(err?.message || err);
  }

  return {
    determined: true,
    why: null,
    // With ticketStatusById undefined this is the documented conservative
    // fallback — count every open PR — which is exactly what BOTH callers
    // want when the queue is unreadable. Unchanged behaviour, one code path.
    decision: wipDecision({ prs, cap: limit, ticketStatusById }),
    statusesAvailable: ticketStatusById !== undefined,
    queueFailure: ticketStatusById === undefined ? queueFailure : null,
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
  TERMINAL_STATUSES,
  resolveCap,
  ticketIdFromPrBody,
  classifyPrs,
  countOpenPrs,
  wipDecision,
  probeCap,
  undeterminedDecision,
};
