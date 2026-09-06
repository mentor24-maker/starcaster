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
 * AND "STILL OPEN" IS NOT "ENQUEUED" (round 2 of the same ticket). The first
 * fix removed the false success and introduced a false *reassurance* in its
 * place: every OPEN-after-merge was reported as a queue wait, without anything
 * ever establishing that a queue existed. None does — `.../branches/main/
 * protection` carries no `merge_queue` block and `/rulesets` is `[]` — so on
 * today's repo EVERY such reading was a genuine merge refusal being announced
 * as "nothing has gone wrong, GitHub is still working through the merge
 * queue", fifteen minutes late, naming a mechanism that does not exist.
 * `main`'s protection has `strict: true`, so a branch that falls behind
 * between ship's CI wait and its merge call is refused exactly this way.
 *
 * So the question "is anything actually going to make this merge happen?" is
 * now ASKED rather than assumed, per pull request, in the same read as the
 * state. Two things can hold an OPEN pull request after `gh pr merge` returns
 * 0, and `gh pr merge --help` names both:
 *
 *   "If required checks have not yet passed, auto-merge will be enabled.
 *    If required checks have passed, the pull request will be added to the
 *    merge queue."
 *
 * So: `isInMergeQueue` OR an `autoMergeRequest`. If NEITHER holds it, nothing
 * is going to merge it later and no amount of polling will change that — that
 * is `not-merged`, returned on the first clean read, which is the fast true
 * answer ship gave before any of this and must keep giving (criterion 5, on
 * the FAILURE path as well as the success path).
 *
 * A HOLD THAT CANNOT BE READ IS NOT "NO HOLD" (DOCTRINE 3.2), and it is not a
 * queue either. It resolves to `not-merged` as well — promptly, with
 * `hold: 'unknown'` so the caller says it could not tell rather than asserting
 * a queue — and that is the safe direction on both sides: nothing records a
 * merge it has not seen, and a pull request GitHub really is holding merges
 * anyway and is found merged by the next pass or the next `ship`.
 *
 * Per pull request, not per repository, on purpose: a queue can be enabled on
 * `main` while THIS merge was refused for its own reason, and "the repo has a
 * queue" would call that a queue wait all over again.
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
 * The ONE spelling of the read both callers take, as a GraphQL query.
 *
 * GraphQL rather than `gh pr view --json`, because `gh` exposes no
 * `isInMergeQueue` field (measured against gh 2.97.0) and the hold has to be
 * read in the SAME breath as the state — two calls can disagree in the gap
 * between them, and the gap is precisely where a merge lands.
 */
const PR_OBSERVATION_QUERY =
  'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n)' +
  '{pullRequest(number:$p){state mergedAt isInMergeQueue autoMergeRequest{enabledAt}}}}';

/**
 * Build the `gh api graphql` argv for one pull request. A single spelling, so
 * ship and the relay cannot drift into asking GitHub different questions.
 *
 * @param repo   "owner/name"
 * @param number pull request number
 */
function prObservationArgv(repo, number) {
  const [owner, name] = String(repo || '').split('/');
  return [
    'api', 'graphql',
    '-f', `query=${PR_OBSERVATION_QUERY}`,
    '-F', `o=${owner || ''}`,
    '-F', `n=${name || ''}`,
    '-F', `p=${Number(number)}`,
  ];
}

/**
 * Flatten one GraphQL answer into the payload `waitForMerge` reads, or null if
 * nothing usable came back.
 *
 * Null rather than a partial object, deliberately: a half-read payload would
 * classify as OPEN-with-an-unknown-hold, which is a reading. Nothing was read.
 */
function parsePrObservation(answer) {
  let parsed = answer;
  // Takes either the raw stdout or an already-parsed answer, so a caller that
  // has its own JSON reader does not have to stringify a payload back just to
  // hand it over.
  if (typeof answer === 'string') {
    try { parsed = JSON.parse(answer); } catch (_) { return null; }
  } else if (!answer || typeof answer !== 'object') {
    return null;
  }
  const pr = parsed && parsed.data && parsed.data.repository && parsed.data.repository.pullRequest;
  if (!pr || typeof pr !== 'object') return null;
  return {
    state: pr.state,
    mergedAt: pr.mergedAt,
    // Strict booleans on the way in, so "the field was not returned" stays
    // distinguishable from "GitHub said no" — see classifyMergeHold.
    isInMergeQueue: typeof pr.isInMergeQueue === 'boolean' ? pr.isInMergeQueue : null,
    autoMergeEnabled: pr.autoMergeRequest === null || pr.autoMergeRequest === undefined
      ? (Object.prototype.hasOwnProperty.call(pr, 'autoMergeRequest') ? false : null)
      : true,
  };
}

