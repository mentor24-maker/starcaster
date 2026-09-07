'use strict';

const { BANNER_LABEL } = require('./operatorCard.js');

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

/**
 * The standing watch list. Ids come in as parameters (they live in env /
 * constants at the call site) so this table stays a pure description.
 *
 * ORDER IS LOAD-BEARING, AND THE MERGE-CAPABLE LIST GOES FIRST (2026-09-03,
 * task 86bbugakw). The relay spends one request per open ticket to read its
 * comments, and ClickUp allows ~100 per minute across the whole company's
 * token. Agent Response held 92 open tickets and is never drained, so with it
 * first the allowance was gone before the sweep reached the Loop Queue — the
 * only list carrying `merge: true`.
 *
 * The relay then failed every 10-minute pass for SIXTEEN HOURS: `requests this
 * pass: 97`, then `100`, then HTTP 429. Merge-on-comment was dead the whole
 * time (Dane commented `merge` on 86bbjt1b4 at 11:17am and nothing acted on
 * it), Lane A halted fail-safe on every pass, and with nothing merging the WIP
 * cap filled and the build loop declined every pass saying "the merge side is
 * the bottleneck". Open work went 38 -> 63 in seven days with every gate green.
 *
 * Reordering does not FIX the budget — the incremental scan (86bbugbay), the
 * 429 retry (86bbugbym) and the shared budget (86bbugcdb) do that. It makes the
 * failure land on the list that can afford it: a notify-only sweep that stops
 * short delays a bus message, where a merge sweep that stops short strands
 * shipped work behind an unread comment. Those are not the same cost, so when
 * the budget runs out it should run out on Agent Response.
 */
function defaultWatches({ agentResponseList, loopQueueList }) {
  // Loop Queue FIRST — see the note above. `mergeEnabled` is the property that
  // matters, not the label: whichever watch can merge must not be last.
  return [
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
    {
      list: agentResponseList,
      label: 'Agent Response',
      statuses: ['pending response', 'responding'],
      // Notify-only, as it has been since PR #340.
      handback: {},
      merge: false,
    },
  ];
}

/**
 * WAS THIS PASS COMPLETE, AND IF NOT, WHICH LIST DID IT NOT FINISH?
 * (2026-09-03, task 86bbugdv9.)
 *
 * The relay already reported what it could not check — but it reported it as
 * TICKETS, and that is the wrong unit. On 2026-09-03 a pass that had entirely
 * failed to sweep the merge-capable list printed this:
 *
 *     bus-relay: 0 relayed, 0 handed back, 0 merged, ... 3 could not be checked.
 *     Could not fully verify:
 *       - 86bbjt1b4 (Panel sweep 8/15...): could not read comments
 *
 * Three ticket ids read as three minor gaps. The truth was "the merge lane did
 * not run", and one of those three ids was carrying Dane's own `merge` command,
 * described as an unread comment rather than as an unperformed merge. The pass
 * happened sixteen hours in a row and nobody could tell from its own output.
 *
 * The precedent is `npm run throughput`, which gives one of four verdicts and
 * never two, and says UNKNOWN when it could not take a reading. CLAUDE.md
 * states the rule it embodies: "alive but useless" never renders as healthy,
 * and neither does "could not tell". This is that rule at LIST granularity.
 *
 * Pure, so a test can reach every branch without a network.
 *
 * `sweeps` is one entry per watch: { label, merge, complete, why }.
 */
