'use strict';

/**
 * pipelineTrackerCall — the pause switch and the stranded-ticket sweep, on the
 * tracker instead of ClickUp (SC-794, review round 1).
 *
 * WHY A TRANSLATOR AND NOT A REWRITE. `npm run pipeline` hands one injected
 * `call(method, path, body)` to two tested modules — pipelinePauseStore.js
 * (where the switch is, and what counts as unreadable) and pipelineSweep.js
 * (which stranded tickets move, and where). Both were written against
 * ClickUp's REST paths. Their DECISIONS are the hard-won part, each with an
 * incident behind it, and none of them is about ClickUp. So this file answers
 * the handful of paths they ask, from the ticket door, in the shapes they
 * already read — and refuses any other path out loud, so a new ClickUp call
 * added later fails here instead of quietly reaching nothing.
 *
 * WHERE THINGS ARE ON THE TRACKER. ClickUp's Loop Queue held both the work and
 * the switch ticket. On the tracker they are two projects: the work is this
 * project's own queue (open tickets — Building and In review are open), and
 * the switch is a standing ticket in the BUS project, beside the roll call and
 * the pulse report, where no loop claims from. So "the Loop Queue, closed
 * included" is answered with both: the open work, then the bus project's
 * ticket(s) carrying the switch's NAME, Live included. Since SC-818
 * StarCaster's bus IS its own project, so the two listings can overlap: each
 * ticket is answered once.
 *
 * ONLY THE SWITCH, NOT EVERY CLOSED TICKET (SC-851). This used to answer with
 * every bus ticket, and since SC-818 that is every StarCaster ticket ever
 * closed — 849 on 2026-11-17, each costing the door a status-history request.
 * From the MacBook that read never finished inside its deadline, so the pause
 * check there failed safe to PAUSED and `npm run ship` merged nothing. Nothing
 * that reads this list wants a closed ticket other than the switch: the store
 * finds the switch by name, and the sweep and the drain count only Building
 * and In review, which are open. Comments, likewise, are read from the one
 * ticket asked about, never from every ticket in the project.
 *
 * `call.findSwitch()` is the check's own path: the switch ticket alone, no
 * work queue at all (pipelinePauseStore.readSwitch, `findSwitch`).
 *
 * The paths answered, and nothing else:
 *
 *   GET  /api/v2/list/<any>/task?...page=N   page 0: the reading above; later pages: empty
 *   GET  /api/v2/task/<id>                   `get`
 *   GET  /api/v2/task/<id>/comment[?start=]  that ticket's comments, newest first, on the first page
 *   POST /api/v2/task/<id>/comment           `comment` (the door reads it back)
 *   PUT  /api/v2/task/<id>  { status }       `status`, guarded on "Building" — the sweep
 *                                            only ever moves a stranded build
 *   POST /api/v2/list/<any>/task             `task` in the bus project (the switch)
 *
 * The tracker has no "Loop note" field, so the field writes are never reached:
 * a task with no `custom_fields` is treated as having no note to write.
 *
 * Every answer is `{ ok, status, res, json }`, the shape `pipeline.mjs`'s own
 * ClickUp `call` returned, and a failed door command becomes `{ ok: false,
 * threw }` — never a throw — because the store's `whyOf` turns that into the
 * reason a reader sees, and a pause check that throws exits with a code some
 * other script misreads (pipelinePauseStore.js, `safely`).
 */

const realDoor = require('../lib/trackerDoor.cjs');
const { SWITCH_TASK_NAME } = require('./pipelinePause.js');

function answer(json, status = 200) {
  return { ok: true, status, res: { ok: true, status }, json, text: '' };
}
function failed(err) {
  return { ok: false, status: 0, res: { ok: false, status: 0 }, json: null, text: '', threw: String(err?.message || err) };
}
function notFound(why) {
  return { ok: false, status: 404, res: { ok: false, status: 404 }, json: null, text: why };
}

