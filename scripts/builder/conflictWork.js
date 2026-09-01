'use strict';

const { CODES: CATCH_UP_CODES } = require('./branchCatchUp.js');

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
 * merge itself is the `localVerdict`, and there are THREE answers it can
 * give — not two:
 *
 *   'real-conflict'   — the branches genuinely changed the same lines.
 *                       Somebody has to decide what the merged file says.
 *   'no-overlap'      — the local merge really did come back clean. A lost
 *                       push race, or GitHub answering about a state it has
 *                       not caught up with. Nothing to resolve; the next pass
 *                       retries and it clears itself.
 *   'could-not-check' — the check never ran. Wrong repo, failed fetch, no
 *                       scratch worktree, a merge result that failed its own
 *                       ancestor proof. NO FINDING WAS MADE.
 *
 * WHY THREE AND NOT TWO (review round 2, 2026-08-31). The first fix collapsed
 * the last two into one bucket called 'unknown' and then wrote copy for it
 * that asserted a finding. On a `FETCH_FAILED` verdict the ticket comment said
 * *"this machine could not check whether that is true"* while the bus post,
 * seconds later, said *"this machine found no overlap between the branch and
 * main. Nothing needs resolving and nobody needs to claim it."* One says it
 * could not look; the other stands the room down on the strength of a look it
 * never took — the same two-comments-200ms-apart shape this ticket exists to
 * remove, arriving in the one place Dane reads.
 *
 * It cost a second way too: `WRONG_REPO` is what the relay gets for EVERY
 * conflicting PR in a repo whose checkout is not on that machine — the queue
 * carries `repo:normie`, `repo:pulse` and `repo:vault`. Deterministically,
 * every pass, forever. Read as self-healing, that filed nothing and told the
 * room nobody needed to claim it, when in fact nothing had been checked and no
 * retry from that machine could ever succeed.
 *
 * So a finding is only ever claimed when a finding was actually made, and the
 * two decisions that matter — file a ticket? name which actor? — read ONE
 * function. They cannot drift, because there is only one answer to read.
 *
 * The original incident this predicate was written for is still the reason it
 * gates filing at all: on 2026-08-30 the merge step filed a resolution ticket
 * on `gate.action` alone, while the hand-off comment built moments later read
 * the verdict and correctly promised the next pass would merge it (PR #444,
 * ticket 86bbmmv7t). The filed ticket — "Resolve the merge conflict on PR
 * #444" — described clearing conflict markers that did not exist.
 * `git merge-tree` on that pair exited 0.
 */
const VERDICT_KINDS = Object.freeze({
  REAL_CONFLICT: 'real-conflict',
  NO_OVERLAP: 'no-overlap',
  COULD_NOT_CHECK: 'could-not-check',
});

/**
 * Every outcome `catchUpBranchLocally` can return, and which of the three
 * answers it is. Exhaustive on purpose, and a test fails if a code is added to
 * branchCatchUp without a decision here — the whole defect above was a default
 * bucket quietly absorbing cases nobody had thought about.
 *
 *   CLEAN / PUSH_FAILED  the merge itself succeeded with nothing to resolve.
 *                        PUSH_FAILED is the 2026-08-30 lost push race: clean
 *                        merge, the push lost a race with another session.
 *                        Both are genuine findings of no overlap.
 *   REAL_CONFLICT        git said the files overlap. A finding, the other way.
 *   WRONG_REPO           this checkout is not that repo. Nothing was tried.
 *   FETCH_FAILED         no fresh refs, so nothing could be merged.
 *   WORKTREE_FAILED      no scratch tree, so nothing could be merged.
 *   NOT_ANCESTOR         a merge that does not contain main is a result this
 *                        module refuses to vouch for. The push was correctly
 *                        withheld, and so is the finding.
 */
