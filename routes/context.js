'use strict';

/**
 * Assets › Context: reference material a project keeps for agent sessions
 * (ticket SC-808, slice 1 of 3: notes).
 *
 *   GET    /api/context       → { ok, data: { entries, total } }   this project's entries, newest change first
 *   POST   /api/context       → { ok, data: { entry } }            JSON { title, bodyHtml }
 *   PATCH  /api/context/:id   → { ok, data: { entry } }            JSON { title?, bodyHtml? }
 *   DELETE /api/context/:id   → { ok, data: { entry } }            the row that was removed
 *
 * AUTHENTICATED: no exemption in routes/index.js, so a session is required,
 * and every call is scoped to the caller's active project (lib/contextStore.js).
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const contextStore = require('../lib/contextStore');

const manifest = {
  id: 'context',
  label: 'Assets › Context (reference entries for agents)',
  prefixes: ['/api/context'],
};

const ID_PATH = /^\/api\/context\/([^/]+)\/?$/;

function fail(res, result, fallback) {
  return sendErr(res, result.status || 500, result.error || fallback), true;
}

async function readBody(req, res) {
  try {
    return { ok: true, body: (await parseJsonBody(req)) || {} };
  } catch (err) {
    sendErr(res, 400, err.message || 'Invalid JSON body');
    return { ok: false };
  }
}

async function handle(req, res, pathname, method) {
  const path = String(pathname || '');
  const verb = String(method || '').toUpperCase();
  const isCollection = path === '/api/context' || path === '/api/context/';
  const idMatch = path.match(ID_PATH);
  if (!isCollection && !idMatch) return false;

  const scope = requestProjectScope(req);
  if (!scope.projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;

  if (isCollection && verb === 'GET') {
    const result = await contextStore.listEntries(500, scope);
    if (!result.ok) return fail(res, result, 'Could not read the context entries');
    return sendOk(res, 200, { entries: result.data, total: result.data.length }), true;
  }

  if (isCollection && verb === 'POST') {
    const read = await readBody(req, res);
    if (!read.ok) return true;
    const result = await contextStore.createEntry(
      { title: read.body.title, bodyHtml: read.body.bodyHtml },
      scope
    );
    if (!result.ok) return fail(res, result, 'Could not save the entry');
    return sendOk(res, 201, { entry: result.data }), true;
  }

  if (idMatch && verb === 'PATCH') {
    const read = await readBody(req, res);
    if (!read.ok) return true;
    const result = await contextStore.updateEntry(
      decodeURIComponent(idMatch[1]),
      { title: read.body.title, bodyHtml: read.body.bodyHtml },
      scope
    );
    if (!result.ok) return fail(res, result, 'Could not change the entry');
    return sendOk(res, 200, { entry: result.data }), true;
  }

  if (idMatch && verb === 'DELETE') {
    const result = await contextStore.deleteEntry(decodeURIComponent(idMatch[1]), scope);
    if (!result.ok) return fail(res, result, 'Could not delete the entry');
    return sendOk(res, 200, { entry: result.data }), true;
  }

  return sendErr(res, 405, `${verb} is not supported on ${path}`), true;
}

module.exports = { handle, manifest };
