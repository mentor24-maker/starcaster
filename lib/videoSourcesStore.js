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
const PROBE_TEXT_FIELDS = [
  ['codec', 'codec'],
  ['deviceLane', 'device_lane'],
  ['localPath', 'local_path'],
  ['proxyPath', 'proxy_path'],
  ['driveFileId', 'drive_file_id'],
  ['contentHash', 'content_hash'],
];

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
    contentHash: safeText(row.content_hash, 200),
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

/** Postgres 23505 arrives as a 409 from PostgREST, but the message is the only
 *  thing guaranteed across versions, so both are checked (as builderPagesStore
 *  and ContactsStore already do). */
function isDuplicateHashError(res) {
  const message = String(res?.error || '').toLowerCase();
  return (
    res?.status === 409 ||
    message.includes('23505') ||
    message.includes('duplicate key')
  );
}

async function createSource(input, scope = null) {
  const sessionId = safeText(input?.sessionId || input?.session_id, 120);
  if (!sessionId) return { ok: false, status: 400, error: 'sessionId is required' };

  const layerRole = normalizeLayerRole(input?.layerRole || input?.layer_role || 'reference');
  if (!layerRole) {
    return { ok: false, status: 400, error: `layerRole must be one of ${LAYER_ROLES.join(', ')}` };
  }

  const state = safeText(input?.state, 40) || 'new';
  if (!SOURCE_STATES.includes(state)) {
    return { ok: false, status: 400, error: `state must be one of ${SOURCE_STATES.join(', ')}` };
  }

  const row = await scopedInsertRow(table(), {
    session_id: sessionId,
    layer_role: layerRole,
    state,
    sync_offset_ms: safeInteger(input?.syncOffsetMs ?? input?.sync_offset_ms) || 0,
    drive_file_id: safeText(input?.driveFileId || input?.drive_file_id, 300) || null,
    content_hash: safeText(input?.contentHash || input?.content_hash, 200) || null,
    duration_s: safeNumber(input?.durationS ?? input?.duration_s),
    width: safeInteger(input?.width),
    height: safeInteger(input?.height),
    fps: safeNumber(input?.fps),
    codec: safeText(input?.codec, 100) || null,
    device_lane: safeText(input?.deviceLane || input?.device_lane, 100) || null,
    recorded_at: safeTimestamp(input?.recordedAt || input?.recorded_at) || null,
    local_path: safeText(input?.localPath || input?.local_path, 1000) || null,
    proxy_path: safeText(input?.proxyPath || input?.proxy_path, 1000) || null,
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
  if (patch?.recordedAt !== undefined) next.recorded_at = safeTimestamp(patch.recordedAt) || null;
  for (const [key, column] of PROBE_NUMBER_FIELDS) {
    if (patch?.[key] !== undefined) next[column] = safeNumber(patch[key]);
  }
  for (const [key, column] of PROBE_INTEGER_FIELDS) {
    if (patch?.[key] !== undefined) next[column] = safeInteger(patch[key]);
  }
  for (const [key, column] of PROBE_TEXT_FIELDS) {
    if (patch?.[key] !== undefined) next[column] = safeText(patch[key], 1000) || null;
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
    return res;
  }
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Source not found in this project' };
  return { ok: true, status: 200, data: rowToSource(updated) };
}

module.exports = {
  LAYER_ROLES,
  SOURCE_STATES,
  createSource,
  getSourceById,
  listSources,
  listSourcesForSession,
  updateSource,
  rowToSource,
};
