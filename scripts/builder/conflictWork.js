'use strict';

/**
 * conflictWork — turning a merge conflict into work somebody actually picks up.
 *
 * WHY THIS EXISTS (2026-08-30, task 86bbq0fh8). When the merge step hit a real
 * conflict it did two things: it commented on the ticket telling Dane his
 * approval still stood and he need not act, and it posted `MERGE BLOCKED` to
 * the bus asking for an agent session to resolve the conflict and push.
 *
 * Nothing consumes bus messages. No session polls that channel and turns "a
 * session needs to resolve this" into claimed work, so the request went into
 * an empty room while the ticket comment beside it described a process already
 * underway. Ticket 86bbmfc15 (PR #434) sat that way from 2026-08-26 to
 * 2026-08-29. Dane found it himself and asked why nothing had happened. Every
 * relay pass in those three days logged `MERGE HANDED OFF (unchanged, nothing
 * posted)` and `0 merged` — the correct quiet behaviour once a hand-off
 * exists. The system worked as designed and the design had a hole.
 *
 * Dane picked option C on 2026-08-30: **file it into the Loop Queue.** On a
 * conflict the merge step files an ordinary `Queued` ticket — "resolve the
 * conflict on branch X for ticket Y" — into the same list the build loop
 * already drains every pass. No new consumer, because the consumer exists and
 * is already running on a timer. He is not interrupted, and the work is
 * visible on the board like everything else.
 *
 * Two rules this module exists to keep (vault `doctrine/TERMINOLOGY.md`,
 * ratified 2026-08-29):
 *
 *   - A hand-off names which of the two it needs — a person (a human being)
 *     or an agent session. A hand-off that cannot name a specific waiting
 *     actor does not get to imply one. Passive voice is the tell, and is
 *     itself the defect.
 *   - If nothing is going to pick the work up, the message says so.
 *
 * So `filed` is not decoration here. It is the named actor, and the notice
 * builder in mergeOnComment.js reads it to decide which promise the body is
 * allowed to make. No ticket filed means no actor, which means no promise.
 */

/**
 * The ONE shape a filed conflict ticket is recorded in, and the only shape
 * `findConflictTicket` will read back. Same discipline as `PR opened:` in
 * loopTrail.js — the writer and the reader share one definition, so a trail
 * the next pass cannot act on is a trail this module refuses to call written.
 */
const CONFLICT_TICKET_TRAIL = 'CONFLICT TICKET FILED:';

/** Anchored on the PR number so a REBUILT PR files its own ticket rather than
 *  matching the one filed for the PR before it. */
const CONFLICT_TICKET_RE = /CONFLICT TICKET FILED:\s*PR\s*#(\d+)\s*—\s*(\S+)/i;

/** How long a conflict may sit filed-but-unresolved before the pass stops
 *  being quiet about it. Twenty-four hours: the build loop runs on a timer
 *  measured in tens of minutes, so a day of nothing means the queue is not
 *  draining this ticket and somebody should know. Three days must be
 *  impossible; one pass of noise per day is the price. */
const STALE_HAND_OFF_MS = 24 * 60 * 60 * 1000;

/**
 * THE ONE PREDICATE (2026-08-31, task 86bbq80j5).
 *
 * `gate.action === 'conflict'` is GitHub's answer, and GitHub's answer about a
 * branch is often minutes stale. What THIS machine found when it tried the
 * merge itself is the `localVerdict`, and only one of its two kinds is work
 * anybody can do:
 *
 *   'real-conflict' — the branches genuinely changed the same lines. Somebody
 *                     has to decide what the merged file says.
 *   'unknown'       — the check could not run, or ran and found no overlap at
 *                     all: a lost push race, a stale GitHub answer. There is
 *                     nothing to resolve. The next pass retries and it clears.
 *
 * On 2026-08-30 the merge step filed a resolution ticket on `gate.action`
 * alone, while the hand-off comment built moments later read the verdict and
 * correctly promised the next pass would merge it (PR #444, ticket 86bbmmv7t).
 * Two comments landed 200ms apart naming two different actors, and the filed
 * ticket — "Resolve the merge conflict on PR #444" — described clearing
 * conflict markers that did not exist. `git merge-tree` on that pair exited 0.
 *
 * So the filing decision and the notice's actor read ONE function. They cannot
 * drift, because there is only one answer to read.
 */
