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
const { prTrailLanded } = require('./loopTrail.js');

/**
 * The ticket link in a PR body. `pr-opened` refuses a PR whose body carries no
 * link back to its ticket, so on loop-built PRs this is reliable; a hand-made
 * PR that skipped that step is exactly the case the gate is here to catch.
 *
 * That premise is now TRUE as written. It was not before 2026-08-26: this gate
 * required a full URL while `pr-opened` ALSO accepted a bare id, so a body that
 * command called traceable could arrive here and be refused for carrying no
 * link at all (task 86bbmmv7t, finding 2). Both sides read the one matcher
 * below now, and it carries the reasoning for which shape won.
 */
const { CLICKUP_LINK_RE, findTicketId, findTicketIds } = require('./clickupTicketLink.js');

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
 * How many parents a commit has, given either shape the world hands us.
 *
 * GitHub's native REST commit object carries `parents` as an ARRAY of parent
 * objects; the runner in `scripts/review_gate.mjs` maps it down to a count with
 * jq before calling in. The first version of this read `Number(parents || 1)`,
 * which handles only the count — `Number([{}, {}])` is `NaN`, and `NaN > 1` is
 * false, so under the native shape every catch-up merge silently counted as the
 * branch's own work and the merge exclusion below quietly went away
 * (task 86bbmmv7t, finding 4).
 *
 * No live caller was affected, because only the runner's own jq mapping
 * produces the count. That is exactly what made it worth fixing: the next
 * caller handed the native shape would have restored the catch-up deadlock this
 * function exists to avoid, and done it invisibly — the failure direction is
 * the strict one, so nothing goes wrong loudly, reviews just start reading as
 * stale for no reason a reader can see.
 *
 * Anything unreadable counts as ONE parent, i.e. as the branch's own work. That
 * is the strict direction: an unrecognised commit tightens the freshness rule
 * rather than escaping it.
 */
function parentCount(parents) {
  if (Array.isArray(parents)) return parents.length;
  const n = Number(parents);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
      isMerge: parentCount(c && c.parents) > 1,
    }))
    .filter((c) => Number.isFinite(c.at));
  if (!dated.length) return NaN;
  const own = dated.filter((c) => !c.isMerge);
  const pool = own.length ? own : dated;
  return pool.reduce((best, c) => (c.at > best ? c.at : best), -Infinity);
}

/**
 * Is the ticket the gate just read actually THIS pull request's ticket?
 *
 * WHY (2026-08-26, task 86bbmmv7t, finding 1 — the one that failed OPEN).
 * `findTicketId` returns the FIRST ClickUp link in the body, and nothing
 * checked that it was the PR's own. A body that cites a related ticket before
 * its own was judged against THAT ticket's verdict, and PASSED whenever that
 * verdict happened to be newer than this PR's newest non-merge commit — the
 * gate opening on a review of entirely different work.
 *
 * It did not bite in the live record only because of an ordering CONVENTION:
 * loop-built bodies put their own ticket on line 1. A convention is what this
 * whole gate exists to stop relying on. PR #433's own body proves the shape is
 * live — it carries 86bbmfbkv on line 1 and 86bbmk7pv on line 156, and had
 * those been the other way round the gate would have judged it against a ticket
 * it does not belong to.
 *
 * The confirmation reuses `loopTrail.prTrailLanded`, which is the reader
 * `pr-opened` already verifies its own write with: the ticket's newest
 * PR line must name this PR's number. Reused rather than re-implemented for
 * the same reason the verdict parser is imported — two readers of one fact
 * drift, and finding 2 on this very ticket is what that costs.
 *
 * A PR number the gate was not given is not a pass either. "I could not check"
 * and "it checked out" must never collapse into the same answer.
 */
