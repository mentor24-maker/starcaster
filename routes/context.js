'use strict';

/**
 * Assets › Context: reference material a project keeps for agent sessions
 * (SC-808 notes, SC-809 files).
 *
 *   GET    /api/context              → { ok, data: { entries, total } }   this project's entries, newest change first
 *   POST   /api/context              → { ok, data: { entry } }            JSON { title, bodyHtml } — a note
 *                                                                        JSON { kind: 'file', file: { url, name, size }, title?, bodyHtml? }
 *   PATCH  /api/context/:id          → { ok, data: { entry } }            JSON { title?, bodyHtml? }
 *   DELETE /api/context/:id          → { ok, data: { entry, file } }      file: null (a note), { removed: true },
 *                                                                        or { removed: false, error } — the row is gone either way
 *   POST   /api/context/blob-upload  → the Vercel Blob client-upload handshake (a token for ONE file)
 *
 * Files go from the browser straight to Vercel Blob, so their size is not
 * capped by the server's ~4.5MB request limit. This route only hands out the
 * token, and only for an accepted type, within 50MB, at a path inside the
 * active project's own folder (lib/contextFileTypes.js). It is its own
 * endpoint rather than /api/assets/blob-upload because that one allows video
 * only, and because a tenant admin may reach it and may not reach this.
 *
 * AUTHENTICATED: no exemption in routes/index.js, so a session is required,
 * and every call is scoped to the caller's active project (lib/contextStore.js).
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const contextStore = require('../lib/contextStore');
const blobStorage = require('../lib/blobStorage');
const {
  ACCEPTED_MIME_TYPES,
  MAX_FILE_BYTES,
  checkContextFile,
  contextFolder,
} = require('../lib/contextFileTypes');

const manifest = {
  id: 'context',
  label: 'Assets › Context (reference entries for agents)',
  prefixes: ['/api/context'],
};

const ID_PATH = /^\/api\/context\/([^/]+)\/?$/;
const UPLOAD_PATH = '/api/context/blob-upload';

function parseClientPayload(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}

/** The token handshake: refuse before Blob ever sees the file. */
async function handleUploadToken(req, res, scope) {
  if (!blobStorage.isConfigured()) {
    return sendErr(res, 503, 'File storage (Vercel Blob) is not set up on this server, so files cannot be uploaded here.', { code: 'ASSET_STORAGE_NOT_CONFIGURED' }), true;
  }
  const read = await readBody(req, res);
  if (!read.ok) return true;
  const folder = contextFolder(scope.projectId);
  const result = await blobStorage.handleClientUpload({
    body: read.body,
    request: req,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      const payload = parseClientPayload(clientPayload);
      const path = String(pathname || '');
      if (!folder || !path.startsWith(folder) || path.includes('..')) {
        throw new Error('A context file can only be stored in the active project\'s own folder.');
      }
      const allowed = checkContextFile({ name: path, size: payload.size });
      if (!allowed.ok) throw new Error(allowed.message);
      return {
        allowedContentTypes: ACCEPTED_MIME_TYPES,
        maximumSizeInBytes: MAX_FILE_BYTES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ projectId: scope.projectId, userId: scope.userId }),
      };
    },
    // Nothing to do when Blob reports back: the page records the entry itself
    // with POST /api/context once its upload has finished.
    onUploadCompleted: async () => {},
  });
  if (!result.ok) return sendErr(res, result.status || 400, result.error || 'The upload could not be started'), true;
  res.statusCode = result.status || 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(result.data));
  return true;
}

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
  const isUpload = path === UPLOAD_PATH || path === `${UPLOAD_PATH}/`;
  const idMatch = isUpload ? null : path.match(ID_PATH);
  if (!isCollection && !isUpload && !idMatch) return false;

  const scope = requestProjectScope(req);
  if (!scope.projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;

  if (isUpload) {
    if (verb !== 'POST') return sendErr(res, 405, `${verb} is not supported on ${path}`), true;
    return handleUploadToken(req, res, scope);
  }

  if (isCollection && verb === 'GET') {
    const result = await contextStore.listEntries(500, scope);
    if (!result.ok) return fail(res, result, 'Could not read the context entries');
    return sendOk(res, 200, { entries: result.data, total: result.data.length }), true;
  }

  if (isCollection && verb === 'POST') {
    const read = await readBody(req, res);
    if (!read.ok) return true;
    const result = await contextStore.createEntry(
      { kind: read.body.kind, file: read.body.file, title: read.body.title, bodyHtml: read.body.bodyHtml },
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
    return sendOk(res, 200, { entry: result.data.entry, file: result.data.file }), true;
  }

  return sendErr(res, 405, `${verb} is not supported on ${path}`), true;
}

module.exports = { handle, manifest };
