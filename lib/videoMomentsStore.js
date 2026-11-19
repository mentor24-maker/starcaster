'use strict';

/**
 * video_moments — the scored moments of each recording, one row per source.
 *
 * Table: docs/SQL/video_reel_spinner_setup.sql. Reel Spinner 2b (SC-827).
 * Written by the Mini's scoring pass (workers/studio/momentsPass.js, 2d).
 *
 * A moment is a DECISION, never a clip: "from 41.2 s to 78.9 s scores 86, it
 * speaks to Delray". Nothing in the pipeline touches video until its last step.
 *
 * "Not scored yet" is the ABSENCE of a row, never a state, so a miss reads as
 * `data: null`, not a 404.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { getSourceById } = require('./videoSourcesStore');
const { readField, unknownKeyError } = require('./storeInput');
const {
  safeText, isSeconds, optionalText, firstRow,
} = require('./reelSpinnerInput');

/** The two answers the scoring step can give. A check constraint too. */
const MOMENT_STATUSES = ['done', 'failed'];

const MOMENT_FIELDS = [
  'status', 'moments', 'summary', 'briefFingerprint', 'model', 'rulesVersion', 'error', 'runStartedAt',
];

/** How far ahead of this server's clock a run's start may be: clock skew, no more. */
const FUTURE_SLACK_MS = 60 * 1000;

/**
 * `runStartedAt` as a canonical ISO time, or a 400. Required: without it the
 * store cannot tell a rescore asked for BEFORE the run (answered by it) from
 * one asked for DURING it (not answered — the run scored the old state).
 */
function runStartedAtOrError(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, status: 400, error: 'runStartedAt is required: the time this scoring run began, so a rescore asked for during the run is kept' };
  }
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) {
    return { ok: false, status: 400, error: `runStartedAt must be an ISO date and time (got ${JSON.stringify(value)})` };
  }
  if (ms > now + FUTURE_SLACK_MS) {
    return { ok: false, status: 400, error: `runStartedAt (${value}) is in the future; it would wipe a rescore asked for after the run` };
  }
  return { ok: true, value: new Date(ms).toISOString() };
}

const COLUMNS = [
  'id', 'project_id', 'owner_user_id', 'source_id', 'status', 'moments', 'summary',
  'brief_fingerprint', 'model', 'rules_version', 'rescore_requested_at', 'error',
  'created_at', 'updated_at',
].join(',');

function table() {
  return tableConfig().videoMoments;
}

/** "moments[2] (at 41.2 s)" — enough for a person to find it. */
function momentLabel(item, i) {
  const at = item && typeof item === 'object' && isSeconds(item.start_s) ? ` (at ${item.start_s} s)` : '';
  return `moments[${i}]${at}`;
}

/**
 * `[{ start_s, end_s, score, reasons, project, mood, quote }]`, checked moment
 * by moment, or a 400 naming the first bad one. Only the declared keys are kept.
 */
function momentsOrError(value) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'moments must be an array' };
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    const refuse = (why) => ({ ok: false, status: 400, error: `${momentLabel(item, i)}: ${why}` });
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return refuse('must be { start_s, end_s, score, reasons, project, mood, quote }');
    }
    if (!isSeconds(item.start_s) || !isSeconds(item.end_s)) {
      return refuse('start_s and end_s must be numbers of seconds');
    }
    if (item.start_s >= item.end_s) {
      return refuse(`start_s (${item.start_s} s) must be before end_s (${item.end_s} s)`);
    }
    if (typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > 100) {
      return refuse(`score must be a number from 0 to 100 (got ${JSON.stringify(item.score)})`);
    }
    const reasons = item.reasons === undefined || item.reasons === null ? [] : item.reasons;
    if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string')) {
      return refuse('reasons must be a list of sentences');
    }
    for (const key of ['project', 'mood', 'quote']) {
      if (item[key] !== undefined && item[key] !== null && typeof item[key] !== 'string') {
        return refuse(`${key} must be text`);
      }
    }
    out.push({
      start_s: item.start_s,
      end_s: item.end_s,
      score: item.score,
      reasons: reasons.map((reason) => reason.trim()).filter(Boolean),
      project: typeof item.project === 'string' ? item.project.trim() : '',
      mood: typeof item.mood === 'string' ? item.mood.trim() : '',
      quote: typeof item.quote === 'string' ? item.quote.trim() : '',
    });
  }
  return { ok: true, value: out };
}