function sweepVerdict(sweeps) {
  const list = Array.isArray(sweeps) ? sweeps : [];
  if (!list.length) {
    // No sweep at all is not a clean pass. It is the absence of evidence, and
    // the whole point of this function is that those must not look alike.
    return {
      complete: false,
      mergeLaneRan: false,
      exitCode: 1,
      line: 'INCOMPLETE — no list was swept at all, so nothing can be concluded about either one.',
    };
  }
  const unfinished = list.filter((s) => !s.complete);
  const mergeSweep = list.find((s) => s.merge);
  const mergeLaneRan = Boolean(mergeSweep && mergeSweep.complete);

  if (!unfinished.length) {
    return {
      complete: true,
      mergeLaneRan,
      exitCode: 0,
      line: `COMPLETE — swept ${list.length} list(s) in full: ${list.map((s) => s.label).join(', ')}.`,
    };
  }

  const named = unfinished
    .map((s) => `${s.label}${s.merge ? ' (the merge-capable list)' : ''}${s.why ? ` — ${s.why}` : ''}`)
    .join('; ');

  // The merge-capable list gets its own sentence, in the words that say what it
  // COSTS rather than what failed. "Could not read comments" is a mechanism; a
  // merge command going unread is the consequence, and the consequence is the
  // thing a reader needs at 2am.
  const mergeWarning = unfinished.some((s) => s.merge)
    ? ' Merge commands on that list were NOT read this pass, so an authorization may be sitting unacted on.'
    : '';

  return {
    complete: false,
    mergeLaneRan,
    exitCode: 1,
    line: `INCOMPLETE — did not finish ${named}.${mergeWarning}`,
  };
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

/**
 * THE ESCALATION CARD — the comment that IS the question.
 *
 * `ask` is the only way a ticket reaches `Needs your input` (a bare `status`
 * move refuses on its own), and every card it writes ends in the banner
 * `operatorCard.js` draws. That banner is therefore the one durable mark on a
 * ticket saying "the machine asked something here", which is what lets a later
 * pass order the trail: anything of Dane's AFTER the newest card is an answer
 * to it, and anything before it belonged to an earlier round.
 *
 * Matched on the label with its trailing space trimmed off, because the label
 * is drawn with one and a round trip through ClickUp is not guaranteed to keep
 * it. The `#` rule around it is deliberately NOT part of the test: ClickUp
 * escapes markdown punctuation on the way back out, so a rule can return as
 * `\#\#\#...` and a matcher reading it would fail on exactly the tickets it
 * was written for.
 *
 * THIS IS THE BANNER TEST AND NOTHING ELSE — authorship is a SEPARATE question
 * and the caller owes it (2026-09-07, round 1 review). The banner is just text,
 * so a comment of Dane's that QUOTES the card above his reply matched here, and
 * the quote is newer than the card it quotes. `answerAwaitingHandback` then
 * anchored the question on HIS OWN comment, found nothing of his after it, and
 * returned `none`: the relay handed nothing back — a regression against the old
 * fresh-only rule, which would have moved it — while `lib/staleAnswer.js` filed
 * the same ticket as healthy. Stranded, with the watchdog saying all-clear.
 *
 * So `answerAwaitingHandback` requires a card to be MACHINE-WRITTEN, through
 * the same `isMachine` predicate it filters his answers with. One predicate,
 * asked once, which makes the two sets disjoint by construction: a comment can
 * never be both the question and the answer to it.
 */
const ESCALATION_BANNER = BANNER_LABEL.trim();

function isEscalationCard(text) {
  if (text == null) return false;
  return String(text).includes(ESCALATION_BANNER);
}

/** Epoch ms of a ClickUp comment, or 0 when it has no usable date. */
function commentAt(comment) {
  const at = Number(comment && comment.date);
  return Number.isFinite(at) && at > 0 ? at : 0;
}

/**
 * IS AN ANSWER FROM DANE SITTING ON THIS TICKET WITH NOTHING HAVING MOVED?
 *
 * WHY THIS EXISTS (2026-09-06, task 86bbvr4w3). The hand-back used to fire on
 * ONE trigger and one only: a comment relayed to the party line *during this
 * pass*. That trigger is not repeatable. Relaying writes a permanent dedup
 * marker, so every later pass reads the comment as already relayed, computes
 * `fresh = 0`, and hands nothing back — for ever.
 *
 * On 2026-09-06 the 09:46 pass relayed Dane's answer on 86bbv8nvy, ran out of
 * ClickUp request budget between the relay and the move, and reported the
 * failure honestly into a bus post that the same rate limit then skipped. The
 * ticket was stranded in `Needs your input` permanently: the only event that
 * could release it had already happened and could never happen again. He found
 * it himself three and a half hours later.
 *
 * So the trigger moves from "what happened in this pass" to "what is true of
 * the ticket" — state that is re-derivable on every later pass, which is the
 * whole of the fix. Two facts, both read off the trail:
 *
 *   1. The newest escalation card is the QUESTION. Dane's newest comment after
 *      it is the ANSWER. Nothing before the card can release the ticket,
 *      which is what stops an answer from an earlier round releasing a fresh
 *      escalation if a marker write is ever lost.
 *   2. That answer must have been DELIVERED — relayed to the party line, or
 *      receipted on the ticket. That gate is unchanged and not weakened: a
 *      ticket must never move on an answer nobody ever got. What changes is
 *      that "delivered" is now read from the durable marker as well as from
 *      this pass's own success.
 *
 * NO CARD MEANS NO ANSWER TO THE QUESTION — `no-question`, never `answered`.
 * A ticket parked by hand, or one whose card has fallen off the newest page of
 * comments, gives no way to tell an answer from something he said last week,
 * and handing such a ticket back on the strength of an old comment is a worse
 * failure than the one being fixed. The caller keeps the old fresh-only
 * behaviour there, and `lib/staleAnswer.js` reports it as CANNOT TELL.
 *
 * @param comments   the ticket's comments (one page is enough — the card and
 *                   the answer are both recent by construction)
 * @param operatorId Dane's ClickUp user id
 * @param isMachine  (text) => boolean, so a machine card under his token is
 *                   never mistaken for his word (see operatorComments)
 * @param delivered  optional (comment) => boolean. Omit it to ask only
 *                   "has he answered?", which is what the report needs.
 * @param handled    optional (comment) => boolean: does this answer already
 *                   carry the marker a COMPLETED hand-back writes? An answer
 *                   that does is spent, so a ticket re-parked by hand is left
 *                   where he put it.
 * @returns { state, answer, answerAt, questionAt, delivered }
 *          state: 'answered' | 'handled' | 'none' | 'no-question'
 *          delivered: true/false, or null when no test was supplied
 */
function answerAwaitingHandback({ comments, operatorId, isMachine, delivered, handled } = {}) {
  const all = Array.isArray(comments) ? comments : [];
  // A card must be MACHINE-WRITTEN as well as carry the banner — the same
  // predicate `operatorComments` filters his answers with, so no comment can
  // be both the question and an answer to it. Without `isMachine` nothing can
  // be a card at all, which falls through to `no-question`: the old fresh-only
  // rule at the relay and CANNOT TELL in the report, both safe.
  const machine = typeof isMachine === 'function' ? isMachine : () => false;
  const questionAt = all
    .filter((c) => isEscalationCard(c && c.comment_text) && machine(c && c.comment_text))
    .reduce((newest, c) => Math.max(newest, commentAt(c)), 0);

  if (!questionAt) {
    return { state: 'no-question', answer: null, answerAt: 0, questionAt: 0, delivered: null };
  }

  const answers = operatorComments(all, { operatorId, isMachine })
    .filter((c) => commentAt(c) > questionAt);

  if (!answers.length) {
    return { state: 'none', answer: null, answerAt: 0, questionAt, delivered: null };
  }

  // His NEWEST word after the question. Newest rather than oldest because the
  // hand-back is a move made on the strength of what he last said: releasing
  // the ticket while his most recent sentence had reached nobody is the very
  // thing the delivery gate exists to prevent.
  const answer = answers.reduce((newest, c) => (commentAt(c) > commentAt(newest) ? c : newest));
  // ALREADY ACTED ON, so this ticket is parked on purpose (2026-09-07, round 1
  // review). The authorization above is a property of the ticket with no memory
  // of the move ever having been made, so a ticket answered, released, and then
  // re-parked in `Needs your input` BY HAND still satisfies "delivered answer
  // newer than the newest card" — and the relay would move it straight back out
  // and strip his assignment inside ten minutes. The old fresh-only rule left
  // such a ticket alone, and `Needs your input` is a status only Dane may be
  // taken out of, on the strength of a comment he wrote FOR IT.
  //
  // So a completed hand-back writes its own durable marker on the answer, and
  // an answer carrying one is spent: `handled`, never `answered`. If that write
  // fails the behaviour degrades to exactly what it was before this paragraph —
  // it can cost a re-release, never a stranding.
  if (typeof handled === 'function' && handled(answer)) {
    return { state: 'handled', answer, answerAt: commentAt(answer), questionAt, delivered: null };
  }
  return {
    state: 'answered',
    answer,
    answerAt: commentAt(answer),
    questionAt,
    delivered: typeof delivered === 'function' ? Boolean(delivered(answer)) : null,
  };
}

/** Where a task should be moved once its operator answer has been delivered —
 *  or null for "do not touch it".
 *
 *  `authorized` used to be the count of comments relayed THIS RUN, which made
 *  the move a one-shot event that a crash could destroy for good (see
 *  `answerAwaitingHandback` for the incident). It is now a durable verdict:
 *  "there is a delivered answer to the newest question, and the ticket is
 *  still parked". Falsy means do nothing, exactly as before — the doctrine
 *  checkpoint that no loop takes a ticket out of `Needs your input` without
 *  his word is unchanged; only its evidence is now re-readable. */
function handbackTarget(watch, taskStatus, authorized) {
  if (!authorized) return null;
  const byStatus = watch.handback || {};
  return byStatus[String(taskStatus || '').toLowerCase()] || null;
}

/**
 * THE FAILED HAND-BACK, WRITTEN WHERE THE NEXT PASS CAN SEE IT.
 *
 * The retry above does not depend on this note — it is derived from the trail,
 * which is the point of criterion 4: a bus post that the rate limit swallows
 * must not be the only record. This is the evidence half. A reader landing on
 * the ticket cold sees why it did not move and when, rather than an answer
 * followed by silence.
 *
 * Deliberately NOT prefixed `[bus-relay]`: that exact prefix is the dedup
 * marker the relay reads as "this comment was already relayed", and a note
 * that accidentally claimed delivery would drop a real bus message for good.
 * `[bus-relay-handback]` shares the family the machine-comment tag matches
 * and none of the prefix the dedup check reads.
 */
const HANDBACK_FAILURE_MARKER = '[bus-relay-handback]';

/**
 * THE COMPLETED HAND-BACK, WRITTEN WHERE THE NEXT PASS CAN SEE IT.
 *
 * The other half of the failure note above, and the reason both exist: this
 * whole fix decides what to do from the TICKET's trail, so anything the trail
 * cannot say is a thing no later pass can know. "The move already happened" is
 * one of those, and without it a hand-parked ticket is dragged back out of
 * `Needs your input` within ten minutes (see `answerAwaitingHandback`).
 *
 * `[bus-relay-handback-done]`, distinct from BOTH neighbours by construction:
 * it does not start with `[bus-relay]`, the dedup prefix that would falsely
 * claim delivery and drop a real bus message, and it does not start with
 * `[bus-relay-handback]` either — the failure marker ends in `]` where this
 * one carries `-done`, so `startsWith` tells them apart and a completed move
 * can never read as a failed one.
 */
const HANDBACK_DONE_MARKER = '[bus-relay-handback-done]';

function handbackDoneText({ target, at } = {}) {
  return `${HANDBACK_DONE_MARKER} Your answer was delivered and this ticket was returned to `
    + `"${target}", so it is back with the machines.\n\n`
    + 'This note is what stops a later pass acting on the same answer twice — park the ticket here '
    + `again and it will be left where you put it.${at ? ` (Automatic — bus-relay, ${at}.)` : ''}`;
}

/**
 * THE THREE THINGS A REPLY THREAD CAN SAY, read in ONE place.
 *
 * The relay reads these off replies it already has in hand; `stale_answer.mjs`
 * reads them off a fetch of its own. Two `startsWith` calls written twice are
 * two definitions that drift silently in the direction of "nothing found",
 * which reads as healthy — so they live here and both callers ask.
 */
function repliesSay(replies, marker) {
  return (Array.isArray(replies) ? replies : [])
    .some((r) => String((r && r.comment_text) || '').startsWith(marker));
}

/** Was the comment this thread hangs off relayed to the party line? */
const repliesShowRelayed = (replies) => repliesSay(replies, BUS_RELAY_MARKER);

/** Did a hand-back on this answer already COMPLETE? */
const repliesShowHandbackDone = (replies) => repliesSay(replies, HANDBACK_DONE_MARKER);

/** Has a failed hand-back on this answer already been noted on the ticket? */
const repliesShowHandbackFailure = (replies) => repliesSay(replies, HANDBACK_FAILURE_MARKER);

function handbackFailureText({ target, status, why, at } = {}) {
  const where = status ? `"${status}"` : 'the status it was already in';
  return `${HANDBACK_FAILURE_MARKER} Your answer was delivered, but returning this ticket to `
    + `"${target}" FAILED (${why || 'reason unknown'}), so it is still parked in ${where}.\n\n`
    + 'Nothing is lost: the next relay pass re-derives this from the trail above and tries the move '
    + `again.${at ? ` (Automatic — bus-relay, ${at}.)` : ''}`;
}

/** May this watch act on a merge command? Ad-hoc `--list` runs are
 *  notify-only by construction (see clickup_direct.mjs), so a hand-typed
 *  list id can never merge anything — same reasoning as handback. */
/** One relay interval. The overlap must be at least as long as the gap
 *  between passes, or a comment can land in the blind spot between them. */
const DEFAULT_OVERLAP_MS = 600 * 1000;

/**
 * WHICH TICKETS COST A COMMENT READ THIS PASS (2026-09-03, task 86bbugbay).
 *
 * The relay's cost is not the list fetch — that is one request per 100
 * tickets. It is the per-ticket comment read, and the reply read behind each
 * operator comment. With 104 open tickets on Agent Response a pass spent
 * 114-115 requests against ClickUp's ~100-per-minute allowance, so every pass
 * was rate-limited partway through and finished INCOMPLETE. An incomplete
 * pass cannot run Lane A (standing condition 4), so the auto-merge lane
 * halted 271 passes in a row and had never once merged. The starvation was
 * the cause; the refusal was correct.
 *
 * So: a ticket nobody has touched since the last completed pass cannot have a
 * new comment on it. Measured 2026-09-03 on task 86bbqpwfa — a task's
 * `date_updated` equals its newest comment's timestamp to the millisecond, so
 * recency is a sound proxy for "might have something to say".
 *
 * THE NON-GOAL THE TICKET ASKED US TO DECIDE, decided here and deliberately
 * NOT applied to every watch: a MERGE-CAPABLE watch reads every ticket in its
 * statuses regardless of recency. Three things there are re-decided from
 * scratch on every pass and would break if a quiet ticket went unread:
 *
 *   1. A refused merge command is re-decided every pass (task 86bbjt18r) — a
 *      refusal is a snapshot of a moment, not a verdict. PR #558 sat refused
 *      for exactly this reason on 2026-09-03: CI had not finished inside the
 *      merge step's wait. The ticket then goes quiet, and a recency filter
 *      would mean the retry that was promised never happens.
 *   2. Lane A's candidates are Ready-to-launch tickets that must be announced,
 *      left an hour and then merged. Going quiet for an hour is the NORMAL
 *      path through that lane, not a reason to stop looking at it.
 *   3. The auto-merge kill switch may have been set on any ticket.
 *
 * That watch is small — the Loop Queue at 'needs your input' and 'ready to
 * launch' held one open ticket on the day this was written, against Agent
 * Response's 104. The saving comes from the big notify-only list, and the
 * correctness comes from not touching the small merge-capable one.
 */
function ticketsToRead({ watch, tasks, mark, overlapMs = DEFAULT_OVERLAP_MS }) {
  const all = Array.isArray(tasks) ? tasks : [];
  // A merge-capable watch is never filtered — see 1-3 above.
  if (mergeEnabled(watch)) {
    return { read: all, skipped: 0, reason: 'merge-capable watch — every ticket read regardless of recency' };
  }
  // Cold start: no mark, so nothing is known to be unchanged. Read everything
  // and SAY so, rather than relaying nothing and looking healthy.
  if (!Number.isFinite(mark) || mark <= 0) {
    return { read: all, skipped: 0, reason: 'no stored high-water mark (cold start) — reading every ticket' };
  }
  // The overlap is a correctness requirement, not a safety margin. A comment
  // posted WHILE a pass is running, on a ticket that pass had already read,
  // is older than the mark the pass goes on to write — so a cutoff of exactly
  // `mark` would skip it forever. One pass interval back covers it.
  const cutoff = mark - overlapMs;
  const read = all.filter((t) => Number(t.date_updated) > cutoff);
  return {
    read,
    skipped: all.length - read.length,
    reason: `updated since ${new Date(cutoff).toISOString()} (mark minus a ${Math.round(overlapMs / 1000)}s overlap)`,
  };
}

/**
 * The mark to store for a list after a pass, or null to leave the old one.
 *
 * A partial pass must NOT advance the mark: the tickets it never reached
 * would fall behind the cutoff and their comments would be skipped forever.
 * That is the same "silently relaying nothing" failure the cold-start branch
 * above guards, arrived at from the other direction.
 *
 * The stamp is the time the pass STARTED, never the time it finished. A pass
 * takes tens of seconds; a comment posted during it would sit before a
 * finish-time mark and be missed on the next pass — the overlap would have to
 * absorb it, and an overlap doing two jobs hides when one of them is wrong.
 */
function markAfterPass({ complete, startedAt, previous }) {
  if (!complete) return { mark: previous ?? null, advanced: false, why: 'the pass did not complete this list — the mark stays where it was so the next pass re-reads the window' };
  return { mark: startedAt, advanced: true, why: 'the list was read in full' };
}

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
  sweepVerdict,
  ESCALATION_BANNER,
  isEscalationCard,
  commentAt,
  answerAwaitingHandback,
  handbackTarget,
  HANDBACK_FAILURE_MARKER,
  handbackFailureText,
  HANDBACK_DONE_MARKER,
  handbackDoneText,
  repliesShowRelayed,
  repliesShowHandbackDone,
  repliesShowHandbackFailure,
  mergeEnabled,
  ticketsToRead,
  markAfterPass,
  DEFAULT_OVERLAP_MS,
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
