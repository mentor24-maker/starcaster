'use strict';

/**
 * shipPrTrail — the decision `npm run ship` makes about the ticket's PR trail.
 *
 * WHY THIS EXISTS (2026-08-31, task 86bbq7z1k). `scripts/ship_thread.cjs` had
 * no ClickUp interaction of any kind, so the hand lane and the fast-track lane
 * never left a `PR opened:` line on the ticket. That was harmless while the
 * review gate was advisory. It stops being harmless the moment branch
 * protection is ticked: the gate confirms the ticket records this PR by reading
 * that line (`loopTrail.prTrailLanded`), and a ticket without one is CANNOT
 * TELL, which is never a pass — so every hand-shipped PR would be blocked until
 * somebody remembered to run `clickup pr-opened` by hand.
 *
 * Two ways to close that were on the table: teach `ship` to write the trail, or
 * add a written step to the lane docs. The first one cannot be forgotten, which
 * is the same argument that turned both loop traces into commands in the first
 * place (task 86bbjt18r) — a step that says "post a comment" is followed most of
 * the time, and nothing notices the times it is not.
 *
 * `ship` already knows the ticket: `npm run thread` stamps it onto the branch
 * (`branch.<name>.clickup-task`), the same stamp `npm run tidy` reads back.
 *
 * The rules live here, pure and unit-tested, rather than inline in the script,
 * because everything around them in `ship` needs a remote, a PR and a live CI
 * run to exercise — which is exactly how an untested rule rots.
 */

const { bodyNamesTicket } = require('./clickupTicketLink.js');

/** The one spelling of a ticket URL, shared with the matcher that reads it. */
function ticketUrl(taskId) {
  return `https://app.clickup.com/t/${String(taskId || '').trim()}`;
}

/**
 * Should `ship` record this PR on a ticket, and if not, what does it say?
 *
 * Three outcomes, and only one of them writes:
 *
 *   record     — there is a stamp and a PR number; go and write the trail.
 *   no-stamp   — the branch was not made by `npm run thread`, or was made
 *                before the stamp existed. NOT a failure (acceptance criterion
 *                3): plenty of legitimate branches have no ticket. But it is
 *                said out loud, with the consequence named, because the gate
 *                will refuse this PR once it is enforcing and "nothing was
 *                printed" is indistinguishable from "it was recorded".
 *   no-pr      — there is no PR number to record. Only reachable if the PR
 *                lookup came back empty, which is already odd; saying so beats
 *                sending `--pr undefined` to ClickUp.
 */
function decideTrailWrite({ taskId, prNumber } = {}) {
  const id = String(taskId == null ? '' : taskId).trim();
  const pr = String(prNumber == null ? '' : prNumber).trim();

  if (!id) {
    return {
      write: false,
      reason: 'no-stamp',
      message:
        'This branch carries no ClickUp ticket, so no "PR opened:" line was written.\n' +
        'That is fine for a branch that has no ticket. But once branch protection is\n' +
        'enforcing, the review gate refuses a PR whose ticket does not record it — so if\n' +
        'this work DOES have a ticket, stamp the branch and run ship again:\n' +
        `  git config branch.<branch>.clickup-task <task-id>\n` +
        'or record it once by hand:\n' +
        '  npm run clickup -- pr-opened --task <task-id> --pr <pr-url>',
    };
  }
  if (!/^\d+$/.test(pr)) {
    return {
      write: false,
      reason: 'no-pr',
      message:
        `The ticket is ${id}, but no pull-request number could be read, so nothing was\n` +
        'written to it. Record it by hand once the PR exists:\n' +
        `  npm run clickup -- pr-opened --task ${id} --pr <pr-url>`,
    };
  }
  return { write: true, reason: 'record', taskId: id, prNumber: Number(pr), url: ticketUrl(id) };
}

/**
 * The PR body `ship` should send, with the ticket link added when it is absent.
 *
 * The trail has to run BOTH ways — the ticket names the PR, the PR names the
 * ticket — and `pr-opened` refuses to write its half until the PR body carries
 * the other half. Since `ship` is the one authoring this body, adding the line
 * here is what makes acceptance criterion 1 reachable at all; without it, every
 * ship on a stamped branch would post the trail request and get exit 4 back.
 *
 * Idempotent by the SAME matcher `pr-opened` and the review gate use, so a body
 * that already links the ticket — in either live URL shape, written by hand or
 * by a previous run — is returned untouched rather than gaining a second copy.
 */
function bodyWithTicketLink(body, taskId) {
  const text = String(body == null ? '' : body);
  const id = String(taskId || '').trim();
  if (!id) return text;
  if (bodyNamesTicket(text, id, '')) return text;
  const trimmed = text.replace(/\s+$/, '');
  return `${trimmed}${trimmed ? '\n\n' : ''}ClickUp: ${ticketUrl(id)}\n`;
}

/**
 * What `ship` prints about the trail attempt — and, crucially, whether that
 * stops the ship.
 *
 * It never does (acceptance criterion 4). A ClickUp outage is not a reason to
 * abandon a green, mergeable PR, and stopping here would leave the operator
 * with a merge to finish by hand for a reason that has nothing to do with his
 * change. But it is not swallowed either: a silently missing trail is the whole
 * defect this work exists to fix, so a failure is LOUD and names the exact
 * command that repairs it.
 *
 * Exit 4 is called out separately because it is the one failure with a
 * different fix: the PR body has no link back to the ticket, so the repair is
 * to edit the body, not to re-run the command.
 */
function describeTrailResult({ taskId, prNumber, code, output } = {}) {
  const id = String(taskId || '').trim();
  const pr = String(prNumber == null ? '' : prNumber).trim();
  const tail = String(output || '').trim();
  // `spawnSync` reports `status: null` when the child was killed by a signal
  // rather than exiting. `Number(null)` is 0, so a plain numeric compare read a
  // KILLED ClickUp write as a successful one — a silent missing trail, which is
  // the precise defect this whole module exists to prevent. Only a real, finite
  // zero counts.
  const status = (code === null || code === undefined || code === '') ? NaN : Number(code);

  if (status === 0) {
    return { ok: true, loud: false, message: tail || `Recorded PR #${pr} on ticket ${id}.` };
  }
  if (status === 4) {
    return {
      ok: false,
      loud: true,
      message:
        `COULD NOT RECORD THE PR ON TICKET ${id}: pull request #${pr} has no link back to\n` +
        'the ticket in its body, so the trail would only run one way. Nothing was written.\n' +
        'The ship itself is unaffected. Add this line to the PR body, then run the command:\n' +
        `  ClickUp: ${ticketUrl(id)}\n` +
        `  npm run clickup -- pr-opened --task ${id} --pr ${pr}` +
        (tail ? `\n\n${tail}` : ''),
    };
  }
  return {
    ok: false,
    loud: true,
    message:
      `COULD NOT RECORD PR #${pr} ON TICKET ${id} (the command exited ${Number.isFinite(status) ? status : '?'}).\n` +
      'The ship itself is unaffected — but this ticket now has no readable PR trail, and the\n' +
      'review gate will refuse it once branch protection is enforcing. Run this when ClickUp\n' +
      'is reachable again:\n' +
      `  npm run clickup -- pr-opened --task ${id} --pr ${pr}` +
      (tail ? `\n\n${tail}` : ''),
  };
}

module.exports = { ticketUrl, decideTrailWrite, bodyWithTicketLink, describeTrailResult };