/**
 * Is anything going to make this OPEN pull request merge later?
 *
 *   'queue'      — GitHub has it in the merge queue.
 *   'auto-merge' — GitHub is holding it and will merge when the checks pass.
 *   'none'       — neither. Nothing is holding it, so the merge did not happen
 *                  and no amount of waiting will change that.
 *   'unknown'    — the reading is absent. NOT 'none' (DOCTRINE 3.2): a caller
 *                  must say it could not tell, never assert a queue and never
 *                  assert a refusal it did not observe.
 *
 * Only meaningful for an OPEN pull request; a MERGED or CLOSED one is already
 * terminal and the hold says nothing about it.
 */
function classifyMergeHold(prJson) {
  if (!prJson || typeof prJson !== 'object') return 'unknown';
  if (prJson.isInMergeQueue === true) return 'queue';
  if (prJson.autoMergeEnabled === true) return 'auto-merge';
  if (prJson.isInMergeQueue === false && prJson.autoMergeEnabled === false) return 'none';
  return 'unknown';
}

/** Is this hold something that will still merge the pull request? */
function holdIsPending(hold) {
  return hold === 'queue' || hold === 'auto-merge';
}

/**
 * Plain-English name for a hold, for the messages callers print. Never invents
 * a queue: 'unknown' says it could not be read.
 */
function holdLabel(hold) {
  if (hold === 'queue') return 'GitHub has it in the merge queue';
  if (hold === 'auto-merge') return 'GitHub is holding it on auto-merge';
  if (hold === 'none') return 'nothing is holding it — no merge queue entry and no auto-merge';
  return 'whether anything is holding it could not be read';
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
 * @param timeoutMs      overall ceiling, and it is only ever SPENT on a pull
 *                 request GitHub is demonstrably holding — an unheld OPEN one
 *                 returns on the first read. Callers supply their own: ship
 *                 derives it from its CI ceiling, the relay from its own
 *                 wake interval (`mergeObserveBudget`). There is no default,
 *                 deliberately: the 15-minute literal that used to sit here
 *                 traced to nothing, and a bound that traces to nothing is a
 *                 bound nobody can check.
 * @param pollIntervalMs gap between reads.
 * @param onPoll   (state, elapsedMs, prJson) => void  progress hook.
 *
 * @returns { outcome, mergedAt, polls, failedReads, sleptMs, state, hold } where
 * `sleptMs` is how long the wait ACTUALLY blocked for — 0 when it answered on
 * the first read, which is every merge on a queue-less repo. A caller that
 * charges a wait budget must charge it on that, not on having been willing to
 * wait (round 3 of this ticket): the relay spent one of its three in-pass
 * slots on every ordinary merge for a wait it never took, so three merges in a
 * pass left the fourth ticket's real CI wait refused and deferred a whole
 * interval. And outcome is:
 *   'merged'     — observed MERGED. `mergedAt` is GitHub's time (or null if it
 *                  reported none).
 *   'closed'     — observed CLOSED without merging. It will not merge.
 *   'not-merged' — read cleanly as OPEN with NOTHING holding it: no merge
 *                  queue entry, no auto-merge. The merge did not happen and
 *                  polling cannot change that, so this returns at once. This
 *                  is a FAILURE, and on today's queue-less repo it is what
 *                  every refused merge is. `hold` is 'none' or 'unknown'.
 *   'queued'     — OPEN, GitHub IS holding it (queue or auto-merge), and the
 *                  budget ran out. THE THIRD ANSWER: not a success and not a
 *                  failure. A caller must not record a merge and must not
 *                  report a failure.
 *   'unknown'    — no clean read was ever taken. Also not a failure: nobody
 *                  looked. `failedReads` says how many came back blind.
 */