const CATCH_UP_VERDICTS = Object.freeze({
  [CATCH_UP_CODES.CLEAN]: { kind: VERDICT_KINDS.NO_OVERLAP },
  [CATCH_UP_CODES.PUSH_FAILED]: { kind: VERDICT_KINDS.NO_OVERLAP },
  [CATCH_UP_CODES.REAL_CONFLICT]: { kind: VERDICT_KINDS.REAL_CONFLICT },
  [CATCH_UP_CODES.WRONG_REPO]: { kind: VERDICT_KINDS.COULD_NOT_CHECK, permanent: true },
  [CATCH_UP_CODES.FETCH_FAILED]: { kind: VERDICT_KINDS.COULD_NOT_CHECK },
  [CATCH_UP_CODES.WORKTREE_FAILED]: { kind: VERDICT_KINDS.COULD_NOT_CHECK },
  [CATCH_UP_CODES.NOT_ANCESTOR]: { kind: VERDICT_KINDS.COULD_NOT_CHECK },
});

/**
 * Turn what `catchUpBranchLocally` returned into the verdict the rest of this
 * module reads. Lives here, beside the predicate, rather than inline at the
 * call site: the code-to-answer table IS the decision, and a copy of it in
 * clickup_direct.mjs is a second place for it to drift.
 *
 * `permanent` travels with WRONG_REPO because the copy has to say it. Every
 * other could-not-check might work on the next pass; that one will not, from
 * this machine, ever.
 */
function verdictFromCatchUp(local) {
  if (!local || !local.code) return null;
  // No default bucket. An unrecognised code is a code nobody decided about,
  // and the safe answer to "did you check?" is always "no".
  const mapped = CATCH_UP_VERDICTS[local.code] || { kind: VERDICT_KINDS.COULD_NOT_CHECK };
  return { ...mapped, code: local.code, reason: local.reason };
}

function conflictVerdictKind(localVerdict) {
  // `localVerdict === null` IS A DELIBERATE CHOICE, not a fallthrough
  // (criterion 4 of task 86bbq80j5, revisited in review round 2). Null means
  // no verdict was produced at all, and the only remaining way that happens is
  // a dry run, which never attempts the catch-up. "Nothing was checked" is
  // exactly what could-not-check means, so that is what it reads as.
  //
  // It used to read as the self-healing answer, which made a dry run claim a
  // finding it had not made and quietly under-report stalled hand-offs: an
  // unfiled, actor-less real conflict came out of the dry run looking calm.
  // A dry run files nothing either way, so this costs nothing and the
  // diagnostic stops being more confident than the real pass.
  //
  // The other case that used to land here — the local catch-up SUCCEEDED and
  // pushed, and GitHub's re-read still said conflict — is no longer null. The
  // merge step carries that CLEAN verdict through, so the textbook stale
  // answer is now a stated 'no-overlap' rather than an absence.
  if (!localVerdict) return VERDICT_KINDS.COULD_NOT_CHECK;
  if (localVerdict.kind) {
    return Object.values(VERDICT_KINDS).includes(localVerdict.kind)
      ? localVerdict.kind
      : VERDICT_KINDS.COULD_NOT_CHECK;
  }
  // The legacy boolean. `true` is a finding; `false` never distinguished "no
  // overlap" from "did not look", so it fails to the answer that claims
  // nothing.
  return localVerdict.realConflict ? VERDICT_KINDS.REAL_CONFLICT : VERDICT_KINDS.COULD_NOT_CHECK;
}

/** Did this machine find a genuine overlap? The only condition under which the
 *  copy may say the two branches changed the same lines. */
function isRealOverlap(localVerdict) {
  return conflictVerdictKind(localVerdict) === VERDICT_KINDS.REAL_CONFLICT;
}

/**
 * Did this machine actually look, and find nothing to resolve? The ONLY
 * condition under which any message is allowed to say "no overlap was found"
 * and stand the room down. Everything else either found an overlap or found
 * out nothing.
 */
function isSelfHealing(localVerdict) {
  return conflictVerdictKind(localVerdict) === VERDICT_KINDS.NO_OVERLAP;
}

