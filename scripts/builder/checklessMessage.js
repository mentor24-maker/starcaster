'use strict';

const { classifyMergeable, isWorkflowCheck } = require('./waitForChecks');

/**
 * ONE PLACE THAT DECIDES WHAT TO TELL THE OPERATOR ABOUT A CHECKLESS PULL
 * REQUEST — and, the whole reason it exists, one place that can only ever tell
 * him to do ONE thing.
 *
 * WHY THIS EXISTS (round 3 of task 86bbvqkr1, 2026-09-06)
 * A pull request with no CI checks has two known causes with OPPOSITE remedies:
 * a run GitHub never created (fixed by a new head SHA) and a head GitHub calls
 * conflicting (fixed by merging the base branch in — a new commit cannot help,
 * because that commit does not merge either). Rounds 1 and 2 taught `ship` to
 * take the reading that tells them apart, and then assembled the message by
 * CONCATENATION: a base paragraph chosen from the nudge outcome, with a note
 * about mergeability appended after it. Two of those pairings contradict
 * themselves outright. Rendered from the real strings, the commit-failed +
 * conflicting pairing said:
 *
 *     ...Re-running `npm run ship` on its own will NOT help — the branch
 *     needs a new commit before GitHub will make a run.
 *     ...The remedy is a catch-up merge, not another commit: run
 *     `npm run ship` again and it merges origin/main in first.
 *
 * The operator can do one of those, and nothing in the message says which. That
 * is this ticket's own failure mode — a checkless pull request handing out a
 * remedy that cannot work — reproduced inside the fix written for it, and it is
 * reachable: one conflicting reading at the grace poll is not the two the
 * `blocked_conflicting` guard requires, so the run falls through to the nudge,
 * and a nudge whose commit fails lands exactly here.
 *
 * THE FIX IS STRUCTURAL, NOT EDITORIAL. The message is assembled as
 * `preamble + evidence + exactly one remedy block + where to look`, and the
 * remedy is CHOSEN by a table rather than accumulated. Adding a second remedy
 * to a message is no longer something a future edit can do by accident: there
 * is one slot, `chooseRemedy` fills it, and the tests assert that a rendered
 * message carries exactly one `WHAT TO DO:` and that nothing above that line
 * issues a command.
 *
 * A SECOND SOURCE ON THE CONFLICT, TOO. GitHub's mergeability is a cached
 * background computation and it is wrong often enough here to have its own
 * memory note — PRs #567, #585, and #639, this ticket's own pull request, all
 * read CONFLICTING while `git merge-tree` merged the same two commits cleanly.
 * "Merge origin/main in" is the right answer when the branch is genuinely
 * behind, and a no-op loop when it is not: `ship` merges main in at step 1, so
 * a branch already current with main gets that advice, does it, changes
 * nothing, and arrives back here. So a conflicting reading is met with git's
 * own answer, the same cross-check `mergeOnComment`'s gate already makes, and
 * the three situations get three different remedies instead of one paragraph
 * that hedges between them.
 *
 * Pure, and exported as a function of plain data on purpose. The round-2
 * defect survived because the message was assembled inline in `ship_thread.cjs`
 * where the only way to test it was to slice the source and match strings —
 * and the test that did so asserted the note's three cases while nothing
 * asserted the note was USED. Deleting `+ mergeNote` from the caller left all
 * 63 tests passing. Here the message is a value, every combination is a unit
 * test, and the caller has one call and no strings of its own.
 */

/** Which step of the nudge was reached, as one word the message can key on. */
function attemptOf({ nudged, nudgeFailedAt } = {}) {
  if (nudged) return 'pushed';
  if (nudgeFailedAt === 'commit') return 'commit-failed';
  if (nudgeFailedAt === 'push') return 'push-failed';
  return 'not-attempted';
}

