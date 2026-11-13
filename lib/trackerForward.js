'use strict';

/**
 * The live app's writes to the tracker (SC-796, slice of SC-791).
 *
 * StarCaster's work moved from ClickUp to the tracker on 2026-11-12 (SC-790).
 * The loops reach it through the ticket door (`npm run clickup -- ...`), but
 * the app on Vercel cannot shell out to anything: a bug report arrives on a
 * visitor's request, and the AI spending alarm runs on Vercel's scheduler. So
 * this file is the app's own small door, speaking the tracker's HTTP API
 * directly at its public address (`trackerPublicUrl` in spirality.project.json,
 * the Mini's Tailscale Funnel name). It replaces lib/clickupForward.js for
 * every write the app makes.
 *
 * It does two things, with the same guards the ClickUp version kept:
 *
 *  - createHeldTask: a bug report becomes a ticket in the StarCaster project,
 *    in "needs your input" and assigned to the operator. That is the one
 *    status no loop claims; a ticket that lands "queued" gets BUILT from
 *    public text. Both are asserted in code before any request, read back
 *    after, corrected once if wrong, and deleted (or reported as surviving)
 *    if still wrong.
 *  - createSyntheticReportTask: a report our own harness filed lands "live"
 *    and unassigned instead, with its own mirror-image assertions.
 *  - postBusMessage: one comment on the bus project's "Team chat" ticket,
 *    read back, exactly what the door's `bus-post` writes.
 *
 * It does NOT require loop/lib (the door's own helpers), on purpose: those
 * read the project config from the working directory and need Node to
 * require() an ESM file, neither of which is safe to assume inside a Vercel
 * function. The three things it shares with them (the Team chat ticket's
 * name, the post header, the machine marker) are pinned to loop/lib by
 * scripts/builder/trackerForward.test.js, so the two cannot drift apart
 * quietly.
 *
 * Token: TRACKER_TOKEN_APP, server-side only, the app's own machine sign-in
 * on the tracker (never the operator's). Unset means "cannot forward":
 * callers mark their record failed_forward and say so; nothing here throws
 * into a public request. An env change on Vercel needs a redeploy
 * (CLAUDE.md landmine 10).
 */

const PROJECT_CONFIG = require('../spirality.project.json');
// The shared "is this a test run?" predicate: a test run must never reach the
// real tracker (the ClickUp version filed 34 fake tickets that way, task
// 86bc0zuvb). One definition, so the two guards cannot disagree.
const { underTestRunner } = require('../scripts/lib/clickup.cjs');

const TOKEN_ENV = 'TRACKER_TOKEN_APP';
const URL_ENV = 'TRACKER_PUBLIC_URL';

const PROJECT = String(PROJECT_CONFIG.projectSlug || 'starcaster');
const BUS_PROJECT = PROJECT_CONFIG.busProject ? String(PROJECT_CONFIG.busProject) : '';
const OPERATOR_USER_ID = Number(PROJECT_CONFIG.operatorUserId);
const HELD_STATUS = 'needs your input';
const SYNTHETIC_STATUS = 'live';
const SYNTHETIC_TAGS = ['bug-report', 'synthetic', 'wont-do'];

/** The bus ticket's name, current then old (loop/lib/busFallback.js). */
const TEAM_CHAT_NAMES = ['Team chat', 'Undelivered alarms'];
/** The last line that marks a comment as a machine's, not the operator's (loop/scripts/lib/machineComment.mjs). */
const MACHINE_MARKER = '[machine]';
const MACHINE_MARKER_LINE = `${MACHINE_MARKER} posted by the StarCaster app on Vercel — not his word`;
/** Who a bus post says it is from. */
const BUS_SENDER = 'the StarCaster app (Vercel)';

// Per-request ceiling. A bug report's forward runs on the reporter's awaited
// submit path (serverless freezes after the response), so a hung tracker must
// not hang the reporter through several round trips.
const REQUEST_TIMEOUT_MS = 5000;

function readToken(deps) {
  return String(deps?.token ?? process.env[TOKEN_ENV] ?? '').trim();
}

function baseUrl(deps) {
  const raw = String(deps?.baseUrl ?? process.env[URL_ENV] ?? PROJECT_CONFIG.trackerPublicUrl ?? '').trim();
  return raw.replace(/\/+$/, '');
}

function isConfigured(deps) {
  return Boolean(readToken(deps) && baseUrl(deps));
}