function conflictVerdictKind(localVerdict) {
  // `localVerdict === null` IS A DELIBERATE CHOICE, not a fallthrough
  // (criterion 4 of task 86bbq80j5). Null means the local check produced no
  // verdict, which happens two ways and neither is evidence of an overlap:
  //
  //   - a dry run, where the check is never attempted (and a dry run files
  //     nothing regardless);
  //   - the local catch-up SUCCEEDED and pushed, and GitHub's re-read still
  //     said conflict — the textbook stale answer.
  //
  // Both read as 'unknown', so neither files a ticket. That is the safe
  // direction and it is not silence: a hand-off still sitting there after
  // STALE_HAND_OFF_MS announces itself on the bus either way, so a branch that
  // really is stuck gets escalated by the stall path. Filing on a guess is the
  // defect this predicate removes — a Queued ticket costs a build-loop pass
  // and tells whoever claims it to clear markers that may not be there.
  if (!localVerdict) return 'unknown';
  if (localVerdict.kind) return localVerdict.kind;
  return localVerdict.realConflict ? 'real-conflict' : 'unknown';
}

/** Did this machine find a genuine overlap? The only condition under which
 *  resolving the conflict is work a named actor can be handed. */
function isRealOverlap(localVerdict) {
  return conflictVerdictKind(localVerdict) === 'real-conflict';
}

/**
 * May the merge step file a Loop Queue ticket for this conflict? Same
 * predicate, named for the decision it makes, so the call site in
 * clickup_direct.mjs reads as the question it is asking.
 */
function shouldFileConflictTicket(localVerdict) {
  return isRealOverlap(localVerdict);
}

/** The comment written on the ORIGINAL ticket, recording where the resolution
 *  work now lives. */
function conflictTicketFiledComment({ id, url, prNumber }) {
  return `${CONFLICT_TICKET_TRAIL} PR #${prNumber} — ${url}\n\nResolving the conflict on PR #${prNumber} is now ticket ${id} in the Loop Queue, which the build loop drains every pass. This ticket stays in Ready to launch and needs nothing from you.`;
}

/**
 * Has a conflict ticket already been filed for this PR? Idempotency lives
 * here rather than in the caller because the merge step runs every pass: a
 * conflict that persists for a day would otherwise file twenty-four identical
 * tickets into the queue the build loop is trying to drain.
 */
function findConflictTicket(comments, prNumber) {
  for (const c of comments || []) {
    const m = CONFLICT_TICKET_RE.exec(String((c && c.comment_text) || ''));
    if (!m) continue;
    if (Number(m[1]) !== Number(prNumber)) continue;
    const url = m[2].replace(/[.,)]+$/, '');
    const id = url.split('/').filter(Boolean).pop();
    return { id, url, prNumber: Number(m[1]) };
  }
  return null;
}

/** The filed ticket's name. Says the branch, because that is what the session
 *  picking it up has to check out. */
function conflictTicketName({ pr, branch }) {
  return `Resolve the merge conflict on PR #${pr.number}${branch ? ` (${branch})` : ''}`;
}

/**
 * The filed ticket's description. Written for the build loop that will claim
 * it: what is wrong, which branch, what "done" is, and — the part the bus post
 * never carried — that Dane's merge word is already given and must not be
 * asked for again.
 */
function conflictTicketBody({ task, pr, branch, localVerdict, commentId }) {
  const what = isRealOverlap(localVerdict)
    ? `This branch and \`main\` have both changed the same lines — ${localVerdict.reason}`
    : localVerdict
      ? `GitHub called it a conflict and the relay machine could not check whether that is true — ${localVerdict.reason}`
      : 'GitHub reported that the branch conflicts with newer work on `main`.';

  return [
    '## What is wrong',
    '',
    what,
    '',
    `The merge step never resolves a conflict blind (task 86bbjd5nn, binding), so it filed this instead of guessing. This ticket IS the agent session the old bus post used to ask an empty room for (task 86bbq0fh8).`,
    '',
    '## The branch',
    '',
    `- PR: ${pr.url}`,
    branch ? `- Branch: \`${branch}\`` : '- Branch: read it off the PR.',
    `- Waiting ticket: ${task.url} — "${task.name}"`,
    '',
    '## Scope',
    '',
    `Catch \`${branch || 'the branch'}\` up with \`main\`, resolve the overlap by hand, and push. Nothing else — this is not a licence to change what the PR does.`,
    '',
    '## Acceptance criteria',
    '',
    `- [ ] The branch merges cleanly into \`main\` (\`git merge origin/main\` on the branch, no conflict markers left anywhere)`,
    '- [ ] Only ordinary pushes — merge `origin/main` in, never rebase-and-force (`docs/DOCTRINE.md` §6.6)',
    `- [ ] CI is green on PR #${pr.number}`,
    `- [ ] Nothing on ${task.url} is changed — its status stays Ready to launch`,
    '',
    '## Do NOT ask Dane to say "merge" again',
    '',
    `He already authorized it (his comment ${commentId} on ${task.url}). The merge marker there is re-decidable, so the next relay pass merges it on that original word the moment this branch is clean and green. Asking twice is the failure task 86bbk0g4u removed.`,
    '',
    '## How to test',
    '',
    `1. \`gh pr view ${pr.number} --json mergeable,mergeStateStatus\` — mergeable, not CONFLICTING.`,
    `2. \`npm run clickup -- bus-relay --dry-run --only-task ${task.id}\` — it must say it would merge, not hand off.`,
  ].join('\n');
}

