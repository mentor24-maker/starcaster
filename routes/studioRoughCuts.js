'use strict';

/**
 * Rough cuts, and Dane's verdict on each (Reel Spinner 4c, SC-835).
 * Dispatched from routes/studio.js, kept in its own file so that one does not
 * grow past the route-size line.
 *
 *   GET  /api/studio/rough-cuts              every rough cut in THIS project,
 *                                            newest recording first, with the
 *                                            count of each group
 *   POST /api/studio/rough-cuts/:id/review   { status, daneNote? } — approved,
 *                                            skipped or sent_back
 *
 * THE WEBSITE WRITES ONLY `status` AND `dane_note`. The verdict goes through
 * lib/videoEditsStore.js reviewEdit, which refuses a step out of order (an
 * edit not in review cannot be approved), refuses a send-back without a note
 * sent in the same save, and guards the write on the status it read. Any
 * other field in the body is refused here, before the store sees it: the
 * YouTube text is reviewEdit's too, but it is 6b's screen, not this one.
 *
 * The answer to a verdict is the row the database RETURNED, checked: a 200
 * that does not carry his verdict would be a toast over a write that did not
 * land. The Mac Mini acts on it (listEditsByStatus); nothing here does.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { listEditsByStatus, reviewEdit, EDIT_STATUSES } = require('../lib/videoEditsStore');
const { listSources } = require('../lib/videoSourcesStore');
const { getMomentsBySource } = require('../lib/videoMomentsStore');
const { roughCutsView } = require('../lib/studioRoughCuts');

const LIST_PATH = '/api/studio/rough-cuts';
const REVIEW_PATH = /^\/api\/studio\/rough-cuts\/([^/]+)\/review$/;

/** The most edits one read takes. Past it the counts are a minimum, said so. */
const EDIT_READ_LIMIT = 500; // listEditsByStatus's own ceiling
const SOURCE_READ_LIMIT = 1000;

const VERDICT_FIELDS = ['status', 'daneNote'];
const VERDICTS = ['approved', 'skipped', 'sent_back'];

/** Every status but failed: a failed edit has no rough cut to watch. */
const LISTED_STATUSES = EDIT_STATUSES.filter((s) => s !== 'failed');

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
}

/**
 * The moments each short was cut from, one read per recording that has a
 * short shown. A failed read does not take the list down: each short says its
 * score could not be read, and the answer carries why.
 */
async function readMoments(edits, scope) {
  const ids = [...new Set(edits
    .filter((e) => e.kind === 'short' && !['draft', 'rendering'].includes(e.status))
    .map((e) => String(e.sourceId).toLowerCase()))];
  const results = await Promise.all(ids.map((id) => getMomentsBySource(id, scope)));
  const bySource = {};
  let error = '';
  results.forEach((r, i) => {
    if (!r.ok) { error = error || r.error || `status ${r.status}`; return; }
    if (r.data) bySource[ids[i]] = r.data;
  });
  return { bySource, error };
}

async function sendList(req, res) {
  const scope = requestScope(req);
  if (!scope.projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' });
  const [edits, sources] = await Promise.all([
    listEditsByStatus(EDIT_READ_LIMIT, LISTED_STATUSES, scope),
    listSources(SOURCE_READ_LIMIT, scope),
  ]);
  // A failed read is an error, never "no rough cuts yet".
  if (!edits.ok) return sendErr(res, edits.status || 500, `Could not read the rough cuts: ${edits.error}`);
  if (!sources.ok) return sendErr(res, sources.status || 500, `Could not read the recordings: ${sources.error}`);
  const moments = await readMoments(edits.data, scope);
  const view = roughCutsView({ edits: edits.data, sources: sources.data, momentsBySource: moments.bySource });
  return sendOk(res, 200, {
    ...view,
    truncated: edits.data.length >= EDIT_READ_LIMIT,
    readLimit: EDIT_READ_LIMIT,
    momentsError: moments.error,
  });
}

async function sendVerdict(req, res, editId) {
  const scope = requestScope(req);
  if (!scope.projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' });
  let body;
  try {
    body = (await parseJsonBody(req)) || {};
  } catch (err) {
    return sendErr(res, 400, err.message || 'Invalid JSON body', { code: 'VALIDATION_ERROR' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendErr(res, 400, 'Send { status, daneNote }', { code: 'VALIDATION_ERROR' });
  }
  const extra = Object.keys(body).filter((k) => !VERDICT_FIELDS.includes(k));
  if (extra.length) {
    return sendErr(res, 400, `This screen sets only status and daneNote (got ${extra.join(', ')})`, { code: 'VALIDATION_ERROR' });
  }
  const status = String(body.status || '').trim();
  if (!VERDICTS.includes(status)) {
    return sendErr(res, 400, `status must be one of ${VERDICTS.join(', ')}`, { code: 'VALIDATION_ERROR' });
  }
  const input = { status };
  if (body.daneNote !== undefined && body.daneNote !== null) input.daneNote = String(body.daneNote);

  const saved = await reviewEdit(editId, input, scope);
  if (!saved.ok) {
    return sendErr(res, saved.status || 500, saved.error || 'The verdict was not saved', {
      code: saved.status === 404 ? 'NOT_FOUND' : saved.status === 409 ? 'CONFLICT' : saved.status === 400 ? 'VALIDATION_ERROR' : undefined,
    });
  }
  const row = saved.data;
  if (!row || row.status !== status || (input.daneNote !== undefined && row.daneNote !== input.daneNote.trim())) {
    return sendErr(res, 502, 'The database answered, but the row it returned does not carry this verdict');
  }
  return sendOk(res, 200, { id: row.id, status: row.status, daneNote: row.daneNote });
}

/** true when this module answered the request. */
async function handleRoughCuts(req, res, pathname, method) {
  const path = String(pathname || '');
  if (path === LIST_PATH) {
    if (method !== 'GET') {
      sendErr(res, 405, 'Read the rough cuts with GET', { code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    await sendList(req, res);
    return true;
  }
  const match = path.match(REVIEW_PATH);
  if (!match) return false;
  if (method !== 'POST') {
    sendErr(res, 405, 'Give a verdict with POST', { code: 'METHOD_NOT_ALLOWED' });
    return true;
  }
  await sendVerdict(req, res, decodeURIComponent(match[1]));
  return true;
}

module.exports = { handleRoughCuts, EDIT_READ_LIMIT, LISTED_STATUSES };
