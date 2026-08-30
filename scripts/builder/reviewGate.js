'use strict';

/**
 * reviewGate — may this pull request be merged, given what its ticket says?
 *
 * WHY THIS EXISTS (2026-08-25, task 86bbmfbkv). On 2026-08-25 at 12:38, PR
 * #432 was built and merged to production with no review verdict on its
 * ticket and no merge word from Dane. Ticket 86bbjt1aq went `Live` without
 * ever reaching `Ready to launch`.
 *
 * None of the unattended machinery did it. It was a second Claude Code
 * session on the MacBook running `gh pr merge 432 --squash` — an ordinary
 * session, with ordinary `gh` access, that had no way to know a review lane
 * was waiting for that PR.
 *
 * That is the whole lesson: "loops never merge" is a CONVENTION, and a
 * convention only reaches the actors that know they are bound by it. A fresh
 * session, a forgotten terminal window, an operator in a hurry — none of
 * them are. So the rule stops being something every actor must remember and
 * becomes something the repository enforces, as a required status check.
 *
 * Everything in here is a pure function over data someone else fetched: the
 * PR body, the head commit's timestamp, and the ticket's comments. No
 * network, no `gh`, no ClickUp client — which is what makes every refusal
 * path testable, including the ones that are awkward to reproduce live (a
 * PASS that predates the newest commit; ClickUp being unreachable).
 *
 * The verdict parser is IMPORTED from mergeOnComment, never re-implemented.
 * A gate that disagreed with the merge step about what counts as a PASS
 * would be worse than no gate: it would refuse merges the merge step thinks
 * are fine, or wave through ones it does not. reviewGate.test.js asserts the
 * two agree across a fixture set, so they cannot drift apart later.
 */

const { isReviewVerdict, isReviewPassed } = require('./mergeOnComment.js');

/**
 * The ticket link in a PR body. `pr-opened` refuses a PR whose body carries
 * no link back to its ticket, so on loop-built PRs this is reliable; a
 * hand-made PR that skipped that step is exactly the case the gate is here
 * to catch.
 *
 * Both live shapes are accepted: the plain `app.clickup.com/t/<id>` form the
 * loop writes, and the `t/<workspace>/<id>` form ClickUp's own "copy link"
 * button produces. Ids are alphanumeric (`86bbmfbkv`), so the workspace
 * segment — all digits — is distinguished by shape rather than by position.
 */
const CLICKUP_LINK_RE = /https?:\/\/app\.clickup\.com\/t\/(?:\d+\/)?([a-z0-9]+)/i;

/**
 * A deliberate override, e.g. `[gate-waived: hotfix, site is down]`.
 *
 * LINE-ANCHORED, and that is not a detail. The first version of this matched
 * anywhere in the body, and the very first CI run caught it: THIS gate's own
 * pull request explains the waiver syntax in its description, and the gate
 * read its own documentation as a live waiver and let itself through. Any PR
 * that quoted the syntax — a doc change, a discussion, a table of the rules —
 * would have bypassed the gate while looking completely ordinary.
 *
 * So a waiver must sit ALONE on its line, exactly as mergeOnComment anchors
 * its verdict regexes for the same reason: a comment that merely DISCUSSES
 * the words is prose, not an instruction. This anchor covers the sentence and
 * the table cell; the code-block skip in `findWaiver` below covers the other
 * shape a written-down example takes.
 *
 * Deliberately requires a REASON — `[gate-waived:]` does not match — because
 * the whole value of an override is that it is legible afterwards. An
 * override nobody can see is not an override, it is a hole, which is why
 * using one also posts to the bus (see `waiverAnnouncement`).
 */
const WAIVER_RE = /^[ \t>*-]*\[gate-waived:\s*([^\]\n]+?)\s*\][ \t]*$/i;

