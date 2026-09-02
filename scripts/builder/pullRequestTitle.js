'use strict';

/**
 * THE PULL REQUEST IS NAMED AFTER ITS TICKET, NOT AFTER A COMMIT MESSAGE.
 *
 * WHY (2026-09-01, task 86bbqwupk). Dane reads the ClickUp Closed list and the
 * GitHub/Vercel deploy list side by side and pairs them up by name and time.
 * That only works while the two names are the same string, and nothing anywhere
 * said they had to be. `npm run ship` titled the PR from the newest
 * hand-authored commit on the branch (`pullRequestCommit.js`), which is a
 * freehand sentence somebody typed; `loop-build` step 7 said "open a PR with
 * gh" and the agent invented one.
 *
 * Measured over the ten most recently merged PRs on 2026-08-31, two differed
 * from their ticket. #481 is the dangerous shape — "drifts slower than the
 * page" against "scrolls slower than the page", one word apart, so it reads as
 * a match until you look twice. A pairing method that is right most of the time
 * is worse than one that is obviously wrong, because nobody checks it.
 *
 * So: byte-identical, or say loudly that it is not. GitHub appends `(#NNN)` on
 * squash-merge, which is expected and fine.
 *
 * WHY THE FALLBACK IS LOUD. The old commit-subject picker is still here and
 * still correct — it is the path for a branch with no ticket, which is a
 * legitimate thing to have. But a SILENT fallback is how this rule gets quietly
 * lost again: "the title came from the ticket" and "the fetch failed and nobody
 * looked" print the same nothing. Every path that does not use the ticket name
 * says which path it took and why.
 *
 * WHY IT NEVER STOPS THE SHIP. Same reasoning as the PR trail next door
 * (`shipPrTrail.js`): a ClickUp outage is not a reason to abandon a green,
 * mergeable branch. A wrong-but-honest title costs one rename; a refused ship
 * costs the operator his afternoon.
 *
 * Pure, so it can be tested without a remote, a PR or a live ClickUp token —
 * everything around it in `ship_thread.cjs` needs all three, which is exactly
 * how an untested rule rots.
 */

/**
 * Pull the task name out of what `npm run --silent clickup -- task-name` wrote
 * to stdout.
 *
 * `task-name` prints the name and nothing else, so this should be a trim. It is
 * not, and the reason is worth the lines: npm writes its run banner
 * (`> starcaster@1.0.0 clickup` / `> doppler run ...`) to **stdout**, not
 * stderr. `--silent` suppresses it today, but the title this produces is
 * compared byte-for-byte against ClickUp by a human reading two lists, so a
 * future npm that ignores `--silent` would not fail — it would silently title
 * every PR "> starcaster@1.0.0 clickup". Dropping the banner shape here costs
 * nothing and cannot misfire on a real name: a ClickUp task name beginning
 * "> " would be stripped, which is the one case worth accepting.
 *
 * @param {string} stdout  raw stdout from the fetch
 * @returns {string} the name, or '' if there was nothing usable
 */
function parseTaskName(stdout) {
  const lines = String(stdout == null ? '' : stdout).split('\n');
  while (lines.length && (lines[0].trim() === '' || lines[0].startsWith('> '))) lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n').trim();
}

/**
 * What should this pull request be called?
 *
 * @param {object} input
 * @param {string} input.taskId          the branch's `clickup-task` stamp ('' if unstamped)
 * @param {string} input.fallbackSubject the commit subject `pickPullRequestCommit` chose
 * @param {(taskId: string) => {ok: boolean, stdout?: string, output?: string}} input.fetchTaskName
 *        asks ClickUp for the name. Injected so the three outcomes below can be
 *        tested without a token.
 * @returns {{title: string, source: 'ticket'|'commit', reason: string, loud: boolean, message: string}}
 */
function decidePullRequestTitle({ taskId, fallbackSubject, fetchTaskName } = {}) {
  const id = String(taskId == null ? '' : taskId).trim();
  const fallback = String(fallbackSubject == null ? '' : fallbackSubject).trim();

  const fellBack = (reason, why) => ({
    title: fallback,
    source: 'commit',
    reason,
    loud: true,
    message:
      `${why}\n` +
      `Naming the pull request after the newest hand-authored commit instead:\n` +
      `  "${fallback || '(no commit subject either — gh will refuse this)'}"\n` +
      'The Closed list and the deploy list are paired up by name, so if this PR has a\n' +
      'ticket, rename it to match:\n' +
      `  gh pr edit <pr> --title "<the ClickUp task name, copied exactly>"`,
  });

  if (!id) {
    return fellBack(
      'no-stamp',
      'This branch carries no ClickUp ticket, so there is no task name to title the\n' +
      'pull request with. That is fine for a branch that has no ticket; stamp one on\n' +
      'with `git config branch.<branch>.clickup-task <id>` if it does have one.'
    );
  }

  let fetched;
  try {
    fetched = typeof fetchTaskName === 'function' ? fetchTaskName(id) : null;
  } catch (error) {
    fetched = { ok: false, output: (error && error.message) || String(error) };
  }

  const output = String((fetched && (fetched.output ?? fetched.stdout)) || '').trim();
  if (!fetched || !fetched.ok) {
    return fellBack(
      'fetch-failed',
      `Could not read the name of ticket ${id} from ClickUp, so the pull request could\n` +
      'not be titled after it.' + (output ? `\n${output}` : '')
    );
  }

  const name = parseTaskName(fetched.stdout);
  if (!name) {
    return fellBack(
      'empty-name',
      `ClickUp answered for ticket ${id} but gave no usable task name back.` +
      (output ? `\n${output}` : '')
    );
  }

  return {
    title: name,
    source: 'ticket',
    reason: 'ticket',
    loud: false,
    message: `Titled after ticket ${id}: "${name}"`,
  };
}

module.exports = { decidePullRequestTitle, parseTaskName };