/** Was the question left unanswered? Not a finding — the absence of one. */
function couldNotCheck(localVerdict) {
  return conflictVerdictKind(localVerdict) === VERDICT_KINDS.COULD_NOT_CHECK;
}

/** Will this verdict be the same on every future pass from this machine?
 *  True only for the wrong-repo case, and the copy has to say so out loud —
 *  "the next pass retries" is a false promise when no retry can ever work. */
function isPermanent(localVerdict) {
  return Boolean(localVerdict && localVerdict.permanent) && couldNotCheck(localVerdict);
}

/**
 * May the merge step file a Loop Queue ticket for this conflict?
 *
 * Everything except a proven no-overlap. A real conflict needs somebody to
 * decide what the merged file says; a check that could not run needs somebody
 * to find out WHY, and on 2026-08-31 that half was the regression — a
 * conflicting PR in another repo went from "filed, with a named actor" to
 * "nothing filed, and the bus told the room nobody needed to claim it".
 *
 * This is the SAME function `conflictHandOffNotice` reads to pick its actor,
 * which is what makes the ticket and the promise unable to name two different
 * people. One answer, read twice.
 */
function shouldFileConflictTicket(localVerdict) {
  return !isSelfHealing(localVerdict);
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
  // Three answers, three sentences. The middle one used to swallow the third:
  // a ticket filed off a `PUSH_FAILED` said the machine "could not check" when
  // it had checked and found nothing, and a ticket filed off `WRONG_REPO` says
  // it could not check, which is the truth. Only a real overlap gets to claim
  // the branches changed the same lines.
  const what = isRealOverlap(localVerdict)
    ? `This branch and \`main\` have both changed the same lines — ${localVerdict.reason}`
    : isSelfHealing(localVerdict)
      ? `GitHub called it a conflict, but the relay machine merged it here with no overlap at all — ${localVerdict.reason}`
      : localVerdict
        ? `GitHub called it a conflict and the relay machine could not check whether that is true — ${localVerdict.reason}${isPermanent(localVerdict) ? '. This will never clear from that machine on its own: it is the wrong checkout, so every future pass returns the same answer' : ''}`
        : 'GitHub reported that the branch conflicts with newer work on `main`, and no local check was attempted.';

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
  // THE ACTOR DECIDES THE SENTENCE, NOT `filed` (review round 2).
  // `filed` records what a PAST pass found; `actor` is what THIS pass found,
  // and they can disagree: a real conflict files a ticket, the build loop
  // pushes a catch-up, and the next pass finds no overlap left while GitHub is
  // still stale. Reading `filed` there produced "was expected to clear itself"
  // beside "conflict ticket 86bbq6bam has been open 25 hours without clearing
  // this conflict" — two actors, one sentence, again.
  //
  // A self-healing hand-off that has not healed is still news; what it is NOT
  // is a conflict somebody is failing to resolve.
  return {
    stalled: true,
    why: actor === 'later-pass'
      ? `no overlap was found, so every pass has been retrying the catch-up on its own — and it has not cleared in ${ageText(ageMs)}`
      : `conflict ticket ${filed.id} has been open ${ageText(ageMs)} without clearing this conflict`,
    ageMs,
  };
}

/**
 * The line a stalled hand-off puts in the pass report and on the bus. Names
 * the actor, or says plainly that there is not one.
 *
 * IT READS THE ACTOR, NOT `filed` (2026-08-31, task 86bbq80j5, review round 1).
 * Every other branch of the hand-off was converted to read the notice's actor;
 * this one was missed, and it is the branch that reaches the BUS. Before the
 * filing gate existed, `filed` was a safe stand-in for the actor here — a
 * conflict hand-off always had a ticket unless filing had actually failed, so
 * "NOT filed anywhere" was true whenever it printed. The gate created a second
 * way for `filed` to be null: the self-healing one, where the verdict found no
 * overlap and the actor is the next relay pass. Reaching this line down that
 * path produced one sentence naming two actors —
 *
 *     PR #444 has been waiting on a conflict resolution — NOT filed anywhere
 *     — no actor exists for it. no overlap was found, so every pass has been
 *     retrying the catch-up on its own — and it has not cleared in 25 hours.
 *
 * — which is the exact failure shape of the two comments 200ms apart that this
 * whole ticket exists to remove, arriving in the one place Dane actually
 * reads. `filed` still discriminates the other two actors; `later-pass` gets
 * its own clause, and it agrees with the `why` beside it.
 */
