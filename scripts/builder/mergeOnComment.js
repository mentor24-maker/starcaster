'use strict';

/**
 * mergeOnComment — the rules for "the operator said merge, so merge it".
 *
 * WHY THIS EXISTS (2026-08-21, task 86bbjd5nn). On 2026-08-20 three
 * Ready-to-launch tickets sat for hours after Dane commented "merge" on
 * them. Nothing acted on those comments: bus-relay only echoed them to the
 * party line, and the merge happened whenever a human session next looked.
 * His comment on a reviewed ticket IS the explicit merge authorization the
 * doctrine requires (LOOP_ENGINEERING, "Safety"); the only thing missing
 * was hands. This module is the decision half of those hands — pure
 * functions over comment lists and a `gh pr view` payload, so every refusal
 * path is testable without touching GitHub or ClickUp.
 *
 * The plumbing that carries the decisions out lives in
 * scripts/clickup_direct.mjs (`bus-relay`), the same pass that already
 * relays his comments. Nothing here performs a merge, and nothing here
 * loosens the standing rules: only the operator's own user id authorizes,
 * only a ticket already promoted to Ready to launch by loop-review is
 * eligible, and a script never resolves a merge conflict.
 */

/**
 * The exact phrases that mean "merge it". Deliberately a closed set matched
 * as a WHOLE comment, never as a substring: "do not merge this yet" and
 * "I'll approve the design later" both contain a keyword and must not fire.
 */
const MERGE_PHRASES = ['merge', 'merge it', 'ship it', 'approve'];

/**
 * Normalize a comment for phrase matching: trim, lowercase, collapse runs of
 * whitespace (ClickUp turns a Reply box into "merge\n"), and drop trailing
 * sentence punctuation so "Merge!" is the same instruction as "merge".
 * Nothing here makes the match a substring match — the whole remaining
 * string must equal a phrase.
 */
function normalizeCommand(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!\s]+$/g, '');
}

/** Is this comment, in its entirety, a merge command? */
function isMergeCommand(text) {
  return MERGE_PHRASES.includes(normalizeCommand(text));
}

/**
 * The review verdict comments loop-review leaves. Both spellings are in the
 * live record — "REVIEW: PASSED (...)" and "REVIEW PASSED (...)" — so the
 * colon is optional. Line-anchored, because a review that merely DISCUSSES
 * the words ("this is not a REVIEW PASSED situation") is prose, not a
 * verdict. A failing verdict reads "REVIEW: sent back to Queued", which
 * matches isReviewVerdict but not isReviewPassed — exactly the distinction
 * the precondition needs.
 */
const REVIEW_VERDICT_RE = /^\s*REVIEW\b.*$/im;
const REVIEW_PASSED_RE = /^\s*REVIEW\s*:?\s*PASSED\b/im;

function isReviewVerdict(text) {
  return REVIEW_VERDICT_RE.test(String(text || ''));
}

function isReviewPassed(text) {
  return REVIEW_PASSED_RE.test(String(text || ''));
}

/**
 * The PR this ticket is about. The build loop's own convention is a comment
 * whose first line is "PR opened: <url>" (loop-build SKILL.md step 7), and
 * ONLY that line is trusted: ticket comments routinely cite other PRs in
 * passing ("it depends on ... PR #341: <url>"), and merging the PR a review
 * comment mentioned would be a catastrophe that looks like success. No
 * "PR opened:" line means no candidate — refuse rather than guess.
 * Newest wins, so a rebuilt ticket merges its latest PR.
 */
const PR_OPENED_RE = /^\s*PR opened:\s*(https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+))\b/im;

function findPullRequest(comments) {
  const sorted = byDateNewestFirst(comments);
  for (const c of sorted) {
    const m = PR_OPENED_RE.exec(String(c.comment_text || ''));
    if (m) {
      return { url: m[1], owner: m[2], repo: m[3], number: Number(m[4]), commentId: String(c.id) };
    }
  }
  return null;
}

function commentDate(c) {
  const n = Number(c && c.date);
  return Number.isFinite(n) ? n : 0;
}

function byDateNewestFirst(comments) {
  return (comments || []).slice().sort((a, b) => commentDate(b) - commentDate(a));
}

/**
 * The merge path's dedup marker, written as a threaded reply on the
 * operator's own comment. Defined HERE, next to the parser that reads it
 * back, so the writer and the reader can never drift apart.
 */
const MERGE_MARKER = '[merge-on-comment]';

