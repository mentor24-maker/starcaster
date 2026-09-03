'use strict';

/**
 * WHEN TO WAIT AND RETRY A CLICKUP CALL, and for how long (2026-09-03, task
 * 86bbugbym).
 *
 * Pulled out as a pure function for the same reason busRelayPlan.js was: the
 * decision is the part worth testing, and a test that has to stand up a fake
 * HTTP server to reach it is a test nobody writes.
 *
 * THE INCIDENT. `bus-relay` failed every 10-minute pass for sixteen hours on
 * 2026-09-03. Its own error text said the right thing —
 *
 *     429 is ClickUp itself throttling, and it clears in under a minute.
 *     This is NOT the connector quota — wait 60s and run the same command again.
 *
 * — and then the process exited instead of waiting the under-a-minute it had
 * just described. The same day `npm run reconcile` reported fourteen tickets it
 * "could not check", every one of them an HTTP 429, on a job that had thirty
 * seconds to spare and no way to spend them.
 *
 * ONLY 429 RETRIES. A 401 is a bad or expired token and a 404 is a bad id;
 * repeating either is a slower way to get the same answer, and repeating a 401
 * against an expiring credential is how a rate limit turns into a lockout.
 *
 * WHY RETRYING A WRITE IS SAFE HERE, WHICH IS NOT OBVIOUS.
 * The usual rule is that a failed write must not be retried blindly, because a
 * request that timed out may still have been applied — a doubled comment on a
 * ticket, a doubled bus post. That rule is about an UNKNOWN outcome.
 *
 * A 429 is not an unknown outcome. It is a refusal: the request was rejected
 * on arrival, ahead of any processing, which is the entire meaning of the
 * status. Nothing was applied, so repeating it cannot duplicate anything.
 *
 * That reasoning does NOT extend to a transport failure, where the request may
 * genuinely have landed before the connection died. Those still go straight to
 * `unreachable()` with no retry, and this module is never consulted for them.
 * If a future edit is tempted to widen this to timeouts, that is the line, and
 * crossing it needs a different argument than this one.
 */

/** The original attempt plus three retries. Small on purpose: the relay wakes
 *  every 600s, so a pass that cannot get through in a minute and a half is
 *  better off ending and letting the next one try with a fresh budget. */
const MAX_ATTEMPTS = 4;

/** Total time this call may spend waiting, across all retries. A scheduled job
 *  must never overrun its own interval — launchd will not start a second copy
 *  while the first is still going, so an unbounded wait does not delay a pass,
 *  it deletes every pass after it. */
const TOTAL_DEADLINE_MS = 90_000;

/** Used when ClickUp sends no usable `x-ratelimit-reset`. Long enough to be
 *  worth doing, short enough that four of them fit inside the deadline. */
const DEFAULT_WAIT_MS = 5_000;

/** A single wait is capped just over a minute: the window is per-minute, so
 *  anything longer means the header is wrong rather than the wait being right. */
const MAX_WAIT_MS = 65_000;

/** Never busy-loop, even if the header says the window already closed. */
const MIN_WAIT_MS = 1_000;

/**
 * How long to wait before retrying, from ClickUp's own `x-ratelimit-reset`.
 *
 * That header is an ABSOLUTE epoch-seconds timestamp, not a duration — the
 * same reading `reportLimits` in clickup_direct.mjs already does. Handing it
 * straight to a sleep would wait fifty-six years, so the subtraction is the
 * whole job and it is worth a test of its own.
 */
function waitMsFor({ resetSeconds, nowSeconds } = {}) {
  const reset = Number(resetSeconds);
  const now = Number(nowSeconds);
  if (!Number.isFinite(reset) || !Number.isFinite(now)) return DEFAULT_WAIT_MS;
  const seconds = reset - now;
  if (!Number.isFinite(seconds)) return DEFAULT_WAIT_MS;
  // A window already past, or a clock skewed the wrong way, still waits the
  // floor rather than retrying instantly into the same refusal.
  const ms = Math.round(seconds * 1000);
  if (ms <= 0) return MIN_WAIT_MS;
  return Math.min(Math.max(ms, MIN_WAIT_MS), MAX_WAIT_MS);
}

/**
 * Should this call be retried, and after how long?
 *
 * `attempt` is 1-based and counts the try that just failed. `elapsedMs` is how
 * long this call has ALREADY spent waiting across earlier retries.
 *
 * Returns { retry, waitMs, why } — `why` is printed verbatim when a retry is
 * refused, because "it gave up" without a reason is the shape of report this
 * repo keeps having to fix.
 */
function retryDecision({
  status,
  attempt = 1,
  elapsedMs = 0,
  resetSeconds,
  nowSeconds,
  maxAttempts = MAX_ATTEMPTS,
  totalDeadlineMs = TOTAL_DEADLINE_MS,
} = {}) {
  if (Number(status) !== 429) {
    return { retry: false, waitMs: 0, why: `HTTP ${status} is not a rate limit — retrying would not change it` };
  }
  if (attempt >= maxAttempts) {
    return {
      retry: false,
      waitMs: 0,
      why: `still rate limited after ${attempt} attempt(s) — giving up rather than waiting longer`,
    };
  }
  const waitMs = waitMsFor({ resetSeconds, nowSeconds });
  if (elapsedMs + waitMs > totalDeadlineMs) {
    return {
      retry: false,
      waitMs: 0,
      why: `waiting ${Math.round(waitMs / 1000)}s more would pass this call's ${Math.round(totalDeadlineMs / 1000)}s ceiling — giving up so a scheduled pass cannot overrun its interval`,
    };
  }
  return {
    retry: true,
    waitMs,
    why: `rate limited — waiting ${Math.round(waitMs / 1000)}s for ClickUp's window to reset, then retrying (attempt ${attempt + 1} of ${maxAttempts})`,
  };
}

module.exports = {
  MAX_ATTEMPTS,
  TOTAL_DEADLINE_MS,
  DEFAULT_WAIT_MS,
  MAX_WAIT_MS,
  MIN_WAIT_MS,
  waitMsFor,
  retryDecision,
};
