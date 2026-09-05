'use strict';

/**
 * pipelineSweep — THE STRANDED-TICKET SWEEP, on its own and drivable in a test.
 *
 * This is the one repair for work whose pass died. Until 2026-09-02 it was
 * reachable from nowhere that mattered: it lived inline in `resume`, BELOW that
 * command's early exit for "the pipeline is already running". So the repair
 * `status` recommends by name could only run as a side effect of lifting a
 * pause — while a ticket strands when a session dies, which happens
 * overwhelmingly while the pipeline is RUNNING. On 2026-09-02 four stranded
 * builds filled four of the five in-flight slots overnight; `status` printed
 * the advice, `resume --operator-asked` answered "Nothing to resume — the
 * pipeline is already running", and changed nothing. A guard placed above the
 * work it protects, never exercised in the state it exists for (DOCTRINE,
 * unreachable guards). PR #527 fixed that, and it is asserted below.
 *
 * WHY IT LIVES HERE RATHER THAN IN pipeline.mjs (2026-09-05, task 86bbt204x).
 * The fix above shipped with the "running + stranded" path covered only by
 * REGEXES over the text of pipeline.mjs — assertions that `sweepStranded` is
 * called in the right place and that its exit code is wired through. Nothing
 * executed it. That is the weakest kind of coverage for the strongest kind of
 * code: this function MOVES REAL TICKETS on the board, it branches on
 * build-vs-review, and it counts a ticket as "still stranded" on four separate
 * failure paths. A regex proving the function is called cannot catch a bug
 * inside it. It could not be executed because it sat at module scope in a CLI
 * script that runs its command dispatcher on import.
 *
 * So the three ClickUp calls are INJECTED rather than made here — the same
 * shape pipelinePauseStore.js already uses, for the reason it already states:
 * "injecting it also makes every branch below drivable in `node --test` with
 * no token and no network." pipeline.mjs passes its own, so there is still
 * exactly ONE implementation of the sweep and no second copy of the rules
 * (this ticket's third acceptance criterion).
 *
 * The DECISIONS stay where they were and are not re-derived here: where a
 * stranded build belongs is `pipelinePause.strandedBuildDestination`, and the
 * hand-back note is `pipelinePause.sweptTicketNote`.
 */

const {
  STRANDED_AFTER_MS, inFlight, strandedBuildDestination, sweptTicketNote, humanDuration,
} = require('./pipelinePause.js');
const { loopNoteOf, whyOf } = require('./pipelinePauseStore.js');

/**
 * Sweep the stranded tickets out of a queue reading.
 *
 * `apply` is false by default, and the dry run is a real preview: it asks
 * `buildStartFor` the same question and names the same destination, and writes
 * nothing. That default is also the safety property that makes an
 * always-available sweep sound — 90 minutes is longer than any loop pass but
 * NOT longer than a hand-driven fast-track session, which holds a ticket in
 * "Building" for hours without touching it. Nothing moves unless somebody who
 * has read the ages types `--apply`.
 *
 * Returns `{ swept, found, sweepState }`. The three-part report is the reason
 * this is worth reading: `swept` is what moved, `left` is what was examined and
 * could NOT be moved, `checked` is whether the queue was looked at at all. Not
 * looking and finding nothing are different answers (86bbqw49y), and only one
 * of them is an all-clear.
 *
 * @param {object}   o
 * @param {string}   o.by                who is doing this, for the note
 * @param {object}   o.queue             a pipelinePauseStore queue reading
 * @param {boolean}  [o.apply]           false = preview, write nothing
 * @param {number}   [o.strandedAfterMs] how old counts as stranded
 * @param {string}   [o.command]         the command to credit in the note
 * @param {Function} o.buildStartFor     async (taskId) -> { action, why }
 * @param {Function} o.clearLoopNote     async (task) -> boolean
 * @param {Function} o.tryCall           async (method, path, body) -> { ok, json, ... }
 * @param {Function} [o.log]             where the per-ticket lines go
 * @param {number}   [o.nowMs]           the clock, injectable so a test is deterministic
 */
