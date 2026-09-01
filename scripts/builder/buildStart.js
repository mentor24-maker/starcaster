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

/**
 * What a build pass should do with this ticket.
 *
 *   continue   an open PR exists — check that branch out and fix what the
 *              send-back named. Do NOT start a new branch.
 *   fresh      no PR, or the PR is closed/merged. A new branch is right.
 *   unknown    a PR is named but its state could not be read. STOP.
 *
 * `unknown` is not a soft `fresh`, and that asymmetry is the whole point: if
 * the lookup fails and we default to starting fresh, we have rebuilt the bug
 * this module exists to prevent. A check that could not run reports "cannot
 * tell", never a pass (the same rule `doctor:node` and the ecosystem drift
 * check follow).
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
function resolveBuildStart(comments, { lookupPr } = {}) {
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

/** One line for a run report, so the choice is visible rather than implied. */
function describeBuildStart(decision) {
  if (!decision) return '';
  const prefix = {
    continue: 'CONTINUE',
    fresh: 'FRESH BRANCH',
    unknown: 'CANNOT TELL',
  }[decision.action] || decision.action.toUpperCase();
  return `${prefix} — ${decision.why}`;
}

module.exports = { resolveBuildStart, describeBuildStart };
