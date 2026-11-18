'use strict';

/**
 * Dane's choice of whose sound a pair of recordings uses (Reel Spinner 3b,
 * SC-832). Dispatched from routes/studio.js, kept in its own file so that one
 * does not grow past the route-size line.
 *
 *   POST /api/studio/pairs/:id/sound   { audioSourceId }
 *
 * The pair is looked up in THIS project (chooseAudioSource scopes both the
 * read and the write), so another project's pair is a 404 exactly like one
 * that does not exist. The choice is stamped `chosen_by = dane`, and the Mac
 * Mini's line-up pass never overwrites it (lib/videoAudioPairsStore.js).
 *
 * The answer is the row the database RETURNED, checked: a 200 that does not
 * carry his pick would be a toast over a write that did not land.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { chooseAudioSource } = require('../lib/videoAudioPairsStore');

const SOUND_PATH = /^\/api\/studio\/pairs\/([^/]+)\/sound$/;

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
}

async function sendChoice(req, res, pairId) {
  const scope = requestScope(req);
  if (!scope.projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' });
  let body;
  try {
    body = (await parseJsonBody(req)) || {};
  } catch (err) {
    return sendErr(res, 400, err.message || 'Invalid JSON body', { code: 'VALIDATION_ERROR' });
  }
  const audioSourceId = String(body.audioSourceId || '').trim();
  if (!audioSourceId) return sendErr(res, 400, 'Say whose sound to use (audioSourceId)', { code: 'VALIDATION_ERROR' });

  const chosen = await chooseAudioSource(pairId, audioSourceId, scope);
  if (!chosen.ok) {
    return sendErr(res, chosen.status || 500, chosen.error || 'The choice of sound was not saved', {
      code: chosen.status === 404 ? 'NOT_FOUND' : chosen.status === 400 ? 'VALIDATION_ERROR' : undefined,
    });
  }
  const row = chosen.data;
  if (!row || row.chosenBy !== 'dane' || String(row.audioSourceId || '').toLowerCase() !== audioSourceId.toLowerCase()) {
    return sendErr(res, 502, 'The database answered, but the row it returned does not carry this choice of sound');
  }
  return sendOk(res, 200, { pairId: row.id, audioSourceId: row.audioSourceId, chosenBy: row.chosenBy });
}

/** true when this module answered the request. */
async function handlePairs(req, res, pathname, method) {
  const match = String(pathname || '').match(SOUND_PATH);
  if (!match) return false;
  if (method !== 'POST') {
    sendErr(res, 405, 'Choose the sound with POST', { code: 'METHOD_NOT_ALLOWED' });
    return true;
  }
  await sendChoice(req, res, decodeURIComponent(match[1]));
  return true;
}

module.exports = { handlePairs };