/**
 * Read one marker reply back into a decision.
 *
 * WHY THIS EXISTS (2026-08-22, task 86bbjt18r). Until now every marker meant
 * the same thing — "this authorization is spent, never look at it again" —
 * and that is wrong for a REFUSAL. On 2026-08-22 two tickets were refused for
 * "no PR opened: comment", the missing comment was added by hand minutes
 * later, and the next three passes did not look at them again: Dane's
 * approval was still sitting there, still valid, and the ticket had gone
 * quiet forever. A refusal is a snapshot of a moment, not a verdict on the
 * ticket.
 *
 * So markers now carry a KIND. 'terminal' (merged, or handed to a human for
 * a conflict) is spent forever — re-deciding a merged PR is the one mistake
 * that cannot be undone. 'refused' is re-decided on every later pass, and
 * only stays quiet while the reason it gave is still the true one.
 *
 * The format is the one already in the live record — `[merge-on-comment]
 * refused: <why> — <ISO>` — so markers written before this change parse
 * correctly and nothing needs migrating. `lastIndexOf` finds the timestamp
 * separator because the REASON often contains an em-dash of its own
 * ("no \"PR opened:\" comment on this ticket — nothing to merge").
 */
function parseMergeMarker(text) {
  const raw = String(text || '');
  if (!raw.startsWith(MERGE_MARKER)) return null;
  let rest = raw.slice(MERGE_MARKER.length).trim();
  let at = '';
  const cut = rest.lastIndexOf(' — ');
  if (cut !== -1) {
    const tail = rest.slice(cut + 3).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(tail)) {
      at = tail;
      rest = rest.slice(0, cut).trim();
    }
  }
  if (/^refused\s*:/i.test(rest)) {
    return { kind: 'refused', reason: rest.replace(/^refused\s*:\s*/i, '').trim(), at };
  }
  return { kind: 'terminal', reason: rest, at };
}

/**
 * The NEWEST marker on one comment's reply thread decides its state. A
 * ticket refused twice for different reasons carries two markers, and only
 * the last one describes where it actually stands.
 */
function latestMergeMarker(replies) {
  let best = null;
  let bestDate = -Infinity;
  for (const r of replies || []) {
    const parsed = parseMergeMarker(r && r.comment_text);
    if (!parsed) continue;
    const d = commentDate(r);
    if (d >= bestDate) { best = parsed; bestDate = d; }
  }
  return best;
}

/**
 * Decide what a bus-relay pass should do with one Ready-to-launch ticket.
 *
 * Returns `{ act, reason, ... }` where act is one of:
 *   'ignore'  — nothing to do, and nothing to say (the common case)
 *   'refuse'  — an authorization exists but a precondition failed; the
 *               caller comments on the ticket and marks the comment handled
 *   'merge'   — every ClickUp-side precondition holds; the caller now checks
 *               GitHub (see githubGate) and merges
 *
 * `handled` is the set of comment ids whose answer was TERMINAL — merged, or
 * handed to a human for a conflict. Those are never re-decided.
 *
 * `refused` is the other half (task 86bbjt18r): a map of comment id -> the
 * reason that refusal gave. A refused authorization IS re-decided on every
 * later pass, because the reason may have gone away — that is the whole
 * point. The map is what keeps it quiet in the meantime: if the pass reaches
 * the SAME refusal again, the decision is 'ignore' and nothing is posted, so
 * re-planning costs no extra noise on the ticket. A different reason, or a
 * clean run through to 'merge', is new information and is acted on.
 */
function mergeDecision({ status, comments, operatorId, handled, refused }) {
  const seen = handled instanceof Set ? handled : new Set(handled || []);
  const priorRefusals = refused instanceof Map ? refused : new Map(Object.entries(refused || {}));
  const all = byDateNewestFirst(comments);

  // Only Ready to launch. The same word on any other status does nothing —
  // a merge command on a Building ticket is not an authorization, it is a
  // guess about work that is not finished.
  if (String(status || '').toLowerCase() !== 'ready to launch') {
    return { act: 'ignore', reason: `status is "${status}", not Ready to launch` };
  }

  // Only the operator, checked by numeric user id. A Pulse or agent comment
  // saying "merge" is a machine talking to itself, never an authorization.
  const authorization = all.find(
    (c) => Number(c.user && c.user.id) === Number(operatorId)
      && isMergeCommand(c.comment_text)
      && !seen.has(String(c.id)),
  );
  if (!authorization) return { act: 'ignore', reason: 'no unhandled merge command from the operator' };

  const base = { commentId: String(authorization.id), commentDate: commentDate(authorization) };

  // A refusal we have already given, whose reason is still true, is not news.
  // Saying it again on every hourly pass would bury the ticket in identical
  // comments, so it goes quiet — but it goes quiet by RE-DERIVING the same
  // answer, not by being permanently struck off. The moment the reason
  // changes (or disappears), the next pass acts.
  const wasRefusedFor = priorRefusals.get(base.commentId);
  const refuse = (reason) => (
    reason === wasRefusedFor
      ? { ...base, act: 'ignore', reason: `already refused for the same reason: ${reason}` }
      : { ...base, act: 'refuse', reason }
  );

  // The newest REVIEW verdict must be a PASS, and the authorization must be
  // NEWER than it. Both halves matter: the first is "a human-independent
  // check said this is good", the second is "he was authorizing THIS
  // verdict". A ticket sent back, rebuilt and re-reviewed carries a stale
  // "merge" from the previous round; that comment predates the new verdict
  // and must not release the new PR.
  const verdict = all.find((c) => isReviewVerdict(c.comment_text));
  if (!verdict) {
    return refuse('no review verdict on this ticket — loop-review has not passed it');
  }
  if (!isReviewPassed(verdict.comment_text)) {
    return refuse('the most recent review verdict is not a PASS');
  }
  if (commentDate(authorization) < commentDate(verdict)) {
    return refuse('the merge command predates the current review verdict — it authorized an earlier round');
  }

  const pr = findPullRequest(all);
  if (!pr) {
    return refuse('no "PR opened:" comment on this ticket — nothing to merge');
  }

  return { ...base, act: 'merge', pr, reason: `authorized by comment ${authorization.id}` };
}

