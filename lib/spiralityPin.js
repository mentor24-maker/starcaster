/**
 * Do GitHub's checks test StarCaster against the Spirality release its lanes
 * run? (SC-870, replacing SC-868's lib/loopDrift.js.)
 *
 * WHY THIS EXISTS
 * StarCaster used to run its own copy of Spirality's ticket door (`loop/`),
 * copied by hand. On 2026-11-17 the copy was eight hours behind a Spirality
 * fix, and a build pass handed Dane SQL with no clickable link (SC-832). The
 * copy is gone now: the lanes run a Spirality release, and StarCaster's own
 * scripts read that same folder (lib/spirality.cjs). One thing is still
 * written down by hand and can fall behind: `.spirality-release`, the release
 * GitHub's checks download, because GitHub cannot ask the tracker which
 * release the lanes run. When the lanes move on and the pin does not, CI tests
 * against code the lanes no longer run. This says so.
 *
 * Three verdicts, never two: IN STEP (0), OUT OF STEP (1), CANNOT TELL (2).
 * No record of which release the lanes ran (another machine, a fresh one) is
 * CANNOT TELL, never IN STEP.
 *
 * Pure: no disk. scripts/spirality_pin.mjs does the reading.
 */
'use strict';

const VERDICT = Object.freeze({ IN_STEP: 'IN STEP', OUT_OF_STEP: 'OUT OF STEP', CANNOT_TELL: 'CANNOT TELL' });
const EXIT = Object.freeze({ [VERDICT.IN_STEP]: 0, [VERDICT.OUT_OF_STEP]: 1, [VERDICT.CANNOT_TELL]: 2 });
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * pinned: the release `.spirality-release` names ('' when unreadable)
 * lanes:  the release StarCaster's lanes ran last here ('' when none recorded)
 * error:  why one of them could not be read
 */
function judge({ pinned, lanes, error }) {
  if (!pinned) return { verdict: VERDICT.CANNOT_TELL, reason: `could not read .spirality-release: ${error || 'no reading'}`, pinned: '', lanes: lanes || '' };
  if (!lanes) return { verdict: VERDICT.CANNOT_TELL, reason: `this machine has no record of which Spirality release StarCaster's lanes run (${error || 'no last-starcaster file'})`, pinned, lanes: '' };
  if (pinned === lanes) return { verdict: VERDICT.IN_STEP, reason: `GitHub's checks and the lanes both use ${pinned}`, pinned, lanes };
  return { verdict: VERDICT.OUT_OF_STEP, reason: `GitHub's checks use ${pinned}, the lanes run ${lanes}`, pinned, lanes };
}

/**
 * What --check should post, given what it posted before.
 * state: { outAt, cannotTellAt } (ISO strings, '' or absent when not alarmed)
 * Returns { out, cannotTell, cleared, next }. Each alarm is said at most once
 * a day; an IN STEP after a posted OUT OF STEP says one all-clear.
 */
function plan({ judged, state = {}, now = Date.now(), everyMs = DAY_MS }) {
  const at = new Date(now).toISOString();
  const recent = (iso) => {
    const then = Date.parse(iso || '');
    return Number.isFinite(then) && now - then < everyMs;
  };
  const outAt = (state && state.outAt) || '';
  const cannotTellAt = (state && state.cannotTellAt) || '';
  if (judged.verdict === VERDICT.CANNOT_TELL) {
    const due = !recent(cannotTellAt);
    return { out: false, cannotTell: due, cleared: false, next: { outAt, cannotTellAt: due ? at : cannotTellAt } };
  }
  if (judged.verdict === VERDICT.OUT_OF_STEP) {
    const due = !recent(outAt);
    return { out: due, cannotTell: false, cleared: false, next: { outAt: due ? at : outAt, cannotTellAt: '' } };
  }
  return { out: false, cannotTell: false, cleared: Boolean(outAt), next: { outAt: '', cannotTellAt: '' } };
}

function renderOut({ judged, node, at }) {
  return [
    `[CC-starcaster] 🟠 GitHub's checks test StarCaster against a different Spirality release from the one its lanes run (${judged.reason})`,
    '',
    `.spirality-release names ${judged.pinned}; StarCaster's lanes ran ${judged.lanes} last. Until they match, a pull request's checks pass or fail against Spirality code the lanes are not running.`,
    `The fix is a StarCaster pull request changing .spirality-release to ${judged.lanes}, with npm run verify passing.`,
    `Checked from ${node} at ${at}. Said again once a day until they match; one all-clear when they do.`,
  ].join('\n');
}

function renderCannotTell({ judged, node, at }) {
  return [
    "[CC-starcaster] ⚪ Could not tell whether GitHub's checks use the Spirality release StarCaster's lanes run",
    '',
    `The check (npm run spirality:pin) ${judged.reason}.`,
    'This is not an all-clear: until it can read both again, a pin left behind would go unnoticed.',
    `Checked from ${node} at ${at}. Said again once a day while it cannot tell.`,
  ].join('\n');
}

function renderClear({ judged, node, at }) {
  return [
    `[CC-starcaster] ✅ GitHub's checks and StarCaster's lanes use the same Spirality release again (${judged.reason})`,
    `Checked from ${node} at ${at}.`,
  ].join('\n');
}

module.exports = { VERDICT, EXIT, DAY_MS, judge, plan, renderOut, renderCannotTell, renderClear };
