'use strict';

/**
 * routes/browserView.js
 * The sign-in window's pass and log — Outreach wizard 4/19, sign-in window
 * slice 2 (task 86bcrmbc9). Plan: docs/LIVE_BROWSER_VIEW.md §4 and §9.
 *
 *   POST /api/browser-view/open              { site } -> a one-time pass for the Mini's browser
 *   POST /api/browser-view/:id/close         { reason } -> record how that window ended
 *   GET  /api/browser-view/sessions          this project's windows, newest first
 *
 * PROJECT ADMINS ONLY. The window shows a project's own signed-in browser, so
 * only a member whose role on THIS project is `owner` or `admin` may open one,
 * close one or read the log; anybody else gets 403 before anything is written
 * or sent. A tenant site's admin login never reaches here at all —
 * `/api/browser-view` is on the deny list in lib/projectAdminApiAuth.js.
 *
 * OPEN, IN ORDER: check the role and the site; close as `not-reported` any of
 * this project's windows that must already have ended; write the log row and
 * read it back (lib/browserViewStore.js); send the signed "open" to the door
 * keeper (lib/browserDoorClient.js). If the Mini cannot be reached or refuses,
 * the row is closed straight away with that reason and the admin is told in
 * plain words — so the log holds every attempt, including the ones that never
 * opened. Only on success does the answer carry the pass, and this is the only
 * place the pass ever appears.
 *
 * The pass is single-use and dies after 60 seconds. The door keeper enforces
 * both (workers/browser-door/door.js PassBook); this side makes a fresh 32-byte
 * pass for every open and never issues one twice, which a test proves end to
 * end by feeding what this route sends into the door keeper's own code.
 */

const { sendOk, sendErr, parseJsonBody, normalizeApiPathname } = require('./http');
const store = require('../lib/browserViewStore');
const doorClient = require('../lib/browserDoorClient');
const { checkEndpointLimit } = require('../lib/rateLimiter');

const PREFIX = '/api/browser-view';
const ADMIN_ROLES = new Set(['owner', 'admin']);

const manifest = { id: 'browserView', label: 'Sign-in window', prefixes: [PREFIX] };

/** What the route answers when the Mini did not open the window. */
const NOT_OPENED_STATUS = { 'not-configured': 503, 'door-unreachable': 502, 'door-refused': 502 };

function safeText(value) {
  return String(value || '').trim();
}

function scopeFor(req) {
  return {
    projectId: safeText(req?.projectContext?.project?.id),
    userId: safeText(req?.authUser?.id),
  };
}

function isProjectAdmin(req) {
  const role = safeText(req?.projectContext?.membership?.role).toLowerCase();
  return Boolean(req?.authUser && ADMIN_ROLES.has(role));
}

function fail(res, result, fallbackStatus = 500) {
  sendErr(res, result.status || fallbackStatus, result.error || 'Something went wrong', { code: result.code });
  return true;
}

async function handleOpen(req, res) {
  if (checkEndpointLimit(req, res, 'browserView.open')) return true;
  const body = await parseJsonBody(req).catch(() => ({}));
  const scope = scopeFor(req);

  const swept = await store.sweepNotReported(scope);
  if (!swept.ok) return fail(res, swept);

  const opened = await store.openSession({ site: body?.site, openedByEmail: req.authUser?.email }, scope);
  if (!opened.ok) return fail(res, opened);
  const { session, pass } = opened.data;

  const sent = await doorClient.sendOpen({ pass, projectId: session.projectId, site: session.site });
  if (!sent.ok) {
    const closed = await store.closeSession(session.id, { reason: sent.reason }, scope);
    const unlogged = closed.ok ? '' : ` (and the log could not record it: ${closed.error})`;
    sendErr(res, NOT_OPENED_STATUS[sent.reason] || 502, `${sent.error}${unlogged}`, { code: 'WINDOW_NOT_OPENED' });
    return true;
  }

  // sendOk already marks every answer no-store, which matters here: the body carries the pass.
  sendOk(res, 201, {
    session,
    pass,
    passExpiresAt: session.passExpiresAt,
    viewerUrl: doorClient.viewerUrl(doorClient.doorConfig().baseUrl),
  });
  return true;
}

async function handleClose(req, res, id) {
  const body = await parseJsonBody(req).catch(() => ({}));
  const reason = safeText(body?.reason);
  if (!store.VIEWER_CLOSE_REASONS.includes(reason)) {
    sendErr(res, 400, `reason must be one of: ${store.VIEWER_CLOSE_REASONS.join(', ')}`, { code: 'VALIDATION_ERROR' });
    return true;
  }
  const scope = scopeFor(req);
  const closed = await store.closeSession(id, { reason, closedBy: scope.userId }, scope);
  if (!closed.ok) return fail(res, closed);
  sendOk(res, 200, closed.data);
  return true;
}

async function handle(req, res, pathname, method) {
  const path = normalizeApiPathname(pathname);
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const verb = String(method || '').toUpperCase();

  if (!isProjectAdmin(req)) {
    sendErr(res, 403, 'Only an owner or admin of this project can open its sign-in window.', { code: 'FORBIDDEN' });
    return true;
  }

  if (path === `${PREFIX}/open` && verb === 'POST') return handleOpen(req, res);

  const closeMatch = /^\/api\/browser-view\/([^/]+)\/close$/.exec(path);
  if (closeMatch && verb === 'POST') return handleClose(req, res, decodeURIComponent(closeMatch[1]));

  if (path === `${PREFIX}/sessions` && verb === 'GET') {
    const listed = await store.listSessions(50, scopeFor(req));
    if (!listed.ok) return fail(res, listed);
    sendOk(res, 200, listed.data);
    return true;
  }

  sendErr(res, 404, 'Not found', { code: 'NOT_FOUND' });
  return true;
}

module.exports = { handle, manifest, isProjectAdmin };
