'use strict';

/**
 * video_sources — one media file belonging to a session: a camera angle, a
 * screen recording, a separate audio take, a reference clip.
 *
 * Table: docs/SQL/video_studio_setup.sql. Studio Phase 1 · 1 of 8 (86bbjv681).
 * Nothing downloads, probes or transcodes yet; those are slices 4/8-6/8, and
 * they fill in content_hash, the probe columns, local_path and proxy_path.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { getSessionById } = require('./videoSessionsStore');

/** What a file IS in the edit. These four ARE the data model, so unlike the
 *  states they are also a check constraint in the SQL. */
const LAYER_ROLES = ['background', 'subject', 'plate', 'reference'];

/** The per-file lifecycle. Kept here, not in a constraint — see the note in
 *  docs/SQL/video_studio_setup.sql about slices 4/8-6/8 extending it. */
const SOURCE_STATES = ['new', 'downloading', 'downloaded', 'probed', 'proxied', 'ready', 'failed'];

const PROBE_NUMBER_FIELDS = [
  ['durationS', 'duration_s'],
  ['fps', 'fps'],
];
const PROBE_INTEGER_FIELDS = [
  ['width', 'width'],
  ['height', 'height'],
];
/**
 * The probe-filled text columns, each with THE length — one number per field,
 * used by create, update and the row reader alike.
 *
 * It was three numbers before: create capped content_hash at 200, update at
 * 1000, and the reader at 200. So the same value round-tripped differently
 * depending on which path wrote it, and a hash written by update read back
 * truncated. Review caught it; one table is the fix.
 */
const PROBE_TEXT_FIELDS = [
  ['codec', 'codec', 100],
  ['deviceLane', 'device_lane', 100],
  ['localPath', 'local_path', 1000],
  ['proxyPath', 'proxy_path', 1000],
  ['driveFileId', 'drive_file_id', 300],
  ['contentHash', 'content_hash', 200],
];

/** The one length for a probe column, so no caller has to remember it. */
function probeLimit(key) {
  const found = PROBE_TEXT_FIELDS.find(([name]) => name === key);
  return found ? found[2] : 1000;
}

function table() {
  return tableConfig().videoSources;
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function safeTimestamp(value) {
  const text = safeText(value, 60);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/**
 * A timestamp, or a 400 saying so.
 *
 * safeTimestamp() returns '' for anything it cannot parse, and every caller
 * turned that into `null` — so `updateSource(id, { recordedAt: 'not a date' })`
 * answered ok:true and WIPED the timestamp the row already had. Every other
 * invalid input in these stores is a 400; this one silently destroyed data and
 * reported success. Review caught it.
 *
 * @returns {{ ok: true, value: string|null } | { ok: false, status, error }}
 */
function timestampOrError(value, field) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const parsed = safeTimestamp(value);
  if (!parsed) {
    return { ok: false, status: 400, error: `${field} is not a valid date` };
  }
  return { ok: true, value: parsed };
}

/** Reading a number the database already accepted. Trusted input; never used
 *  on anything a caller supplied — that is numberOrError below. */
function safeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInteger(value) {
  const parsed = safeNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

/**
 * A number, or a 400 saying so — the same bargain timestampOrError makes.
 *
 * safeNumber() returns null for anything it cannot read, and every caller wrote
 * that null straight into the row, so `updateSource(id, { durationS: 'N/A' })`
 * answered ok:true and ERASED a duration the row already had. Review reproduced
 * it live on duration_s, fps, width and height. Slices 4/8-6/8 are the code
 * that will be writing these columns from a probe, and a probe that cannot read
 * a stream reports exactly that kind of junk — so the silent wipe was aimed
 * squarely at the only caller this table will ever have.
 *
 * Deliberately stricter than Number(): booleans, arrays and objects are junk
 * too. `Number(true)` is 1 and `Number([])` is 0, which is how a confident
 * wrong value gets in through a coercion nobody asked for.
 *
 * @returns {{ ok: true, value: number|null } | { ok: false, status, error }}
 */
function numberOrError(value, field) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { ok: true, value: null };
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      return { ok: false, status: 400, error: `${field} must be a number` };
    }
    return { ok: true, value: parsed };
  }
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
  return { ok: false, status: 400, error: `${field} must be a number` };
}

