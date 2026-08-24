'use strict';

/**
 * Production-side ClickUp writes: create a task HELD for the operator.
 *
 * This is the importable cousin of scripts/clickup_direct.mjs (same API, same
 * ids, same read-back discipline) for code paths that cannot shell out to
 * npm — a public bug report arriving on a Vercel function, for one.
 *
 * Two guards are asserted IN CODE, not left to configuration, because the
 * thing being forwarded is public text and the Loop Queue is an autonomous
 * build pipeline:
 *
 *  - the task must land in "Needs your input" — the one status no loop may
 *    claim. A task that lands "Queued" gets BUILT. If ClickUp answers with a
 *    different status (a renamed status, a list default), this corrects it
 *    once, re-reads, and if it is still wrong DELETES the task and reports
 *    failure — the bug-report row is the record, a mis-statused task is a
 *    hazard.
 *  - the assignee must be the operator's human account (48012725) and never
 *    the machine account (54254347): Pulse assigning Pulse is a handoff with
 *    no notification (docs/LOOP_ENGINEERING.md, two-account model).
 *
 * Token: CLICKUP_API_TOKEN, server-side only. Unset means "cannot forward" —
 * callers mark their record failed_forward and say so loudly; nothing here
 * throws into a public request.
 */

const LOOP_QUEUE_LIST_ID = String(process.env.CLICKUP_LOOP_QUEUE_LIST_ID || '901418546619');
const OPERATOR_USER_ID_RAW = Number(process.env.CLICKUP_OPERATOR_ID || 48012725);
// A garbage env value must not become NaN — [NaN].includes(NaN) is true, so
// the operator-assignee guard would wave it through. Fall back to the real id.
const OPERATOR_USER_ID = Number.isFinite(OPERATOR_USER_ID_RAW) ? OPERATOR_USER_ID_RAW : 48012725;
const MACHINE_USER_ID = 54254347;
const HELD_STATUS = 'Needs your input';

/** Where a report our own machinery filed goes instead: closed, unassigned,
 *  and tagged so it is obvious at a glance why it is there. */
const SYNTHETIC_STATUS = 'Live';
const SYNTHETIC_TAGS = ['bug-report', 'synthetic', 'wont-do'];
const API_BASE = 'https://api.clickup.com';

function readToken(deps) {
  return String(deps?.token ?? process.env.CLICKUP_API_TOKEN ?? '').trim();
}

function isConfigured(deps) {
  return Boolean(readToken(deps));
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

// Per-request ceiling. The forward runs on the reporter's awaited submit
// path (serverless freezes after the response), so a hung ClickUp must not
// hang the reporter through five sequential round trips — each call aborts,
// and the caller treats a timeout like any other failure (→ failed_forward).
const REQUEST_TIMEOUT_MS = 5000;

async function clickupRequest(method, path, body, deps) {
  const fetchImpl = deps?.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(deps?.timeoutMs) ? deps.timeoutMs : REQUEST_TIMEOUT_MS;
  const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  try {
    const res = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: readToken(deps), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      ...(signal ? { signal } : {}),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    // A timeout (AbortError) or a network error is not a real HTTP answer —
    // surface it as a non-ok result so callers never mistake it for success.
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, status: 0, json: null, text: '', error: timedOut ? `request timed out after ${timeoutMs}ms` : `network error: ${err.message}` };
  }
}

function describeFailure(label, out) {
  // out.error carries a timeout/network reason when there was no HTTP answer.
  const detail = out.json?.err || out.json?.error || out.error || String(out.text || '').slice(0, 200);
  return `${label} failed — HTTP ${out.status}${detail ? `: ${detail}` : ''}`;
}

/**
 * Create one task in the Loop Queue, held for the operator, and prove it
 * landed that way by reading it back.
 *
 * @returns {{ ok: true, taskId, url, status, assignees } | { ok: false, error, code, taskId? }}
 */
