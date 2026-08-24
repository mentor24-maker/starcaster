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

function safeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInteger(value) {
  const parsed = safeNumber(value);
  return parsed === null ? null : Math.round(parsed);
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
    syncOffsetMs: Number(row.sync_offset_ms) || 0,
    driveFileId: safeText(row.drive_file_id, 300),
    contentHash: safeText(row.content_hash, probeLimit('contentHash')),
    durationS: safeNumber(row.duration_s),
    width: safeInteger(row.width),
    height: safeInteger(row.height),
    fps: safeNumber(row.fps),
    codec: safeText(row.codec, 100),
    deviceLane: safeText(row.device_lane, 100),
    recordedAt: row.recorded_at || '',
    state: safeText(row.state, 40) || 'new',
    localPath: safeText(row.local_path, 1000),
    proxyPath: safeText(row.proxy_path, 1000),
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
  const owner = await getSessionById(sessionId, scope);
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

  const row = await scopedInsertRow(table(), {
    session_id: sessionId,
    layer_role: layerRole,
    state,
    sync_offset_ms: safeInteger(input?.syncOffsetMs ?? input?.sync_offset_ms) || 0,
    drive_file_id: safeText(input?.driveFileId || input?.drive_file_id, probeLimit('driveFileId')) || null,
    content_hash: safeText(input?.contentHash || input?.content_hash, probeLimit('contentHash')) || null,
    duration_s: safeNumber(input?.durationS ?? input?.duration_s),
    width: safeInteger(input?.width),
    height: safeInteger(input?.height),
    fps: safeNumber(input?.fps),
    codec: safeText(input?.codec, probeLimit('codec')) || null,
    device_lane: safeText(input?.deviceLane || input?.device_lane, probeLimit('deviceLane')) || null,
    recorded_at: recordedAt.value,
    local_path: safeText(input?.localPath || input?.local_path, probeLimit('localPath')) || null,
    proxy_path: safeText(input?.proxyPath || input?.proxy_path, probeLimit('proxyPath')) || null,
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
  if (patch?.syncOffsetMs !== undefined) next.sync_offset_ms = safeInteger(patch.syncOffsetMs) || 0;
  if (patch?.recordedAt !== undefined) {
    const when = timestampOrError(patch.recordedAt, 'recordedAt');
    if (!when.ok) return when;
    next.recorded_at = when.value;
  }
  for (const [key, column] of PROBE_NUMBER_FIELDS) {
    if (patch?.[key] !== undefined) next[column] = safeNumber(patch[key]);
  }
  for (const [key, column] of PROBE_INTEGER_FIELDS) {
    if (patch?.[key] !== undefined) next[column] = safeInteger(patch[key]);
  }
  for (const [key, column, limit] of PROBE_TEXT_FIELDS) {
    if (patch?.[key] !== undefined) next[column] = safeText(patch[key], limit) || null;
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
  createSource,
  getSourceById,
  listSources,
  listSourcesForSession,
  updateSource,
  rowToSource,
};