/**
 * What git says about the same question GitHub answered — as one word.
 *
 * 'conflicting' — git finds conflicts merging the base into the head
 * 'clean'       — it merges cleanly and the head is BEHIND the base, so a
 *                 catch-up merge is a real change
 * 'current'     — it merges cleanly and the head already contains the base, so
 *                 a catch-up merge would do nothing at all
 * null          — no reading could be taken; never treated as clean
 *
 * THE TRAP THIS GUARDS: `git merge-tree --write-tree` exits 1 for conflicts AND
 * for a ref it cannot resolve ("nosuchref - not something we can merge",
 * measured on git 2.50.1). Reading that bare 1 as a conflict would send the
 * operator to resolve a conflict that does not exist, over a typo'd ref name.
 * So both refs must be resolved BEFORE the exit code means anything, and a
 * merge-tree that says it could not merge something is a cannot-tell.
 */
function classifyLocalMerge({
  baseResolved, headResolved, mergeTreeCode, mergeTreeOut = '', behindCount, baseIsFresh,
} = {}) {
  if (!baseResolved || !headResolved) return null;
  if (/not something we can merge/i.test(String(mergeTreeOut))) return null;
  if (mergeTreeCode === 1) return 'conflicting';
  if (mergeTreeCode !== 0) return null;
  // "Already current" is a claim about the base ref, so it may only be made
  // against one this run actually refreshed. A stale origin/main would report
  // a branch as current when main has moved, which sends the phantom-conflict
  // remedy to a pull request whose real remedy is the catch-up merge.
  if (!baseIsFresh) return 'clean';
  if (typeof behindCount !== 'number' || Number.isNaN(behindCount)) return 'clean';
  return behindCount === 0 ? 'current' : 'clean';
}

/**
 * THE TABLE. Every checkless message's remedy comes from here and nowhere else.
 *
 * Read down the mergeability column first: what GitHub says about the merge ref
 * decides which FAMILY of remedy applies, because it decides whether a new
 * commit can create a run at all. Only inside the mergeable family does the
 * nudge's own outcome matter.
 */
function chooseRemedy({ mergeable, localMerge, nudged, nudgeFailedAt } = {}) {
  switch (classifyMergeable(mergeable)) {
    case 'conflicting':
      if (localMerge === 'conflicting') return 'resolve-the-conflict';
      if (localMerge === 'current') return 'recompute-mergeability';
      // 'clean', or no local reading at all: bringing main in is both the
      // measured remedy (#630) and the safe default when git could not answer.
      return 'catch-up-merge';
    case 'mergeable':
      switch (attemptOf({ nudged, nudgeFailedAt })) {
        case 'pushed': return 'check-actions';
        case 'push-failed': return 'push-the-commit';
        default: return 'new-commit';
      }
    default:
      // No reading, an unparseable one, or GitHub's own UNKNOWN. Two causes,
      // opposite remedies, and nothing to choose between them — so this branch
      // hands out neither and says how to settle it.
      return 'establish-the-cause';
  }
}

/**
 * The remedy blocks. Each is the ONLY thing in a message that tells the
 * operator to do something, and each begins `WHAT TO DO:` so a test can count
 * them. Do not add a command line anywhere outside this map.
 */