/**
 * Text, or a 400 saying so — the text half of the bargain numberOrError makes.
 *
 * safeText() String-coerces ANYTHING, so `createSource({ contentHash: {} })`
 * stored the literal '[object Object]' under ok:true, and the next genuinely
 * different file in that project was then turned away 409 "already in the
 * catalog for this project" — a message that is simply untrue about two files
 * that have nothing in common. Review reproduced it live. numberOrError
 * already refuses objects, booleans and arrays for exactly this reason; the
 * text path never got the same treatment.
 *
 * A finite number is accepted and stringified: a device lane of 2 is legible
 * text. A boolean, an array or an object is not text under any reading, and
 * coercing one is how a confident wrong value gets in.
 *
 * @returns {{ ok: true, value: string|null } | { ok: false, status, error }}
 */
function textOrError(value, field, max) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'string') return { ok: true, value: value.trim().slice(0, max) || null };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, value: String(value).slice(0, max) };
  }
  return { ok: false, status: 400, error: `${field} must be text` };
}

/** numberOrError, rounded. Same refusal on junk. */
function integerOrError(value, field) {
  const parsed = numberOrError(value, field);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value === null ? null : Math.round(parsed.value) };
}

function normalizeLayerRole(value) {
  const role = safeText(value, 40).toLowerCase();
  return LAYER_ROLES.includes(role) ? role : '';
}

function rowToSource(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    sessionId: safeText(row.session_id, 120),
    layerRole: safeText(row.layer_role, 40) || 'reference',
    syncOffsetMs: safeNumber(row.sync_offset_ms),
    driveFileId: safeText(row.drive_file_id, probeLimit('driveFileId')),
    contentHash: safeText(row.content_hash, probeLimit('contentHash')),
    durationS: safeNumber(row.duration_s),
    width: safeInteger(row.width),
    height: safeInteger(row.height),
    fps: safeNumber(row.fps),
    codec: safeText(row.codec, probeLimit('codec')),
    deviceLane: safeText(row.device_lane, probeLimit('deviceLane')),
    recordedAt: row.recorded_at || '',
    state: safeText(row.state, 40) || 'new',
    localPath: safeText(row.local_path, probeLimit('localPath')),
    proxyPath: safeText(row.proxy_path, probeLimit('proxyPath')),
    createdAt: row.created_at || '',
  };
}

/**
 * Is this failure a duplicate content hash, specifically?
 *
 * NOT "is it a 409". PostgREST answers 409 for a FOREIGN KEY violation too
 * (23503), so the first version of this reported "this file is already in the
 * catalog" when the real problem was a session id that does not exist —
 * a message that lies about what went wrong, which is the exact failure
 * DOCTRINE is written against. Review reproduced it live with a made-up id.
 *
 * So the status is not consulted at all; only the signals that actually mean
 * a unique-constraint collision.
 */
function isDuplicateHashError(res) {
  const message = String(res?.error || '').toLowerCase();
  return (
    message.includes('23505') ||
    message.includes('duplicate key') ||
    message.includes('idx_video_sources_project_content_hash')
  );
}

/** The other thing a 409 can be: the session this row points at is not there. */
function isMissingSessionError(res) {
  const message = String(res?.error || '').toLowerCase();
  return (
    message.includes('23503') ||
    message.includes('foreign key') ||
    message.includes('violates foreign key constraint')
  );
}