async function createHeldTask({ name, markdownDescription, tags = [], priority } = {}, deps = {}) {
  if (!isConfigured(deps)) {
    return { ok: false, code: 'CLICKUP_NOT_CONFIGURED', error: 'CLICKUP_API_TOKEN is not set on this server, so nothing can be forwarded to ClickUp.' };
  }
  const title = String(name || '').trim();
  if (!title) return { ok: false, code: 'VALIDATION_ERROR', error: 'A task name is required.' };

  const listId = String(deps.listId || LOOP_QUEUE_LIST_ID);
  const status = String(deps.status || HELD_STATUS);
  const assignees = Array.isArray(deps.assignees) ? deps.assignees.map(Number) : [OPERATOR_USER_ID];

  // The two in-code assertions. These refuse BEFORE any request is made.
  if (normalizeStatus(status) !== normalizeStatus(HELD_STATUS)) {
    return { ok: false, code: 'HELD_STATUS_REQUIRED', error: `Forwarded tasks may only be created in "${HELD_STATUS}" (asked for "${status}").` };
  }
  if (assignees.includes(MACHINE_USER_ID)) {
    return { ok: false, code: 'MACHINE_ASSIGNEE_REFUSED', error: `Refusing to assign the machine account (${MACHINE_USER_ID}); operator handoffs assign ${OPERATOR_USER_ID}.` };
  }
  if (!assignees.includes(OPERATOR_USER_ID)) {
    return { ok: false, code: 'OPERATOR_ASSIGNEE_REQUIRED', error: `A held task must be assigned to the operator (${OPERATOR_USER_ID}).` };
  }

  const created = await clickupRequest('POST', `/api/v2/list/${listId}/task`, {
    name: title.slice(0, 200),
    markdown_description: String(markdownDescription || ''),
    status,
    assignees,
    tags: (Array.isArray(tags) ? tags : []).map((t) => String(t || '').trim()).filter(Boolean),
    ...(priority ? { priority } : {}),
  }, deps);
  if (!created.ok) return { ok: false, code: 'CLICKUP_CREATE_FAILED', error: describeFailure('create task', created) };

  const taskId = String(created.json?.id || '');
  const url = String(created.json?.url || '');
  if (!taskId) return { ok: false, code: 'CLICKUP_CREATE_FAILED', error: 'create task answered 200 but returned no task id.' };

  // A 200 proves a write happened, not that the RIGHT thing landed.
  let check = await readBack(taskId, deps);
  if (!check.ok) return { ok: false, code: 'CLICKUP_VERIFY_FAILED', error: check.error, taskId, url };

  if (!landedHeld(check.data, assignees)) {
    // One correction, then re-read. Then give up loudly and remove the hazard.
    await clickupRequest('PUT', `/api/v2/task/${taskId}`, { status, assignees: { add: assignees, rem: [] } }, deps);
    check = await readBack(taskId, deps);
    if (!check.ok || !landedHeld(check.data, assignees)) {
      const landed = check.ok ? `"${check.data.status}" assigned to [${check.data.assignees.join(', ')}]` : 'an unreadable state';
      // The DELETE is the last line of defence — its result MUST be checked.
      // If it fails, a task carrying public text is sitting in the Loop Queue
      // (plausibly the list default, Queued) where loop-build will claim and
      // build it — the exact hazard the held status exists to prevent. Never
      // report "deleted it" unless it was.
      const del = await clickupRequest('DELETE', `/api/v2/task/${taskId}`, undefined, deps);
      if (del.ok) {
        return {
          ok: false,
          code: 'HELD_STATUS_NOT_HONOURED',
          error: `Task ${taskId} landed as ${landed}, not "${HELD_STATUS}" for the operator — deleted it rather than leave it where a loop could claim it.`,
          taskId,
          url,
        };
      }
      const why = del.error || `HTTP ${del.status}`;
      return {
        ok: false,
        code: 'HELD_STATUS_NOT_DELETED',
        error: `Task ${taskId} (${url}) landed as ${landed}, not "${HELD_STATUS}", and could NOT be deleted (${why}) — it is in the Loop Queue right now, where a build loop may claim it. Move or delete it by hand.`,
        taskId,
        url,
      };
    }
  }

  return { ok: true, taskId, url, status: check.data.status, assignees: check.data.assignees };
}

/**
 * File a report we can prove our own machinery made. The mirror image of
 * createHeldTask, and deliberately a SEPARATE function rather than a flag on
 * that one (task 86bbk0tvk).
 *
 * createHeldTask carries two in-code assertions — held status, operator
 * assignee — that exist because a forwarded task escaping into `Queued` gets
 * claimed and built by a loop. Adding a "...unless synthetic" branch to those
 * assertions would mean the one guard standing between public text and an
 * unattended build loop now has an exception in it, and every future reader
 * has to work out whether their case takes the exception. So this function has
 * its OWN assertions, pointing the opposite way: it refuses to use the held
 * status and refuses to assign anybody. Neither function can be talked into
 * doing the other one's job.
 *
 * The task is still created. The evidence that the live path works is the
 * POST reaching /api/public/bug-report and a row being written — none of which
 * this touches. What changes is only that the result does not land in the
 * operator's lane.
 */
