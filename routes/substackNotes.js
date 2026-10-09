'use strict';

/**
 * Substack Notes API — the agent's actions (Notes, replies, restacks, likes)
 * and the account's settings (Substack Notes 1/7, task 86bcet65t). A thin
 * layer over lib/substackNotesStore.js, which does all the checking.
 *
 *   GET    /api/engage/substack-notes/items          ?account=&kind=&status=&limit=
 *   POST   /api/engage/substack-notes/items          { kind, source?, ideaText?, targetUrl?, ... }
 *   GET    /api/engage/substack-notes/items/:id
 *   PATCH  /api/engage/substack-notes/items/:id      (PUT accepted too) text, or { status }
 *   DELETE /api/engage/substack-notes/items/:id
 *   GET    /api/engage/substack-notes/settings       ?account=
 *   PUT    /api/engage/substack-notes/settings       ?account=   (PATCH accepted too)
 *
 * Drafts and approval (3/7, task 86bcet6pa — lib/substackNotesDrafter.js):
 *
 *   POST   /api/engage/substack-notes/items/:id/draft     write a draft (AI); "Write another" too
 *   POST   /api/engage/substack-notes/items/:id/approve   { text? }  (edited wording)
 *   POST   /api/engage/substack-notes/items/:id/reject
 *
 * `account` defaults to dane_of_earth. Auth and project scope are decided
 * centrally in routes/index.js; /api/engage is closed to a client's own site
 * admin (lib/projectAdminApiAuth.js), and this sits under it on purpose.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const store = require('../lib/substackNotesStore');
const { checkEndpointLimit } = require('../lib/rateLimiter');

const PREFIX = '/api/engage/substack-notes';

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

function errorCode(status) {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'RULE_BROKEN';
  return undefined;
}

/** Answer from a store envelope. Returns true so `return reply(...)` ends the route. */
function reply(res, result, okStatus) {
  if (!result.ok) {
    const status = result.status || 500;
    sendErr(res, status, result.error || 'The Substack Notes list could not be read or saved', { code: result.code || errorCode(status) });
    return true;
  }
  sendOk(res, okStatus || result.status || 200, result.data);
  return true;
}

async function readBody(req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendErr(res, 400, 'The request body must be a JSON object', { code: 'VALIDATION_ERROR' });
      return null;
    }
    return body;
  } catch (err) {
    sendErr(res, 400, `The request body is not valid JSON: ${err.message}`, { code: 'VALIDATION_ERROR' });
    return null;
  }
}

function listOptions(urlObj) {
  const options = {};
  for (const [param, key] of [['account', 'accountKey'], ['kind', 'kind'], ['status', 'status']]) {
    const value = urlObj.searchParams.get(param);
    if (value !== null) options[key] = value;
  }
  return options;
}

async function handle(req, res, pathname, method) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
  const scope = requestScope(req);
  const urlObj = getUrlObj(req);

  if (pathname === `${PREFIX}/items`) {
    if (method === 'GET') {
      const limit = urlObj.searchParams.get('limit');
      return reply(res, await store.listItems(limit === null ? 200 : Number(limit), scope, listOptions(urlObj)));
    }
    if (method === 'POST') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.createItem(body, scope), 201);
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  const decision = pathname.match(/^\/api\/engage\/substack-notes\/items\/([^/]+)\/(draft|approve|reject)$/);
  if (decision) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    const id = decodeURIComponent(decision[1]);
    if (decision[2] === 'approve') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.approveItem(id, body, scope));
    }
    if (decision[2] === 'reject') return reply(res, await store.rejectItem(id, scope));
    if (checkEndpointLimit(req, res, 'substackNotes.drafts.create')) return true;
    return reply(res, await store.writeDraftForItem(id, scope));
  }

  const one = pathname.match(/^\/api\/engage\/substack-notes\/items\/([^/]+)$/);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'GET') return reply(res, await store.getItemById(id, scope));
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.updateItem(id, body, scope));
    }
    if (method === 'DELETE') return reply(res, await store.deleteItem(id, scope));
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  if (pathname === `${PREFIX}/settings`) {
    if (method === 'GET') return reply(res, await store.getSettings(scope, listOptions(urlObj)));
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.saveSettings(body, scope, listOptions(urlObj)));
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  return sendErr(res, 404, 'Unknown Substack Notes endpoint', { code: 'NOT_FOUND' }), true;
}

const manifest = { id: 'substackNotes', label: 'Substack Notes', prefixes: [PREFIX] };

module.exports = { handle, manifest };
