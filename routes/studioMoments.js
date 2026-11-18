'use strict';

/**
 * Reel Spinner's scored moments, as the Footage screen reads them
 * (Reel Spinner 2e, SC-830). Dispatched from routes/studio.js, kept in its own
 * file so that one does not grow past the route-size line.
 *
 *   GET  /api/studio/sources/:id/moments           the moments, best first, and
 *                                                  whether they were scored
 *                                                  against today's notes
 *   POST /api/studio/sources/:id/moments/rescore   ask the Mac Mini to score
 *                                                  this recording again
 *
 * Both look the source up in THIS project first, so another project's
 * recording is a 404 exactly like one that does not exist — never its moments,
 * and never a rescore stamped on its row.
 *
 * The rescore only SETS A FLAG (`rescore_requested_at`). The scoring runs on
 * the Mac Mini, which polls for it; nothing here scores anything.
 */

const { sendOk, sendErr } = require('./http');
const { getSourceById } = require('../lib/videoSourcesStore');
const { getMomentsBySource, requestRescore } = require('../lib/videoMomentsStore');
const { readContextFor } = require('../lib/contextFor');
const { momentsViewFor } = require('../lib/studioFootage');

const REEL_SPINNER_USE = 'reel-spinner';

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
}

function projectNameOf(req) {
  const project = req?.projectContext?.project || {};
  return String(project.name || project.title || '').trim();
}

async function ownSource(req, res, sourceId, scope) {
  const found = await getSourceById(sourceId, scope);
  if (!found.ok || !found.data) {
    const status = !found.ok && found.status !== 404 ? (found.status || 500) : 404;
    sendErr(res, status, found.error || 'Source not found', { code: status === 404 ? 'NOT_FOUND' : undefined });
    return null;
  }
  return found.data;
}

async function sendMoments(req, res, sourceId) {
  const scope = requestScope(req);
  const source = await ownSource(req, res, sourceId, scope);
  if (!source) return;
  const [read, notes] = await Promise.all([
    getMomentsBySource(source.id, scope),
    readContextFor({ projectId: scope.projectId, use: REEL_SPINNER_USE }),
  ]);
  // "Could not read the moments" must never read as "not scored yet".
  if (!read.ok) return sendErr(res, read.status || 500, `Could not read the moments: ${read.error}`);
  sendOk(res, 200, momentsViewFor({
    sourceId: source.id,
    driveFileId: source.driveFileId,
    row: read.data,
    notes,
    projectName: projectNameOf(req),
  }));
}

async function sendRescore(req, res, sourceId) {
  const scope = requestScope(req);
  const source = await ownSource(req, res, sourceId, scope);
  if (!source) return;
  const asked = await requestRescore(source.id, scope);
  if (!asked.ok) {
    return sendErr(res, asked.status || 500, asked.error || 'The rescore request was not saved', {
      code: asked.status === 404 ? 'NOT_SCORED' : undefined,
    });
  }
  // Read back: the flag on the row the database returned, not the one we sent.
  if (!asked.data || !asked.data.rescoreRequestedAt) {
    return sendErr(res, 502, 'The database answered, but the rescore request is not on the row it returned');
  }
  sendOk(res, 200, { sourceId: source.id, rescoreRequestedAt: asked.data.rescoreRequestedAt });
}

/** true when this module answered the request. */
async function handleMoments(req, res, pathname, method) {
  const rescore = pathname.match(/^\/api\/studio\/sources\/([^/]+)\/moments\/rescore$/);
  if (rescore) {
    if (method !== 'POST') {
      sendErr(res, 405, 'Ask for a rescore with POST', { code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    await sendRescore(req, res, decodeURIComponent(rescore[1]));
    return true;
  }
  const moments = pathname.match(/^\/api\/studio\/sources\/([^/]+)\/moments$/);
  if (moments && method === 'GET') {
    await sendMoments(req, res, decodeURIComponent(moments[1]));
    return true;
  }
  return false;
}

module.exports = { handleMoments, REEL_SPINNER_USE };