const REMEDIES = Object.freeze({
  'catch-up-merge': () =>
    'WHAT TO DO: bring main in. GitHub runs these workflows against the MERGE of this\n' +
    'branch and main, and it will not build that merge for a pull request it believes\n' +
    'conflicts — so the checks are not late, they are not coming. An empty "nudge"\n' +
    'commit cannot fix this one either; its new head SHA would not merge any better.\n\n' +
    '  npm run ship\n\n' +
    'merges origin/main into this branch first, which is the step that was missing.',

  'resolve-the-conflict': () =>
    'WHAT TO DO: resolve the conflict by hand. GitHub and git AGREE this branch and\n' +
    'main disagree, so this is a real conflict rather than a stale reading — and\n' +
    'GitHub cannot build a merge ref for it, so no check is coming until it is fixed.\n\n' +
    '  git fetch origin && git merge origin/main\n\n' +
    'then fix the conflicted files, commit, and run `npm run ship` again.',

  'recompute-mergeability': () =>
    'WHAT TO DO: make GitHub work the answer out again. It calls this pull request\n' +
    'conflicting, but this branch ALREADY contains everything on origin/main and git\n' +
    'merges the two cleanly — so the two sources disagree and GitHub is holding a\n' +
    'stale computation. Bringing main in would change nothing here, because there is\n' +
    'nothing left to bring; what moves it is a new head SHA:\n\n' +
    '  git commit --allow-empty -m "Recompute mergeability" && git push\n\n' +
    'GitHub recomputes mergeability on the push, and the runs start within seconds of\n' +
    'it deciding the pull request is mergeable after all.',

  'check-actions': () =>
    'WHAT TO DO: look at the repository rather than at this branch. GitHub does not\n' +
    'think this pull request conflicts, and an extra commit has already been pushed to\n' +
    'it, so neither of the two known causes of a checkless pull request fits. Check\n' +
    'that Actions is enabled for the repository and that the workflow files are\n' +
    'present on this branch.',

  'new-commit': () =>
    'WHAT TO DO: get a new commit onto the branch. GitHub does not think this pull\n' +
    'request conflicts, so this is the other cause — a run that was never created,\n' +
    'which only a new head SHA fixes. Waiting cannot help, and neither can re-running\n' +
    '`npm run ship` until whatever stopped the commit above has been dealt with.\n\n' +
    '  git commit --allow-empty -m "Nudge GitHub into creating a check run" && git push',

  'push-the-commit': () =>
    'WHAT TO DO: push the commit that is already here. GitHub does not think this pull\n' +
    'request conflicts, and the commit that creates a run has been made — it simply has\n' +
    'not reached GitHub yet.\n\n' +
    '  git push\n\n' +
    'or run `npm run ship` again; it picks up from wherever it got to.',

  'establish-the-cause': ({ prNumber }) =>
    'WHAT TO DO: find out WHICH cause this is before acting on either. There are two,\n' +
    'they need opposite remedies, and the reading that tells them apart could not be\n' +
    'taken. Do not act on a guess — ask GitHub directly:\n\n' +
    `  gh pr view ${prNumber || '<pr>'} --json mergeable,mergeStateStatus\n\n` +
    'CONFLICTING or DIRTY means merge origin/main in (`npm run ship` again does it).\n' +
    'MERGEABLE means the run was never created and a new commit is what creates one.\n' +
    'UNKNOWN means GitHub has not worked it out yet — ask again in a few seconds.',
});

const HEADLINES = Object.freeze({
  blocked_conflicting:
    'No check of this repository\'s own workflows has appeared on this pull request, and\n' +
    'ship stopped early rather than waiting the window out — the reason is below, and no\n' +
    'amount of waiting changes it.',
  never_appeared:
    'No check of this repository\'s own workflows ever appeared on this pull request.',
});

const ATTEMPTS = Object.freeze({
  'pushed':
    'An extra commit was pushed to make GitHub create a run; it made none for that either.',
  'commit-failed':
    'The extra commit that would normally create a run could not be made (the reason is\n' +
    'above this message), so nothing new has been pushed.',
  'push-failed':
    'The extra commit that creates a run was made, but pushing it failed (the reason is\n' +
    'above this message), so it is sitting on this branch locally and GitHub has not seen it.',
  'not-attempted':
    'No extra commit was pushed to try to create one.',
});

