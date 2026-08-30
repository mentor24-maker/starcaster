'use strict';

/**
 * The "Loop note" — one plain-language line, in the operator's words, saying
 * what is happening to a ticket and what happens next. Stamped onto a ClickUp
 * text custom field by the loop tooling at each transition, so the Loop Queue
 * answers "is the pipeline alive, when did it last move, what's next" at a
 * glance — questions the Status column alone never did (2026-08-20).
 *
 * Pure and time-injected on purpose: the caller passes the clock string, so
 * every wording is testable without a clock or a network. The register is
 * fixed here (one place) so two callers cannot phrase the same transition two
 * ways.
 */

const { LOOP_NOTE_MAX, truncateReason } = require('./sendBackRounds.js');

/**
 * The send-back line (task 86bbmg2tq, 2026-08-25). Until then every send-back
 * read the same — "returned to the line with notes for the builder" — so a
 * ticket on its third round was indistinguishable on the board from one being
 * handed back for the first time. That is the ambiguity Dane spotted from the
 * UI and the WIP cap spotted by jamming on it. The round comes first and is
 * never truncated; the reason is one short clause, cut to fit if it has to be,
 * because the board is a glance and the ticket holds the full story.
 */
function sentBackNote({ at, round, reason }) {
  const clause = String(reason || '').trim() || 'returned to the line with notes for the builder';
  const shell = `↩ round ${round} —  (${at})`;
  return `↩ round ${round} — ${truncateReason(clause, LOOP_NOTE_MAX - shell.length)} (${at})`;
}

/**
 * The stem of the review-claim note, exported because it is not only a
 * wording: the pipeline drain identifies a review pass that is ACTUALLY
 * RUNNING by this exact text (pipelinePause.classifyTicket), since "In review"
 * is a resting status as well as a working one. Two copies of it would mean a
 * live review going invisible to the drain the first time either was reworded.
 */
const REVIEW_CLAIM_NOTE = '\u{1F50D} being checked';

const TRANSITIONS = {
  claimed:   ({ at }) => `🔨 building — claimed ${at}`,
  'pr-open': ({ at, pr }) => `🔀 PR #${pr} open — waiting for a review pass (${at})`,
  // A review takes many minutes and, until 2026-08-22, left no trace while it
  // ran — so two review passes checked PR #362 at the same time and the slower
  // one overwrote the faster one's verdict. This note IS the visible claim: it
  // carries the date as well as the clock, because "is that review still
  // running or did it die?" cannot be answered by a time of day alone.
  'review-started': ({ at }) => `${REVIEW_CLAIM_NOTE} — a review pass started ${at}`,
  verified:  ({ at }) => `👀 verified — waiting on Dane to say "merge" (${at})`,
  'sent-back': sentBackNote,
  merged:    ({ at }) => `✅ live ${at}`,
  escalated: ({ at }) => `🙋 needs Dane — a question is waiting (${at})`,
};

/** Compose the note for one transition. Throws on an unknown transition — a
 *  silently-wrong note is worse than a loud failure (DOCTRINE §2.1). */
function loopNote(transition, opts = {}) {
  const make = TRANSITIONS[transition];
  if (!make) {
    throw new Error(`unknown loop-note transition "${transition}" — known: ${Object.keys(TRANSITIONS).join(', ')}`);
  }
  if (transition === 'pr-open' && !opts.pr) {
    throw new Error('loop-note "pr-open" needs a PR number (--pr)');
  }
  // A send-back with no round is the old, ambiguous line coming back. It is
  // refused rather than defaulted: the round is derived from the ticket's own
  // comments by the caller, and a derivation that quietly failed must not
  // render as a note that merely looks a bit less informative.
  if (transition === 'sent-back' && !(Number(opts.round) > 0)) {
    throw new Error('loop-note "sent-back" needs the round number (--round), counted from the ticket\'s send-back verdicts');
  }
  return make({
    at: String(opts.at || '').trim() || 'just now',
    pr: opts.pr,
    round: Number(opts.round),
    reason: opts.reason,
  });
}

/** The once-per-pass heartbeat line for the pinned "Loop heartbeat" ticket. */
function heartbeatNote({ at, inLine, nextUp } = {}) {
  const when = String(at || '').trim() || 'just now';
  const n = Number.isFinite(Number(inLine)) ? Number(inLine) : 0;
  const line = `${n} in line`;
  const next = String(nextUp || '').trim();
  return next
    ? `pass finished ${when} — ${line}, next up: "${next}"`
    : `pass finished ${when} — queue empty, nothing waiting`;
}

const KNOWN_TRANSITIONS = Object.keys(TRANSITIONS);

module.exports = { loopNote, heartbeatNote, KNOWN_TRANSITIONS, REVIEW_CLAIM_NOTE };
