'use strict';

/**
 * bus-relay's decision table: which lists it watches, and what a fresh
 * operator comment DOES on each one. Pulled out of clickup_direct.mjs so the
 * rules are testable without a network.
 *
 * COMMENT-DRIVEN HANDBACK (2026-08-19, task 86bbh9g7k). Before this, a
 * comment from the operator on a "Needs your input" Loop Queue ticket
 * changed nothing: the relay only watched the Agent Response list, and even
 * where it watched, it only *notified* — no status moved, so no loop ever
 * picked the answer up. Both halves bit on 2026-08-19: two answered tickets
 * sat parked for hours until a human session went looking.
 *
 * The doctrine rule "no loop ever takes a ticket out of Needs your input"
 * still holds — that rule exists so a loop cannot quietly reclaim its OWN
 * escalation. Here the trigger is a fresh comment from the operator himself:
 * the comment is the release, the relay is his hands. No fresh comment, no
 * move — handbackTarget() below is that rule in code.
 */

/** The standing watch list. Ids come in as parameters (they live in env /
 *  constants at the call site) so this table stays a pure description. */
function defaultWatches({ agentResponseList, loopQueueList }) {
  return [
    {
      list: agentResponseList,
      label: 'Agent Response',
      statuses: ['pending response', 'responding'],
      // Notify-only, as it has been since PR #340.
      handback: {},
      merge: false,
    },
    {
      list: loopQueueList,
      label: 'Loop Queue',
      statuses: ['needs your input', 'ready to launch'],
      // An answer on "needs your input" returns the ticket to the machine.
      // "ready to launch" is deliberately absent from the handback table:
      // that status waits on a MERGE, not a reply, so no comment moves it
      // by handback. Since 2026-08-21 (task 86bbjd5nn) a comment there CAN
      // still end the wait — but only by being an explicit merge command
      // from the operator himself, and only through the merge path below,
      // which checks the PR is open, reviewed and green first.
      handback: { 'needs your input': 'Queued' },
      merge: true,
    },
  ];
}

/** Where a task should be moved after its fresh operator comments were
 *  relayed — or null for "do not touch it". freshRelayed is the count of
 *  comments relayed THIS run: zero means nothing new from the operator,
 *  and a task with nothing new is never moved, ever. */
function handbackTarget(watch, taskStatus, freshRelayed) {
  if (!freshRelayed) return null;
  const byStatus = watch.handback || {};
  return byStatus[String(taskStatus || '').toLowerCase()] || null;
}

/** May this watch act on a merge command? Ad-hoc `--list` runs are
 *  notify-only by construction (see clickup_direct.mjs), so a hand-typed
 *  list id can never merge anything — same reasoning as handback. */
function mergeEnabled(watch) {
  return Boolean(watch && watch.merge);
}

/**
 * DELIVERY (2026-08-23, task 86bbjxew2). The handback gate above is right:
 * a ticket must not move on an answer that was never delivered. But it used
 * to be wired to a single chat POST, and on 2026-08-23 every chat write in
 * the workspace returned HTTP 400 for sixteen hours. The answers themselves
 * were never at risk — they are comments on the tickets, which is where the
 * loops read them from — but the RECEIPT was unavailable, so nothing moved:
 * 23 comments and 5 handbacks parked behind one surface.
 *
 * So the gate stays and the target moves. "Delivered" now means the message
 * reached somewhere durable: the party line, or failing that a short receipt
 * comment on the ticket the message concerns. Task comments were the most
 * reliable write in this API throughout that outage.
 */

/** The dedup marker prefix. Exported so the text a pass WRITES and the
 *  "already relayed" check that READS it can never drift apart. */
const BUS_RELAY_MARKER = '[bus-relay]';

/** What counts as delivered, given how each surface answered. Chat is still
 *  preferred — the fallback is a fallback, not a second channel. */
