'use strict';

/**
 * buildStartTicket — "was this ticket already started?", read through the
 * tracker's ticket door (SC-877).
 *
 * WHY THIS EXISTS. The fast-track lane's step 4 (CLAUDE.md) asks this before
 * a branch is cut: is there an open pull request for the ticket, or a
 * half-built worktree on this disk or another machine? The answer used to be
 * `npm run clickup -- build-start`, a command of the old ClickUp door
 * (scripts/clickup_direct.mjs). When the tickets moved to the tracker
 * (SC-790) the door was replaced by Spirality's copy in `loop/`, which has no
 * such command, so on 2026-11-18 fast-tracking SC-843 printed the door's usage
 * text and the check silently did not run.
 *
 * The decisions are unchanged and stay in buildStart.js. This file is only the
 * reading: the ticket's comments (for the `PR opened:` line), then — only when
 * no PR settles it — the ticket itself (for its `repo:` tag) and the disks.
 *
 * A READ THAT FAILED IS NEVER "NOTHING STARTED" (DOCTRINE §3.11). Comments
 * that could not be read become `unknown` (exit 1), not an empty trail, which
 * would read as `fresh` (exit 0) and send a session off to cut a second
 * branch over work that exists.
 */

const buildStart = require('./buildStart.js');

/**
 * @param {object} o
 * @param {string}   o.taskId
 * @param {Function} o.call           ClickUp-shaped `call(method, path)` (pipelineTrackerCall)
 * @param {Function} o.lookupPr       (pr) -> gh's JSON for it, or null when it could not be read
 * @param {Function} o.findLocalWork  (task) -> localWorkReading verdict; may throw
 * @param {string}   [o.hereId]       this machine's name
 * @returns {Promise<object>} buildStart's decision
 */
async function readBuildStart({ taskId, call, lookupPr, findLocalWork, hereId }) {
  const id = encodeURIComponent(String(taskId));
  let seen;
  try {
    seen = await call('GET', `/api/v2/task/${id}/comment`);
  } catch (err) {
    seen = { ok: false, threw: String(err?.message || err) };
  }
  if (!seen?.ok || !Array.isArray(seen.json?.comments)) {
    return {
      action: 'unknown',
      pr: null,
      why: `the comments on ${taskId} could not be read (${whyOf(seen)}) — `
        + 'a check that did not run is not "nothing started", so do NOT start a branch',
    };
  }

  const fromPr = buildStart.resolveFromPullRequest(seen.json.comments, lookupPr);
  if (!buildStart.needsLocalWorkReading(fromPr)) return fromPr;

  // The ticket is read for its TAGS: the repo to look in comes from its own
  // `repo:` tag. An unreadable ticket throws inside the reading, which
  // `withLocalWork` turns into CANNOT TELL — never a ticket fabricated as
  // `{ id }`, which would default to starcaster and probe the wrong checkout.
  let ticket;
  try {
    ticket = await call('GET', `/api/v2/task/${id}`);
  } catch (err) {
    ticket = { ok: false, threw: String(err?.message || err) };
  }
  return buildStart.withLocalWork(fromPr, {
    findLocalWork: () => {
      if (!ticket?.ok || !ticket.json) {
        throw new Error(`the ticket itself could not be read (${whyOf(ticket)}), `
          + 'so which repo to look in is unknown and nothing was probed');
      }
      return findLocalWork(ticket.json);
    },
    hereId,
  });
}

/** The lines the command prints, in order — kept here so a test pins them. */
function reportLines(decision, { task }) {
  const lines = [buildStart.describeBuildStart(decision)];
  if (decision.pr) {
    lines.push(`pr:     #${decision.pr.number}${decision.pr.branch ? ` (branch ${decision.pr.branch})` : ''}`);
    if (decision.pr.url) lines.push(`url:    ${decision.pr.url}`);
  }
  for (const line of buildStart.describeFoundWork(decision)) lines.push(`work:   ${line}`);
  const next = buildStart.describeNextMove(decision, { task });
  if (next) lines.push(`next:   ${next}`);
  return lines;
}

function whyOf(out) {
  if (!out) return 'no answer';
  if (out.threw) return out.threw;
  if (out.text) return String(out.text).slice(0, 200);
  if (out.status) return `status ${out.status}`;
  return 'the answer had no comment list';
}

module.exports = { readBuildStart, reportLines, exitCode: buildStart.buildStartExitCode };
