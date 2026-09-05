'use strict';

/**
 * mergeCompletion — "did this pull request actually MERGE?", asked once, for
 * every caller that merges.
 *
 * WHY THIS EXISTS (2026-09-05, task 86bbv35cq). `gh pr merge` does not mean
 * "merged". From `gh pr merge --help`:
 *
 *   "When targeting a branch that requires a merge queue, no merge strategy is
 *    required. If required checks have not yet passed, auto-merge will be
 *    enabled. If required checks have passed, the pull request will be added to
 *    the merge queue."
 *
 * So under a merge queue the command ENQUEUES and returns success immediately.
 * The pull request stays OPEN for however long the queue takes, and may never
 * merge at all if the group's CI fails. Two callers read that immediate success
 * as a merge, and they failed in opposite directions:
 *
 *   `scripts/ship_thread.cjs` read the PR state back one instant later, saw
 *   OPEN, and stopped with "The merge did not complete" — a loud FALSE FAILURE
 *   on every run, leaving the worktree untidied and the ticket short of Live.
 *
 *   `scripts/clickup_direct.mjs` (the bus-relay merge step) checked only that
 *   the COMMAND succeeded, then stamped `new Date()` as the merge time, logged
 *   "MERGED PR #N", posted to the bus and moved the ticket to Live — a SILENT
 *   FALSE SUCCESS with a fabricated merge time, on the busiest path there is.
 *
 * The second one is the serious one, and it is the defect class this whole repo
 * is built against: an action reporting one thing while another is true.
 *
 * ONE FUNCTION, TWO CALLERS, for the reason `wipCap.ticketIdFromPrBody` already
 * carries a comment about — two callers answering the same question separately
 * will eventually answer it differently, and the day they do, one of them will
 * be the one that moves a ticket to Live.
 *
 * WHAT THIS IS NOT. It is not a fourth merge gate and it decides nothing about
 * whether a merge SHOULD happen; that is `mergeOnComment.githubGate`'s job. It
 * only observes whether one DID, after the merge command has already run.
 *
 * NO EXTRA DELAY WHERE THERE IS NO QUEUE, which is the state it ships into
 * (criterion 5). With no queue `gh pr merge` merges synchronously, so the very
 * first read — taken before any sleep — already says MERGED and the wait
 * returns. The polling only ever costs anything once a queue is switched on.
 *
 * Synchronous and injectable, deliberately, exactly like `waitForChecks`
 * beside it: `ship_thread.cjs` is CommonJS with no top-level await, and the
 * relay's `gh()` is `spawnSync` throughout, so both are already blocking.
 * Injecting `readPr`/`sleep`/`now` is what makes the queued shape — success,
 * then OPEN, then OPEN, then MERGED — a real unit test rather than something
 * that could only be observed by switching a merge queue on in production.
 */

/**
 * Classify one `gh pr view --json state,mergedAt` payload.
 *   'merged'     — GitHub says MERGED. The only state that authorizes the
 *                  bookkeeping a merge owes.
 *   'closed'     — closed WITHOUT merging. Terminal, and not a merge: under a
 *                  queue this is what a failed merge group leaves behind.
 *   'open'       — still open. Under a queue this is "enqueued, not yet
 *                  merged"; with no queue it means the merge did not happen.
 *   'unreadable' — nothing was read. NOT a state of the pull request: a state
 *                  of our knowledge, and it must never collapse into one of
 *                  the three above (DOCTRINE 3.2).
 */
function classifyMergeState(prJson) {
  if (!prJson || typeof prJson !== 'object') return 'unreadable';
  const state = String(prJson.state || '').toUpperCase();
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  if (state === 'OPEN') return 'open';
  return 'unreadable';
}

/**
 * GitHub's own merge time, or null — never a clock of ours (criterion 4).
 *
 * The relay used to stamp `new Date().toISOString()` at the moment `gh`
 * returned. That is wrong by a few seconds today and would be wrong by however
 * long a merge queue took, and it is recorded on the ticket as fact.
 */
function mergedAtOf(prJson) {
  const at = prJson && typeof prJson.mergedAt === 'string' ? prJson.mergedAt.trim() : '';
  return at ? at : null;
}

/**
 * What to write where a merge time is expected and GitHub did not report one.
 * A missing `mergedAt` on a MERGED pull request should not happen; if it ever
 * does, the record says so rather than quietly acquiring today's date.
 */
function mergeTimeLabel(mergedAt) {
  return mergedAt || 'a time GitHub did not report';
}

/**
 * Wait until a pull request has actually merged.
 *
 * @param readPr   () => object|null   one `gh pr view --json state,mergedAt`
 *                 payload. Return null (or anything unparseable) for a read
 *                 that did not happen — a failed read is not an OPEN pull
 *                 request and is never treated as one.
 * @param sleep    (ms) => void        block for ms.
 * @param now      () => number        epoch ms.
 * @param timeoutMs      overall ceiling. Default 15 minutes: long enough for a
 *                 merge queue to build and land a group, short enough that a
 *                 wedged queue does not hold a relay pass all night.
 * @param pollIntervalMs gap between reads.
 * @param onPoll   (state, elapsedMs, prJson) => void  progress hook.
 *
 * @returns { outcome, mergedAt, polls, failedReads, state } where outcome is:
 *   'merged'  — observed MERGED. `mergedAt` is GitHub's time (or null if it
 *               reported none).
 *   'closed'  — observed CLOSED without merging. It will not merge.
 *   'queued'  — every clean read said OPEN and the budget ran out. THE THIRD
 *               ANSWER the ticket asks for: not a success and not a failure —
 *               "queued, not yet merged". A caller must not record a merge and
 *               must not report a failure.
 *   'unknown' — no clean read was ever taken. Also not a failure: nobody
 *               looked. `failedReads` says how many attempts came back blind.
 */
function waitForMerge({
  readPr,
  sleep,
  now,
  timeoutMs = 15 * 60 * 1000,
  pollIntervalMs = 15 * 1000,
  onPoll,
} = {}) {
  if (typeof readPr !== 'function') throw new TypeError('waitForMerge needs a readPr function');
  if (typeof sleep !== 'function') throw new TypeError('waitForMerge needs a sleep function');
  if (typeof now !== 'function') throw new TypeError('waitForMerge needs a now function');

  const start = now();
  let polls = 0;
  let failedReads = 0;
  let sawOpen = false;

  for (;;) {
    let prJson = null;
    try {
      prJson = readPr();
    } catch (_) {
      prJson = null;
    }
    const state = classifyMergeState(prJson);
    polls += 1;
    const elapsed = now() - start;
    if (typeof onPoll === 'function') onPoll(state, elapsed, prJson);

    if (state === 'merged') {
      return { outcome: 'merged', mergedAt: mergedAtOf(prJson), polls, failedReads, state };
    }
    if (state === 'closed') {
      return { outcome: 'closed', mergedAt: null, polls, failedReads, state };
    }
    if (state === 'open') sawOpen = true;
    else failedReads += 1;

    if (elapsed >= timeoutMs) {
      // sawOpen, not "the last read was open": one clean OPEN reading is
      // enough to know the pull request exists and has not merged, and a rate
      // limit on the final poll must not turn a known-queued PR into a
      // cannot-tell.
      return {
        outcome: sawOpen ? 'queued' : 'unknown',
        mergedAt: null,
        polls,
        failedReads,
        state,
      };
    }
    sleep(pollIntervalMs);
  }
}

module.exports = { classifyMergeState, mergedAtOf, mergeTimeLabel, waitForMerge };
