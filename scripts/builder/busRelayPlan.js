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
    },
    {
      list: loopQueueList,
      label: 'Loop Queue',
      statuses: ['needs your input', 'ready to launch'],
      // An answer on "needs your input" returns the ticket to the machine.
      // "ready to launch" is deliberately absent: that status waits on a
      // MERGE, not a reply — a comment there is relayed but moves nothing.
      handback: { 'needs your input': 'Queued' },
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

module.exports = { defaultWatches, handbackTarget };
