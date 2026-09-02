'use strict';

/**
 * What should the loop runner do about a pass that died on a usage limit?
 *
 * WHY THIS EXISTS (2026-09-02, task 86bbtuje2 — audit Phase 1). Between 2:05
 * and 2:50am the build loop fired three passes. Each died in seconds on
 *
 *   You've hit your session limit · resets 2:50am (America/Denver)
 *
 * and each time the runner slept its fixed 900s and retried into the same
 * closed window, blind. The message NAMES the reset time; nothing read it.
 *
 * This module is the reading. It is pure — text and a clock in, a decision
 * out — so every branch is testable without a runner, a log file or a real
 * limit. The bash side calls it through scripts/loop_runner_delay.mjs and
 * treats any failure as "use the normal interval", because a guard that can
 * kill the runner is worse than no guard.
 *
 * THREE ANSWERS, NEVER TWO (the house rule):
 *
 *   null                     no limit message in the text. Normal pacing.
 *   { seconds, reason }      a limit with a readable reset: sleep until then.
 *   { seconds: DEFAULT_BACKOFF_SECONDS, reason }
 *                            a limit whose time could not be read. Backing off
 *                            a fixed half hour is honest — "we know we are
 *                            limited, we do not know until when" — where
 *                            pretending no limit exists would burn the next
 *                            three passes discovering it again.
 */

/** Sleep this long on a limit whose reset time cannot be parsed. */
const DEFAULT_BACKOFF_SECONDS = 1800;

/**
 * Added past the stated reset. The message says "resets 2:50am"; waking at
 * 2:50:00 by the runner's clock races the limiter's clock and loses often
 * enough to waste a whole pass. Two minutes is noise against any real window.
 */
const MARGIN_SECONDS = 120;

/**
 * A computed sleep longer than this means the arithmetic went wrong somewhere
 * (a mis-read time, a timezone surprise), and obeying it would silence a loop
 * for most of a day on a guess. Fall back to the default backoff instead —
 * the next pass re-reads the situation half an hour from now.
 */
const CAP_SECONDS = 8 * 60 * 60;

/** The line, as observed live. Historical variants (all seen in real logs):
 *  "resets 10:50am", "resets 10pm", "resets 12am" — always with a zone in
 *  parentheses so far, but the zone is treated as optional and defaulted,
 *  because a wording change must degrade to the backoff, never to a crash. */
const LIMIT_LINE = /hit your .{0,20}limit/i;
const RESET_TIME = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i;

const DEFAULT_ZONE = 'America/Denver';

/** The wall-clock hour and minute of `nowMs` in `zone`, or null if the zone
 *  name is one Intl refuses — treated as unreadable, never as UTC. */
function wallClock(nowMs, zone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(new Date(nowMs));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const h = get('hour');
    const m = get('minute');
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return { h, m };
  } catch {
    return null;
  }
}

/**
 * Cut a log tail down to the LAST pass's output.
 *
 * The runner appends forever, so the tail handed to `limitDelay` still holds
 * the previous pass's lines — and a 2:38am "resets 2:50am" sitting above a
 * 3:00am pass that succeeded would read as a limit whose reset is now almost
 * a day away. Scoping at the last START marker means a limit line can only
 * ever belong to the pass that just ran.
 *
 * No marker at all returns the text unchanged: better to over-read a fresh
 * log than to silently scan nothing.
 */
const PASS_START_MARKER = ' START /';

function scopeToLastPass(text) {
  const body = String(text || '');
  const at = body.lastIndexOf(PASS_START_MARKER);
  return at === -1 ? body : body.slice(at);
}

/**
 * Decide, from the tail of a pass's output.
 *
 * @param {object} opts
 * @param {string} opts.text   the pass output (or its tail)
 * @param {number} opts.nowMs  the clock, injected so tests own it
 */
function limitDelay({ text, nowMs } = {}) {
  const body = String(text || '');
  if (!LIMIT_LINE.test(body)) return null;

  const m = RESET_TIME.exec(body);
  if (!m) {
    return {
      seconds: DEFAULT_BACKOFF_SECONDS,
      reason: 'a usage limit was hit but its reset time could not be read — backing off '
        + `${DEFAULT_BACKOFF_SECONDS}s instead of retrying into a closed window`,
    };
  }

  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const half = m[3].toLowerCase();
  const zone = (m[4] || DEFAULT_ZONE).trim();

  // 12am is midnight, 12pm is noon; every other hour is offset by half.
  if (hour === 12) hour = half === 'am' ? 0 : 12;
  else if (half === 'pm') hour += 12;

  if (!Number.isFinite(hour) || hour > 23 || !Number.isFinite(minute) || minute > 59) {
    return {
      seconds: DEFAULT_BACKOFF_SECONDS,
      reason: `a usage limit named a time that does not parse ("${m[0]}") — backing off ${DEFAULT_BACKOFF_SECONDS}s`,
    };
  }

  const now = wallClock(Number(nowMs), zone) || wallClock(Number(nowMs), DEFAULT_ZONE);
  if (!now) {
    return {
      seconds: DEFAULT_BACKOFF_SECONDS,
      reason: `a usage limit named a zone this machine cannot resolve ("${zone}") — backing off ${DEFAULT_BACKOFF_SECONDS}s`,
    };
  }

  // Minutes-of-day arithmetic in the message's own zone: a reset "earlier"
  // than now means tomorrow. The 2:05am incident is the <= case — a pass that
  // dies AT the reset minute must wait for the margin, not zero.
  let delta = (hour * 60 + minute) - (now.h * 60 + now.m);
  if (delta <= 0) delta += 24 * 60;
  const seconds = delta * 60 + MARGIN_SECONDS;

  if (seconds > CAP_SECONDS) {
    return {
      seconds: DEFAULT_BACKOFF_SECONDS,
      reason: `the reset time reads as ${Math.round(seconds / 3600)}h away, which is past the ${Math.round(CAP_SECONDS / 3600)}h `
        + `sanity cap — backing off ${DEFAULT_BACKOFF_SECONDS}s and letting the next pass re-read it`,
    };
  }

  return {
    seconds,
    reason: `session limit — sleeping ${seconds}s until the stated reset (${m[1]}${m[2] ? `:${m[2]}` : ''}${half} ${zone}) plus a ${MARGIN_SECONDS}s margin`,
  };
}

module.exports = {
  PASS_START_MARKER,
  scopeToLastPass,
  DEFAULT_BACKOFF_SECONDS,
  MARGIN_SECONDS,
  CAP_SECONDS,
  limitDelay,
};