function waitForMerge({
  readPr,
  sleep,
  now,
  timeoutMs = 0,
  pollIntervalMs = 15 * 1000,
  onPoll,
} = {}) {
  if (typeof readPr !== 'function') throw new TypeError('waitForMerge needs a readPr function');
  if (typeof sleep !== 'function') throw new TypeError('waitForMerge needs a sleep function');
  if (typeof now !== 'function') throw new TypeError('waitForMerge needs a now function');

  const start = now();
  let polls = 0;
  let failedReads = 0;
  let sleptMs = 0;
  let sawHeld = false;
  let lastHold = 'unknown';

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
      return { outcome: 'merged', mergedAt: mergedAtOf(prJson), polls, failedReads, sleptMs, state, hold: classifyMergeHold(prJson) };
    }
    if (state === 'closed') {
      return { outcome: 'closed', mergedAt: null, polls, failedReads, sleptMs, state, hold: classifyMergeHold(prJson) };
    }
    if (state === 'open') {
      // THE ROUND-2 FIX. "Still open" is not "enqueued" until something says
      // so. If nothing is holding this pull request, no amount of polling
      // will merge it — waiting would turn an accurate one-second failure
      // into a fabricated one fifteen minutes later, naming a merge queue
      // that does not exist. Answer now, with the truth.
      lastHold = classifyMergeHold(prJson);
      if (!holdIsPending(lastHold)) {
        return { outcome: 'not-merged', mergedAt: null, polls, failedReads, sleptMs, state, hold: lastHold };
      }
      sawHeld = true;
    } else {
      failedReads += 1;
    }

    if (elapsed >= timeoutMs) {
      // sawHeld, not "the last read was held": one clean reading of GitHub
      // holding the pull request is enough, and a rate limit on the final
      // poll must not turn a known-queued PR into a cannot-tell.
      return {
        outcome: sawHeld ? 'queued' : 'unknown',
        mergedAt: null,
        polls,
        failedReads,
        sleptMs,
        state,
        hold: sawHeld ? lastHold : 'unknown',
      };
    }
    sleep(pollIntervalMs);
    sleptMs += pollIntervalMs;
  }
}

/**
 * A `not-merged` reading, put into the words a caller prints.
 *
 * WHY THIS IS SHARED AND NOT A STRING AT EACH CALL SITE (round 4 of task
 * 86bbv35cq). `waitForMerge` returns `not-merged` for TWO different readings,
 * and `holdIsPending` is false for both:
 *
 *   hold 'none'    — read cleanly as OPEN with no queue entry and no
 *                    auto-merge. Nothing is holding it, so GitHub really did
 *                    refuse the merge. An OBSERVED refusal.
 *   hold 'unknown' — the hold field was not returned at all. The merge did not
 *                    happen; whether GitHub is still holding it is NOT KNOWN.
 *
 * Both callers printed the same sentence for both: "The merge command reported
 * success, so GitHub refused it afterwards." On the `unknown` reading that
 * asserts a refusal nobody observed — one line below a line that had just said
 * the hold could not be read. The relay's version reaches the ticket and the
 * bus, so it reaches Dane.
 *
 * The rest of this code path already had it right — the window is HELD on an
 * unreadable hold, and the relay's own return sets `cannotTell: true` on
 * exactly `not-merged && hold === 'unknown'`. The code knew it was a
 * cannot-tell everywhere except in the sentence a human reads. That is this
 * ticket's own defect class (an action reporting one thing while another is
 * true), and it is worse than the round-2 version it echoes: round 2's false
 * line was corrected by the line below it, and this one is the terminal
 * message with no correction anywhere.
 *
 * So the split lives here, next to the classifier that creates the two
 * readings, for the reason the module header already gives: two callers
 * answering the same question separately will eventually answer it
 * differently.
 *
 * NO CAUSE IS ASSERTED ON A CANNOT-TELL, AND NEITHER IS ANY ADVICE THAT
 * PRESUMES ONE. Ship's old advice — "main moved again... run `npm run ship`
 * again" — is misdirection when the real cause was an unreadable field, and
 * following it merges a pull request that may already be landing.
 *
 * @param hold the `hold` off a `not-merged` observation
 * @returns {{ causeIsObserved: boolean, cause: string, advice: string }}
 *          `advice` is a full sentence for a caller that offers a next step;
 *          the relay states no next step and uses only `cause`.
 */
function notMergedExplanation(hold) {
  if (hold === 'none') {
    // A REAL, OBSERVED REFUSAL. Nothing is holding the pull request, so the
    // merge is not coming and saying why is fair — `main`'s protection has
    // strict:true and a branch that fell behind is by far the commonest cause.
    return {
      causeIsObserved: true,
      cause: 'The merge command reported success, so GitHub refused it afterwards. The usual reason '
        + 'is that main moved again in the seconds between the checks passing and the merge, and '
        + 'this branch is protected against merging while behind.',
      advice: 'Run `npm run ship` again — it catches up on main first, so a second run normally goes '
        + 'straight through.',
    };
  }
  // EVERY OTHER HOLD IS A CANNOT-TELL, including anything unrecognised: only
  // 'none' is a positive reading that nothing is holding the pull request.
  return {
    causeIsObserved: false,
    cause: 'The merge command reported success and the pull request has not merged, but whether '
      + 'GitHub is still holding it could not be read — so why it did not merge is not known. It '
      + 'may have been refused, or it may still be held and about to land.',
    advice: 'Open the pull request on GitHub to see which it is, then run `npm run ship` again: if it '
      + 'has since merged, ship sees this branch is already in main and finishes the tidy-up; if it '
      + 'was refused, it catches up on main and merges.',
  };
}

