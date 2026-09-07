'use strict';

/**
 * Before a build pass writes a line of code: is there already an open pull
 * request for this ticket?
 *
 * WHY THIS EXISTS (2026-08-23). A loop-build pass opened two duplicate PRs in
 * one session — #407 alongside the already-open #349, and #408 alongside #350.
 * Both originals had been sent back to `Queued` days earlier for one small
 * missing test case each, were still open, and each had a `PR opened:` comment
 * naming it sitting in the ticket's own history.
 *
 * The claim was not the problem. `--if-status Queued` did exactly its job,
 * because a sent-back ticket genuinely IS queued. THE ATOMIC CLAIM PROTECTS
 * AGAINST TWO BUILDERS STARTING AT ONCE; IT SAYS NOTHING ABOUT WORK THAT WAS
 * ALREADY STARTED AND HANDED BACK. Two different questions, and only one of
 * them was being asked.
 *
 * It was cheap that time only by luck — both duplicates happened to be
 * supersets, so closing the originals lost nothing. On a feature ticket it is
 * two branches diverging on one piece of work, and with a merge instruction
 * already on the ticket it is very nearly a relay merging one of two PRs with
 * nobody having decided which.
 *
 * The fix is a STEP, not a reminder. "Read the comments more carefully" is
 * advice, and a pass that must remember is a pass that will forget.
 */

const { findPullRequest } = require('./mergeOnComment.js');
const strandedLocalWork = require('./strandedLocalWork.js');

/**
 * WHAT A BUILD PASS SHOULD DO WITH THIS TICKET — the four answers.
 *
 *   continue   work already exists that this pass can carry on: an open PR,
 *              or (since task 86bbvur5a) a half-finished worktree on THIS
 *              machine. Check that branch out. Do NOT start a new one.
 *   elsewhere  work exists on ANOTHER machine, which this one cannot check
 *              out. Refuse, and say where it is. Also a "do not branch".
 *   fresh      nothing anywhere. A new branch is right.
 *   unknown    something could not be read. STOP.
 *
 * `unknown` is not a soft `fresh`, and that asymmetry is the whole point: if
 * the lookup fails and we default to starting fresh, we have rebuilt the bug
 * this module exists to prevent. A check that could not run reports "cannot
 * tell", never a pass (the same rule `doctor:node` and the ecosystem drift
 * check follow).
 *
 * THE ANSWER IS BUILT IN TWO HALVES. `resolveFromPullRequest` below is the
 * original, unchanged: it reads the ticket's `PR opened:` trail. `withLocalWork`
 * is the disk reading, and it is consulted ONLY when the first half says
 * `fresh` — see its own header for why, and for why it is injected rather than
 * imported.
 *
 * @param comments  the ticket's comments, as ClickUp returns them
 * @param lookupPr  (pr) => { state, headRefName } | null, where `pr` is the
 *                  WHOLE parsed pull request — `{ url, owner, repo, number }`,
 *                  not just its number. `null` means the lookup itself failed.
 *                  A PR that genuinely does not exist should come back as
 *                  { state: 'MISSING' }.
 *
 * IT IS HANDED THE REPO, NOT JUST THE NUMBER (2026-09-01, task 86bbqyyfn).
 * This used to pass `found.number` alone, and every caller then ran
 * `gh pr view <number>` with no `--repo`, so gh resolved the repo from the
 * working directory — always starcaster. On a `repo:pulse` ticket that read
 * STARCASTER's PR of the same number and answered about the wrong repo
 * entirely: on 2026-08-31, building 86bbq83j0, it reported "FRESH BRANCH —
 * PR #1 is merged" (starcaster's #1, merged in July) while pulse's #1 was open
 * with unmerged review work on it.
 *
 * It fails toward the unsafe side, which is what makes it worth a guard rather
 * than a note. Low PR numbers collide across repos almost by definition —
 * every repo has a #1, the newer repos are in single digits while starcaster
 * is past #500 — so the overlap is exactly the range cross-repo tickets live
 * in, and starcaster's early PRs are all merged, so the wrong answer is nearly
 * always the permissive one: "go ahead and branch".
 */