function ticketNamesThisPr(comments, prNumber) {
  const want = Number(prNumber);
  if (!Number.isFinite(want) || want <= 0) {
    return { ok: false, why: 'the gate was not told which PR it is judging, so it cannot confirm the ticket belongs to this PR' };
  }
  const landed = prTrailLanded(comments, want);
  if (landed.ok) return { ok: true, why: '' };
  return { ok: false, why: landed.why };
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
 * @param {string|number} input.prNumber  which PR this is, so the ticket the
 *                                        body points at can be confirmed as
 *                                        this PR's own
 * @param {string|number} input.headCommittedAt  the newest commit's timestamp
 * @param {Array|null} input.comments   the ticket's ClickUp comments, or null
 *                                      if they could not be read
 * @param {string} [input.clickupError] why the comments could not be read
 * @returns {{verdict: string, reason: string, ticketId: string,
 *            waiverReason: string, verdictCommentId: string}}
 */
function reviewGateDecision({ prBody, prNumber, headCommittedAt, comments, clickupError } = {}) {
  const base = { ticketId: '', waiverReason: '', verdictCommentId: '', cause: '' };

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
      cause: 'clickup-unreachable',
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
      cause: 'unreadable-dates',
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

  // Everything above says the ticket carries a fresh PASS. One question is
  // left, and it is the one that failed open: is this ticket THIS PR's?
  //
  // Checked HERE, on the pass path alone, rather than up beside the ticket
  // link. Every refusal above is already safe, so moving the check earlier
  // could only change the WORDING of a refusal, never its outcome — and it
  // would change it for the worse in the gate's commonest case. A hand-made PR
  // typically has neither a review verdict nor a recorded PR line, and
  // "ticket X carries no review verdict" is the message that reader needs;
  // pointing them at the trail would send them to fix bookkeeping on a ticket
  // that nothing has reviewed.
  const owned = ticketNamesThisPr(comments, prNumber);
  if (!owned.ok) {
    return {
      ...base,
      ticketId,
      verdictCommentId,
      verdict: CANNOT_TELL,
      cause: 'ticket-not-this-prs',
      reason: `ticket ${ticketId} carries a review PASS, but it cannot be confirmed to be this PR's ticket: ${owned.why}`,
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
 * THE GATE'S OWN VOICE — and why it does not say "REVIEW".
 *
 * `mergeOnComment.isReviewVerdict` treats any line beginning with the word
 * REVIEW as a review verdict, deliberately and case-insensitively. The gate's
 * messages used to begin with that word, which meant every single one of them —
 * pass, fail and CANNOT TELL alike — parsed as a verdict, and as a SEND-BACK,
 * since none of them matches the PASSED spelling (task 86bbmmv7t, finding 3).
 *
 * Nothing automated pasted them onto a ticket, so it never bit. But a refusal
 * here is written to tell the reader what to do next, which makes copying it
 * onto the ticket the natural next move for a person or an agent — and doing
 * that would have made the gate's own words the ticket's newest verdict,
 * freezing `readyToLaunchGate`, `mergeDecision` and this gate at once, with
 * the ticket showing a send-back nobody wrote.
 *
 * The fix is to stay out of that namespace: every message this file and
 * `scripts/review_gate.mjs` emit begins with GATE_LABEL, which the verdict
 * parser does not recognise. Exported rather than typed twice so the runner
 * cannot drift back, and a test asserts every real output string reads as no
 * verdict at all.
 */
const GATE_LABEL = 'MERGE GATE';

/**
 * WHAT A FAILURE SAYS.
 *
 * A red X that says "the gate failed" teaches nothing and, worse, teaches
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
      `${GATE_LABEL} WAIVED — ${label} merged past the review check on purpose.`,
      '',
      `Reason given: ${decision.waiverReason}`,
      ticketLine,
      '',
      'This was announced on the bus. An override nobody can see is not an',
      'override, it is a hole — so every use of `[gate-waived: ...]` is reported.',
    ].join('\n');
  }

  if (decision.verdict === PASS) {
    return [`${GATE_LABEL} PASSED — ${decision.reason}`, ticketLine].join('\n');
  }

  const fix = decision.cause === 'ticket-not-this-prs'
    ? [
      'The PR body points at a ticket, and that ticket has been reviewed — but',
      'nothing on it says it is about THIS pull request, so the review may',
      'belong to different work. The gate refuses rather than borrowing it.',
      '',
      "What to do: put this PR's OWN ticket link first in the body (a body may",
      'cite other tickets, but the first link is the one that is read), and make',
      'sure that ticket records this PR — `npm run clickup -- pr-opened --task',
      '<id> --pr <url>` writes that line and checks it landed. Then re-run.',
    ]
    : decision.cause === 'unreadable-dates'
      ? [
        'The gate could not compare the review date with the commit date, so it',
        'cannot tell whether the review covers the code about to merge. It fails',
        'rather than passes, deliberately.',
        '',
        'What to do: re-run this check. If it keeps failing, the verdict comment',
        'on the ticket has an unreadable timestamp — say so on the bus.',
      ]
      : decision.verdict === CANNOT_TELL
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
            'its own — `https://app.clickup.com/t/<id>`. The full link, not the id',
            'alone; every PR gets a ticket, hand-made ones included. If this',
            'genuinely has no ticket and must merge anyway, put',
            '`[gate-waived: <reason>]` in the body; that is allowed, and it is',
            'reported to the bus.',
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
    `${GATE_LABEL} ${decision.verdict} — ${label} may not merge.`,
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
  return `[CC-starcaster review-gate] ${GATE_LABEL} WAIVED on PR #${prNumber}${who}: ${reason}\n\nThis PR is merging without a recorded review PASS, on purpose. Reason as given in the PR body above.\n\n${prUrl}`;
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
  PASS,
  FAIL,
  CANNOT_TELL,
  WAIVED,
  GATE_LABEL,
  CLICKUP_LINK_RE,
  WAIVER_RE,
  PLACEHOLDER_REASON_RE,
  findTicketId,
  findTicketIds,
  findWaiver,
  toMillis,
  parentCount,
  newestSubstantiveCommitAt,
  ticketNamesThisPr,
  allowsMerge,
  reviewGateDecision,
  gateMessage,
  waiverAnnouncement,
  exitCodeFor,
  isEnforcing,
};