/**
 * A merge was ordered and did NOT complete. Does the caller give the merge
 * window back?
 *
 * WHY THIS IS A DECISION AND NOT A LINE OF CODE (round 3 of task 86bbv35cq).
 * The relay released the window on EVERY non-merged outcome, `queued`
 * included — and `queued` is the one outcome where GitHub is demonstrably
 * holding the pull request and WILL land it. That is the livelock the window
 * exists to prevent, arriving through its own fix: release it, the next merge
 * moves `main`, `strict: true` puts the held pull request behind, its checks
 * reset, and it never lands. Round after round.
 *
 * The relay's own arming path already states the rule 100 lines above:
 * "ARMING IS A MAIN MOVE, just a deferred one... Two armed pull requests
 * therefore reset each other exactly as two merged ones would, so arming takes
 * the window and holds it until the merge lands." A `queued` merge is exactly
 * that state and gets exactly that treatment.
 *
 * So the window is given back only where something was POSITIVELY OBSERVED
 * that means no merge is coming:
 *
 *   'merged'     — it landed. main has moved; the window's job is done.
 *   'closed'     — closed without merging. Nothing will land it.
 *   'not-merged' with hold 'none' — read cleanly as OPEN with no queue entry
 *                  and no auto-merge. GitHub refused it and is not holding it.
 *
 * Everything else HOLDS, and every one of those is a cannot-tell rather than a
 * known-idle window (DOCTRINE 3.2):
 *
 *   'queued'     — GitHub is holding it. Releasing is the livelock.
 *   'unknown'    — no clean read was ever taken. The merge command succeeded,
 *                  so main may be moving right now; nobody looked.
 *   'not-merged' with hold 'unknown' — the merge did not happen, but whether
 *                  GitHub is still holding it could not be read.
 *
 * The two errors are not symmetric, which is what settles the cannot-tells.
 * Releasing wrongly is an unbounded, silent livelock. Holding wrongly costs
 * one merge lane for the lease's 45-minute bound, which clears itself and is
 * reported — the same trade the lease already makes when a pass dies between
 * taking the window and pushing.
 *
 * @param observed a `waitForMerge` result (or anything with { outcome, hold })
 * @returns {{ release: boolean, why: string }}
 */
function windowDispositionAfterMerge(observed) {
  const outcome = String((observed && observed.outcome) || '');
  const hold = String((observed && observed.hold) || 'unknown');

  if (outcome === 'merged') return { release: true, why: 'it merged' };
  if (outcome === 'closed') {
    return { release: true, why: 'the pull request is closed without merging, so nothing will land it' };
  }
  if (outcome === 'not-merged' && hold === 'none') {
    return {
      release: true,
      why: 'the merge did not happen and nothing is holding the pull request, so no merge is coming',
    };
  }
  if (outcome === 'queued') {
    return {
      release: false,
      why: `GitHub is holding this pull request and will still land it (${holdLabel(hold)}), `
        + 'so the window stays taken exactly as an armed merge does — giving it back would let the '
        + 'next merge move main, put this one behind, and reset the checks it is waiting on',
    };
  }
  if (outcome === 'not-merged') {
    return {
      release: false,
      why: 'the merge did not happen, but whether GitHub is still holding this pull request could '
        + 'not be read — so the window is held rather than handed out on a guess',
    };
  }
  return {
    release: false,
    why: 'no clean reading of the pull request was taken at all, so whether main is about to move '
      + 'is unknown — the window is held rather than handed out on a guess',
  };
}

module.exports = {
  classifyMergeState,
  classifyMergeHold,
  holdIsPending,
  holdLabel,
  notMergedExplanation,
  windowDispositionAfterMerge,
  mergedAtOf,
  mergeTimeLabel,
  waitForMerge,
  PR_OBSERVATION_QUERY,
  prObservationArgv,
  parsePrObservation,
};
