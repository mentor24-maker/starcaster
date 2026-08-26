'use strict';

/**
 * video_sessions — one recording session (a shoot, a talk, a screen capture).
 * Its media files live in video_sources, one row per file.
 *
 * Table: docs/SQL/video_studio_setup.sql. Studio Phase 1 · 1 of 8 (86bbjv681);
 * nothing ingests or renders yet — this is the place those slices write to.
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10): `session.state` read off the envelope is `undefined` and
 * `session.status` is the HTTP status, which reads as a plausible answer.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { resolveLimit } = require('./storeLimit');

/**
 * The session lifecycle. It lives here rather than in a check constraint
 * because slices 4/8-6/8 each add stages to it, and every added stage would
 * otherwise be a schema migration. Extend the array; no SQL required.
 */
const SESSION_STATES = ['new', 'ingesting', 'synced', 'ready', 'failed'];

const MAX_TITLE_LENGTH = 300;

function table() {
  return tableConfig().videoSessions;
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/** A timestamp the database will accept, or '' — never a half-parsed string. */
function safeTimestamp(value) {
  const text = safeText(value, 60);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** Confidence is a proportion: anything outside 0..1 is a bug upstream, so it
 *  is clamped rather than stored and later mistaken for a percentage. */
/**
 * A timestamp, or a 400 saying so. Same reasoning as videoSourcesStore: an
 * unparseable date used to become `null`, so an update reported success and
 * wiped the timestamp the row already had. Every other invalid input here is
 * a 400.
 */
function timestampOrError(value, field) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const parsed = safeTimestamp(value);
  if (!parsed) return { ok: false, status: 400, error: `${field} is not a valid date` };
  return { ok: true, value: parsed };
}

/**
 * A confidence in 0..1, or a 400 saying so.
 *
 * It used to null anything non-numeric, so `updateSession(id, { syncConfidence:
 * 'high' })` answered ok:true and ERASED a measured 0.92. Same class as the
 * unparseable date above, and as the probe numbers in videoSourcesStore — an
 * invalid input that destroys the value it was meant to replace and reports
 * success. Every other invalid input in these stores is a 400; so is this one.
 *
 * Out-of-range is still CLAMPED rather than refused, which is a different
 * judgement on purpose: 1.4 is a legible answer from a sync pass that
 * over-normalised, and reading it as a percentage later is the real hazard.
 * `'high'` is not an answer at all.
 *
 * @returns {{ ok: true, value: number|null } | { ok: false, status, error }}
 */
function confidenceOrError(value, field) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { ok: true, value: null };
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      return { ok: false, status: 400, error: `${field} must be a number between 0 and 1` };
    }
    return { ok: true, value: Math.max(0, Math.min(parsed, 1)) };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, value: Math.max(0, Math.min(value, 1)) };
  }
  return { ok: false, status: 400, error: `${field} must be a number between 0 and 1` };
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    title: safeText(row.title, MAX_TITLE_LENGTH),
    recordedAt: row.recorded_at || '',
    state: safeText(row.state, 40) || 'new',
    programAudioSourceId: safeText(row.program_audio_source_id, 120),
    syncConfidence: row.sync_confidence === null || row.sync_confidence === undefined
      ? null
      : Number(row.sync_confidence),
    createdAt: row.created_at || '',
  };
}

async function createSession(input, scope = null) {
  const title = safeText(input?.title, MAX_TITLE_LENGTH);
  if (!title) return { ok: false, status: 400, error: 'A title is required' };

  const state = safeText(input?.state, 40) || 'new';
  if (!SESSION_STATES.includes(state)) {
    return { ok: false, status: 400, error: `state must be one of ${SESSION_STATES.join(', ')}` };
  }

  const recordedAt = timestampOrError(input?.recordedAt ?? input?.recorded_at, 'recordedAt');
  if (!recordedAt.ok) return recordedAt;

  const confidence = confidenceOrError(
    input?.syncConfidence ?? input?.sync_confidence, 'syncConfidence'
  );
  if (!confidence.ok) return confidence;

  const row = await scopedInsertRow(table(), {
    title,
    state,
    recorded_at: recordedAt.value,
    sync_confidence: confidence.value,
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToSession(created) };
}

async function getSessionById(id, scope = null) {
  const sessionId = safeText(id, 120);
  if (!sessionId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return { ok: false, status: 404, error: 'Session not found' };
  return { ok: true, status: 200, data: rowToSession(found) };
}

/** Newest recordings first. Limit FIRST, scope second (DOCTRINE 5.10). */
async function listSessions(limit = 200, scope = null) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return { ok: false, status: 400, error: bounded.error };
  const query = await scopedListQuery(
    table(),
    `select=*&order=recorded_at.desc.nullslast,created_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToSession) : [],
  };
}

/**
 * Patch the fields the later slices move: state, the programme-audio source,
 * the sync confidence, the title, the recording time. Scoped PATCH verified
 * from the write's own representation — a 200 with no row back means the scope
 * filter excluded it, which is a failure, not an empty success.
 */
async function updateSession(id, patch, scope = null) {
  const sessionId = safeText(id, 120);
  if (!sessionId) return { ok: false, status: 400, error: 'id is required' };

  const next = {};
  if (patch?.title !== undefined) {
    const title = safeText(patch.title, MAX_TITLE_LENGTH);
    if (!title) return { ok: false, status: 400, error: 'A title is required' };
    next.title = title;
  }
  if (patch?.state !== undefined) {
    const state = safeText(patch.state, 40);
    if (!SESSION_STATES.includes(state)) {
      return { ok: false, status: 400, error: `state must be one of ${SESSION_STATES.join(', ')}` };
    }
    next.state = state;
  }
  if (patch?.recordedAt !== undefined) {
    const when = timestampOrError(patch.recordedAt, 'recordedAt');
    if (!when.ok) return when;
    next.recorded_at = when.value;
  }
  if (patch?.programAudioSourceId !== undefined) {
    next.program_audio_source_id = safeText(patch.programAudioSourceId, 120) || null;
  }
  if (patch?.syncConfidence !== undefined) {
    const confidence = confidenceOrError(patch.syncConfidence, 'syncConfidence');
    if (!confidence.ok) return confidence;
    next.sync_confidence = confidence.value;
  }
  if (!Object.keys(next).length) {
    return { ok: false, status: 400, error: 'Nothing to update' };
  }

  const body = await scopedPatchRow(table(), next, scope);
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(sessionId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Session not found in this project' };
  return { ok: true, status: 200, data: rowToSession(updated) };
}

module.exports = {
  SESSION_STATES,
  MAX_TITLE_LENGTH,
  // Exported so a test can pin the boundary directly — clamped vs refused.
  confidenceOrError,
  createSession,
  getSessionById,
  listSessions,
  updateSession,
  rowToSession,
};
