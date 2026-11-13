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
 * included" is answered with both: the open work, then every bus ticket.
 *
 * The paths answered, and nothing else:
 *
 *   GET  /api/v2/list/<any>/task?...page=N   page 0: the reading above; later pages: empty
 *   GET  /api/v2/task/<id>                   `get`
 *   GET  /api/v2/task/<id>/comment[?start=]  every comment, newest first, on the first page
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
  // Which project each id was seen in, so its comments are read from the right
  // one first. An id never seen is tried in both.
  const seenIn = new Map();

  async function commentsOf(id) {
    const key = String(id).toLowerCase();
    const first = seenIn.get(key);
    const order = first ? [first, first === project ? busProject : project] : [project, busProject];
    let last = null;
    for (const p of order) {
      try {
        return await door.getTaskCommentRecords(id, { project: p });
      } catch (err) {
        last = err;
        // Only "not in this project" moves on to the other; a failed read is a failed read.
        if (!/is not in the .* project on the tracker/.test(String(err?.message || ''))) throw err;
      }
    }
    throw last;
  }

  return async function call(method, path, body) {
    const [route, query = ''] = String(path).split('?');
    const params = new URLSearchParams(query);
    let m;
    try {
      if (method === 'GET' && (m = /^\/api\/v2\/list\/[^/]+\/task$/.exec(route))) {
        if (Number(params.get('page') || 0) > 0) return answer({ tasks: [], last_page: true });
        door.forgetComments();
        const work = await door.listTasks({ project });
        const standing = await door.listTasks({ project: busProject, includeClosed: true });
        for (const t of work) seenIn.set(String(t.id).toLowerCase(), project);
        for (const t of standing) seenIn.set(String(t.id).toLowerCase(), busProject);
        return answer({ tasks: [...work, ...standing], last_page: true });
      }
      if (method === 'GET' && (m = /^\/api\/v2\/task\/([^/]+)\/comment$/.exec(route))) {
        // Every comment comes back on the first page; a request for the page
        // after it (`start=`) is the end of the trail.
        if (params.has('start')) return answer({ comments: [] });
        return answer({ comments: await commentsOf(decodeURIComponent(m[1])) });
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
  };
}

module.exports = { trackerCall };