function deliveryVerdict({ chatOk, receiptOk, handsBack } = {}) {
  if (chatOk) return { ok: true, via: 'chat' };

  // A ticket receipt only DELIVERS on a watch that hands the ticket back.
  //
  // Review finding, 2026-08-23, and it is the one that matters. Of the three
  // watches, only one has a handback target:
  //
  //   Agent Response, fresh comment   -> no target
  //   Loop Queue, "ready to launch"   -> no target
  //   Loop Queue, "needs your input"  -> Queued        <- the only one
  //
  // The ticket's own reasoning for the fallback — "the answer is already a
  // comment on the ticket, which is where every loop reads it from" — is only
  // true for that last one. On the other two NOTHING reads the ticket: the
  // party line IS the delivery. Counting a receipt there would post a note to
  // Dane on a ticket he is already looking at, write the permanent dedup
  // marker, and drop the bus message for good once chat recovered.
  //
  // Before this feature those two cases retried every pass until the bus took
  // them. Turning a self-healing retry into silent permanent loss is the exact
  // shape of bug this ticket exists to remove, so: no handback, no delivery.
  if (receiptOk && handsBack) return { ok: true, via: 'ticket' };
  if (receiptOk) return { ok: false, via: 'none', why: 'receipted, but this watch hands nothing back — only the party line delivers here' };
  return { ok: false, via: 'none' };
}

/** The dedup marker's text. Same PREFIX whichever surface was used, so the
 *  existing "already relayed" check still matches either one; the words
 *  after it differ so a human reading the trail later can see which surface
 *  carried the message. Nothing delivered means nothing to mark — null, and
 *  the comment is retried next pass. */
function relayMarkerText({ via, channel, at } = {}) {
  if (via === 'chat') return `${BUS_RELAY_MARKER} sent to channel ${channel} at ${at}`;
  if (via === 'ticket') return `${BUS_RELAY_MARKER} chat unavailable, receipted on the ticket at ${at}`;
  return null;
}

/** The fallback comment itself. A RECEIPT, not a re-quote: Dane's words are
 *  already on this ticket, one comment up. What is missing without this is
 *  the acknowledgement that they were read and acted on. */
const RECEIPT_FINGERPRINT = 'Your answer was read and picked up.';

function receiptText({ why, target } = {}) {
  // Past tense for what is certain, present for what is under way — never the
  // future. Review finding, 2026-08-23: the first version announced "this
  // ticket is going back to Queued" BEFORE the move was attempted, so a failed
  // PUT left the ticket sitting in "Needs your input" carrying a comment
  // saying otherwise. The failure was always reported in `unchecked`, but the
  // untrue note stayed on the ticket.
  //
  // A receipt is only ever written on a watch that hands the ticket back, so
  // `target` is always set by the time this is called.
  const move = target ? ` This ticket is being returned to ${target}.` : '';
  return `${RECEIPT_FINGERPRINT}${move} The party line is unavailable right now (${why || 'reason unknown'}), so this note is the record instead.

(Automatic — bus-relay.)`;
}

/**
 * Where a failed bus post gets reported. Two buckets, and the difference is
 * whether anybody was actually told:
 *
 *   'skipped'   — cosmetic. The message reached a durable surface anyway, or
 *                 (merge step) its real explanation was already written onto
 *                 the ticket by the caller. Gets its own summary heading and
 *                 does NOT fail the run.
 *   'unchecked' — nobody was told. Still "could not fully verify", still
 *                 exits 1. The gate is re-pointed, never weakened.
 */
function busFailureBucket({ delivered, cosmetic } = {}) {
  return delivered || cosmetic ? 'skipped' : 'unchecked';
}

module.exports = {
  defaultWatches,
  handbackTarget,
  mergeEnabled,
  BUS_RELAY_MARKER,
  RECEIPT_FINGERPRINT,
  deliveryVerdict,
  relayMarkerText,
  receiptText,
  busFailureBucket,
};