/** Why the app cannot forward, naming the setting to fix. */
function notConfiguredReason(deps) {
  if (!readToken(deps)) return `${TOKEN_ENV} is not set on this server, so nothing can be sent to the tracker.`;
  return `the tracker has no public address (trackerPublicUrl in spirality.project.json, or ${URL_ENV}), so nothing can be sent to it.`;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

async function trackerRequest(method, path, body, deps) {
  if (!deps?.fetchImpl && underTestRunner(deps?.env || process.env)) {
    return { ok: false, status: 0, json: null, error: 'refused: a test run may not reach the real tracker — inject deps.fetchImpl' };
  }
  const timeoutMs = Number.isFinite(deps?.timeoutMs) ? deps.timeoutMs : REQUEST_TIMEOUT_MS;
  const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs) : undefined;
  const url = `${baseUrl(deps)}${path}`;
  const init = {
    method,
    headers: { Authorization: `Bearer ${readToken(deps)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    ...(signal ? { signal } : {}),
  };
  // The tracker, never ClickUp, so this is not a second door to ClickUp's
  // budget (scripts/builder/clickupOneDoor.test.js): this file imports the
  // ClickUp module only for underTestRunner. A test brings its own transport.
  let res;
  try {
    res = deps?.fetchImpl ? await deps.fetchImpl(url, init) : await fetch(url, init);
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, status: 0, json: null, error: timedOut ? `request timed out after ${timeoutMs}ms` : `network error: ${err?.message || err}` };
  }
  let text = '';
  try { text = await res.text(); } catch { text = ''; }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: Boolean(res.ok), status: Number(res.status) || 0, json, text };
}

function describeFailure(label, out) {
  const detail = out.json?.message || out.json?.error?.message || out.json?.error || out.error || String(out.text || '').slice(0, 200);
  return `${label} failed — HTTP ${out.status}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`;
}

/** The ticket's page, the address Dane opens (the API address is the loops'). */
function ticketUrl(id) {
  const page = String(PROJECT_CONFIG.trackerUrl || '').replace(/\/+$/, '');
  return page ? `${page}/t/${id}` : String(id);
}

const ticketPath = (id) => `/tickets/${encodeURIComponent(String(id).toUpperCase())}`;

async function readBack(id, deps) {
  const out = await trackerRequest('GET', ticketPath(id), undefined, deps);
  if (!out.ok || !out.json?.id) return { ok: false, error: describeFailure('read ticket back', out) };
  const t = out.json;
  return {
    ok: true,
    data: {
      status: String(t.status || ''),
      assignee: t.assignee == null ? null : Number(t.assignee),
      descriptionChars: String(t.description || '').length,
      comments: Array.isArray(t.comments) ? t.comments : [],
    },
  };
}

function cleanTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean))];
}

async function fileTicket(fields, deps) {
  const created = await trackerRequest('POST', `/projects/${encodeURIComponent(PROJECT)}/tickets`, fields, deps);
  if (!created.ok) return { ok: false, error: describeFailure('file ticket', created) };
  const taskId = String(created.json?.id || '');
  if (!taskId) return { ok: false, error: 'file ticket answered OK but returned no ticket id.' };
  return { ok: true, taskId, url: ticketUrl(taskId) };
}

/** Where a ticket that could not be deleted sits now, worded from the status it actually has. */
const CLAIMABLE_STATUSES = ['queued', 'rework'];
function whereItSits(check) {
  if (!check.ok) return 'Its state could not be read, so check it by hand: it may be where a build loop can claim it.';
  const status = normalizeStatus(check.data.status);
  if (CLAIMABLE_STATUSES.includes(status)) {
    return `It is in "${check.data.status}" right now, where a build loop may claim it. Move or delete it by hand.`;
  }
  return `It is in "${check.data.status || '(no status)'}", which no build loop claims from, but it is not held for the operator as it should be. Fix or delete it by hand.`;
}

function landedHeld(state, operator) {
  if (normalizeStatus(state.status) !== HELD_STATUS) return false;
  // A blank description is the "200 but empty ticket" trap: not landed as meant.
  if (!(state.descriptionChars > 0)) return false;
  return state.assignee === operator;
}

/**
 * File one ticket held for the operator and prove it landed that way.
 *
 * @returns {{ ok: true, taskId, url, status, assignees } | { ok: false, error, code, taskId? }}
 */
async function createHeldTask({ name, markdownDescription, tags = [], priority } = {}, deps = {}) {
  if (!isConfigured(deps)) return { ok: false, code: 'TRACKER_NOT_CONFIGURED', error: notConfiguredReason(deps) };
  const title = String(name || '').trim();
  if (!title) return { ok: false, code: 'VALIDATION_ERROR', error: 'A ticket name is required.' };

  const operator = Number.isFinite(OPERATOR_USER_ID) ? OPERATOR_USER_ID : NaN;
  const status = normalizeStatus(deps.status || HELD_STATUS);
  const assignee = deps.assignee === undefined ? operator : Number(deps.assignee);

  // The in-code assertions. These refuse BEFORE any request is made.
  if (status !== HELD_STATUS) {
    return { ok: false, code: 'HELD_STATUS_REQUIRED', error: `Forwarded tickets may only be filed in "${HELD_STATUS}" (asked for "${status}").` };
  }
  if (!Number.isFinite(operator)) {
    return { ok: false, code: 'OPERATOR_UNKNOWN', error: 'spirality.project.json names no operatorUserId, so there is nobody to hold the ticket for.' };
  }
  if (assignee !== operator) {
    return { ok: false, code: 'OPERATOR_ASSIGNEE_REQUIRED', error: `A held ticket must be assigned to the operator (actor ${operator}), not to ${Number.isFinite(assignee) ? `actor ${assignee}` : 'nobody'}.` };
  }

  const filed = await fileTicket({
    name: title.slice(0, 200),
    description: String(markdownDescription || ''),
    status: HELD_STATUS,
    assignee: operator,
    tags: cleanTags(tags),
    ...(priority ? { priority } : {}),
  }, deps);
  if (!filed.ok) return { ok: false, code: 'TRACKER_CREATE_FAILED', error: filed.error };
  const { taskId, url } = filed;

  // An OK proves a write happened, not that the RIGHT thing landed.
  let check = await readBack(taskId, deps);
  if (!check.ok) return { ok: false, code: 'TRACKER_VERIFY_FAILED', error: check.error, taskId, url };

  if (!landedHeld(check.data, operator)) {
    const fix = await trackerRequest('PATCH', ticketPath(taskId), { status: HELD_STATUS, assignee: operator }, deps);
    // Kept for the message: why the correction was refused is the clue.
    const fixNote = fix.ok ? '' : ` The correction was refused (${describeFailure('correct', fix)}).`;
    check = await readBack(taskId, deps);
    if (!check.ok || !landedHeld(check.data, operator)) {
      const landed = check.ok
        ? `"${check.data.status}" assigned to ${check.data.assignee == null ? 'nobody' : `actor ${check.data.assignee}`}${check.data.descriptionChars ? '' : ' with an empty description'}`
        : 'an unreadable state';
      // The last line of defence: its result MUST be checked. A ticket of
      // public text left where a loop can claim it is the hazard itself.
      const del = await trackerRequest('DELETE', ticketPath(taskId), undefined, deps);
      if (del.ok) {
        return {
          ok: false,
          code: 'HELD_STATUS_NOT_HONOURED',
          error: `Ticket ${taskId} landed as ${landed}, not "${HELD_STATUS}" for the operator — deleted it rather than leave it where a loop could claim it.${fixNote}`,
          taskId,
          url,
        };
      }
      return {
        ok: false,
        code: 'HELD_STATUS_NOT_DELETED',
        error: `Ticket ${taskId} (${url}) landed as ${landed}, not "${HELD_STATUS}", and could NOT be deleted (${describeFailure('delete', del)}).${fixNote} ${whereItSits(check)}`,
        taskId,
        url,
      };
    }
  }

  return { ok: true, taskId, url, status: check.data.status, assignees: [check.data.assignee] };
}

/**
 * File a report our own machinery made: "live", unassigned, tagged. A separate
 * function, not a flag on createHeldTask, so neither guard has an exception in
 * it (task 86bbk0tvk).
 */
async function createSyntheticReportTask({ name, markdownDescription, tags = [] } = {}, deps = {}) {
  if (!isConfigured(deps)) return { ok: false, code: 'TRACKER_NOT_CONFIGURED', error: notConfiguredReason(deps) };
  const title = String(name || '').trim();
  if (!title) return { ok: false, code: 'VALIDATION_ERROR', error: 'A ticket name is required.' };

  const status = normalizeStatus(deps.status || SYNTHETIC_STATUS);
  if (status === HELD_STATUS) {
    return { ok: false, code: 'SYNTHETIC_MUST_NOT_HOLD', error: `A synthetic report may not be filed in "${HELD_STATUS}" — that is the operator's lane.` };
  }
  if (deps.assignee != null || (Array.isArray(deps.assignees) && deps.assignees.length)) {
    return { ok: false, code: 'SYNTHETIC_MUST_NOT_ASSIGN', error: 'A synthetic report may not be assigned to anybody; it is not a person\'s to answer.' };
  }

  const filed = await fileTicket({
    name: title.slice(0, 200),
    description: String(markdownDescription || ''),
    status,
    tags: cleanTags([...(Array.isArray(tags) ? tags : []), ...SYNTHETIC_TAGS]),
  }, deps);
  if (!filed.ok) return { ok: false, code: 'TRACKER_CREATE_FAILED', error: filed.error };
  const { taskId, url } = filed;

  const check = await readBack(taskId, deps);
  if (!check.ok) return { ok: false, code: 'TRACKER_VERIFY_FAILED', error: check.error, taskId, url };
  if (normalizeStatus(check.data.status) === HELD_STATUS || check.data.assignee != null) {
    return {
      ok: false,
      code: 'SYNTHETIC_LANDED_ASSIGNED',
      error: `Synthetic report ${taskId} (${url}) landed as "${check.data.status}" assigned to ${check.data.assignee == null ? 'nobody' : `actor ${check.data.assignee}`} — it is in the operator's lane. Close it by hand.`,
      taskId,
      url,
    };
  }
  return { ok: true, taskId, url, status: check.data.status, assignees: [] };
}

/** Mountain time, the clock Dane reads: "11/12/2026, 10:15 PM MT". */
function mountainTime(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.toLocaleString('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })} MT`;
}

/** One post as it lands, the same shape as the door's bus-post: sender, time, message, machine marker. */
function renderBusPost(text, at) {
  const body = String(text ?? '').trim();
  if (!body) return null;
  const when = mountainTime(at);
  return [`**From ${BUS_SENDER}**${when ? ` · ${when}` : ''}`, '', body, '', MACHINE_MARKER_LINE].join('\n');
}

/** The Team chat ticket among a project's tickets, the OLDEST if two exist (loop/lib/trackerBus.js pickTeamChat). */
function pickTeamChat(tickets) {
  const names = TEAM_CHAT_NAMES.map((n) => n.toLowerCase());
  const matches = (Array.isArray(tickets) ? tickets : []).filter((t) => names.includes(String(t?.name ?? '').trim().toLowerCase()));
  if (!matches.length) return null;
  return matches.reduce((a, b) => (Date.parse(a.createdAt || 0) <= Date.parse(b.createdAt || 0) ? a : b));
}

/**
 * Post one message to the tracker's bus, and read it back.
 *
 * Never throws. `{ ok, why }`: `ok` is the caller's whole verdict, because an
 * alarm that records itself as sent when it was not silences its own repeat.
 * It never creates the Team chat ticket (the door's `bus-post` does that):
 * a missing one is a failure that says so.
 */
async function postBusMessage(text, deps = {}) {
  if (!isConfigured(deps)) return { ok: false, why: notConfiguredReason(deps) };
  if (!BUS_PROJECT) return { ok: false, why: 'spirality.project.json names no busProject, so there is no bus to post to' };
  const post = renderBusPost(text, deps.now ?? Date.now());
  if (!post) return { ok: false, why: 'the message was empty' };

  const listed = await trackerRequest('GET', `/projects/${encodeURIComponent(BUS_PROJECT)}/tickets`, undefined, deps);
  if (!listed.ok || !Array.isArray(listed.json?.tickets)) return { ok: false, why: describeFailure(`list the bus project ${BUS_PROJECT}`, listed) };
  const chat = pickTeamChat(listed.json.tickets);
  if (!chat) return { ok: false, why: `there is no "${TEAM_CHAT_NAMES[0]}" ticket in ${BUS_PROJECT} (npm run clickup -- bus-post makes one)` };

  const out = await trackerRequest('POST', `${ticketPath(chat.id)}/comments`, { body: post }, deps);
  if (!out.ok) return { ok: false, why: describeFailure(`post to ${chat.id}`, out) };
  const id = out.json?.id == null ? '' : String(out.json.id);
  const back = await readBack(chat.id, deps);
  if (!back.ok) return { ok: false, why: `the post was sent but could not be read back (${back.error})` };
  if (!id || !back.data.comments.some((c) => String(c.id) === id)) return { ok: false, why: `comment ${id || '(no id)'} did not read back on ${chat.id}` };
  return { ok: true, why: '', id, ticket: chat.id };
}

module.exports = {
  TOKEN_ENV,
  URL_ENV,
  PROJECT,
  BUS_PROJECT,
  OPERATOR_USER_ID,
  HELD_STATUS,
  SYNTHETIC_STATUS,
  SYNTHETIC_TAGS,
  TEAM_CHAT_NAMES,
  MACHINE_MARKER,
  MACHINE_MARKER_LINE,
  isConfigured,
  notConfiguredReason,
  createHeldTask,
  createSyntheticReportTask,
  postBusMessage,
  renderBusPost,
  pickTeamChat,
};
