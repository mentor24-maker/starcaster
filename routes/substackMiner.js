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
 *                                                          { status: 'approved' } also puts the writer in
 *                                                          Contacts (Substack Miner 4/7,
 *                                                          lib/acquire/SubstackContactCapture.js)
 *   POST   /api/acquire/substack-miner/candidates/:id/notes  { notes: [{ url, text, postedAt }] } (a bare list too)
 *                                                          — store an approved writer's newest Notes and line up a
 *                                                          like and a reply for the newest (Substack Miner 5/7,
 *                                                          lib/acquire/SubstackNotesCapture.js)
 *   POST   /api/acquire/substack-miner/read-notes          { anyHour?: true } — read every approved writer's newest
 *                                                          Notes not read in 7 days (lib/acquire/SubstackNotesReadRun.js)
 *   POST   /api/acquire/substack-miner/notes-search        { keyword, notes: [{ authorHandle, authorName, url, text }] }
 *                                                          — what the Mini's Notes search found for one keyword: each
 *                                                          author's publication added (or merged) as a candidate, the
 *                                                          Note kept as evidence (Substack Miner 6/7,
 *                                                          lib/acquire/SubstackNotesSearch.js)
 *   GET    /api/acquire/substack-miner/settings
 *   PUT    /api/acquire/substack-miner/settings            (PATCH accepted too)
 *   POST   /api/acquire/substack-miner/snowball            { handles?: [] } — read who approved writers recommend
 *                                                          (Substack Miner 3/7, lib/acquire/SubstackRecommendationsRun.js)
 *   POST   /api/acquire/substack-miner/run                 { keywords?: [] } — the web-search pass
 *                                                          (Substack Miner 2/7, lib/acquire/SubstackMinerRun.js)
 *   GET    /api/acquire/substack-miner/stats               the header's counts: found, approved, rejected,
 *                                                          in Contacts, engaged, subscribed
 *                                                          (Substack Miner 7/7, lib/acquire/SubstackMinerStats.js)
 *   POST   /api/acquire/substack-miner/subscribers/import  { csv } — Substack's subscriber export; marks the
 *                                                          matching contacts subscribed (Substack Miner 7/7,
 *                                                          lib/acquire/SubstackSubscriberImport.js)
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
const { approveCandidate } = require('../lib/acquire/SubstackContactCapture');
const { minerStats } = require('../lib/acquire/SubstackMinerStats');
const { importSubscribers } = require('../lib/acquire/SubstackSubscriberImport');
const { captureCandidateNotes } = require('../lib/acquire/SubstackNotesCapture');
const { runSubstackNotesRead } = require('../lib/acquire/SubstackNotesReadRun');
const { captureNotesSearch } = require('../lib/acquire/SubstackNotesSearch');

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

  const notes = pathname.match(/^\/api\/acquire\/substack-miner\/candidates\/([^/]+)\/notes$/);
  if (notes) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    // The ticket's shape is a bare list; an object carrying `notes` is the
    // envelope every other route here takes. Both are accepted.
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return sendErr(res, 400, `The request body is not valid JSON: ${err.message}`, { code: 'VALIDATION_ERROR' }), true;
    }
    const list = Array.isArray(body) ? body : (body && typeof body === 'object' ? body.notes : undefined);
    return reply(res, await captureCandidateNotes(decodeURIComponent(notes[1]), list, scope));
  }

  const one = pathname.match(/^\/api\/acquire\/substack-miner\/candidates\/([^/]+)$/);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'GET') return reply(res, await store.getCandidateById(id, scope));
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req, res);
      if (!body) return true;
      if (body.status === 'approved') return reply(res, await approveCandidate(id, body, scope));
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

  if (pathname === `${PREFIX}/read-notes`) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    if (checkEndpointLimit(req, res, 'substackMiner.readNotes')) return true;
    const body = await readBody(req, res);
    if (!body) return true;
    // The project's own zone decides the active hours when the account sets none.
    const projectTimeZone = async () => String(req?.projectContext?.project?.timezone || '');
    return reply(res, await runSubstackNotesRead({ anyHour: body.anyHour === true }, scope, { projectTimeZone }));
  }

  if (pathname === `${PREFIX}/notes-search`) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    if (checkEndpointLimit(req, res, 'substackMiner.notesSearch')) return true;
    const body = await readBody(req, res);
    if (!body) return true;
    return reply(res, await captureNotesSearch(body, scope));
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

  if (pathname === `${PREFIX}/stats`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    return reply(res, await minerStats(scope));
  }

  if (pathname === `${PREFIX}/subscribers/import`) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    if (checkEndpointLimit(req, res, 'substackMiner.subscribers.import')) return true;
    const body = await readBody(req, res);
    if (!body) return true;
    return reply(res, await importSubscribers(body, scope));
  }

  return sendErr(res, 404, 'Unknown Substack Miner endpoint', { code: 'NOT_FOUND' }), true;
}

const manifest = { id: 'substackMiner', label: 'Substack Miner', prefixes: [PREFIX] };

module.exports = { handle, manifest };
