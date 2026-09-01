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

// The one reading of a local merge verdict, shared with the merge step so the
// two cannot disagree about it (task 86bbq80j5).
const { isRealOverlap, isSelfHealing, isPermanent, conflictActor, verdictCopy, conflictVerdictKind } = require('./conflictWork');

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
 * The exact shape of a conflict hand-off marker written before 2026-08-23,
 * when hand-offs were terminal by accident rather than by intent. Anchored
 * whole-string so nothing else can drift into the migration path.
 */
const LEGACY_HAND_OFF_RE = /^conflict hand-off on PR #\d+$/i;

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
  // MIGRATION (2026-08-23, task 86bbk0g4u). Conflict hand-offs written before
  // this change carry no "refused:" prefix, so they parsed as TERMINAL and
  // spent the authorization — while the comment posted beside them promised
  // the exact opposite ("then your merge still stands and this goes through").
  // Eleven Ready-to-launch tickets sat dead that way, one of them approved
  // twice four hours apart. Reading the old shape back as re-decidable heals
  // every one of them on the next pass, with no second "merge" from the
  // operator and nothing to remember to run by hand.
  //
  // Safe in the only direction that matters: a `merged PR #N at ...` marker
  // does not match this, so a merged PR is still never re-decided — and even
  // if one somehow were, githubGate refuses an already-merged PR outright.
  if (LEGACY_HAND_OFF_RE.test(rest)) {
    return { kind: 'refused', reason: rest, at, legacy: true };
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
function mergeDecision({ status, comments, operatorId, handled, refused, refusedAt }) {
  const seen = handled instanceof Set ? handled : new Set(handled || []);
  const priorRefusals = refused instanceof Map ? refused : new Map(Object.entries(refused || {}));
  // WHEN the previous refusal was written, carried alongside WHY. A conflict
  // hand-off that has been sitting for a day is news even though its reason
  // has not changed (task 86bbq0fh8) — and the age can only come from the
  // marker, which is the one record of when the pass actually said it.
  const priorRefusalTimes = refusedAt instanceof Map ? refusedAt : new Map(Object.entries(refusedAt || {}));
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

  // The reason a previous pass refused THIS authorization, carried out to the
  // caller as well as used below. The plumbing needs it because two of the
  // three refusal reasons are only discovered later, against GitHub (checks
  // red, branch conflicts) — mergeDecision cannot quiet those on its own, and
  // without it a permanent conflict would post an identical comment on every
  // pass.
  const base = {
    commentId: String(authorization.id),
    commentDate: commentDate(authorization),
    priorRefusal: priorRefusals.get(String(authorization.id)),
    priorRefusalAt: priorRefusalTimes.get(String(authorization.id)) || '',
  };

  // A refusal we have already given, whose reason is still true, is not news.
  // Saying it again on every pass would bury the ticket in identical
  // comments, so it goes quiet — but it goes quiet by RE-DERIVING the same
  // answer, not by being permanently struck off. The moment the reason
  // changes (or disappears), the next pass acts.
  const wasRefusedFor = base.priorRefusal;
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
  // pass is for.
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

/**
 * WAITING FOR CI INSIDE ONE PASS (2026-08-24, task 86bbk2fb5).
 *
 * Merging one PR is about three minutes of real work — catch the branch up,
 * run CI (`verify` median 85 seconds), merge. We were achieving 1.25 merges an
 * hour, with the pipeline idle roughly 95% of the time.
 *
 * The cost was the SHAPE, not the work. It took two passes to merge one PR:
 * pass N caught the branch up and returned `waiting`; CI finished 85 seconds
 * later; pass N+1 merged it an hour after that. A three-minute job took two
 * hours.
 *
 * It gets worse as the queue grows, not better. Branch protection is
 * `strict: true`, so a branch must be current with main to merge — meaning
 * EVERY merge invalidates every other open branch. At 24 open PRs each merge
 * leaves 23 needing catch-up, and a catch-up done an hour ago is stale before
 * the next pass reaches it. The two-pass shape can lose a race with its own
 * previous pass.
 *
 * So after a catch-up push, the pass waits for the check run rather than
 * going away for an hour. Three rules keep that bounded:
 *
 *   - A BUDGET, not patience. ~2x the observed median. When it runs out the
 *     answer is `wait` — exactly what the pass returned before — never a
 *     merge and never a failure. A slow CI run is not a broken one.
 *   - A CAP per pass, so one stuck PR cannot starve the rest. Beyond the cap
 *     everything falls through to `wait` and the next pass takes it.
 *   - The SAME gate. Nothing here decides whether a PR may merge; it only
 *     decides whether to ask again. Red is refused by the existing path, with
 *     the existing wording.
 */

/** ~2x the observed 85s median for `verify`. Named, not a literal. */
const IN_PASS_WAIT_MS = 180_000;

/** How often to re-ask GitHub inside that budget. */
const IN_PASS_POLL_MS = 10_000;

/**
 * How many tickets may hold a pass open. Worst case is CAP x BUDGET, so this
 * is the number that keeps a pass from becoming an unbounded one.
 *
 * The ceiling that matters is the relay's OWN interval (`INTERVAL_SECONDS` in
 * scripts/install_bus_relay.sh, 600s). A pass that stays under it is finished
 * before the next firing is due; a pass that runs past it swallows that firing
 * — launchd coalesces the ones it misses — so approvals arriving meanwhile
 * wait on work already in flight instead of being picked up promptly.
 * mergeOnComment.test.js reads that interval and pins the bound against it, so
 * shortening the cadence again fails a test rather than quietly permitting a
 * pass longer than its own schedule.
 */
const MAX_IN_PASS_WAITS = 3;

/** Has this pass already spent its in-pass waits? */
function mayWaitInPass(waitsUsed, cap = MAX_IN_PASS_WAITS) {
  return Number(waitsUsed || 0) < cap;
}

/**
 * Given a freshly re-read gate and how long we have been waiting, what next?
 *
 * Deliberately does NOT re-implement the gate. `merge`, `refuse` and
 * `conflict` are handed straight back to the paths that already handle them,
 * so there is exactly one place that decides whether something may merge.
 *
 * @returns {{ action: 'merge'|'refuse'|'conflict'|'update-branch'|'wait'|'poll-again', reason?: string }}
 */
function afterCatchUpDecision({ gate, elapsedMs = 0, budgetMs = IN_PASS_WAIT_MS } = {}) {
  const action = String(gate?.action || '');

  // Terminal answers go back to the existing paths untouched.
  if (action === 'merge' || action === 'refuse' || action === 'conflict') {
    return { action, reason: gate.reason };
  }

  // Behind main is also terminal: no amount of polling makes a branch catch
  // itself up, so waiting out the budget on it can only end in a wrong-reason
  // answer — "CI was still running" about a branch whose CI was fine (found
  // in review, 2026-08-30, task 86bbmk7pv). Ending the wait here hands it to
  // the next pass, where the catch-up path already lives.
  if (action === 'update-branch') {
    return { action, reason: gate.reason || 'the branch fell behind main while waiting' };
  }

  // Anything else means "not resolved yet". Out of budget is a WAIT — the
  // same outcome the pass used to return immediately — never a merge.
  if (Number(elapsedMs) >= Number(budgetMs)) {
    return {
      action: 'wait',
      reason: `CI was still running after ${Math.round(Number(budgetMs) / 1000)}s; the next pass will pick it up`,
    };
  }

  return { action: 'poll-again', reason: gate?.reason || 'checks still running' };
}

/**
 * WHAT THE COMMENT PROMISES AND WHAT THE MARKER DOES, BUILT TOGETHER
 * (2026-08-23, task 86bbk0g4u).
 *
 * The merge path posts a comment to the operator and writes a marker for
 * itself, and until now those were written in two different places with
 * nothing tying them together. They drifted, in the worst possible
 * direction: the conflict hand-off told him "then your merge still stands
 * and this goes through" while writing a marker that no later pass would
 * ever look at again. He read that promise on eleven tickets and every one
 * of them was dead.
 *
 * So every notice is built by a function here that returns the body AND the
 * marker as one object. The marker's kind decides which promise the body is
 * allowed to make, and a test asserts that pairing for every notice there
 * is — which is only possible because they are no longer written apart.
 */
const APPROVAL_CARRIES_OVER = '**Your approval is still standing — you do not have to say "merge" again.** Every later pass re-checks this ticket, so the moment the reason above is dealt with it goes through on its own. You will only hear from this step again if the answer changes.';

// There is deliberately NO "your approval is spent" wording here. The ticket
// offered two fixes — say the spent thing truthfully, or stop spending it —
// and this takes the second. Every notice below either carries the approval
// over or is the merge itself, so a sentence telling him to say "merge" twice
// would have nothing left to describe. If a future outcome IS terminal and
// not a merge, it needs that sentence written back, and the test at the
// bottom of mergeOnComment.test.js is what will notice.

/**
 * WHAT THE APPROVAL PROMISE NOW ALSO DEPENDS ON (2026-08-30, task 86bbq0fh8).
 *
 * A re-decidable marker was treated as licence to say "it goes through on its
 * own". That is only true if somebody is going to deal with the reason — and
 * on a conflict, nobody was. The hand-off asked the bus for an agent session,
 * nothing reads the bus, and PR #434 sat three days under a comment saying it
 * was progressing.
 *
 * So every notice now declares its ACTOR as well as its marker, and the two
 * together decide the promise:
 *
 *   'later-pass' — the reason can clear without anyone acting (CI goes green,
 *                  a missing comment gets added). A later pass merges it.
 *   'loop-queue' — resolving it is filed as a Queued ticket the build loop
 *                  drains. A named actor, running on a timer today.
 *   'nobody'     — nothing is going to pick this up. The body MUST say the
 *                  work is stalled and MUST NOT promise a merge.
 *   'none'       — already merged; there is no next actor and no promise.
 *
 * Passive voice is the tell (vault `doctrine/TERMINOLOGY.md`, 2026-08-29): a
 * hand-off that cannot name a specific waiting actor does not get to imply
 * one. `actor` is that name, made structural so a test can check it.
 */
const ACTOR_PROMISES = { 'later-pass': true, 'loop-queue': true, nobody: false, none: false };

/** May this notice tell him the approval carries over? Only if the marker is
 *  re-decidable AND a named actor is going to act on the reason. */
function mayPromiseApproval({ marker, actor }) {
  if (markerKind(marker) === 'terminal') return false;
  return ACTOR_PROMISES[actor] === true;
}

/** The kind a marker string parses back as, without the timestamp tail. */
function markerKind(what) {
  const parsed = parseMergeMarker(`${MERGE_MARKER} ${what}`);
  return parsed ? parsed.kind : 'terminal';
}

/**
 * A precondition failed, or GitHub says the PR cannot be merged safely. The
 * marker is re-decidable, so the promise is the truthful one: the reason may
 * be fixed later and this goes through on its own.
 */
function refusalNotice({ commentId, why, plainEnglish }) {
  return {
    marker: `refused: ${why}`,
    actor: 'later-pass',
    body: `Merge not performed. ${plainEnglish}\n\nWhy: ${why}.\n\n${APPROVAL_CARRIES_OVER}\n\n(Automatic: your comment ${commentId} on this ticket was read as a merge authorization. Nothing on GitHub or this ticket was changed. — bus-relay merge step)`,
  };
}

/**
 * The branch conflicts and a script never resolves a conflict blind — but a
 * human resolving it does not need a second authorization. The marker is
 * re-decidable (see LEGACY_HAND_OFF_RE for why it used not to be), so the
 * body says so, and says plainly what the person has to do first.
 *
 * `localVerdict` is what THIS machine found when it tried the merge itself:
 * THREE outcomes, and collapsing any two of them sends the reader after the
 * wrong thing (the kinds live in conflictWork.js, which is the only place that
 * decides them — this list is a reader's summary, not a second definition):
 *
 *   'real-conflict'   — the branches genuinely overlap. Somebody must decide
 *                       what the merged file says.
 *   'no-overlap'      — the local merge came back clean; it heals itself.
 *   'could-not-check' — the check never ran. NO FINDING WAS MADE, so no
 *                       message here may claim one.
 *
 * (An earlier 'unknown' kind fused the last two and was retired on 2026-08-31,
 * review round 2 of task 86bbq80j5: copy written for it asserted a finding the
 * pass had not made.)
 *
 * (A third kind, 'needs-rebuild', existed while committed HTML carried
 * ?v= asset pins; retired 2026-08-24 with the pins themselves, task 86bbkh288.)
 *
 * `filed` is the NAMED ACTOR (2026-08-30, task 86bbq0fh8): `{ id, url }` for
 * the Loop Queue ticket that will resolve the conflict, or null when no such
 * ticket exists. Null is not a formatting detail — it means nothing is going
 * to pick this up, and the body says exactly that instead of promising a
 * merge. That promise, made with no actor behind it, is what left PR #434
 * sitting for three days under a comment saying it was progressing.
 */
function conflictHandOffNotice({ commentId, pr, localVerdict, filed }) {
  // Two different situations wear the same GitHub answer, and only one of them
  // retries usefully. Saying "it will merge next run" about a real overlap is
  // the same shape of untrue promise this whole ticket family exists to
  // remove — so the two get different sentences, and the difference comes from
  // the localVerdict rather than from a guess.
  //
  // ONE predicate, shared with the filing decision in clickup_direct.mjs
  // (task 86bbq80j5). This function used to derive it here and the merge step
  // did not consult it at all, so a lost push race was filed as a conflict
  // while this very body promised it would heal itself. Neither side gets to
  // hold its own copy of the answer any more.
  // THREE answers, not two (review round 2). `isSelfHealing` is the only one
  // that licences "no overlap was found"; `couldNotCheck` says plainly that
  // nothing was looked at, which is what a wrong repo, a failed fetch or a
  // missing scratch worktree actually is. Collapsing those two produced a
  // ticket comment saying it could not check beside a bus post asserting a
  // finding, seconds apart.
  const realOverlap = isRealOverlap(localVerdict);
  const selfHealing = isSelfHealing(localVerdict);
  const permanent = isPermanent(localVerdict);
  const because = realOverlap
    ? `this branch and \`main\` have both changed the same lines — ${localVerdict.reason}`
    : selfHealing
      ? `GitHub called it a conflict, but this machine merged it here with no overlap at all — ${localVerdict.reason}`
      : localVerdict
        ? `GitHub called it a conflict, and this machine could not check whether that is true — ${localVerdict.reason}`
        : 'GitHub reported that the branch conflicts with newer work on `main`, and no local check was attempted';
  // Who acts next, said out loud. Anything that is not a proven no-overlap is
  // work somebody has to do — deciding what a merged file says, or finding out
  // why the check could not run — and the only honest sentence names who is
  // going to do it. With a filed ticket that is the build loop, which drains
  // the Loop Queue on a timer today. Without one it is nobody, and the body
  // must say so rather than reach for the passive voice that hid the missing
  // actor before. This reads the SAME predicate the filing decision reads.
  const actor = conflictActor({ localVerdict, filed });

  // What the work IS, and what to CALL it — both differ between the two
  // non-healing answers. A ticket that tells its builder to resolve an overlap,
  // when no overlap was ever established, sends them looking for markers that
  // may not be there: the original 2026-08-30 defect, one level down.
  //
  // The real-overlap wording is left EXACTLY as it was. Review round 2
  // verified those two bodies byte-for-byte against main as evidence that the
  // round-1 fix had not disturbed them, and that is a property worth keeping
  // rather than a coincidence to spend.
  const theWork = realOverlap
    ? 'Sorting that overlap out is a code change rather than a decision, and a script must never resolve one blind, so it was not attempted.'
    : `Whether there is anything to resolve is still unknown — the local check did not run${permanent ? ', and it never will from the relay machine: the branch is in a repo that machine has no checkout of, so every future pass returns this same answer' : ''}.`;
  // From the shared table, not from a local ternary (review round 3). This is
  // the noun the FILED TICKET's title has to agree with, and it did not: the
  // comment said "Finding out" and pointed at a ticket titled "Resolve the
  // merge conflict on...". Both read one entry now, so they cannot disagree.
  const theHandOver = verdictCopy(localVerdict).handOver;

  let whatHappensNext;
  if (selfHealing) {
    whatHappensNext = 'It will be merged on the next run, unless something else is in the way by then — GitHub\'s answer about a branch is often minutes stale.';
  } else if (filed) {
    whatHappensNext = `${theWork} ${theHandOver} is now ticket ${filed.id} (${filed.url}) in the Loop Queue, which the build loop drains every pass. Once that branch is caught up and its checks are green, this merges on a later run.`;
  } else {
    // The stalled sentence. It is deliberately blunt: this is the state that
    // cost three days, and a reader must not be able to finish this paragraph
    // thinking something is underway.
    whatHappensNext = `${theWork} **Nothing is currently working on it** — filing the resolution as a Loop Queue ticket did not succeed, so no build loop will pick this up and this PR will not merge on its own. It needs an agent session pointed at the branch, which means asking for one.`;
  }

  const marker = `refused: conflict hand-off on PR #${pr.number}`;
  const promise = mayPromiseApproval({ marker, actor })
    ? `${APPROVAL_CARRIES_OVER}\n\n`
    : '';
  return {
    marker,
    actor,
    // The verdict travels WITH the actor so the merge step never has to
    // re-derive either one (review round 3).
    kind: conflictVerdictKind(localVerdict),
    body: `This task was not able to merge on the last attempt, because ${because}.\n\n${whatHappensNext}\n\n${promise}Nothing was merged and nothing was changed; the ticket stays Ready to launch.\n\n${pr.url}\n\n(Automatic — bus-relay merge step, authorized by your comment ${commentId}.)`,
  };
}

/**
 * The one genuinely terminal outcome. Re-deciding a merged PR is the single
 * mistake that cannot be undone, so this marker stays spent forever and the
 * body makes no promise about a next pass — there is not going to be one.
 */
function mergedNotice({ commentId, pr, mergedAt, lane, files }) {
  // WHOSE WORD MERGED IT (2026-08-25, task 86bbkw2au). Until Lane A there was
  // only one answer — his comment — and the sentence said so. Now there are
  // two, and a record that says "merged on operator comment 123" about a merge
  // he never authorized would be the worst kind of untrue: it would read, to
  // him and to any later audit, as evidence of an approval that does not
  // exist. So the attribution is built from what actually happened.
  const because = lane
    ? `auto-merged under Lane ${lane} after a one-hour objection window with no objection` +
      (files && files.length ? `, qualified by: ${files.map((f) => `\`${f}\``).join(', ')}` : '')
    : `merged on operator comment ${commentId}`;
  return {
    marker: `merged PR #${pr.number} at ${mergedAt}`,
    actor: 'none',
    body: `Merged: PR #${pr.number} (${pr.url}) squash-merged into main at ${mergedAt}, ${because}. Checks were green and the branch was up to date at merge time; the branch has been deleted. main auto-deploys, so this is on its way live now.\n\n(Automatic — bus-relay ${lane ? 'auto-merge' : 'merge step'}.)`,
  };
}

module.exports = {
  IN_PASS_WAIT_MS,
  IN_PASS_POLL_MS,
  MAX_IN_PASS_WAITS,
  mayWaitInPass,
  afterCatchUpDecision,
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
  markerKind,
  mayPromiseApproval,
  refusalNotice,
  conflictHandOffNotice,
  mergedNotice,
  APPROVAL_CARRIES_OVER,
};