/**
 * Every check on the PR, reduced to one verdict. Handles BOTH shapes GitHub
 * puts in statusCheckRollup: a CheckRun (status + conclusion) and a
 * StatusContext (state) — the Vercel deployment arrives as the latter, so a
 * reader that only understood CheckRun would call a red Vercel build green.
 */
function checkState(rollup) {
  const entries = rollup || [];
  const pending = [];
  const failed = [];
  for (const c of entries) {
    const name = c.name || c.context || '(unnamed check)';
    if (c.__typename === 'StatusContext' || (!c.status && c.state)) {
      const state = String(c.state || '').toUpperCase();
      if (state === 'PENDING' || state === 'EXPECTED') pending.push(name);
      else if (state !== 'SUCCESS') failed.push(`${name} (${state || 'unknown'})`);
      continue;
    }
    const status = String(c.status || '').toUpperCase();
    if (status !== 'COMPLETED') { pending.push(name); continue; }
    const conclusion = String(c.conclusion || '').toUpperCase();
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) continue;
    failed.push(`${name} (${conclusion || 'no conclusion'})`);
  }
  return { pending, failed, total: entries.length };
}

/**
 * What to do with the PR itself, given `gh pr view --json
 * state,mergeStateStatus,mergeable,statusCheckRollup`.
 *
 *   'merge'         — go
 *   'update-branch' — behind main; catch it up, then re-run the gate
 *   'conflict'      — hand it to a human; a script never resolves conflicts
 *   'wait'          — checks still running; say nothing, try next pass
 *   'refuse'        — terminal; comment on the ticket and stop
 */
function githubGate(pr) {
  const state = String((pr && pr.state) || '').toUpperCase();
  if (state === 'MERGED') return { action: 'refuse', reason: 'the PR is already merged' };
  if (state !== 'OPEN') return { action: 'refuse', reason: `the PR is ${state || 'in an unknown state'}, not open` };

  if (pr.isDraft) return { action: 'refuse', reason: 'the PR is still a draft' };

  const mergeable = String(pr.mergeable || '').toUpperCase();
  const mergeStateStatus = String(pr.mergeStateStatus || '').toUpperCase();

  // Conflicts first: a CONFLICTING PR cannot be helped by updating the
  // branch, and update-branch on one is exactly the "resolve it blind" this
  // must never do.
  if (mergeable === 'CONFLICTING' || mergeStateStatus === 'DIRTY') {
    return { action: 'conflict', reason: 'the branch conflicts with newer work on main' };
  }

  // GitHub answers UNKNOWN while it is still computing mergeability. That is
  // not a failure — it is "ask again", and asking again is what the next
  // hourly pass is for.
  if (mergeable === 'UNKNOWN' || mergeStateStatus === 'UNKNOWN') {
    return { action: 'wait', reason: 'GitHub is still computing whether the branch merges cleanly' };
  }

  const checks = checkState(pr.statusCheckRollup);
  if (checks.failed.length) {
    return { action: 'refuse', reason: `checks are red: ${checks.failed.join(', ')}` };
  }
  if (checks.pending.length) {
    return { action: 'wait', reason: `checks still running: ${checks.pending.join(', ')}` };
  }
  // A PR with no checks at all is not a green PR — it is a PR nothing
  // verified. main is protected on the "verify" check precisely so this
  // cannot ship unchecked.
  if (!checks.total) {
    return { action: 'refuse', reason: 'the PR reports no checks at all — nothing verified this branch' };
  }

  if (mergeStateStatus === 'BEHIND') {
    return { action: 'update-branch', reason: 'the branch is behind main' };
  }
  if (mergeStateStatus === 'BLOCKED') {
    return { action: 'refuse', reason: 'GitHub reports the merge is blocked (a required review or check is missing)' };
  }

  return { action: 'merge', reason: `open, ${checks.total} check(s) green, no conflicts` };
}

module.exports = {
  MERGE_PHRASES,
  MERGE_MARKER,
  parseMergeMarker,
  latestMergeMarker,
  normalizeCommand,
  isMergeCommand,
  isReviewVerdict,
  isReviewPassed,
  findPullRequest,
  mergeDecision,
  checkState,
  githubGate,
};
