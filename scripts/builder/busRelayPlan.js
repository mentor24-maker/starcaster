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

/**
 * The comments on a ticket that are ACTUALLY the operator's word.
 *
 * Two conditions, and the second one is not optional (task 86bbqx2xe). The
 * loops post under Dane's own API token, so a card a machine wrote comes back
 * from ClickUp carrying HIS user id. Filtering on the id alone, which is what
 * this did until 2026-09-01, meant the relay read its own `ask` card as a
 * fresh answer from him: it relayed the card to the bus as "Dane replied" and
 * handed the ticket out of `Needs your input` ten minutes after it had been
 * escalated to him.
 *
 * A comment whose text could not be read is NOT counted as his. An unread
 * comment is an unknown, and the one thing it must never do is release an
 * escalation on the strength of something nobody looked at.
 */
function operatorComments(comments, { operatorId, isMachine } = {}) {
  if (!Array.isArray(comments)) return [];
  const machine = typeof isMachine === 'function' ? isMachine : () => false;
  return comments.filter((c) => {
    if (Number(c?.user?.id) !== Number(operatorId)) return false;
    return !machine(c.comment_text);
  });
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

/** What counts as delivered, given how each surface answered, and — when the
 *  answer is "not delivered" — the honest one-line reason WHY, which the
 *  caller prints verbatim.
 *
 *  That `why` is a decision, not a string: review finding, 2026-08-24. The
 *  caller used to hard-code "the party line failed and so did the receipt
 *  comment" for every undelivered case, including the case where no receipt
 *  was ever attempted. During a real outage that line appeared for every
 *  Agent Response comment and told the reader task comments were failing too
 *  — the opposite of the truth, and the opposite of what this very file's
 *  outage write-up says to conclude. Chat is still preferred; the fallback is
 *  a fallback, not a second channel. */
function deliveryVerdict({
  chatOk, handsBack, receiptAttempted, receiptPosted, receiptOk, receiptStatus,
} = {}) {
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
  if (!handsBack) {
    return {
      ok: false,
      via: 'none',
      why: receiptAttempted
        ? 'a receipt was written, but this watch hands nothing back — only the party line delivers here'
        : 'no receipt was attempted, because this watch hands nothing back — only the party line delivers here',
    };
  }

  if (receiptOk) return { ok: true, via: 'ticket' };
  if (!receiptAttempted) return { ok: false, via: 'none', why: 'no receipt was attempted' };
  if (!receiptPosted) {
    return { ok: false, via: 'none', why: `the fallback receipt comment also failed (HTTP ${receiptStatus == null ? '?' : receiptStatus})` };
  }
  return { ok: false, via: 'none', why: 'the fallback receipt reported HTTP 200 but could not be read back' };
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

function receiptText({ why, target, at } = {}) {
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

${receiptSignature(at)}`;
}

/** The receipt's own signature line, carrying the moment it was written.
 *
 *  The timestamp is not decoration — it is what makes ONE receipt findable.
 *  Review finding, 2026-08-24: the read-back searched every comment on the
 *  task for RECEIPT_FINGERPRINT, which is a constant, so a leftover receipt
 *  from an earlier outage "verified" a fresh POST that never stuck — the exact
 *  case the read-back was added to catch. */
function receiptSignature(at) {
  return at ? `(Automatic — bus-relay, ${at}.)` : '(Automatic — bus-relay.)';
}

/** Is this comment the receipt we just wrote — not merely *a* receipt?
 *
 *  Two independent handles, either of which is enough: the id ClickUp returned
 *  from the POST, and the ISO instant folded into the signature line. The id is
 *  exact; the timestamp survives a response shape that carries no id. Both are
 *  unique to this write, which a bare fingerprint never was. */
function isThisReceipt(comment, { id, at } = {}) {
  if (!comment) return false;
  if (id != null && String(comment.id) === String(id)) return true;
  const text = String(comment.comment_text || '');
  return Boolean(at && text.includes(RECEIPT_FINGERPRINT) && text.includes(receiptSignature(at)));
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
/* ------------------------------------------------------------------------ *
 * Breaking the party line on purpose (task 86bbjzg83, Dane's option B).
 *
 * PR #414 gave the relay a fallback: chat first, then a receipt comment on
 * the ticket, and the handback fires if either landed. What it could not give
 * was a way to WATCH that happen. The fallback only runs during a vendor
 * outage, which is the worst possible moment to discover a bug in it, and the
 * one command that sounds like a rehearsal — `bus-relay --dry-run` — returns
 * before deliverToBus() is ever called.
 *
 * So: a switch that fails every party-line write without sending a request,
 * and a dry-run that stops short-circuiting when it is on.
 * ------------------------------------------------------------------------ */

/** What a simulated party-line failure reports as its `why`. It says
 *  "simulated" in the string itself, deliberately: this text travels into the
 *  run report and into the receipt comment's body, and a reader finding it in
 *  a log six months from now must not mistake a rehearsal for an outage. */
const SIMULATED_BUS_WHY = 'HTTP 000 — SIMULATED by --simulate-bus-failure (no request was sent)';

/** May `--simulate-bus-failure` run? Only inside `--dry-run`.
 *
 *  Outside dry-run the switch would not be a rehearsal, it would be sabotage
 *  with permanent consequences: a forced chat failure sends the relay down the
 *  real fallback, which posts a real receipt comment saying the party line is
 *  unavailable and then writes the real, permanent dedup marker recording that
 *  the message was carried by the ticket. Chat would have been fine the whole
 *  time. The bus message is then dropped for good — the marker means "already
 *  relayed" forever — and the ticket's trail now lies about an outage that
 *  never happened.
 *
 *  That is the exact shape of loss #414 was written to remove, so the guard
 *  refuses rather than warns. Returns { ok, why } — `why` is printed verbatim.
 */
function simulationGuard({ simulate, dryRun } = {}) {
  if (!simulate) return { ok: true, why: '' };
  if (dryRun) return { ok: true, why: '' };
  return {
    ok: false,
    why: [
      '--simulate-bus-failure requires --dry-run.',
      '',
      'Without it this is not a rehearsal. Forcing the party line to fail sends the',
      'relay down its real fallback, which would post a real receipt comment claiming',
      'an outage that is not happening, then write the permanent "already relayed"',
      'marker against it — dropping the real bus message for good and leaving a trail',
      'that lies. Nothing was run.',
      '',
      'Try:  npm run clickup -- bus-relay --dry-run --simulate-bus-failure',
    ].join('\n'),
  };
}

/** One line per relayed comment in a simulated pass, so the rehearsal is
 *  readable rather than inferred. `verdict` is deliveryVerdict()'s own answer
 *  — this only renders it. `target` is the status the watch would move to, or
 *  null on a notify-only watch.
 *
 *  The failure explanation prefers `reason` (deliveryVerdict's account of why
 *  nothing was delivered) over `why` (the chat failure). Keeping those two
 *  apart was a review finding on #414: printing the chat error alone says
 *  "HTTP 000" and leaves out the part that actually explains the outcome —
 *  that this watch hands nothing back, so a receipt would deliver nothing. */
function simulationLine({ verdict, target } = {}) {
  const v = verdict || {};
  if (v.ok && v.via === 'ticket') {
    return `  SIMULATION — party line down: delivered by receipt on the ticket; hand-back to "${target}" WOULD fire`;
  }
  if (v.ok && v.via === 'chat') {
    // Unreachable while simulating (chat always fails), but a verdict of
    // "chat" here would mean the simulation did not take effect — say so
    // rather than printing a success line that reads as a passing rehearsal.
    return '  SIMULATION — reported delivery via chat, which the simulation should have made impossible. Treat this run as INVALID.';
  }
  const explain = v.reason || v.why;
  const why = explain ? ` — ${explain}` : '';
  return `  SIMULATION — party line down: NOT delivered${why}; nothing marked relayed, no hand-back`;
}

function busFailureBucket({ delivered, cosmetic } = {}) {
  return delivered || cosmetic ? 'skipped' : 'unchecked';
}

module.exports = {
  operatorComments,
  defaultWatches,
  handbackTarget,
  mergeEnabled,
  BUS_RELAY_MARKER,
  RECEIPT_FINGERPRINT,
  receiptSignature,
  isThisReceipt,
  deliveryVerdict,
  relayMarkerText,
  receiptText,
  busFailureBucket,
  SIMULATED_BUS_WHY,
  simulationGuard,
  simulationLine,
};