function stalledHandOffLine({ task, pr, filed, stalled, actor }) {
  const selfHealing = actor === 'later-pass';
  const what = selfHealing
    ? `PR #${pr.number} was expected to clear itself`
    : `PR #${pr.number} has been waiting on a conflict resolution`;
  // FOUR cases, because `filed` and `actor` are answers to different questions
  // and both can be true at once (review round 2). A ticket filed by an
  // earlier pass does not become "the actor" just because it is still open —
  // if this pass found no overlap, nothing is left for it to resolve, and the
  // line has to say both facts rather than pick whichever reads first.
  const who = selfHealing
    ? (filed
      ? `the earlier ticket ${filed.url} is still open, but this pass found no overlap left to resolve`
      : 'no ticket, and none is needed')
    : (filed
      ? `filed as ${filed.url}`
      : 'NOT filed anywhere — no actor exists for it');
  return `${task.id} ("${task.name}"): ${what} — ${who}. ${stalled.why}.`;
}

/**
 * The banner the bus post wears above that line. Actor-aware for the same
 * reason the line is: "CONFLICT STILL UNRESOLVED" over a body that says no
 * overlap was ever found is the contradiction one word higher up. A
 * self-healing hand-off that has not healed IS news — it just is not a
 * conflict, and calling it one sends a reader looking for markers to clear.
 */
function stalledHandOffHeadline({ actor }) {
  return actor === 'later-pass' ? 'MERGE STILL NOT CLEARED' : 'CONFLICT STILL UNRESOLVED';
}

/**
 * The same word problem one surface across: the END-OF-PASS summary, which
 * printed `CONFLICTS STILL UNRESOLVED` directly above the very lines saying no
 * overlap was found and every pass is retrying (review round 2, item 4).
 *
 * A pass can stall several hand-offs of different kinds at once, so this reads
 * all their actors rather than one. Mixed is a real case and gets its own
 * wording — collapsing it either way would be the same overstatement or
 * understatement the per-line banner was fixed for.
 */
function stalledSummaryHeadline(actors) {
  const list = Array.isArray(actors) ? actors : [];
  const anyConflict = list.some((a) => a !== 'later-pass');
  const anyDeferred = list.some((a) => a === 'later-pass');
  if (anyConflict && anyDeferred) return 'MERGES STILL NOT CLEARED — SOME ARE CONFLICTS, SOME ARE NOT';
  return anyConflict ? 'CONFLICTS STILL UNRESOLVED' : 'MERGES STILL NOT CLEARED';
}

/** The one-line clause in the pass summary, counting the two kinds apart so
 *  neither is described as the other. Empty at zero, as before. */
function stalledSummaryClause(actors) {
  const list = Array.isArray(actors) ? actors : [];
  const conflicts = list.filter((a) => a !== 'later-pass').length;
  const deferred = list.length - conflicts;
  const parts = [];
  if (conflicts) parts.push(`${conflicts} conflict(s) STILL UNRESOLVED`);
  if (deferred) parts.push(`${deferred} merge(s) STILL NOT CLEARED`);
  return parts.length ? `, ${parts.join(', ')}` : '';
}

module.exports = {
  CONFLICT_TICKET_TRAIL,
  VERDICT_KINDS,
  CATCH_UP_VERDICTS,
  verdictFromCatchUp,
  conflictVerdictKind,
  isRealOverlap,
  isSelfHealing,
  couldNotCheck,
  isPermanent,
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
  stalledHandOffHeadline,
  stalledSummaryHeadline,
  stalledSummaryClause,
};
