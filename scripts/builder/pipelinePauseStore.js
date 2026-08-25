'use strict';

/**
 * pipelinePauseStore — reading the pause switch out of ClickUp.
 *
 * The DECISIONS live in pipelinePause.js (pure, no network). This is the one
 * place that knows how the switch is stored and found, shared by everything
 * that asks: `npm run pipeline` and bus-relay today, any future actor
 * tomorrow.
 *
 * ONE IMPLEMENTATION, ON PURPOSE — the same reasoning as lib/nodeRoles.js and
 * lib/environmentBanner.js. Two copies of "where is the flag and what counts
 * as unreadable" are two rules, and they disagree quietly. A second reader
 * that forgot `include_closed` would report "no switch" on a paused pipeline
 * and merge straight through the pause; that is not a hypothetical, it is the
 * single most likely way this feature fails.
 *
 * The HTTP call is injected rather than made here, because the two callers
 * already have one apiece — bus-relay's counts requests for its rate-limit
 * report, and pipeline.mjs's is standalone. Injecting it also makes every
 * branch below drivable in `node --test` with no token and no network.
 */

const { SWITCH_TASK_NAME } = require('./pipelinePause.js');

/** How the injected caller's answer is read, whichever shape it uses. */
function okOf(out) {
  return Boolean(out && (out.ok === true || out.res?.ok === true));
}
function statusOf(out) {
  return Number(out?.res?.status ?? out?.status ?? 0);
}

/**
 * A read that cannot throw. A rejected fetch (offline, DNS, TLS) and an HTTP
 * 500 mean exactly the same thing to a pause check — "we could not check" —
 * and both have to arrive as `readable: false`, never as a stack trace that
 * kills the process with an exit code somebody else's script will misread.
 */
async function safely(call, method, path, body) {
  try {
    return await call(method, path, body);
  } catch (err) {
    return { res: { status: 0, ok: false }, json: null, text: '', ok: false, threw: String(err && err.message) };
  }
}

function whyOf(out) {
  if (out && out.threw) return `could not reach ClickUp — ${out.threw}`;
  return `HTTP ${statusOf(out) || '?'}`;
}

/** The "Loop note" custom field's text, resolved by name (never by id). */
function loopNoteOf(task) {
  const f = (task?.custom_fields || []).find(
    (x) => String(x.name || '').trim().toLowerCase() === 'loop note',
  );
  return String(f?.value ?? '').trim();
}

/**
 * Every page of the Loop Queue, CLOSED STATUSES INCLUDED.
 *
 * The switch ticket deliberately rests in a status no loop claims from and no
 * bus-relay watch looks at, which on this list is a closed one — and ClickUp's
 * list endpoint hides closed tasks unless asked. Without `include_closed` the
 * lookup finds nothing, reports a confirmed absence, and every actor runs
 * straight through a live pause. Do not remove it.
 */
async function fetchQueue({ call, list, maxPages = 50 }) {
  const tasks = [];
  for (let page = 0; page < maxPages; page += 1) {
    const out = await safely(call, 'GET', `/api/v2/list/${list}/task?archived=false&include_closed=true&page=${page}`);
    if (!okOf(out)) return { readable: false, why: `reading the Loop Queue: ${whyOf(out)}`, tasks };
    tasks.push(...(out.json?.tasks || []));
    if (out.json?.last_page !== false || (out.json?.tasks || []).length === 0) break;
  }
  return { readable: true, why: '', tasks };
}

/**
 * Find the switch and read its trail.
 *
 * THREE outcomes, and keeping them apart IS the fail-safe:
 *
 *   readable: false      we could not check. Callers treat this as PAUSED.
 *   switchFound: false   a CONFIRMED absence — a clean read of the list with
 *                        no such ticket in it. The pipeline has never been
 *                        paused, so it is running. This is an answer, not a
 *                        guess, which is the only reason it may safely be
 *                        "not paused".
 *   otherwise            { task, comments } for pipelinePause.readTrail.
 */
async function readSwitch({ call, list, pauseTaskId = '', withQueue = false }) {
  let task = null;
  let queue = null;

  if (withQueue || !pauseTaskId) {
    queue = await fetchQueue({ call, list });
    if (!queue.readable) return { readable: false, why: queue.why };
  }

  if (pauseTaskId) {
    const out = await safely(call, 'GET', `/api/v2/task/${pauseTaskId}`);
    // A 404 is a clean answer: the id names no task, so there is no switch.
    if (statusOf(out) === 404) return { readable: true, switchFound: false, queue };
    if (!okOf(out)) {
      // Driven live on 2026-08-25: ClickUp answers a made-up task id with 401,
      // not 404. That is the SAFE direction — an id we cannot resolve becomes
      // "unreadable", which becomes "paused" — but the bare status reads like
      // an expired token and would send the diagnosis straight past the real
      // cause. Say both possibilities, and name the one-line way out.
      const st = statusOf(out);
      const hint = (st === 401 || st === 403)
        ? '\nClickUp answers 401 both for a bad token AND for a task id this token cannot see, including one that has been\n'
          + 'deleted. If `npm run clickup -- whoami` works, CLICKUP_PAUSE_TASK is pointing at a task that no longer exists —\n'
          + 'unset it and the switch is found by name in the Loop Queue instead.'
        : '';
      return { readable: false, why: `reading the switch ticket ${pauseTaskId}: ${whyOf(out)}${hint}` };
    }
    task = out.json;
  } else {
    task = (queue.tasks || []).find(
      (t) => String(t.name || '').trim().toLowerCase() === SWITCH_TASK_NAME.toLowerCase(),
    ) || null;
    if (!task) return { readable: true, switchFound: false, queue };
  }

  const cout = await safely(call, 'GET', `/api/v2/task/${task.id}/comment`);
  if (!okOf(cout)) return { readable: false, why: `reading the switch's comments: ${whyOf(cout)}` };

  return { readable: true, switchFound: true, task, comments: cout.json?.comments || [], queue };
}

module.exports = { fetchQueue, readSwitch, loopNoteOf, whyOf, safely, okOf, statusOf };