function resolveFromPullRequest(comments, lookupPr) {
  const found = findPullRequest(comments);
  if (!found) {
    return {
      action: 'fresh',
      pr: null,
      why: 'no "PR opened:" line on this ticket — nothing has been built for it yet',
    };
  }

  // A PR line we could parse but cannot place in a repo is a CANNOT TELL, not
  // a fresh branch. "I do not know which repo" and "there is no PR" must never
  // share an answer — that is the same conflation one layer down.
  if (!found.owner || !found.repo) {
    return {
      action: 'unknown',
      pr: found,
      why: `this ticket names PR #${found.number} but not which repo it is in — `
        + 'do NOT look it up in whichever repo happens to be the working directory',
    };
  }

  let info;
  try {
    info = typeof lookupPr === 'function' ? lookupPr(found) : null;
  } catch {
    info = null;
  }

  if (!info || !info.state) {
    return {
      action: 'unknown',
      pr: found,
      why: `this ticket names ${found.owner}/${found.repo} PR #${found.number} but its state could not be read — do NOT start a branch on a guess`,
    };
  }

  const state = String(info.state).toUpperCase();
  if (state === 'OPEN') {
    return {
      action: 'continue',
      pr: { ...found, branch: info.headRefName || '' },
      why: `${found.owner}/${found.repo} PR #${found.number} is still OPEN — continue that branch, do not start a second one`,
    };
  }

  if (state === 'MERGED' || state === 'CLOSED') {
    return {
      action: 'fresh',
      pr: found,
      why: `${found.owner}/${found.repo} PR #${found.number} is ${state.toLowerCase()} — a new branch is right`,
    };
  }

  return {
    action: 'unknown',
    pr: found,
    why: `PR #${found.number} reports an unrecognised state "${info.state}" — do NOT guess`,
  };
}

/**
 * THE SECOND READING: is a half-finished build sitting on somebody's DISK?
 *
 * WHY (2026-09-07, task 86bbvur5a). Everything above is a pull-request lookup,
 * and a pull request is the LAST thing a build produces. A pass that wrote
 * seven files and died before pushing leaves no PR at all, so `fresh` came
 * back — exit 0 — and the next pass cut a second branch off `origin/main`,
 * orphaning the work.
 *
 * That is not hypothetical. `pass-reconcile` (#637) and the stranded sweep
 * (#624) both learned to take this reading before handing a ticket back, and
 * both write a note on the ticket naming the machine, worktree and branch they
 * found. But the note only helps somebody who READS the comments, and
 * `build-start` — the step whose entire job is "has this been started
 * already?" — was answering from PR comments alone. So the loop's own
 * defence ended one step short of the step that acts on it.
 *
 * IT IS ONLY CONSULTED ON `fresh`, because `fresh` is the only answer that
 * asserts an ABSENCE. `continue` and `unknown` already name a pull request and
 * already refuse to branch; asking a disk could not change either one, and an
 * ssh probe on a hot path that cannot change the answer is pure cost.
 *
 * THE READING IS INJECTED, NOT IMPORTED. `resolveBuildStart` stays pure and
 * synchronous, and a caller that does not supply `findLocalWork` gets exactly
 * today's behaviour — which is what keeps `pass-reconcile` and the sweep
 * unchanged (this ticket's non-goals). They take the same reading themselves,
 * through the same module, at the point where THEY decide.
 *
 * @param fresh          the `fresh` decision the PR reading produced
 * @param findLocalWork  () => the shape `strandedLocalWork.findWorkInProgress`
 *                       returns: { verdict, work, unseen, unlooked }
 * @param hereId         which machine we are standing on, in `nodeRoles` words
 */
function withLocalWork(fresh, { findLocalWork, hereId } = {}) {
  if (typeof findLocalWork !== 'function') return fresh;

  let reading;
  try {
    reading = findLocalWork();
  } catch (err) {
    return {
      ...fresh,
      action: 'unknown',
      why: `${fresh.why}, but the local-work reading could not be taken (${err?.message || err}) — `
        + 'a check that did not run is not a clean bill of health, so do NOT start a branch',
    };
  }

  if (!reading || !reading.verdict) {
    return {
      ...fresh,
      action: 'unknown',
      why: `${fresh.why}, but the local-work reading came back with no verdict — do NOT start a branch on a guess`,
    };
  }

  const work = Array.isArray(reading.work) ? reading.work : [];
  const unseen = Array.isArray(reading.unseen) ? reading.unseen : [];
  const unlooked = Array.isArray(reading.unlooked) ? reading.unlooked : [];

  if (reading.verdict === 'work') {
    // WHERE the work is decides what a pass can do about it, and the two are
    // genuinely different instructions. Work on THIS machine is a worktree the
    // pass can `cd` into — the same answer an open PR gets. Work on another
    // machine cannot be checked out from here at all, so telling a pass to
    // "continue that branch" would be an instruction it cannot follow, and it
    // would very likely cut a branch anyway. It gets its own answer, which
    // refuses and says where to go.
    const here = work.filter((w) => w.machine === hereId);
    const there = work.filter((w) => w.machine !== hereId);
    if (here.length) {
      return {
        action: 'continue',
        pr: fresh.pr,
        work,
        unlooked,
        why: `no open pull request, but a build is already in progress on this machine — `
          + `${strandedLocalWork.describeWork(here).join('; ')}. `
          + 'Work on THAT branch; do not start a second one.',
      };
    }
    return {
      action: 'elsewhere',
      pr: fresh.pr,
      work,
      unlooked,
      why: `no open pull request, but a build is already in progress on another machine — `
        + `${strandedLocalWork.describeWork(there).join('; ')}. `
        + 'This machine cannot check that out, so do NOT start a branch here: finish it there, '
        + 'or hand the ticket back with a note saying where the work is.',
    };
  }

  if (reading.verdict === 'cannot-tell') {
    // A machine that SHOULD have answered and did not. Both blind spots are
    // named — a reader going to look by hand needs every seat that was not
    // looked at, not only the ones that failed (DOCTRINE 3.11).
    const blind = strandedLocalWork.describeUnlooked([...unseen, ...unlooked]);
    return {
      ...fresh,
      action: 'unknown',
      work,
      unlooked,
      why: `${fresh.why}, but whether a build is half-finished on a disk CANNOT BE TOLD from here — ${blind}. `
        + 'Do NOT start a branch on a reading nobody took.',
    };
  }

  if (reading.verdict === 'none') {
    // The reading's real job, and it has to keep working: a guard that never
    // lets anything through is the mirror-image defect, and this repo has
    // shipped that one. An `unrouted` seat does NOT freeze this — from the
    // Mini, which is where the loops actually run, there is no ssh route to
    // the MacBook at all, so treating that as a failed reading would refuse
    // EVERY claim forever. It is named in the line instead.
    const seats = strandedLocalWork.describeUnlooked(unlooked);
    return {
      ...fresh,
      work: [],
      unlooked,
      why: seats
        ? `${fresh.why}, and no half-finished build is on any disk that could be asked `
          + `(not looked at: ${seats})`
        : `${fresh.why}, and no half-finished build is on any disk`,
    };
  }

  return {
    ...fresh,
    action: 'unknown',
    work,
    unlooked,
    why: `${fresh.why}, but the local-work reading returned an unrecognised verdict `
      + `"${reading.verdict}" — do NOT guess`,
  };
}