function rowToMoments(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    sourceId: safeText(row.source_id, 120),
    status: safeText(row.status, 40),
    moments: Array.isArray(row.moments) ? row.moments : [],
    summary: safeText(row.summary, 4000),
    briefFingerprint: safeText(row.brief_fingerprint, 200),
    model: safeText(row.model, 200),
    rulesVersion: safeText(row.rules_version, 200),
    rescoreRequestedAt: row.rescore_requested_at || '',
    error: safeText(row.error, 2000),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/**
 * Write the scored moments for one source, replacing whatever was there.
 *
 * A REPLACEMENT, not a patch: every column is sent every time, so a re-score
 * after a failure does not keep the old `error`, and a failed run does not
 * leave the last good run's moments behind it.
 *
 * The ONE column it does not replace is `rescore_requested_at`. A score is the
 * answer to a rescore asked for before the run began (`runStartedAt`), never
 * to one asked for while it was running — scoring takes minutes, and that run
 * scored the old state. So the stamp is cleared by a second, CONDITIONAL
 * write (`rescore_requested_at <= runStartedAt`): a request made mid-run
 * survives the answer, and the Mini picks it up next time. The condition is in
 * the UPDATE itself, so no interleaving of the two calls can lose it.
 *
 * The upsert sends `on_conflict=` AND `Prefer: resolution=merge-duplicates`
 * (CLAUDE.md landmine 15), and a refused write is returned as itself — there
 * is no fallback.
 */
async function upsertMoments(sourceId, data, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, error: 'moment data must be an object' };
  }
  const unknown = unknownKeyError(data, MOMENT_FIELDS);
  if (unknown) return unknown;

  const suppliedStatus = readField(data, 'status');
  if (!suppliedStatus.ok) return suppliedStatus;
  const status = safeText(suppliedStatus.value, 40);
  if (!MOMENT_STATUSES.includes(status)) {
    return { ok: false, status: 400, error: `status must be one of ${MOMENT_STATUSES.join(', ')}` };
  }

  const fields = {};
  for (const [key, max] of [
    ['summary', 4000], ['briefFingerprint', 200], ['model', 200], ['rulesVersion', 200], ['error', 2000],
  ]) {
    const supplied = readField(data, key);
    if (!supplied.ok) return supplied;
    const parsed = optionalText(supplied.value, key, max);
    if (!parsed.ok) return parsed;
    fields[key] = parsed.value;
  }
  // A failure nobody can explain reads as a broken screen (landmine 17).
  if (status === 'failed' && !fields.error) {
    return { ok: false, status: 400, error: 'error is required when status is failed' };
  }

  const suppliedMoments = readField(data, 'moments');
  if (!suppliedMoments.ok) return suppliedMoments;
  const moments = momentsOrError(suppliedMoments.value);
  if (!moments.ok) return moments;

  const suppliedStart = readField(data, 'runStartedAt');
  if (!suppliedStart.ok) return suppliedStart;
  const runStartedAt = runStartedAtOrError(suppliedStart.value);
  if (!runStartedAt.ok) return runStartedAt;

  // The source must belong to THIS project; the foreign key alone is satisfied
  // by any source anywhere.
  const owner = await getSourceById(id, scope);
  if (!owner.ok && owner.status !== 404) return owner;
  if (!owner.ok || !owner.data) {
    return { ok: false, status: 404, error: 'That source does not exist in this project' };
  }

  const row = await scopedInsertRow(table(), {
    source_id: owner.data.id,
    status,
    moments: moments.value,
    summary: fields.summary,
    brief_fingerprint: fields.briefFingerprint,
    model: fields.model,
    rules_version: fields.rulesVersion,
    error: fields.error,
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: `on_conflict=project_id,source_id&select=${COLUMNS}`,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const saved = firstRow(res.data);
  if (!saved) {
    return { ok: false, status: 502, error: 'The database accepted the moments but returned no row' };
  }

  // Clear the rescore request this run answered — and only that one.
  const clear = await scopedPatchRow(table(), { rescore_requested_at: null }, scope);
  const clearQuery = await scopedListQuery(
    table(),
    `source_id=eq.${encodeURIComponent(owner.data.id)}`
      + `&rescore_requested_at=lte.${encodeURIComponent(runStartedAt.value)}&select=${COLUMNS}`,
    scope
  );
  const cleared = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: clearQuery,
    headers: { Prefer: 'return=representation' },
    body: clear,
  });
  if (!cleared.ok) {
    return {
      ok: false,
      status: cleared.status,
      error: `The moments were saved, but the rescore request they answer was not cleared: ${cleared.error || 'the database refused it'}`,
    };
  }
  // No row matched: there was no request, or it came after the run began and
  // still stands. Either way the upsert's row is the row.
  return { ok: true, status: 200, data: rowToMoments(firstRow(cleared.data) || saved) };
}

