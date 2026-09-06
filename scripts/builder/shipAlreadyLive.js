'use strict';

/**
 * "This branch is already live — there is nothing left to ship but the
 * tidy-up." The question `npm run ship` has to be able to answer before it
 * touches anything.
 *
 * WHY THIS EXISTS (round 3 of task 86bbv35cq). Ship's `queued` and `unknown`
 * endings both told the reader to run `npm run ship` again and it "will see
 * the merge and carry on with the tidy-up". Ship had no such path. It finds
 * its pull request with `gh pr list --head <branch> --state open`, and a
 * merged pull request is not open — measured on a real one:
 *
 *     $ gh pr list --head sweep-e2e-test --state open  --json number  ->  none
 *     $ gh pr list --head sweep-e2e-test --state merged --json number  ->  623
 *
 * so a rerun fell through to `gh pr create` and opened a SECOND pull request
 * for work already live, or stopped with a confusing "Could not open a pull
 * request" when there was no diff left. Same class as the defect round 1 was
 * sent back for: advice naming an action that does not exist.
 *
 * TWO SIGNALS, AND BOTH MUST SAY YES. Either one alone is wrong:
 *
 *   · A merged pull request alone does not mean this branch is finished. The
 *     branch may have gained commits since it merged (GitHub deletes the head
 *     branch on merge, so a same-named branch made afterwards still matches
 *     `--head`), and skipping the ship would silently strand real work.
 *   · Content-in-main alone does not mean anything merged. A branch can hold
 *     nothing unique because it never changed anything, or because somebody
 *     else's pull request carried the same change.
 *
 * ORDER IS CHEAPEST-FIRST, and it is the local one that runs on every ship:
 * `branchContentIsInMain` is pure git and free, and on an ordinary
 * mid-flight branch it answers "no" — so the GitHub call is never made and an
 * ordinary ship pays nothing for this check at all.
 *
 * IT IS CONSERVATIVE IN ONE DIRECTION, MEASURED. `branchContentIsInMain`
 * compares the paths the branch touched between `origin/main` and the branch
 * tip, so a local branch that LAGS what actually merged reads as "not in
 * main" — `sweep-e2e-test` above does, because its local tip is an ancestor
 * of the head GitHub merged. That false negative costs nothing: it falls
 * through to the ordinary ship, which is exactly what happened before this
 * check existed. The false POSITIVE — skipping a ship that was needed — is
 * the one that would strand work, and it takes both signals to reach.
 *
 * A CANNOT-TELL NEVER AUTHORIZES THE SKIP (DOCTRINE 3.2). `branchHasMergedPr`
 * returns null when GitHub could not be reached, and null is not false and is
 * certainly not true: it falls through to the ordinary ship and says why.
 *
 * AND A BRANCH THAT CHANGED NOTHING IS NOT EVIDENCE OF ANYTHING (round 4,
 * raised in review as a non-blocking note). `branchContentIsInMain` answers
 * `true` for a branch that touched no files — right for its own question, and
 * `npm run tidy` relies on it — but composed here it made a THIRD way to reach
 * `live`, on no evidence at all: GitHub deletes the head branch when it
 * merges, so a freshly made branch reusing a topic name that already merged
 * once scores true on both signals. Nothing can be lost by it (ship refuses to
 * run on uncommitted edits, `tidy` protects unshipped commits), but the reader
 * is told "was already merged into main" about a branch that was not, and its
 * worktree is removed. `touchedFiles` is that emptiness asked directly, so the
 * skip now rests on the branch having actually done something.
 */

/**
 * @param contentInMain true / false / null — `branchContentIsInMain`
 * @param mergedPr      true / false / null — `branchHasMergedPr`
 * @param touchedFiles  true / false / null — `branchTouchedFiles`. Defaults to
 *                      true so an existing caller reads exactly as before; it
 *                      is only ever a veto, never a reason to skip.
 * @returns {{ live: boolean, why: string }}
 */
function decideAlreadyLive({ contentInMain = null, mergedPr = null, touchedFiles = true } = {}) {
  if (touchedFiles === false) {
    return {
      live: false,
      why: 'this branch has not changed a single file, so there is nothing it could have merged',
    };
  }
  if (contentInMain !== true) {
    return {
      live: false,
      why: contentInMain === false
        ? 'this branch still holds changes main does not have'
        : 'whether main already carries this branch could not be read, so nothing is skipped on a guess',
    };
  }
  if (mergedPr === true) {
    return {
      live: true,
      why: 'GitHub has a merged pull request for this branch, and main already carries everything it changed',
    };
  }
  if (mergedPr === false) {
    return {
      live: false,
      why: 'main already carries everything this branch changed, but GitHub has no merged pull request for it',
    };
  }
  return {
    live: false,
    why: 'main already carries everything this branch changed, but GitHub could not say whether a pull '
      + 'request for it merged — that is a cannot-tell, and nothing is skipped on a guess',
  };
}

module.exports = { decideAlreadyLive };
