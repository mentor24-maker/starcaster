'use strict';

/**
 * Substack Miner API — the Substack writers found for a project and the
 * keyword list the searches use (Substack Miner 1/7, task 86bcfprx5). A thin
 * layer over lib/substackMinerStore.js, which does all the checking.
 *
 *   GET    /api/acquire/substack-miner/candidates          ?status=&foundVia=&limit=
 *   POST   /api/acquire/substack-miner/candidates          one writer; merged if already here
 *   POST   /api/acquire/substack-miner/candidates/import   { candidates: [{ handle, publicationUrl, name, whyFit, keywordsHit }] }
 *   GET    /api/acquire/substack-miner/candidates/:id
 *   PATCH  /api/acquire/substack-miner/candidates/:id      (PUT accepted too) details, or { status }
 *   GET    /api/acquire/substack-miner/settings
 *   PUT    /api/acquire/substack-miner/settings            (PATCH accepted too)
 *   POST   /api/acquire/substack-miner/snowball            { handles?: [] } — read who approved writers recommend
 *                                                          (Substack Miner 3/7, lib/acquire/SubstackRecommendationsRun.js)
 *   POST   /api/acquire/substack-miner/run                 { keywords?: [] } — the web-search pass
 *                                                          (Substack Miner 2/7, lib/acquire/SubstackMinerRun.js)
 *
 * Auth and project scope are decided centrally in routes/index.js; /api/acquire
 * is closed to a client's own site admin (lib/projectAdminApiAuth.js), and this
 * sits under it on purpose.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const store = require('../lib/substackMinerStore');
const { runSubstackSnowball } = require('../lib/acquire/SubstackRecommendationsRun');
const { runSubstackMinerSearch } = require('../lib/acquire/SubstackMinerRun');

const PREFIX = '/api/acquire/substack-miner';

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
  return undefined;
}

/** Answer from a store envelope. Returns true so `return reply(...)` ends the route. */
function reply(res, result) {
  if (!result.ok) {
    const status = result.status || 500;
    sendErr(res, status, result.error || 'The Substack Miner list could not be read or saved', { code: errorCode(status) });
    return true;
  }
  sendOk(res, result.status || 200, result.data);
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
  for (const param of ['status', 'foundVia']) {
    const value = urlObj.searchParams.get(param);
    if (value !== null) options[param] = value;
  }
  return options;
}

async function handle(req, res, pathname, method) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
  const scope = requestScope(req);
  const urlObj = getUrlObj(req);

  if (pathname === `${PREFIX}/candidates`) {
    if (method === 'GET') {
      const limit = urlObj.searchParams.get('limit');
      return reply(res, await store.listCandidates(limit === null ? 200 : Number(limit), scope, listOptions(urlObj)));
    }
    if (method === 'POST') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.upsertCandidate(body, scope));
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  if (pathname === `${PREFIX}/candidates/import`) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    const body = await readBody(req, res);
    if (!body) return true;
    return reply(res, await store.importCandidates(body.candidates, scope));
  }

  const one = pathname.match(/^\/api\/acquire\/substack-miner\/candidates\/([^/]+)$/);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'GET') return reply(res, await store.getCandidateById(id, scope));
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.updateCandidate(id, body, scope));
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  if (pathname === `${PREFIX}/run`) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    const body = await readBody(req, res);
    if (!body) return true;
    return reply(res, await runSubstackMinerSearch({ keywords: body.keywords }, scope));
  }

  if (pathname === `${PREFIX}/settings`) {
    if (method === 'GET') return reply(res, await store.getSettings(scope));
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.saveSettings(body, scope));
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  if (pathname === `${PREFIX}/snowball`) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    if (checkEndpointLimit(req, res, 'substackMiner.snowball')) return true;
    const body = await readBody(req, res);
    if (!body) return true;
    return reply(res, await runSubstackSnowball({ handles: body.handles }, scope));
  }

  return sendErr(res, 404, 'Unknown Substack Miner endpoint', { code: 'NOT_FOUND' }), true;
}

const manifest = { id: 'substackMiner', label: 'Substack Miner', prefixes: [PREFIX] };

module.exports = { handle, manifest };