async function createSource(input, scope = null) {
  const sessionId = safeText(input?.sessionId || input?.session_id, 120);
  if (!sessionId) return { ok: false, status: 400, error: 'sessionId is required' };

  // The session must belong to THIS project. The foreign key alone is
  // satisfied by any session anywhere, so without this, project A could hang a
  // source off project B's session: the row lands stamped project_id = A while
  // living under B's session, and B deleting that session cascades A's row
  // away. Review reproduced exactly that, end to end.
  //
  // The read is scoped, so a session in another project comes back as missing
  // rather than as forbidden — which is also the right thing to tell the
  // caller, since the existence of B's sessions is not A's business.
  //
  // Only a genuine 404 becomes a 404. `!owner.ok` was true for a Supabase 500,
  // a timeout and an auth failure just as much as for a missing row, so a
  // database that was briefly down told the caller their session did not
  // exist — a message that lies about what went wrong, which is the exact
  // thing the 409 above was already sent back for. Anything that is not a
  // missing row surfaces as itself.
  const owner = await getSessionById(sessionId, scope);
  if (!owner.ok && owner.status !== 404) return owner;
  if (!owner.ok || !owner.data) {
    return { ok: false, status: 404, error: 'That session does not exist in this project' };
  }

  const layerRole = normalizeLayerRole(input?.layerRole || input?.layer_role || 'reference');
  if (!layerRole) {
    return { ok: false, status: 400, error: `layerRole must be one of ${LAYER_ROLES.join(', ')}` };
  }

  const state = safeText(input?.state, 40) || 'new';
  if (!SOURCE_STATES.includes(state)) {
    return { ok: false, status: 400, error: `state must be one of ${SOURCE_STATES.join(', ')}` };
  }

  const recordedAt = timestampOrError(input?.recordedAt ?? input?.recorded_at, 'recordedAt');
  if (!recordedAt.ok) return recordedAt;

  // Every caller-supplied number, checked before anything is written. Junk is a
  // 400 here rather than a null (or, for the offset, a 0) written under a
  // success. See numberOrError.
  const numbers = {};
  for (const [key, column, reader] of [
    ['syncOffsetMs', 'sync_offset_ms', integerOrError],
    ['durationS', 'duration_s', numberOrError],
    ['width', 'width', integerOrError],
    ['height', 'height', integerOrError],
    ['fps', 'fps', numberOrError],
  ]) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const parsed = reader(input?.[key] ?? input?.[snake], key);
    if (!parsed.ok) return parsed;
    numbers[column] = parsed.value;
  }

  // Every caller-supplied probe text, checked the same way and for the same
  // reason: an object or a boolean is a 400 here rather than the string
  // '[object Object]' written under a success. See textOrError.
  const texts = {};
  for (const [key, column, limit] of PROBE_TEXT_FIELDS) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const parsed = textOrError(input?.[key] ?? input?.[snake], key, limit);
    if (!parsed.ok) return parsed;
    texts[column] = parsed.value;
  }

  const row = await scopedInsertRow(table(), {
    session_id: sessionId,
    layer_role: layerRole,
    state,
    // An absent offset stays null, NOT 0: for an A/V sync offset, 0 is not a
    // blank, it is the claim "these two tracks are already perfectly in sync."
    // `safeInteger(...) || 0` turned "we have not measured this yet" into that
    // claim, and the sync pass in Studio 7/8 is built to trust it.
    sync_offset_ms: numbers.sync_offset_ms,
    drive_file_id: texts.drive_file_id,
    content_hash: texts.content_hash,
    duration_s: numbers.duration_s,
    width: numbers.width,
    height: numbers.height,
    fps: numbers.fps,
    codec: texts.codec,
    device_lane: texts.device_lane,
    recorded_at: recordedAt.value,
    local_path: texts.local_path,
    proxy_path: texts.proxy_path,
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) {
    if (isDuplicateHashError(res)) {
      return {
        ok: false,
        status: 409,
        error: 'This file is already in the catalog for this project (same content hash)',
      };
    }
    if (isMissingSessionError(res)) {
      return { ok: false, status: 404, error: 'That session does not exist in this project' };
    }
    return res;
  }
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToSource(created) };
}