/**
 * The two ways Markdown says "this is an example, not an instruction":
 * a fenced block (``` or ~~~) and an indented block (four spaces, or a tab).
 *
 * Scanning line by line and skipping both is the rest of the fix above, and
 * it closes the same hole one step further out (found in review, 2026-08-25).
 * The line anchor alone stops a mention inside a SENTENCE, but this repo
 * documents its own rules with realistic, runnable-looking examples — and an
 * example sitting alone inside a code fence has exactly the shape of a real
 * waiver. The next docs page to write a plausible reason would have waived
 * the gate silently, which is the original bug wearing a different hat.
 *
 * Both skips fail CLOSED: an unbalanced fence makes the remainder of the body
 * read as code, so a waiver after it is ignored and the gate still checks the
 * ticket. Losing a waiver costs one edit; granting one costs a merge.
 */
const CODE_FENCE_RE = /^[ \t]*(?:`{3,}|~{3,})/;
const INDENTED_CODE_RE = /^(?: {4,}|\t)/;

/**
 * A reason that is obviously a placeholder copied out of the documentation,
 * not a reason. Belt and braces beside the line anchor above: an example is
 * often written on a line of its own, which is precisely the shape a real
 * waiver has.
 */
const PLACEHOLDER_REASON_RE = /^<[^>]*>$/;

/** The ticket id a PR body points at, or '' if it points at none. */
function findTicketId(prBody) {
  const m = CLICKUP_LINK_RE.exec(String(prBody || ''));
  return m ? m[1] : '';
}

/**
 * The waiver reason a PR body carries, or '' if it carries none.
 *
 * Scans EVERY candidate line rather than only the first. That is not a
 * detail: the first version took `WAIVER_RE.exec(body)` once, so a body whose
 * first match was a placeholder stopped the search there — and the regression
 * test named after the self-waiver incident could not fail, because its
 * fixture's first match was `<reason>` and a different guard caught it
 * (found in review, 2026-08-25). Rejecting a placeholder now skips that ONE
 * line and keeps looking, so each rule is pinned by its own behaviour.
 */
function findWaiver(prBody) {
  let inFence = false;
  for (const line of String(prBody || '').split(/\r?\n/)) {
    if (CODE_FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || INDENTED_CODE_RE.test(line)) continue;
    const m = WAIVER_RE.exec(line);
    if (!m) continue;
    const reason = m[1].trim();
    if (PLACEHOLDER_REASON_RE.test(reason)) continue;
    return reason;
  }
  return '';
}

/** ClickUp dates are epoch-millisecond STRINGS; git dates are ISO. */
function toMillis(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * The newest commit that could have changed what a reviewer actually read.
 *
 * WHY THIS IS NOT SIMPLY "the newest commit" (found 2026-08-25 while checking
 * the gate against live PRs, task 86bbmfbkv). Branch protection here is
 * `strict: true`, so a branch must be current with `main` to merge — and this
 * repo catches up by MERGING origin/main in rather than rebasing, on purpose
 * (DOCTRINE §6.6, so a convenience script never force-pushes). Every catch-up
 * therefore adds a commit that is newer than any review.
 *
 * A naive "newest commit" rule made real, correctly-reviewed PRs fail: #406
 * was passed at 14:11 on 08-23 and its three later commits were all
 * `Merge remote-tracking branch 'origin/main'`; #400 the same. Enforcing that
 * rule would have deadlocked the whole pipeline — catch up, go stale,
 * re-review, catch up again — which is the exact false-fail the ticket asked
 * to be confirmed absent before switching the gate on.
 *
 * So merge commits are excluded, tested structurally by PARENT COUNT rather
 * than by matching the merge message: a message string is a convention that a
 * future catch-up could word differently, while "has two parents" is what a
 * merge IS.
 *
 * RESIDUAL RISK, stated rather than hidden: a merge commit CAN carry changes
 * of its own, when whoever resolved a conflict wrote new code into the
 * resolution (an "evil merge"). Parent count cannot see that. It is a narrow
 * hole — this repo's catch-ups are performed by a script that refuses to
 * resolve a conflict at all (branchCatchUp), so a conflicted catch-up stops
 * and asks a human rather than committing a resolution unreviewed — and it is
 * far outside the failure this gate exists for. Closing it needs a real diff
 * against the merge base, which is a bigger change than this ticket.
 *
 * A PR made ENTIRELY of merge commits has no "own" commit to measure, so it
 * falls back to the strictest reading — the newest commit of any kind —
 * rather than quietly having no freshness rule at all.
 */
function newestSubstantiveCommitAt(commits) {
  const dated = (commits || [])
    .map((c) => ({
      at: toMillis(c && (c.committedDate ?? c.date)),
      isMerge: Number((c && c.parents) || 1) > 1,
    }))
    .filter((c) => Number.isFinite(c.at));
  if (!dated.length) return NaN;
  const own = dated.filter((c) => !c.isMerge);
  const pool = own.length ? own : dated;
  return pool.reduce((best, c) => (c.at > best ? c.at : best), -Infinity);
}

function byDateNewestFirst(comments) {
  return (comments || [])
    .slice()
    .sort((a, b) => (toMillis(b && b.date) || 0) - (toMillis(a && a.date) || 0));
}

/**
 * The four verdicts. `WAIVED` is kept distinct from `PASS` rather than
 * folded into it because the two need different follow-up: a PASS is
 * silent, a WAIVED is announced.
 */
const PASS = 'PASS';
const FAIL = 'FAIL';
const CANNOT_TELL = 'CANNOT TELL';
const WAIVED = 'WAIVED';

/** Do these verdicts allow the merge to proceed? */
function allowsMerge(verdict) {
  return verdict === PASS || verdict === WAIVED;
}

/**
 * Decide whether this PR carries a review that covers the code about to
 * merge.
 *
 * @param {object} input
 * @param {string} input.prBody         the pull request description
 * @param {string|number} input.headCommittedAt  the newest commit's timestamp
 * @param {Array|null} input.comments   the ticket's ClickUp comments, or null
 *                                      if they could not be read
 * @param {string} [input.clickupError] why the comments could not be read
 * @returns {{verdict: string, reason: string, ticketId: string,
 *            waiverReason: string, verdictCommentId: string}}
 */
function reviewGateDecision({ prBody, headCommittedAt, comments, clickupError } = {}) {
  const base = { ticketId: '', waiverReason: '', verdictCommentId: '' };

  // The override is read FIRST, before the ticket link is even required. A
  // waiver is the deliberate way past every rule below it, including the
  // no-ticket rule — a hotfix opened by hand at 2am is precisely the case
  // it exists for. It is safe to put first only because using one is
  // announced on the bus, so the cost of reaching for it is visibility.
  const waiverReason = findWaiver(prBody);
  if (waiverReason) {
    return {
      ...base,
      verdict: WAIVED,
      ticketId: findTicketId(prBody),
      waiverReason,
      reason: `the PR body waives this gate: ${waiverReason}`,
    };
  }

  // A PR nobody can trace is exactly what should not merge. Hand-made PRs
  // get a ticket, like everything else.
  const ticketId = findTicketId(prBody);
  if (!ticketId) {
    return {
      ...base,
      verdict: FAIL,
      reason: 'the PR body carries no ClickUp ticket link, so there is no review to check',
    };
  }

  // A gate that opens when it cannot see is not a gate. ClickUp being
  // unreachable is the one answer that must never be mistaken for "fine":
  // "nothing reviewed this" and "I could not find out" look identical from
  // here, and only one of them is safe.
  if (!Array.isArray(comments)) {
    return {
      ...base,
      ticketId,
      verdict: CANNOT_TELL,
      reason: `could not read ticket ${ticketId} from ClickUp${clickupError ? `: ${clickupError}` : ''}`,
    };
  }

  const newestVerdict = byDateNewestFirst(comments)
    .find((c) => isReviewVerdict(c && c.comment_text));

  if (!newestVerdict) {
    return {
      ...base,
      ticketId,
      verdict: FAIL,
      reason: `ticket ${ticketId} carries no review verdict — loop-review has not passed this work`,
    };
  }

  const verdictCommentId = String(newestVerdict.id || '');

  if (!isReviewPassed(newestVerdict.comment_text)) {
    return {
      ...base,
      ticketId,
      verdictCommentId,
      verdict: FAIL,
      reason: `the newest review verdict on ticket ${ticketId} is a send-back, not a PASS`,
    };
  }

  // A PASS on an older commit is not a review of what is about to merge.
  // This is the send-back-then-push case: reviewed, sent back, fixed,
  // pushed — and the PASS still sitting on the ticket now describes code
  // that no longer exists.
  const verdictAt = toMillis(newestVerdict.date);
  const headAt = toMillis(headCommittedAt);

  // An unreadable timestamp on either side is a CANNOT TELL, not a pass:
  // the freshness rule is the half of this gate that catches the subtlest
  // failure, and skipping it because a date would not parse is the same
  // "open when you cannot see" mistake as above.
  if (!Number.isFinite(verdictAt) || !Number.isFinite(headAt)) {
    return {
      ...base,
      ticketId,
      verdictCommentId,
      verdict: CANNOT_TELL,
      reason: 'could not compare the review date with the commit date — one of them is unreadable',
    };
  }

  if (verdictAt < headAt) {
    return {
      ...base,
      ticketId,
      verdictCommentId,
      verdict: FAIL,
      reason: `the review PASS on ticket ${ticketId} (${new Date(verdictAt).toISOString()}) is older than this PR's newest commit (${new Date(headAt).toISOString()}) — it reviewed code that has since changed`,
    };
  }

  return {
    ...base,
    ticketId,
    verdictCommentId,
    verdict: PASS,
    reason: `ticket ${ticketId} carries a review PASS from ${new Date(verdictAt).toISOString()}, newer than this PR's head commit`,
  };
}