/**
 * Build a ClickUp-shaped `call` that reaches the tracker.
 *
 * @param {object} [o]
 * @param {object} [o.door]        trackerDoor.cjs (injected in tests)
 * @param {string} [o.project]     the loop's own project
 * @param {string} [o.busProject]  where the switch lives
 */
function trackerCall({ door = realDoor, project = door.PROJECT, busProject = door.BUS_PROJECT } = {}) {
  /** The bus project's ticket(s) named as the switch is, Live included. Throws on a failed read. */
  const switchTickets = () => door.findTasksNamed({ project: busProject, name: SWITCH_TASK_NAME });

  async function call(method, path, body) {
    const [route, query = ''] = String(path).split('?');
    const params = new URLSearchParams(query);
    let m;
    try {
      if (method === 'GET' && (m = /^\/api\/v2\/list\/[^/]+\/task$/.exec(route))) {
        if (Number(params.get('page') || 0) > 0) return answer({ tasks: [], last_page: true });
        door.forgetComments();
        const work = await door.listTasks({ project });
        const standing = await switchTickets();
        // When the bus is the project's own queue (SC-818) an OPEN switch
        // ticket is in both listings; counted twice it would read as two
        // switch tickets.
        const listed = new Set(work.map((t) => String(t.id).toLowerCase()));
        const extra = standing.filter((t) => !listed.has(String(t.id).toLowerCase()));
        return answer({ tasks: [...work, ...extra], last_page: true });
      }
      if (method === 'GET' && (m = /^\/api\/v2\/task\/([^/]+)\/comment$/.exec(route))) {
        // Every comment comes back on the first page; a request for the page
        // after it (`start=`) is the end of the trail. Read from THIS ticket
        // alone: one request, wherever the ticket lives (SC-851).
        if (params.has('start')) return answer({ comments: [] });
        return answer({ comments: await door.readTaskComments(decodeURIComponent(m[1])) });
      }
      if (method === 'GET' && (m = /^\/api\/v2\/task\/([^/]+)$/.exec(route))) {
        const out = await door.getTask(decodeURIComponent(m[1]));
        if (out.ok) return answer(out.json);
        return /no ticket in it|not found|no such/i.test(out.why || '') ? notFound(out.why) : failed(out.why);
      }
      if (method === 'POST' && (m = /^\/api\/v2\/task\/([^/]+)\/comment$/.exec(route))) {
        door.commentOnTask(decodeURIComponent(m[1]), String(body?.comment_text ?? ''));
        door.forgetComments();
        return answer({ id: null });
      }
      if (method === 'PUT' && (m = /^\/api\/v2\/task\/([^/]+)$/.exec(route)) && body?.status) {
        const id = decodeURIComponent(m[1]);
        door.moveTaskStatus(id, body.status, { ifStatus: 'Building' });
        return answer({ id, status: { status: String(body.status).toLowerCase() } });
      }
      if (method === 'POST' && /^\/api\/v2\/list\/[^/]+\/task$/.test(route)) {
        const made = await door.createTask({
          project: busProject, name: body?.name, status: body?.status, body: body?.description || '',
        });
        return made.ok ? answer(made.json) : failed(made.why);
      }
    } catch (err) {
      return failed(err);
    }
    return failed(`${method} ${route} has no tracker equivalent here (scripts/builder/pipelineTrackerCall.js) — nothing was sent`);
  }

  /**
   * The switch ticket alone, for a check that needs nothing else (SC-851):
   * `{ readable: true, tasks }`, where an empty list is a CONFIRMED absence
   * because it only ever comes from a read that worked, or
   * `{ readable: false, why }`. Never throws.
   */
  call.findSwitch = async function findSwitch() {
    try {
      return { readable: true, why: '', tasks: await switchTickets() };
    } catch (err) {
      return { readable: false, why: `finding the switch ticket on the tracker: ${String(err?.message || err)}`, tasks: [] };
    }
  };

  return call;
}

module.exports = { trackerCall };
