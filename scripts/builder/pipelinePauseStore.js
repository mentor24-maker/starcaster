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
// The comment-paging RULE, borrowed rather than re-derived — one answer to
// "have I read the whole trail" for the whole repo. See scripts/lib/clickup.cjs.
const { pageComments } = require('../lib/clickup.cjs');

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
    const batch = out.json?.tasks || [];
    tasks.push(...batch);
    // Stop on an EMPTY page or an explicit `last_page: true` — never on
    // `last_page !== false`. ClickUp can omit the flag, and `undefined !== false`
    // is true, so the old form read page 0 and stopped: on a list past 100
    // tasks that reports the switch ABSENT, which is fail-open in the one
    // feature built to fail safe. scripts/lib/clickup.cjs `listTasks` learned
    // this first; an absent flag means "fetch the next page", not "stop and hope".
    if (batch.length === 0 || out.json?.last_page === true) return { readable: true, why: '', tasks };
  }
  // Ran past the cap without ever being told the end. We do not know whether
  // the switch is in the pages we never read, so this is UNREADABLE, which
  // every caller turns into "paused".
  return { readable: false, why: `reading the Loop Queue: stopped after ${maxPages} pages without reaching the end — treat as incomplete`, tasks };
}

/** The switch's real identity is its NAME; CLICKUP_PAUSE_TASK is only a shortcut. */
function findSwitchByName(tasks) {
  return (tasks || []).find(
    (t) => String(t.name || '').trim().toLowerCase() === SWITCH_TASK_NAME.toLowerCase(),
  ) || null;
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

  /** Read the list once, lazily — `status` always wants it, `check` only does
   *  when it has to fall back to the name lookup. */
  async function needQueue() {
    if (!queue) queue = await fetchQueue({ call, list });
    return queue;
  }

  if (withQueue || !pauseTaskId) {
    if (!(await needQueue()).readable) return { readable: false, why: queue.why };
  }

  if (pauseTaskId) {
    const out = await safely(call, 'GET', `/api/v2/task/${pauseTaskId}`);
    if (statusOf(out) === 404) {
      // A configured id that resolves to nothing is a STALE SETTING, not proof
      // the switch is gone: the id is an optimisation (one GET instead of a
      // list walk), and the switch's real identity is its NAME. Reading a 404
      // as "no switch" made `pause` create a SECOND one, which is two flags
      // disagreeing — the exact state the command refuses to create elsewhere.
      // So fall back to the name lookup, and only then call it absent.
      if (!(await needQueue()).readable) return { readable: false, why: queue.why };
      task = findSwitchByName(queue.tasks);
      if (!task) return { readable: true, switchFound: false, queue };
    } else if (!okOf(out)) {
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
    } else {
      task = out.json;
    }
  } else {
    task = findSwitchByName(queue.tasks);
    if (!task) return { readable: true, switchFound: false, queue };
  }

  // EVERY page of the trail, not the newest 25.
  //
  // The state is ONE comment on a task that also collects an hourly reminder
  // comment while it is paused, so an unpaged read loses the pause record after
  // about 25 hours and reports the pipeline RUNNING — the two headline features
  // cancelling each other out, failing open, overnight, which is exactly when
  // the reminder exists. Found in review on 2026-08-26.
  const trail = await pageComments({
    get: async (path) => {
      const out = await safely(call, 'GET', path);
      return { ok: okOf(out), status: statusOf(out), json: out?.json ?? null, threw: out?.threw, text: out?.text };
    },
    taskId: task.id,
  });
  if (!trail.complete) {
    const why = trail.capped
      ? 'the trail did not end within the page budget, so the state record may be beyond it'
      : whyOf(trail.failed);
    return { readable: false, why: `reading the switch's comments: ${why}` };
  }

  return { readable: true, switchFound: true, task, comments: trail.comments, queue };
}

module.exports = { fetchQueue, readSwitch, findSwitchByName, loopNoteOf, whyOf, safely, okOf, statusOf };
