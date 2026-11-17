'use strict';

/**
 * video_moments — the scored moments of each recording, one row per source.
 *
 * Table: docs/SQL/video_reel_spinner_setup.sql. Reel Spinner 2b (SC-827).
 * Nothing calls this yet; the scoring step (2c onward) will.
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
  'status', 'moments', 'summary', 'briefFingerprint', 'model', 'rulesVersion', 'error',
];

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
 * leave the last good run's moments behind it. It also clears
 * `rescore_requested_at`, because a score written IS the answer to the request.
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
    rescore_requested_at: null,
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
  return { ok: true, status: 200, data: rowToMoments(saved) };
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
 * Mini polls for it, and the next upsertMoments clears it.
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

module.exports = {
  MOMENT_STATUSES,
  MOMENT_FIELDS,
  momentsOrError,
  rowToMoments,
  upsertMoments,
  getMomentsBySource,
  requestRescore,
};