/** "3 days", "26 hours", "40 minutes" — plain enough for a report line. */
function ageText(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return 'an unknown time';
  const mins = Math.floor(n / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Should this pass stay quiet about a hand-off it has already posted?
 *
 * The quiet path is the RIGHT behaviour — re-deriving the same answer every
 * pass says nothing new — and it is also exactly where the three days of
 * silence lived. So quiet is now conditional on there being a named actor and
 * on that actor being recent enough to still be plausible:
 *
 *   - no ticket filed          -> never quiet. Nothing is going to pick it up.
 *   - filed, under threshold   -> quiet. It is in the queue the loop drains.
 *   - filed, over threshold    -> not quiet. A day of no progress is news.
 *
 * `at` is the ISO timestamp off the merge marker the earlier pass wrote; an
 * unreadable or missing one counts as stalled, on the same fail-safe reasoning
 * as everywhere else here — "nobody is working on it" and "I cannot tell" look
 * identical, and only one of them is safe to sit on.
 *
 * `actor` (2026-08-31, task 86bbq80j5) is the notice's own answer to "who acts
 * next". It matters because `later-pass` is a NAMED, REAL actor with no ticket
 * behind it: the verdict said there is no overlap to resolve, so the next relay
 * pass retries the catch-up and it clears itself. Reading that as "no ticket,
 * therefore nobody" would nag the bus every ten minutes about a branch that is
 * healing on its own — the false-alarm class this ticket exists to remove. It
 * still stalls on AGE: a self-healing hand-off that has not healed in a day is
 * news, and the sentence says which of the two it is. Any other actor — and an
 * absent one — keeps the original filed-ticket rule, which fails toward noise.
 */
function handOffStalled({ at, now, filed, actor }) {
  if (!filed && actor !== 'later-pass') {
    return { stalled: true, why: 'no conflict ticket has been filed, so nothing is going to pick this up', ageMs: null };
  }
  const then = Date.parse(String(at || ''));
  if (!Number.isFinite(then)) {
    return { stalled: true, why: 'the hand-off carries no readable timestamp, so its age cannot be checked', ageMs: null };
  }
  const ageMs = Number(now) - then;
  if (ageMs < STALE_HAND_OFF_MS) return { stalled: false, ageMs };
  return {
    stalled: true,
    why: filed
      ? `conflict ticket ${filed.id} has been open ${ageText(ageMs)} without clearing this conflict`
      : `no overlap was found, so every pass has been retrying the catch-up on its own — and it has not cleared in ${ageText(ageMs)}`,
    ageMs,
  };
}

/** The line a stalled hand-off puts in the pass report and on the bus. Names
 *  the actor, or says plainly that there is not one. */
function stalledHandOffLine({ task, pr, filed, stalled }) {
  const who = filed
    ? `filed as ${filed.url}`
    : 'NOT filed anywhere — no actor exists for it';
  return `${task.id} ("${task.name}"): PR #${pr.number} has been waiting on a conflict resolution — ${who}. ${stalled.why}.`;
}

module.exports = {
  CONFLICT_TICKET_TRAIL,
  conflictVerdictKind,
  isRealOverlap,
  shouldFileConflictTicket,
  CONFLICT_TICKET_RE,
  STALE_HAND_OFF_MS,
  conflictTicketFiledComment,
  findConflictTicket,
  conflictTicketName,
  conflictTicketBody,
  ageText,
  handOffStalled,
  stalledHandOffLine,
};
