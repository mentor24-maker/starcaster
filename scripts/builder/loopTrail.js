'use strict';

/**
 * loopTrail — the two written traces the loop leaves on a ticket, and the
 * checks that they actually got left.
 *
 * WHY THIS EXISTS (2026-08-22, task 86bbjt18r). Merge-on-comment works, but
 * draining the Ready-to-launch backlog on 2026-08-22 found two ways an
 * approved ticket stalls that have nothing to do with judgement:
 *
 *   - Four tickets had no `PR opened:` comment at all, so the merge step
 *     correctly refused to guess which PR it was about. Two of those PRs also
 *     carried no ClickUp link in their body, so the ticket and its PR could
 *     only be matched by reading titles. The audit trail broke in BOTH
 *     directions at once.
 *   - Two tickets sat in `Ready to launch` — the operator's "safe to merge"
 *     signal — with no passing review verdict recorded on them. He approved
 *     both in good faith. A ticket reaching that status unreviewed is worse
 *     than a ticket stuck.
 *
 * The common cause is that both traces were prose in a skill file: a step
 * that says "add a ClickUp comment with the PR URL" is followed most of the
 * time, and nothing notices the times it is not. So both are commands now
 * (`clickup pr-opened`, `clickup verdict`), each writing a shape this module
 * defines and reading it back through the SAME parser the consumer uses —
 * `mergeOnComment.findPullRequest` and `mergeOnComment.isReviewPassed`. A
 * comment that the merge step could not act on is a comment this module
 * refuses to call written.
 */

const { findPullRequest, isReviewVerdict, isReviewPassed } = require('./mergeOnComment.js');

/** The one shape `mergeOnComment.findPullRequest` will find. */
function prOpenedComment(prUrl, extra) {
  const tail = String(extra || '').trim();
  return `PR opened: ${prUrl}${tail ? `\n\n${tail}` : ''}`;
}

/** The one shape `mergeOnComment.isReviewPassed` will accept as a PASS. */
function verdictComment(passed, note) {
  const tail = String(note || '').trim();
  const head = passed
    ? 'REVIEW: PASSED'
    : 'REVIEW: sent back to Queued';
  return `${head}${tail ? ` — ${tail}` : ''}`;
}

/**
 * Did the `PR opened:` comment land in a form the merge step can use? Takes
 * the ticket's comments as read back from ClickUp, and the PR number that
 * was supposed to be recorded. Deliberately checks the NUMBER and not merely
 * "some PR line exists": a ticket rebuilt onto a second PR whose new comment
 * silently failed would otherwise verify against the old one.
 */
function prTrailLanded(comments, prNumber) {
  const found = findPullRequest(comments);
  if (!found) {
    return { ok: false, why: 'no "PR opened: <url>" line is readable on the ticket' };
  }
  if (Number(found.number) !== Number(prNumber)) {
    return {
      ok: false,
      why: `the newest "PR opened:" line on the ticket points at PR #${found.number}, not #${prNumber}`,
    };
  }
  return { ok: true, why: '', pr: found };
}

/**
 * Does the PR body carry its ClickUp ticket? Accepts the full URL or the
 * bare task id — ClickUp short links and the `app.clickup.com/t/<id>` form
 * both resolve, and an id alone is enough to find the ticket by search.
 * Case-insensitive because ids are quoted in mixed case in the wild.
 */
function prBodyCarriesTicket(body, taskId, taskUrl) {
  const text = String(body || '').toLowerCase();
  if (!text.trim()) return false;
  if (taskUrl && text.includes(String(taskUrl).toLowerCase())) return true;
  return Boolean(taskId) && text.includes(String(taskId).toLowerCase());
}

/**
 * May this ticket move to `Ready to launch`?
 *
 * That status means one thing to the operator: loop-review checked this and
 * it is safe to merge. So the gate is exactly the precondition the merge
 * step already applies — the NEWEST review verdict on the ticket must be a
 * PASS. Anything else (no verdict at all, or a send-back as the last word)
 * is refused, because promoting it puts a ticket in his inbox wearing a
 * badge that says "reviewed" when nothing reviewed it.
 *
 * Comments may arrive in any order; newest-first is imposed here rather than
 * assumed, for the same reason mergeDecision does it.
 */
function readyToLaunchGate(comments) {
  const sorted = (comments || [])
    .slice()
    .sort((a, b) => (Number(b && b.date) || 0) - (Number(a && a.date) || 0));
  const verdict = sorted.find((c) => isReviewVerdict(c && c.comment_text));
  if (!verdict) {
    return {
      ok: false,
      why: 'no review verdict has been recorded on this ticket — loop-review has not passed it',
    };
  }
  if (!isReviewPassed(verdict.comment_text)) {
    return {
      ok: false,
      why: 'the most recent review verdict on this ticket is not a PASS',
    };
  }
  return { ok: true, why: '', verdictId: String(verdict.id) };
}

/** Is this the status the gate above guards? */
function isReadyToLaunch(status) {
  return String(status || '').trim().toLowerCase() === 'ready to launch';
}

module.exports = {
  prOpenedComment,
  verdictComment,
  prTrailLanded,
  prBodyCarriesTicket,
  readyToLaunchGate,
  isReadyToLaunch,
};
