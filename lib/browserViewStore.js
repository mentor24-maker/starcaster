'use strict';

/**
 * Outreach wizard 4/19 · sign-in window slice 2 (task 86bcrmbc9) — the log of
 * every sign-in window a project admin opens onto the Mac Mini's browser.
 *
 * Table: docs/SQL/browser_view_sessions_setup.sql. The plan is
 * docs/LIVE_BROWSER_VIEW.md (§4 "Who may open it"). The route that issues the
 * pass and talks to the Mini is routes/browserView.js; the door keeper on the
 * Mini is workers/browser-door/ (slice 1).
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10);
 * list functions take the limit FIRST (landmine 12b).
 *
 * THE TENANT COLUMNS ARE WRITTEN BY NAME, AND READ BACK. A row in this table
 * says which client's browser profile somebody opened, so a row with no tenant
 * is not a cosmetic gap. Rather than trust scopedInsertRow's probe (landmine
 * 12 — it stamps NEITHER column when the probe fails, and the insert still
 * succeeds), `openSession` writes `project_id` and `owner_user_id` itself and
 * then reads the row back by id and project, refusing if either column is not
 * what it wrote.
 *
 * THE PASS IS NEVER STORED. Only its SHA-256, the same as the door keeper keeps
 * it. The pass itself is made here, handed to the route once, and forgotten.
 *
 * A WINDOW CLOSES ONCE. The close write is filtered on `status=eq.open`, so two
 * close reports racing (the viewer's, and a second tab) cannot both land: the
 * second is told the window was already closed rather than overwriting why.
 */

const crypto = require('node:crypto');
const { sbQuery, tableConfig } = require('./supabase');
const { supportsProjectColumns } = require('./projectScope');
const { resolveLimit } = require('./storeLimit');

/** The sites the door keeper knows (workers/browser-door/door.js SITES). A test holds the two lists equal. */
const SITES = Object.freeze(['google', 'youtube', 'substack', 'reddit']);

/** How long a pass lives — the door keeper's PASS_TTL_MS; a test holds them equal. */
const PASS_TTL_MS = 60 * 1000;

/** 32 random bytes, as the plan says (§4). base64url so it travels in JSON and a URL untouched. */
const PASS_BYTES = 32;

/**
 * Why a window closed. The first five are what the door keeper tells the
 * viewer (workers/browser-door/server.js CLOSE_MESSAGES + its `browser-gone`
 * and `error` closes), so they are the ones a viewer may report.
 */
const VIEWER_CLOSE_REASONS = Object.freeze(['finished', 'idle', 'time-limit', 'browser-gone', 'error']);
/** Closes Starcaster records itself: the window never opened, or nobody said how it ended. */
const SERVER_CLOSE_REASONS = Object.freeze(['not-configured', 'door-unreachable', 'door-refused', 'not-reported']);
const CLOSE_REASONS = Object.freeze([...VIEWER_CLOSE_REASONS, ...SERVER_CLOSE_REASONS]);

/**
 * The door keeper ends every window by 15 minutes (§4). A row still `open`
 * well past that was closed without anybody telling Starcaster — a viewer tab
 * shut mid-window — so it is closed as `not-reported` rather than left reading
 * as open for ever. Two minutes of slack for the pass's own minute and clocks.
 */
const MAX_WINDOW_MS = 15 * 60 * 1000;
const NOT_REPORTED_AFTER_MS = MAX_WINDOW_MS + 2 * 60 * 1000;

function sessionsTable() { return tableConfig().browserViewSessions; }

function safeText(value, max = 500) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400, extra = {}) {
  return { ok: false, status, error, ...extra };
}

function hashPass(pass) {
  return crypto.createHash('sha256').update(String(pass)).digest('hex');
}

function makePass() {
  return crypto.randomBytes(PASS_BYTES).toString('base64url');
}

async function requireScope(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) return refuse('No project is selected, so no sign-in window can be opened or logged.');
  if (!(await supportsProjectColumns(sessionsTable()))) {
    return refuse(
      `The ${sessionsTable()} table is not available with its project columns, so sign-in windows cannot be logged. `
      + 'Has docs/SQL/browser_view_sessions_setup.sql been applied to this database?',
      503
    );
  }
  return { ok: true, projectId, userId: safeText(scope?.userId || scope?.user_id, 120) };
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    openedBy: safeText(row.opened_by, 120),
    openedByEmail: safeText(row.opened_by_email, 320),
    site: safeText(row.site, 40),
    passExpiresAt: row.pass_expires_at || null,
    status: row.status,
    openedAt: row.opened_at || null,
    closedAt: row.closed_at || null,
    closedBy: safeText(row.closed_by, 120),
    closeReason: safeText(row.close_reason, 40),
    durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined
      ? null : Number(row.duration_seconds),
  };
}

function firstRow(res) {
  return Array.isArray(res.data) ? res.data[0] : res.data;
}