async function getSourceById(id, scope = null) {
  const sourceId = safeText(id, 120);
  if (!sourceId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(sourceId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return { ok: false, status: 404, error: 'Source not found' };
  return { ok: true, status: 200, data: rowToSource(found) };
}

/** Limit FIRST, scope second (DOCTRINE 5.10). */
async function listSources(limit = 200, scope = null) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return { ok: false, status: 400, error: bounded.error };
  const query = await scopedListQuery(
    table(),
    `select=*&order=created_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data.map(rowToSource) : [] };
}

/**
 * The files of one session, oldest first (the order an editor stacks them).
 * Parent id first, then scope — the shape every other parent-keyed list here
 * already uses (listPageRevisions, listAssociationsForAsset).
 */
async function listSourcesForSession(sessionId, scope = null) {
  const id = safeText(sessionId, 120);
  if (!id) return { ok: false, status: 400, error: 'sessionId is required' };
  const query = await scopedListQuery(
    table(),
    `session_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc&limit=1000`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data.map(rowToSource) : [] };
}

/** What the ingest, probe and proxy slices write back onto a row. */
async function updateSource(id, patch, scope = null) {
  const sourceId = safeText(id, 120);
  if (!sourceId) return { ok: false, status: 400, error: 'id is required' };

  const next = {};
  if (patch?.layerRole !== undefined) {
    const layerRole = normalizeLayerRole(patch.layerRole);
    if (!layerRole) {
      return { ok: false, status: 400, error: `layerRole must be one of ${LAYER_ROLES.join(', ')}` };
    }
    next.layer_role = layerRole;
  }
  if (patch?.state !== undefined) {
    const state = safeText(patch.state, 40);
    if (!SOURCE_STATES.includes(state)) {
      return { ok: false, status: 400, error: `state must be one of ${SOURCE_STATES.join(', ')}` };
    }
    next.state = state;
  }
  if (patch?.syncOffsetMs !== undefined) {
    // Not `|| 0`. Clearing an offset back to "unknown" is null; 0 is the claim
    // that the tracks are already in sync. See the note on the create path.
    const offset = integerOrError(patch.syncOffsetMs, 'syncOffsetMs');
    if (!offset.ok) return offset;
    next.sync_offset_ms = offset.value;
  }
  if (patch?.recordedAt !== undefined) {
    const when = timestampOrError(patch.recordedAt, 'recordedAt');
    if (!when.ok) return when;
    next.recorded_at = when.value;
  }
  for (const [key, column] of PROBE_NUMBER_FIELDS) {
    if (patch?.[key] === undefined) continue;
    const parsed = numberOrError(patch[key], key);
    if (!parsed.ok) return parsed;
    next[column] = parsed.value;
  }
  for (const [key, column] of PROBE_INTEGER_FIELDS) {
    if (patch?.[key] === undefined) continue;
    const parsed = integerOrError(patch[key], key);
    if (!parsed.ok) return parsed;
    next[column] = parsed.value;
  }
  for (const [key, column, limit] of PROBE_TEXT_FIELDS) {
    if (patch?.[key] === undefined) continue;
    const parsed = textOrError(patch[key], key, limit);
    if (!parsed.ok) return parsed;
    next[column] = parsed.value;
  }
  if (!Object.keys(next).length) return { ok: false, status: 400, error: 'Nothing to update' };

  const body = await scopedPatchRow(table(), next, scope);
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(sourceId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) {
    if (isDuplicateHashError(res)) {
      return {
        ok: false,
        status: 409,
        error: 'This file is already in the catalog for this project (same content hash)',
      };
    }
    if (isMissingSessionError(res)) {
      return { ok: false, status: 404, error: 'That session does not exist in this project' };
    }
    return res;
  }
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Source not found in this project' };
  return { ok: true, status: 200, data: rowToSource(updated) };
}

module.exports = {
  LAYER_ROLES,
  SOURCE_STATES,
  // Exported for their own tests. The tenancy check in createSource catches a
  // missing session BEFORE the insert, so the foreign-key branch below is only
  // reachable in a race — the session deleted between the check and the write.
  // Real, worth keeping, and untestable through createSource, so it is tested
  // directly rather than left as code nothing exercises.
  isDuplicateHashError,
  isMissingSessionError,
  // The declared length for a probe column. Exported so a test can assert what
  // was actually WRITTEN against the single declaration, rather than comparing
  // two values that have both already been truncated on the way back out.
  probeLimit,
  // The input validators, exported so a test can pin the exact boundary
  // (`'  '` is blank, `true` is junk) without going through a whole write.
  numberOrError,
  integerOrError,
  textOrError,
  createSource,
  getSourceById,
  listSources,
  listSourcesForSession,
  updateSource,
  rowToSource,
};
