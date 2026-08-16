'use strict';

/**
 * THE PR IS NAMED AFTER THE WORK, NOT AFTER THE SHIP SCRIPT'S HOUSEKEEPING.
 *
 * `npm run ship` used to title the pull request from `git log -1` — the newest
 * commit on the branch. By the time it asks, that is very often a commit the
 * script just made itself: the verify step rebuilds, the rebuild re-stamps the
 * `?v=` asset pins, and those get committed; catching up with main leaves a
 * merge commit. Either one stole the title.
 *
 * And because every PR here is squash-merged, the stolen title is what lands in
 * `main` permanently. Three of four merges on 2026-08-15 went in as "Re-pin
 * asset hashes from a clean build" while actually carrying features (#258,
 * #259, #261), so `git log` could no longer answer "when did that ship?" —
 * you had to open each housekeeping commit and read its body.
 *
 * Lives in its own file so it can be tested against a real repository. The
 * force-push property next door is asserted on the source text because driving
 * it needs a remote and CI; this one needs nothing but `git log`, and a
 * behavioural test is strictly better when it is available.
 */

/** The one commit subject `ship` writes itself. */
const REPIN_SUBJECT = 'Re-pin asset hashes from a clean build';

/** ASCII unit separator — cannot appear in a commit subject, so splitting is safe. */
const SEP = '\x1f';

/**
 * Choose the commit a pull request should be named after.
 *
 * @param {(args: string[], opts?: object) => string} git  runs git, returns stdout
 * @param {{ base?: string, repinSubject?: string }} [options]
 * @returns {{ subject: string, body: string }}
 */
function pickPullRequestCommit(git, options = {}) {
  const base = options.base || 'origin/main';
  const repinSubject = options.repinSubject || REPIN_SUBJECT;

  // --no-merges drops the catch-up merge commits; the subject check drops the
  // re-pin. Newest first, so this keeps the old "last commit" intent and only
  // skips what the script itself authored.
  const log = git(['log', `${base}..HEAD`, '--no-merges', `--format=%H${SEP}%s`], { allowFail: true });

  const authored = String(log || '')
    .split('\n')
    .map((line) => line.split(SEP))
    .filter((parts) => parts.length === 2 && parts[0].trim())
    .find(([, subject]) => subject.trim() && subject.trim() !== repinSubject);

  // Nothing but housekeeping on the branch — unusual, but a PR with no title
  // fails outright, so fall back to the old behaviour rather than break.
  if (!authored) {
    return { subject: git(['log', '-1', '--format=%s']), body: git(['log', '-1', '--format=%b']) };
  }

  const [hash, subject] = authored;
  return { subject: subject.trim(), body: git(['log', '-1', '--format=%b', hash]) };
}

module.exports = { pickPullRequestCommit, REPIN_SUBJECT, SEP };