/** The scored moments of one source, or `data: null` if it has not been scored. */
async function getMomentsBySource(sourceId, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  const query = await scopedListQuery(
    table(),
    `source_id=eq.${encodeURIComponent(id)}&select=${COLUMNS}&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = firstRow(res.data);
  return { ok: true, status: 200, data: found ? rowToMoments(found) : null };
}

/**
 * Ask for a recording to be scored again. Stamps `rescore_requested_at`; the
 * Mini polls for it, and the first upsertMoments whose run STARTED after it
 * clears it (a run already going when he asked does not).
 *
 * A recording that was never scored has nothing to RE-score, and says so.
 */
async function requestRescore(sourceId, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  const body = await scopedPatchRow(table(), { rescore_requested_at: new Date().toISOString() }, scope);
  const query = await scopedListQuery(
    table(),
    `source_id=eq.${encodeURIComponent(id)}&select=${COLUMNS}`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) return res;
  const updated = firstRow(res.data);
  if (!updated) {
    return { ok: false, status: 404, error: 'That recording has not been scored yet in this project, so there is nothing to score again' };
  }
  return { ok: true, status: 200, data: rowToMoments(updated) };
}

/** listMomentStates takes at most this many ids per request (a URL has a length). */
const MAX_STATE_IDS = 500;

/**
 * `{ <source id lower-cased>: { status, briefFingerprint, rulesVersion, rescoreRequestedAt, updatedAt } }`
 * for the sources that HAVE a row. A source missing from the map has not been
 * scored (the absence of a row is the state). For `studio:backfill-moments`.
 */
async function listMomentStates(sourceIds, scope = null) {
  if (!Array.isArray(sourceIds)) {
    return { ok: false, status: 400, error: 'sourceIds must be an array — listMomentStates is (sourceIds, scope)' };
  }
  const ids = [];
  for (const value of sourceIds) {
    if (typeof value !== 'string' || !value.trim()) {
      return { ok: false, status: 400, error: 'every source id must be non-empty text' };
    }
    const clean = value.trim().toLowerCase();
    if (!ids.includes(clean)) ids.push(clean);
  }
  if (!ids.length) return { ok: true, status: 200, data: {} };
  if (ids.length > MAX_STATE_IDS) {
    return { ok: false, status: 400, error: `ask for at most ${MAX_STATE_IDS} sources at a time (got ${ids.length})` };
  }
  const list = ids.map((value) => encodeURIComponent(value)).join(',');
  const query = await scopedListQuery(
    table(),
    `source_id=in.(${list})&select=source_id,status,brief_fingerprint,rules_version,rescore_requested_at,updated_at&limit=${ids.length}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const states = {};
  for (const row of Array.isArray(res.data) ? res.data : []) {
    states[safeText(row.source_id, 120).toLowerCase()] = {
      status: safeText(row.status, 40),
      briefFingerprint: safeText(row.brief_fingerprint, 200),
      rulesVersion: safeText(row.rules_version, 200),
      rescoreRequestedAt: row.rescore_requested_at || '',
      updatedAt: row.updated_at || '',
    };
  }
  return { ok: true, status: 200, data: states };
}

/** The most rescore requests one read returns; more than this is a backlog, said so. */
const MAX_RESCORE_REQUESTS = 200;

/**
 * Every recording in this project Dane has asked to have scored again and the
 * Mini has not answered yet: `[{ sourceId, rescoreRequestedAt }]`, oldest
 * request first. The Studio daemon reads it on a clock (Reel Spinner 2d) and
 * queues a scoring job for each; the score that answers clears the stamp
 * (upsertMoments). `truncated` says the read hit its ceiling.
 */
async function listRescoreRequests(scope = null) {
  const query = await scopedListQuery(
    table(),
    'rescore_requested_at=not.is.null&select=source_id,rescore_requested_at'
      + `&order=rescore_requested_at.asc&limit=${MAX_RESCORE_REQUESTS}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const rows = (Array.isArray(res.data) ? res.data : []).map((row) => ({
    sourceId: safeText(row.source_id, 120),
    rescoreRequestedAt: row.rescore_requested_at || '',
  })).filter((row) => row.sourceId && row.rescoreRequestedAt);
  return { ok: true, status: 200, data: rows, truncated: rows.length >= MAX_RESCORE_REQUESTS };
}

module.exports = {
  MOMENT_STATUSES,
  MAX_STATE_IDS,
  MAX_RESCORE_REQUESTS,
  listMomentStates,
  listRescoreRequests,
  MOMENT_FIELDS,
  momentsOrError,
  runStartedAtOrError,
  rowToMoments,
  upsertMoments,
  getMomentsBySource,
  requestRescore,
};