/**
 * @param comments       the ticket's comments, as ClickUp returns them
 * @param lookupPr       see `resolveFromPullRequest`
 * @param findLocalWork  optional; see `withLocalWork`. Omitted = today's
 *                       PR-only behaviour, exactly.
 * @param hereId         optional; which machine this is, for `findLocalWork`
 */
function resolveBuildStart(comments, { lookupPr, findLocalWork, hereId } = {}) {
  const fromPr = resolveFromPullRequest(comments, lookupPr);
  // Only `fresh` asserts an absence, and an absence is the only claim a disk
  // can contradict.
  if (fromPr.action !== 'fresh') return fromPr;
  return withLocalWork(fromPr, { findLocalWork, hereId });
}

/**
 * The exact `gh` arguments for looking one pull request up.
 *
 * IT LIVES HERE SO THE `--repo` CANNOT BE DROPPED QUIETLY (task 86bbqyyfn).
 * Two callers ask this question — the `build-start` command and
 * `pipeline.mjs`'s `buildStartFor` — and both built their own argument list.
 * A unit test cannot reach either closure, so removing `--repo` from one of
 * them passed the entire suite: the break-test for this very fix did exactly
 * that and nothing went red. One builder, pinned by one test, is what makes
 * "break it on purpose and watch it fail" possible at all here.
 */
function prLookupArgs(pr) {
  if (!pr || !pr.owner || !pr.repo || !pr.number) {
    throw new Error('prLookupArgs needs a pull request with an owner, a repo and a number');
  }
  return ['pr', 'view', String(pr.number), '--repo', `${pr.owner}/${pr.repo}`, '--json', 'state,headRefName'];
}

/** One line for a run report, so the choice is visible rather than implied. */
function describeBuildStart(decision) {
  if (!decision) return '';
  const prefix = {
    continue: 'CONTINUE',
    elsewhere: 'WORK ON ANOTHER MACHINE',
    fresh: 'FRESH BRANCH',
    unknown: 'CANNOT TELL',
  }[decision.action] || decision.action.toUpperCase();
  return `${prefix} — ${decision.why}`;
}

/**
 * The exit code for one decision, so the command and its tests cannot drift.
 *
 * The dialect is `node:owns`', which the loop-build skill already documents:
 * 0 = go ahead, 3 = somebody else's work, 1 = cannot tell. `elsewhere` is a 3
 * rather than a new code on purpose — it IS "somebody else's work", every
 * caller that branches on 3 already refuses to cut a branch, and the sentence
 * printed alongside it says which of the two kinds it is. A fourth code would
 * have to be taught to every reader of this command, and a reader that had not
 * learned it would fall through to its default, which is the permissive one.
 */
function buildStartExitCode(decision) {
  const action = decision?.action;
  if (action === 'continue' || action === 'elsewhere') return 3;
  if (action === 'unknown') return 1;
  if (action === 'fresh') return 0;
  // An action nobody taught this function about must not read as "go ahead".
  return 1;
}

module.exports = {
  resolveBuildStart,
  resolveFromPullRequest,
  withLocalWork,
  describeBuildStart,
  buildStartExitCode,
  prLookupArgs,
};