async function sweepStranded({
  by, queue, apply = false, strandedAfterMs = STRANDED_AFTER_MS,
  command = 'npm run pipeline -- resume',
  buildStartFor, clearLoopNote, tryCall,
  log = (msg) => console.error(msg),
  nowMs = Date.now(),
}) {
  // Three things the report needs, and only this loop can know two of them.
  // `swept` is what was unstuck. `left` is what was EXAMINED and could not be —
  // invisible to a summary that is only shown what was taken, which is how an
  // all-clear came to print one line under "it is still stranded" (86bbqw49y).
  // `checked` is whether the queue was looked at at all.
  const swept = [];
  const left = [];
  let sweepChecked = false;
  let sweepWhy = '';
  let found = 0;
  if (queue?.readable) {
    sweepChecked = true;
    const rows = (queue.tasks || []).map((t) => ({ ...t, loopNote: loopNoteOf(t) }));
    const { stranded } = inFlight(rows, { nowMs, strandedAfterMs });
    found = stranded.length;
    for (const s of stranded) {
      // WHERE a stranded ticket belongs depends on what died on it.
      //
      // A stranded BUILD has no finished work to protect, so it goes back to
      // the claim line and the next build pass picks it up (its `build-start`
      // check finds any half-pushed branch, which is what the note tells it to
      // do).
      //
      // A stranded REVIEW is different: the ticket is already in "In review",
      // which is where a ticket WAITS for a reviewer. All that is wrong with it
      // is the stale claim note saying a review is running. Sending it to
      // Queued would throw away a completed, PR-open build and hand the whole
      // job to a second builder. So it is released where it stands — note
      // cleared, status untouched — and the next review pass claims it.
      const reviewing = s.kind === 'a review';
      // WHERE a stranded build goes depends on whether anything was built for
      // it (task 86bbr1u9v). Asked BEFORE the note is written, because the note
      // names the destination — a note saying "Queued" above a move to "Rework"
      // is a trail that contradicts the board, and the trail is the only thing
      // the next pass reads. Reviews skip it: they never move.
      const dest = reviewing ? { action: 'n/a' } : await buildStartFor(s.id);
      const plan = reviewing ? null : strandedBuildDestination(dest.action);
      // HOW STALE, on every line. The sweep can be run at any moment rather
      // than only out of a pause, so its reader has to be able to tell a ticket
      // dead since midnight from one a hand-driven session claimed 91 minutes
      // ago and is still working on. The threshold cannot make that call for
      // them; the age can.
      const age = s.ageMs != null ? `, untouched for ${humanDuration(s.ageMs)}` : '';

      // A DRY RUN STOPS HERE, having written nothing. It still does the full
      // `build-start` lookup above, because "where would this go" is the whole
      // question the dry run is asked, and answering it from a guess would
      // make the preview a different program from the thing it previews.
      if (!apply) {
        log(`  ${s.id} ("${s.name}") WOULD ${reviewing
          ? 'be released where it stands in "In review" — its build is finished and its PR is open'
          : `return to ${plan.status} — ${plan.why}`}; it is ${s.kind} with nothing working on it${age}.`);
        swept.push({ id: s.id, kind: s.kind, destination: reviewing ? 'In review' : plan.status });
        continue;
      }
      const note = await tryCall('POST', `/api/v2/task/${s.id}/comment`, {
        comment_text: sweptTicketNote({
          at: new Date().toISOString(), by, kind: s.kind, command,
          destination: plan?.status, why: plan?.why,
        }),
        notify_all: false,
      });
      if (!note.ok) {
        log(`  ${s.id}: could not write the hand-back note (${whyOf(note)}) — LEAVING it where it is rather than moving it silently.`);
        left.push(s.id);
        continue;
      }

      const task = (queue.tasks || []).find((t) => String(t.id) === s.id);

      if (reviewing) {
        const cleared = await clearLoopNote(task);
        if (!cleared) {
          log(`  ${s.id}: the note landed but the stale review claim could NOT be cleared — the next review pass will still see it as taken.`);
          left.push(s.id);
          continue;
        }
        log(`  ${s.id} ("${s.name}") released in "In review" — its review pass died${age}, but its build is finished and its PR is open.`);
        swept.push({ id: s.id, kind: s.kind, destination: 'In review' }); // matches the per-ticket line above, verbatim
        continue;
      }

      const rem = (task?.assignees || []).map((a) => a.id);
      const where = plan;
      const move = await tryCall('PUT', `/api/v2/task/${s.id}`, { status: where.status, assignees: { add: [], rem } });
      if (!move.ok || String(move.json?.status?.status || '').toLowerCase() !== where.status.toLowerCase()) {
        log(`  ${s.id}: the note landed but the move to ${where.status} did NOT (${whyOf(move)}) — it is still stranded.`);
        left.push(s.id);
        continue;
      }
      log(`  ${s.id} ("${s.name}") returned to ${where.status} — it was ${s.kind} with nothing working on it${age}; ${where.why}.`);
      swept.push({ id: s.id, kind: s.kind, destination: where.status });
    }
  } else {
    sweepWhy = 'the queue could not be read';
    log('  the queue could not be read, so nothing was swept — run `npm run pipeline -- status` after this.');
  }
  return { swept, found, sweepState: { checked: sweepChecked, left: left.length, why: sweepWhy } };
}

module.exports = { sweepStranded };