/**
 * ---------------------------------------------------------------------------
 * STALENESS — the answer a check gave before the question changed
 * (2026-08-26, task 86bbmk7pv).
 * ---------------------------------------------------------------------------
 *
 * A GitHub status check is computed ONCE PER COMMIT. This gate reads the
 * ticket for a review PASS — and loop-review posts that PASS *after* the last
 * push, by definition. So the run that already happened saw no verdict,
 * recorded a fail, and will not re-run on its own. Nothing later changes its
 * mind.
 *
 * While the gate is advisory that is harmless. The moment the
 * branch-protection box is ticked it is a deadlock: every correctly-reviewed
 * PR carries a stale red check that only a new commit can clear, and pushing
 * a commit to clear it invalidates the review that just passed.
 *
 * The fix is not to weaken the gate. It is for the merge step to notice that
 * the check answered an older question and RE-RUN it before merging — which
 * is what these functions decide. As everywhere else in this file, they are
 * pure: the caller fetches the rollup and the comments, and carries the
 * answer out with `gh`.
 */

/** The check the gate publishes. The workflow's job id, so also its name. */
const REVIEW_GATE_CHECK_NAME = 'review-gate';

/**
 * The workflow run id inside a check run's details URL, e.g.
 * `https://github.com/alphire/starcaster/actions/runs/1234/job/5678` -> '1234'.
 * `gh run rerun` takes the RUN id, not the job id, so the digits after
 * `/runs/` are the ones that matter and the `/job/` tail is ignored.
 */