async function createSyntheticReportTask({ name, markdownDescription, tags = [] } = {}, deps = {}) {
  if (!isConfigured(deps)) {
    return { ok: false, code: 'CLICKUP_NOT_CONFIGURED', error: 'CLICKUP_API_TOKEN is not set on this server, so nothing can be forwarded to ClickUp.' };
  }
  const title = String(name || '').trim();
  if (!title) return { ok: false, code: 'VALIDATION_ERROR', error: 'A task name is required.' };

  const listId = String(deps.listId || LOOP_QUEUE_LIST_ID);
  const status = String(deps.status || SYNTHETIC_STATUS);

  // The mirror-image assertions, refusing BEFORE any request is made.
  if (normalizeStatus(status) === normalizeStatus(HELD_STATUS)) {
    return { ok: false, code: 'SYNTHETIC_MUST_NOT_HOLD', error: `A synthetic report may not be filed in "${HELD_STATUS}" — that is the operator's lane.` };
  }
  if (Array.isArray(deps.assignees) && deps.assignees.length) {
    return { ok: false, code: 'SYNTHETIC_MUST_NOT_ASSIGN', error: 'A synthetic report may not be assigned to anybody; it is not a person\'s to answer.' };
  }

  const created = await clickupRequest('POST', `/api/v2/list/${listId}/task`, {
    name: title.slice(0, 200),
    markdown_description: String(markdownDescription || ''),
    status,
    assignees: [],
    tags: [...new Set([...(Array.isArray(tags) ? tags : []), ...SYNTHETIC_TAGS])]
      .map((t) => String(t || '').trim()).filter(Boolean),
  }, deps);
  if (!created.ok) return { ok: false, code: 'CLICKUP_CREATE_FAILED', error: describeFailure('create task', created) };

  const taskId = String(created.json?.id || '');
  const url = String(created.json?.url || '');
  if (!taskId) return { ok: false, code: 'CLICKUP_CREATE_FAILED', error: 'create task answered 200 but returned no task id.' };

  // Read back for the same reason createHeldTask does: a 200 proves a write
  // happened, not that the right thing landed. The hazard here is the reverse
  // one — a synthetic task that came to rest in the operator's lane after all.
  const check = await readBack(taskId, deps);
  if (!check.ok) return { ok: false, code: 'CLICKUP_VERIFY_FAILED', error: check.error, taskId, url };
  if (normalizeStatus(check.data.status) === normalizeStatus(HELD_STATUS) || check.data.assignees.length) {
    return {
      ok: false,
      code: 'SYNTHETIC_LANDED_ASSIGNED',
      error: `Synthetic report ${taskId} (${url}) landed as "${check.data.status}" assigned to [${check.data.assignees.join(', ')}] — it is in the operator's lane. Close it by hand.`,
      taskId,
      url,
    };
  }

  return { ok: true, taskId, url, status: check.data.status, assignees: check.data.assignees };
}

async function readBack(taskId, deps) {
  const out = await clickupRequest('GET', `/api/v2/task/${taskId}`, undefined, deps);
  if (!out.ok) return { ok: false, error: describeFailure('read task back', out) };
  const t = out.json || {};
  return {
    ok: true,
    data: {
      status: String(t.status?.status || ''),
      assignees: (Array.isArray(t.assignees) ? t.assignees : []).map((a) => Number(a?.id)).filter(Number.isFinite),
      descriptionChars: String(t.description || '').length,
    },
  };
}

function landedHeld(readState, wantedAssignees) {
  if (normalizeStatus(readState.status) !== normalizeStatus(HELD_STATUS)) return false;
  // We always send a non-empty markdown_description; a 0-char read-back is the
  // house "wrong body field → 200 + empty task" trap (why clickup_direct reads
  // back after every create). An empty body means it did not land as intended.
  if (!(readState.descriptionChars > 0)) return false;
  return wantedAssignees.every((id) => readState.assignees.includes(id));
}

module.exports = {
  LOOP_QUEUE_LIST_ID,
  OPERATOR_USER_ID,
  MACHINE_USER_ID,
  HELD_STATUS,
  isConfigured,
  createHeldTask,
  SYNTHETIC_STATUS,
  SYNTHETIC_TAGS,
  createSyntheticReportTask,
};