/** How the mergeability reading and git's second opinion get stated as facts. */
function evidenceLines({ mergeable, localMerge }) {
  const seen = mergeable && typeof mergeable === 'object' ? mergeable : {};
  const lines = [
    `  GitHub's mergeability reading: mergeable: ${seen.mergeable || '(none)'}, ` +
    `mergeStateStatus: ${seen.mergeStateStatus || '(none)'}`,
  ];
  if (localMerge === 'conflicting') {
    lines.push('  git, asked the same question here: it finds CONFLICTS merging origin/main in');
  } else if (localMerge === 'clean') {
    lines.push('  git, asked the same question here: origin/main merges in cleanly, and this');
    lines.push('    branch is behind it');
  } else if (localMerge === 'current') {
    lines.push('  git, asked the same question here: origin/main merges in cleanly, and this');
    lines.push('    branch already contains all of it');
  } else if (classifyMergeable(mergeable) === 'conflicting') {
    lines.push('  git, asked the same question here: NO READING — the local cross-check could');
    lines.push('    not be taken, so GitHub\'s answer stands unconfirmed');
  }
  return lines.join('\n');
}

/**
 * Name a non-CI check that has FAILED, when there is one.
 *
 * `classifyChecks` deliberately calls a board of nothing but third-party rows
 * `none` even when one of them failed, because "our CI has not run" is the
 * truer statement and it is what lets the conflicting-head probe ask why. That
 * ordering is right and stays — but it means a failed Vercel deployment goes
 * completely unmentioned on the one path that prints a diagnosis. It is not the
 * cause of the missing runs and this must not imply it is; it is a fact the
 * operator would otherwise have to find for himself.
 */
function otherFailuresLine(checks) {
  const failed = (Array.isArray(checks) ? checks : [])
    .filter((c) => c && typeof c === 'object' && !isWorkflowCheck(c))
    .filter((c) => ['fail', 'cancel'].includes(String(c.bucket || '').toLowerCase()))
    .map((c) => String(c.name || 'an unnamed check').trim())
    .filter(Boolean);
  if (!failed.length) return '';
  return (
    '\n\nSEPARATELY, and not the cause of the missing runs: ' +
    `${failed.join(', ')} ${failed.length === 1 ? 'has' : 'have'} FAILED on this\n` +
    'pull request. Nothing else would have named that, so it is named here.'
  );
}

/**
 * Build the whole message for a checkless pull request.
 *
 * @param outcome        'never_appeared' | 'blocked_conflicting'
 * @param nudged         did the extra push actually happen
 * @param nudgeFailedAt  'commit' | 'push' | null — which step failed
 * @param mergeable      the last `gh pr view --json mergeable,mergeStateStatus`
 *                       reading, or null if none could be taken
 * @param localMerge     git's second opinion (see classifyLocalMerge), or null
 * @param checks         the last check list, for naming a failed non-CI row
 * @param prNumber, prUrl
 * @returns { remedy, text } — `remedy` is the table key, so a caller or a test
 *          can assert WHICH advice was given without matching prose.
 */
function checklessMessage({
  outcome = 'never_appeared',
  nudged = false,
  nudgeFailedAt = null,
  mergeable = null,
  localMerge = null,
  checks = [],
  prNumber = null,
  prUrl = '',
} = {}) {
  const remedy = chooseRemedy({ mergeable, localMerge, nudged, nudgeFailedAt });
  const headline = HEADLINES[outcome] || HEADLINES.never_appeared;
  const attempt = ATTEMPTS[attemptOf({ nudged, nudgeFailedAt })];
  const text =
    `${headline}\n${attempt}\n` +
    'Nothing was merged; the work is safe on the branch.\n\n' +
    'WHAT WAS READ:\n' +
    `${evidenceLines({ mergeable, localMerge })}` +
    `${otherFailuresLine(checks)}\n\n` +
    `${REMEDIES[remedy]({ prNumber })}\n\n` +
    `Look at: ${prUrl}`;
  return { remedy, text };
}

module.exports = {
  attemptOf, classifyLocalMerge, chooseRemedy, checklessMessage, REMEDIES, HEADLINES, ATTEMPTS,
};