function runIdFromDetailsUrl(url) {
  const m = /\/actions\/runs\/(\d+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

/**
 * The review-gate entry in a `gh pr view --json statusCheckRollup` payload.
 *
 * Matches on the check's own name OR its workflow name, case-insensitively:
 * the job is named by its id today, and a future `name:` line in the workflow
 * would otherwise make this quietly stop finding it — and "not found" reads
 * as "no gate on this PR", which is the failure wearing a disguise.
 *
 * Newest wins, measured by when the run STARTED. A re-run appears alongside
 * the answer it replaces for a few seconds, and taking the older one back
 * would make the merge step re-run the gate forever.
 */
function findReviewGateRun(rollup) {
  let best = null;
  let bestAt = -Infinity;
  for (const c of rollup || []) {
    const name = String((c && (c.name || c.context)) || '');
    const workflow = String((c && c.workflowName) || '');
    if (name.toLowerCase() !== REVIEW_GATE_CHECK_NAME
      && workflow.toLowerCase() !== REVIEW_GATE_CHECK_NAME) continue;
    const at = toMillis(c.startedAt ?? c.completedAt ?? c.createdAt);
    const key = Number.isFinite(at) ? at : -Infinity;
    if (best === null || key >= bestAt) { best = c; bestAt = key; }
  }
  return best;
}

/** When the newest REVIEW verdict landed on the ticket, or NaN if there is none. */
function newestVerdictAt(comments) {
  const newest = byDateNewestFirst(comments).find((c) => isReviewVerdict(c && c.comment_text));
  return newest ? toMillis(newest.date) : NaN;
}

/** Has this check run finished? An unfinished one has no answer to be stale. */
function isRunComplete(run) {
  const status = String((run && run.status) || '').toUpperCase();
  if (status) return status === 'COMPLETED';
  // A StatusContext has no `status`; `state` PENDING/EXPECTED means running.
  const state = String((run && run.state) || '').toUpperCase();
  if (state) return state !== 'PENDING' && state !== 'EXPECTED';
  return false;
}

/**
 * Does this PR's review-gate check still answer the current question?
 *
 * Compares the run's START time with the newest verdict, NOT its completion
 * time, and that direction is the safe one: a verdict posted before the run
 * started was certainly visible to it, while one posted after the start may
 * or may not have been read before the job fetched the ticket. Comparing
 * against `completedAt` would call that ambiguous run fresh. Being wrong here
 * costs one CI minute in one direction and a merge on an unreviewed verdict
 * in the other.
 *
 * @returns {{state: 'fresh'|'stale'|'pending'|'absent', reason: string,
 *            runId: string, checkStartedAt: number, verdictAt: number}}
 */
function reviewGateStaleness({ rollup, comments } = {}) {
  const run = findReviewGateRun(rollup);
  const base = { runId: '', checkStartedAt: NaN, verdictAt: NaN };

  // NO REVIEW-GATE RUN AT ALL is deliberately not a refusal here, and the
  // reasoning matters. This function's job is "is the existing answer out of
  // date", and there is no answer to be out of date. The two actors that
  // could merge such a PR are both already covered: GitHub itself refuses one
  // once the check is required (githubGate sees BLOCKED), and the relay's own
  // merge path has independently checked the ticket's verdict in ClickUp
  // before it gets here. Refusing instead would strand every PR opened before
  // the workflow existed, which is a deadlock introduced by the fix for a
  // deadlock.
  if (!run) {
    return { ...base, state: 'absent', reason: 'this PR carries no review-gate check run' };
  }

  const runId = runIdFromDetailsUrl(run.detailsUrl || run.targetUrl);
  const checkStartedAt = toMillis(run.startedAt ?? run.completedAt ?? run.createdAt);
  const verdictAt = newestVerdictAt(comments);
  const found = { runId, checkStartedAt, verdictAt };

  if (!isRunComplete(run)) {
    return { ...found, state: 'pending', reason: 'the review-gate check is still running' };
  }

  // An unreadable timestamp on either side is treated as STALE, not fresh.
  // Same rule as the gate itself: cannot-see is never a pass — and here the
  // remedy is cheap, because "stale" only means "run it again".
  if (!Number.isFinite(checkStartedAt) || !Number.isFinite(verdictAt)) {
    return {
      ...found,
      state: 'stale',
      reason: 'could not compare the review-gate run with the newest verdict — one of the two timestamps is unreadable',
    };
  }

  if (checkStartedAt > verdictAt) {
    return {
      ...found,
      state: 'fresh',
      reason: `the review-gate check started ${new Date(checkStartedAt).toISOString()}, after the newest verdict (${new Date(verdictAt).toISOString()})`,
    };
  }

  return {
    ...found,
    state: 'stale',
    reason: `the review-gate check started ${new Date(checkStartedAt).toISOString()}, before the newest verdict (${new Date(verdictAt).toISOString()}) — it answered a question that has since changed`,
  };
}

/**
 * The gate the re-run wait polls on, instead of the ordinary check gate.
 *
 * WHY THE ONLY PASS-THROUGH IS 'fresh' (found in review, 2026-08-30). A
 * re-run was just fired, so for a few seconds GitHub's rollup is in flux:
 * first it still shows the old, settled, stale answer, then it may show NO
 * review-gate entry at all while the old attempt is swapped for the new one.
 * Before this ran through one function, the wait hook fell through to the
 * ordinary gate on 'absent' — and at that instant the other checks are green,
 * so the PR merged with the re-run's answer never observed. 'absent' means
 * "no answer to be out of date" before a re-run exists; DURING the wait it
 * means "cannot see", and cannot-see is never a pass (acceptance criterion 4,
 * task 86bbmk7pv). So 'stale', 'pending' and 'absent' all keep waiting, and
 * only a fresh answer hands the question back to the ordinary gate — which is
 * still the one that decides whether anything may merge.
 */
function duringRerunWait({ staleness, gate } = {}) {
  const state = String((staleness && staleness.state) || '');
  if (state !== 'fresh') {
    return {
      action: 'wait',
      reason: `the re-run has not produced a fresh review-gate answer yet (${(staleness && staleness.reason) || 'no staleness answer'})`,
    };
  }
  return gate;
}

/**
 * What the merge step does with the result of waiting on a re-run.
 *
 * Takes the SHAPE `githubGate` already produces, so nothing here re-decides
 * whether a PR may merge — a green re-run goes back to the merge path, a red
 * one to the refusal path with GitHub's own wording, a conflict to the
 * hand-off.
 *
 * 'update-branch' is the one answer that is neither a pass nor a failure:
 * main moved during the ~3 minutes of waiting, so the branch needs catching
 * up — which the NEXT pass's catch-up path already does, gate re-run
 * included (the push fires `synchronize`). Before this arm existed, that
 * race polled out the full wait and then REFUSED with "the re-run did not
 * clear it" — telling the reader the gate failed when the branch merely
 * fell behind (found in review, 2026-08-30). It maps to a quiet wait, never
 * a refusal and never a merge.
 *
 * Anything else — the wait ran out, the answer was unreadable — is a
 * REFUSAL, never a merge and never a silent wait. Acceptance criterion 4 of
 * task 86bbmk7pv, and the same rule as the gate itself: a re-run whose
 * result nobody saw is not a pass. The refusal is re-decidable, so the next
 * pass merges it on the operator's original word once the re-run has landed.
 */
function afterRerunDecision({ action, reason } = {}) {
  const act = String(action || '');
  if (act === 'merge' || act === 'refuse' || act === 'conflict') {
    return { action: act, reason: reason || '' };
  }
  if (act === 'update-branch') {
    return {
      action: 'wait',
      reason: `main moved while waiting on the review-gate re-run (${reason || 'the branch is behind main'}) — the next pass catches the branch up, which re-runs the gate itself`,
    };
  }
  return {
    action: 'refuse',
    reason: `the review gate was re-run because it was stale, and this pass could not confirm the result (${reason || 'no answer'}) — refusing rather than merging on a stale gate`,
  };
}

/**
 * WHAT A FAILURE SAYS.
 *
 * A red X that says "review-gate failed" teaches nothing and, worse, teaches
 * people to route around it. Every refusal names the ticket, what its newest
 * verdict actually is, and the one thing that has to happen next — so the
 * reader's next action is obvious without opening this file.
 */
function gateMessage(decision, { prNumber } = {}) {
  const label = prNumber ? `PR #${prNumber}` : 'This PR';
  const ticketLine = decision.ticketId
    ? `Ticket: https://app.clickup.com/t/${decision.ticketId}`
    : 'Ticket: none found in the PR body';

  if (decision.verdict === WAIVED) {
    return [
      `REVIEW GATE WAIVED — ${label} merged past the review check on purpose.`,
      '',
      `Reason given: ${decision.waiverReason}`,
      ticketLine,
      '',
      'This was announced on the bus. An override nobody can see is not an',
      'override, it is a hole — so every use of `[gate-waived: ...]` is reported.',
    ].join('\n');
  }

  if (decision.verdict === PASS) {
    return [`REVIEW GATE PASSED — ${decision.reason}`, ticketLine].join('\n');
  }

  const fix = decision.verdict === CANNOT_TELL
    ? [
      'The gate could not reach ClickUp, so it cannot tell whether this work',
      'was reviewed. It fails rather than passes, deliberately: a gate that',
      'opens when it cannot see is not a gate.',
      '',
      'What to do: re-run this check. If it keeps failing, the CI ClickUp',
      'token is missing or expired — see docs/LOOP_ENGINEERING.md, "The review gate".',
    ]
    : !decision.ticketId
      ? [
        'What to do: add the ticket link to this PR description, on a line of',
        'its own — `https://app.clickup.com/t/<id>`. Every PR gets a ticket,',
        'hand-made ones included. If this genuinely has no ticket and must',
        'merge anyway, put `[gate-waived: <reason>]` in the body; that is',
        'allowed, and it is reported to the bus.',
      ]
      : [
        'What to do: let loop-review run and record a PASS on the ticket, then',
        're-run this check (a status check is computed once per commit, so a',
        'verdict posted after the last push does not reach it on its own).',
        '',
        'If this must merge without a review, put `[gate-waived: <reason>]` in',
        'the PR body; that is allowed, and it is reported to the bus.',
      ];

  return [
    `REVIEW GATE ${decision.verdict} — ${label} may not merge.`,
    '',
    `Why: ${decision.reason}.`,
    ticketLine,
    '',
    ...fix,
  ].join('\n');
}

/** The bus post that makes an override visible. */
function waiverAnnouncement({ prNumber, prUrl, reason, actor }) {
  const who = actor ? ` by ${actor}` : '';
  return `[CC-starcaster review-gate] REVIEW GATE WAIVED on PR #${prNumber}${who}: ${reason}\n\nThis PR is merging without a recorded review PASS, on purpose. Reason as given in the PR body above.\n\n${prUrl}`;
}

/**
 * ADVISORY UNTIL THE BOX IS TICKED.
 *
 * Making the check REQUIRED is a branch-protection change in GitHub's
 * settings — a browser action on Dane's account, not something an agent may
 * perform. Until he ticks it, the gate is a warning.
 *
 * "Warning" here means exit 0, not a red X, and that is a deliberate choice
 * with a specific reason: `mergeOnComment.githubGate` refuses to merge ANY
 * PR carrying a red check. An advisory gate that went red would therefore
 * not be advisory at all — it would silently block every merge the relay
 * makes, through a check nobody had agreed to enforce yet. So advisory mode
 * annotates loudly and exits clean, and enforcing mode is the switch that
 * gives the verdict teeth.
 *
 * The mode comes from the repository variable `REVIEW_GATE_ENFORCING`, set
 * in the same visit as the branch-protection tick. Keeping it a variable
 * (not an inference from "is the token present?") closes the hole in the
 * other direction: with the box ticked, a missing or revoked token yields
 * CANNOT TELL and the gate stays shut, instead of quietly reverting to
 * advisory and waving everything through.
 */
function exitCodeFor(verdict, enforcing) {
  if (allowsMerge(verdict)) return 0;
  return enforcing ? 1 : 0;
}

/** Is the repository variable asking for enforcement? */
function isEnforcing(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

module.exports = {
  REVIEW_GATE_CHECK_NAME,
  runIdFromDetailsUrl,
  findReviewGateRun,
  newestVerdictAt,
  reviewGateStaleness,
  duringRerunWait,
  afterRerunDecision,
  PASS,
  FAIL,
  CANNOT_TELL,
  WAIVED,
  CLICKUP_LINK_RE,
  WAIVER_RE,
  PLACEHOLDER_REASON_RE,
  findTicketId,
  findWaiver,
  toMillis,
  newestSubstantiveCommitAt,
  allowsMerge,
  reviewGateDecision,
  gateMessage,
  waiverAnnouncement,
  exitCodeFor,
  isEnforcing,
};
