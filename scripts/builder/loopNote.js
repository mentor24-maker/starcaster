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

const TRANSITIONS = {
  claimed:   ({ at }) => `🔨 building — claimed ${at}`,
  'pr-open': ({ at, pr }) => `🔀 PR #${pr} open — waiting for a review pass (${at})`,
  // A review takes many minutes and, until 2026-08-22, left no trace while it
  // ran — so two review passes checked PR #362 at the same time and the slower
  // one overwrote the faster one's verdict. This note IS the visible claim: it
  // carries the date as well as the clock, because "is that review still
  // running or did it die?" cannot be answered by a time of day alone.
  'review-started': ({ at }) => `🔍 being checked — a review pass started ${at}`,
  verified:  ({ at }) => `👀 verified — waiting on Dane to say "merge" (${at})`,
  'sent-back': ({ at }) => `↩ returned to the line with notes for the builder (${at})`,
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
  return make({ at: String(opts.at || '').trim() || 'just now', pr: opts.pr });
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

module.exports = { loopNote, heartbeatNote, KNOWN_TRANSITIONS };
