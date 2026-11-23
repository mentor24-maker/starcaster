'use strict';

/**
 * Rough cuts, and Dane's verdict on each (Reel Spinner 4c, SC-835).
 * Dispatched from routes/studio.js, kept in its own file so that one does not
 * grow past the route-size line.
 *
 *   GET  /api/studio/rough-cuts              every rough cut in THIS project,
 *                                            newest recording first, with the
 *                                            count of each group
 *   POST /api/studio/rough-cuts/:id/review   { status?, daneNote?, youtubeTitle?,
 *                                              youtubeDescription?, youtubeTags? }
 *                                            — approved, skipped or sent_back,
 *                                            and/or the YouTube text (6a)
 *
 * THE WEBSITE WRITES ONLY THE REVIEW HALF: `status`, `dane_note` and the
 * YouTube text Dane edited on the card (Reel Spinner 6a, SC-839). It goes
 * through lib/videoEditsStore.js reviewEdit, which refuses a step out of order
 * (an edit not in review cannot be approved), refuses a send-back without a
 * note sent in the same save, refuses text once the edit is uploading, and
 * guards the write on the status it read. Any other field in the body is
 * refused here, before the store sees it. Approve sends the boxes WITH the
 * verdict, so what goes to YouTube is what was in them when he pressed it.
 *
 * The answer to a verdict is the row the database RETURNED, checked: a 200
 * that does not carry his verdict would be a toast over a write that did not
 * land. The Mac Mini acts on it (listEditsByStatus); nothing here does.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { listEditsByStatus, reviewEdit, EDIT_STATUSES } = require('../lib/videoEditsStore');
const { listSources } = require('../lib/videoSourcesStore');
const { getMomentsBySource } = require('../lib/videoMomentsStore');
const { roughCutsView, MAKING } = require('../lib/studioRoughCuts');
const { loadShelf } = require('../lib/studioMusicShelf');

const LIST_PATH = '/api/studio/rough-cuts';
const REVIEW_PATH = /^\/api\/studio\/rough-cuts\/([^/]+)\/review$/;

/** The most edits one read takes. Past it the counts are a minimum, said so. */
const EDIT_READ_LIMIT = 500; // listEditsByStatus's own ceiling
const SOURCE_READ_LIMIT = 1000;

const TEXT_FIELDS = ['youtubeTitle', 'youtubeDescription', 'youtubeTags'];
const VERDICT_FIELDS = ['status', 'daneNote', ...TEXT_FIELDS];
const VERDICTS = ['approved', 'skipped', 'sent_back'];

/**
 * Every status. Failed is read too, but lib/studioRoughCuts.js shows only the
 * failed edits YouTube refused to take (Reel Spinner 6c): he approved those,
 * and an approved video must not vanish from the screen without a reason.
 * Any other failed edit has no rough cut to watch and is left out there.
 */
const LISTED_STATUSES = EDIT_STATUSES;

/**
 * The cuts waiting on Dane are read ON THEIR OWN, never as part of one read
 * of every status. listEditsByStatus sorts oldest-updated first and stops at
 * its limit, so in a single read of a project with more edits than that, the
 * rows cut off are the NEWEST, which are exactly the ones waiting for him;
 * the screen would then say "nothing waiting for you" while one was.
 */
const WAITING_STATUSES = ['review'];
const OTHER_STATUSES = LISTED_STATUSES.filter((s) => !WAITING_STATUSES.includes(s));

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
    .filter((e) => e.kind === 'short' && !MAKING.includes(e.status))
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
  const [waiting, others, sources] = await Promise.all([
    listEditsByStatus(EDIT_READ_LIMIT, WAITING_STATUSES, scope),
    listEditsByStatus(EDIT_READ_LIMIT, OTHER_STATUSES, scope),
    listSources(SOURCE_READ_LIMIT, scope),
  ]);
  // A failed read is an error, never "no rough cuts yet".
  for (const edits of [waiting, others]) {
    if (!edits.ok) return sendErr(res, edits.status || 500, `Could not read the rough cuts: ${edits.error}`);
  }
  if (!sources.ok) return sendErr(res, sources.status || 500, `Could not read the recordings: ${sources.error}`);
  const edits = [...waiting.data, ...others.data];
  const moments = await readMoments(edits, scope);
  let shelf = null;
  try { shelf = loadShelf(); } catch { shelf = null; }
  const view = roughCutsView({ edits, sources: sources.data, momentsBySource: moments.bySource, shelf });
  return sendOk(res, 200, {
    ...view,
    truncated: waiting.data.length >= EDIT_READ_LIMIT || others.data.length >= EDIT_READ_LIMIT,
    waitingTruncated: waiting.data.length >= EDIT_READ_LIMIT,
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
    return sendErr(res, 400, `This screen sets only ${VERDICT_FIELDS.join(', ')} (got ${extra.join(', ')})`, { code: 'VALIDATION_ERROR' });
  }
  const textSent = TEXT_FIELDS.filter((k) => body[k] !== undefined);
  const hasStatus = body.status !== undefined && body.status !== null && body.status !== '';
  const status = String(body.status || '').trim();
  if ((hasStatus || !textSent.length) && !VERDICTS.includes(status)) {
    return sendErr(res, 400, `status must be one of ${VERDICTS.join(', ')}`, { code: 'VALIDATION_ERROR' });
  }
  const input = hasStatus ? { status } : {};
  // Passed through UNCHANGED: reviewEdit refuses a note that is not text.
  // String() here once turned {} into "[object Object]" and saved it.
  if (body.daneNote !== undefined && body.daneNote !== null) input.daneNote = body.daneNote;
  // The same for the YouTube text: reviewEdit checks the types and lengths.
  for (const k of textSent) input[k] = body[k];

  const saved = await reviewEdit(editId, input, scope);
  if (!saved.ok) {
    return sendErr(res, saved.status || 500, saved.error || 'The verdict was not saved', {
      code: saved.status === 404 ? 'NOT_FOUND' : saved.status === 409 ? 'CONFLICT' : saved.status === 400 ? 'VALIDATION_ERROR' : undefined,
    });
  }
  const row = saved.data;
  const sameText = (k) => {
    if (input[k] === undefined) return true;
    if (k === 'youtubeTags') return JSON.stringify(row[k]) === JSON.stringify((input[k] || []).map((t) => String(t).trim()).filter(Boolean));
    return (row[k] || '') === String(input[k] == null ? '' : input[k]).trim();
  };
  if (!row || (hasStatus && row.status !== status)
    || (typeof input.daneNote === 'string' && row.daneNote !== input.daneNote.trim())
    || !TEXT_FIELDS.every(sameText)) {
    return sendErr(res, 502, 'The database answered, but the row it returned does not carry what was saved');
  }
  return sendOk(res, 200, {
    id: row.id, status: row.status, daneNote: row.daneNote,
    youtubeTitle: row.youtubeTitle, youtubeDescription: row.youtubeDescription, youtubeTags: row.youtubeTags,
  });
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
  let editId;
  try {
    editId = decodeURIComponent(match[1]);
  } catch {
    sendErr(res, 400, 'That rough cut id is not a valid address', { code: 'VALIDATION_ERROR' });
    return true;
  }
  await sendVerdict(req, res, editId);
  return true;
}

module.exports = { handleRoughCuts, EDIT_READ_LIMIT, LISTED_STATUSES, WAITING_STATUSES, OTHER_STATUSES };