async function readRow(id, projectId) {
  const query = `id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(projectId)}&select=*&limit=1`;
  const res = await sbQuery({ method: 'GET', table: sessionsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: firstRow(res) || null };
}

/**
 * Start a window's row and make its pass.
 * -> { ok, data: { session, pass } } — `pass` is the only copy there will be.
 */
async function openSession({ site, openedByEmail = '' } = {}, scope = null, { now = Date.now } = {}) {
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  if (!gate.userId) return refuse('No signed-in user, so nobody could be recorded as opening this window.', 401);
  const siteKey = safeText(site, 40).toLowerCase();
  if (!SITES.includes(siteKey)) {
    return refuse(`Unknown site "${safeText(site, 40)}". A sign-in window can open: ${SITES.join(', ')}.`);
  }

  const pass = makePass();
  const openedAt = now();
  const row = {
    project_id: gate.projectId,
    owner_user_id: gate.userId,
    opened_by: gate.userId,
    opened_by_email: safeText(openedByEmail, 320),
    site: siteKey,
    pass_hash: hashPass(pass),
    pass_expires_at: new Date(openedAt + PASS_TTL_MS).toISOString(),
    status: 'open',
    opened_at: new Date(openedAt).toISOString(),
    updated_at: new Date(openedAt).toISOString(),
  };
  const res = await sbQuery({
    method: 'POST',
    table: sessionsTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const inserted = firstRow(res);
  if (!inserted || !inserted.id) return refuse('The window log answered the write with no row, so nothing was recorded.', 502);

  // Read it back rather than trusting the insert (landmine 12).
  const back = await readRow(inserted.id, gate.projectId);
  if (!back.ok) return back;
  if (!back.data) {
    return refuse('The window was written to the log but could not be read back for this project, so it was not opened.', 500);
  }
  if (back.data.project_id !== gate.projectId || back.data.owner_user_id !== gate.userId) {
    return refuse(
      `The window log row came back with project "${safeText(back.data.project_id, 120)}" and owner `
      + `"${safeText(back.data.owner_user_id, 120)}", not the ones written, so it was not opened.`,
      500
    );
  }
  return { ok: true, status: 201, data: { session: rowToSession(back.data), pass } };
}

/**
 * Record how a window ended. Only an `open` row moves; a second close is a 409.
 * `closedBy` is the user who reported it, or '' when Starcaster closed it.
 */
async function closeSession(id, { reason, closedBy = '' } = {}, scope = null, { now = Date.now } = {}) {
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const sessionId = safeText(id, 120);
  if (!sessionId) return refuse('id is required');
  const why = safeText(reason, 40);
  if (!CLOSE_REASONS.includes(why)) {
    return refuse(`Unknown close reason "${why}". Known: ${CLOSE_REASONS.join(', ')}.`);
  }

  const current = await readRow(sessionId, gate.projectId);
  if (!current.ok) return current;
  if (!current.data) return refuse('No sign-in window with that id in this project.', 404);
  if (current.data.status !== 'open') {
    return refuse(`This window was already closed (${safeText(current.data.close_reason, 40) || 'no reason recorded'}).`, 409,
      { data: rowToSession(current.data) });
  }

  const closedAt = now();
  const openedAt = Date.parse(current.data.opened_at || '');
  const body = {
    status: 'closed',
    closed_at: new Date(closedAt).toISOString(),
    closed_by: safeText(closedBy, 120),
    close_reason: why,
    // A not-reported close does not know when the window really ended, so it claims no length.
    duration_seconds: why === 'not-reported' || !Number.isFinite(openedAt)
      ? null : Math.max(0, Math.round((closedAt - openedAt) / 1000)),
    updated_at: new Date(closedAt).toISOString(),
  };
  const query = `id=eq.${encodeURIComponent(sessionId)}&project_id=eq.${encodeURIComponent(gate.projectId)}`
    + '&status=eq.open&select=*';
  const res = await sbQuery({ method: 'PATCH', table: sessionsTable(), query, headers: { Prefer: 'return=representation' }, body });
  if (!res.ok) return res;
  const updated = firstRow(res);
  if (!updated) return refuse('This window was closed by something else a moment ago, so it was left alone.', 409);
  return { ok: true, status: 200, data: rowToSession(updated) };
}

/** Windows in this project, newest first. */
async function listSessions(limit = 50, scope = null) {
  const bounded = resolveLimit(limit, { fallback: 50, max: 500 });
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const query = `project_id=eq.${encodeURIComponent(gate.projectId)}&select=*&order=opened_at.desc&limit=${bounded.limit}`;
  const res = await sbQuery({ method: 'GET', table: sessionsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToSession) };
}

/**
 * Close, as `not-reported`, every window in this project still `open` long
 * after the door keeper must have ended it. -> { ok, data: { closed: n } }
 */
async function sweepNotReported(scope = null, { now = Date.now } = {}) {
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const query = `project_id=eq.${encodeURIComponent(gate.projectId)}&status=eq.open&select=id,opened_at&limit=100`;
  const res = await sbQuery({ method: 'GET', table: sessionsTable(), query });
  if (!res.ok) return res;
  let closed = 0;
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const openedAt = Date.parse(row.opened_at || '');
    if (Number.isFinite(openedAt) && now() - openedAt < NOT_REPORTED_AFTER_MS) continue;
    const done = await closeSession(row.id, { reason: 'not-reported' }, scope, { now });
    if (done.ok) closed += 1;
    else if (done.status !== 409) return done;
  }
  return { ok: true, status: 200, data: { closed } };
}

module.exports = {
  SITES,
  PASS_TTL_MS,
  VIEWER_CLOSE_REASONS,
  SERVER_CLOSE_REASONS,
  CLOSE_REASONS,
  NOT_REPORTED_AFTER_MS,
  hashPass,
  openSession,
  closeSession,
  listSessions,
  sweepNotReported,
};
