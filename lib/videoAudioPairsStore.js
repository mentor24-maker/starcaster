'use strict';

/**
 * video_audio_pairs — which two recordings were made together, one row per pair.
 *
 * Table: docs/SQL/video_reel_spinner_setup.sql. Reel Spinner 2b (SC-827).
 * Nothing calls this yet; the line-up step (3a onward) will.
 *
 * An iPhone take and its Zoom recording are the same conversation on two
 * clocks. A pair row is the DECISION about them — how far apart they start,
 * how far the clocks drift, whose sound the edit uses — never a merged file.
 *
 * ONE ROW PER PAIR, WHICHEVER WAY ROUND IT IS ASKED. The store files every pair
 * with the smaller source id as A, so "the iPhone with the Zoom" and "the Zoom
 * with the iPhone" land on one row. Offset and drift are measured from A to B,
 * so when a caller's pair is turned round, both are negated with it.
 *
 * DANE'S CHOICE OUTRANKS A MEASUREMENT. Once he picks whose sound to use
 * (chooseAudioSource), a later line-up still updates the offset and drift but
 * keeps his pick. That is enforced by the write itself, not by a read before
 * it: the measured pick is an UPDATE guarded on `chosen_by=eq.measured`, so
 * his choice landing mid-save cannot be overwritten (see upsertAudioPair).
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { getSourceById } = require('./videoSourcesStore');
const { readField, unknownKeyError } = require('./storeInput');
const {
  safeText, safeNumber, optionalText, optionalNumber, firstRow,
} = require('./reelSpinnerInput');

const PAIR_STATUSES = ['done', 'failed'];
const CHOSEN_BY = ['measured', 'dane'];

const PAIR_FIELDS = ['status', 'offsetS', 'driftS', 'confidence', 'audioSourceId', 'error'];

const COLUMNS = [
  'id', 'project_id', 'owner_user_id', 'source_a_id', 'source_b_id', 'offset_s', 'drift_s',
  'confidence', 'audio_source_id', 'chosen_by', 'status', 'error', 'created_at', 'updated_at',
].join(',');

function table() {
  return tableConfig().videoAudioPairs;
}

function rowToPair(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    sourceAId: safeText(row.source_a_id, 120),
    sourceBId: safeText(row.source_b_id, 120),
    offsetS: safeNumber(row.offset_s),
    driftS: safeNumber(row.drift_s),
    confidence: safeNumber(row.confidence),
    audioSourceId: safeText(row.audio_source_id, 120) || null,
    chosenBy: safeText(row.chosen_by, 40),
    status: safeText(row.status, 40),
    error: safeText(row.error, 2000),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/** Negate a measurement when its pair is turned round; null stays null, 0 stays 0. */
function flip(value) {
  return value === null || value === 0 ? value : -value;
}

/**
 * The two source ids in the order the table files them, or a 400.
 * `{ a, b, swapped }` — `swapped` says the caller's order was turned round.
 */
function orderedPair(sourceAId, sourceBId) {
  const first = safeText(sourceAId, 120).toLowerCase();
  const second = safeText(sourceBId, 120).toLowerCase();
  if (!first || !second) return { ok: false, status: 400, error: 'both source ids are required' };
  if (first === second) {
    return { ok: false, status: 400, error: 'a recording cannot be paired with itself' };
  }
  return first < second
    ? { ok: true, a: first, b: second, swapped: false }
    : { ok: true, a: second, b: first, swapped: true };
}

/** Both sources must be in THIS project; a foreign key accepts any project's. */
async function bothInProject(a, b, scope) {
  for (const id of [a, b]) {
    const owner = await getSourceById(id, scope);
    if (!owner.ok && owner.status !== 404) return owner;
    if (!owner.ok || !owner.data) {
      return { ok: false, status: 404, error: `Source ${id} does not exist in this project` };
    }
  }
  return { ok: true };
}

/** The pair row for two sources, in either order, or `data: null`. */
async function getAudioPair(sourceAId, sourceBId, scope = null) {
  const pair = orderedPair(sourceAId, sourceBId);
  if (!pair.ok) return pair;
  const query = await scopedListQuery(
    table(),
    `source_a_id=eq.${encodeURIComponent(pair.a)}&source_b_id=eq.${encodeURIComponent(pair.b)}&select=${COLUMNS}&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = firstRow(res.data);
  return { ok: true, status: 200, data: found ? rowToPair(found) : null };
}

/**
 * Write what the line-up measured for two sources, replacing the measurement
 * that was there — but never Dane's choice of sound (see the file comment).
 * Two writes: the measurement, then the measured choice of sound guarded on
 * the row still being `measured`. `audioSourceId` absent or null means the
 * line-up could not tell, and clears an earlier MEASURED pick, never his.
 *
 * The upsert sends `on_conflict=` AND `Prefer: resolution=merge-duplicates`
 * (CLAUDE.md landmine 15), and a refused write is returned as itself.
 */
async function upsertAudioPair(sourceAId, sourceBId, data, scope = null) {
  const pair = orderedPair(sourceAId, sourceBId);
  if (!pair.ok) return pair;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, error: 'pair data must be an object' };
  }
  const unknown = unknownKeyError(data, PAIR_FIELDS);
  if (unknown) return unknown;

  const suppliedStatus = readField(data, 'status');
  if (!suppliedStatus.ok) return suppliedStatus;
  const status = safeText(suppliedStatus.value, 40);
  if (!PAIR_STATUSES.includes(status)) {
    return { ok: false, status: 400, error: `status must be one of ${PAIR_STATUSES.join(', ')}` };
  }

  const numbers = {};
  for (const [key, range] of [['offsetS', {}], ['driftS', {}], ['confidence', { min: 0, max: 1 }]]) {
    const supplied = readField(data, key);
    if (!supplied.ok) return supplied;
    const parsed = optionalNumber(supplied.value, key, range);
    if (!parsed.ok) return parsed;
    numbers[key] = parsed.value;
  }

  const suppliedError = readField(data, 'error');
  if (!suppliedError.ok) return suppliedError;
  const error = optionalText(suppliedError.value, 'error', 2000);
  if (!error.ok) return error;
  if (status === 'failed' && !error.value) {
    return { ok: false, status: 400, error: 'error is required when status is failed' };
  }

  const suppliedAudio = readField(data, 'audioSourceId');
  if (!suppliedAudio.ok) return suppliedAudio;
  let audioSourceId = null;
  if (suppliedAudio.value !== undefined && suppliedAudio.value !== null) {
    audioSourceId = safeText(suppliedAudio.value, 120).toLowerCase();
    if (audioSourceId !== pair.a && audioSourceId !== pair.b) {
      return { ok: false, status: 400, error: 'audioSourceId must be one of the two paired sources' };
    }
  }

  const owners = await bothInProject(pair.a, pair.b, scope);
  if (!owners.ok) return owners;

  // WRITE 1 — the measurement. The upsert does NOT name audio_source_id or
  // chosen_by, so on a conflict it leaves both exactly as they are (an upsert
  // sets only the columns it names), and a brand-new row gets the defaults
  // (no sound yet, chosen_by 'measured'). Nothing Dane picked can be touched
  // here, however the calls interleave.
  const row = await scopedInsertRow(table(), {
    source_a_id: pair.a,
    source_b_id: pair.b,
    offset_s: pair.swapped ? flip(numbers.offsetS) : numbers.offsetS,
    drift_s: pair.swapped ? flip(numbers.driftS) : numbers.driftS,
    confidence: numbers.confidence,
    status,
    error: error.value,
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: `on_conflict=project_id,source_a_id,source_b_id&select=${COLUMNS}`,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const saved = firstRow(res.data);
  if (!saved) {
    return { ok: false, status: 502, error: 'The database accepted the pair but returned no row' };
  }

  // WRITE 2 — the measured choice of sound, applied ONLY where the row still
  // says chosen_by = 'measured'. The condition is part of the UPDATE itself,
  // so if Dane chose at any moment before this statement runs, it matches no
  // row and his pick stands. A read followed by a separate write could not
  // promise that: his choice could land between the two and be overwritten,
  // with both calls answering 200 (review of PR #1025).
  const pick = await scopedPatchRow(table(), { audio_source_id: audioSourceId, chosen_by: 'measured' }, scope);
  const pickQuery = await scopedIdQuery(
    table(),
    `id=eq.${encodeURIComponent(saved.id)}&chosen_by=eq.measured&select=${COLUMNS}`,
    scope
  );
  const picked = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: pickQuery,
    headers: { Prefer: 'return=representation' },
    body: pick,
  });
  if (!picked.ok) {
    return {
      ok: false,
      status: picked.status,
      error: `The line-up was saved, but its choice of sound was not: ${picked.error || 'the database refused it'}`,
    };
  }
  const afterPick = firstRow(picked.data);
  if (afterPick) return { ok: true, status: 200, data: rowToPair(afterPick) };

  // Nothing matched: Dane has chosen, and his pick was kept. Read the row as
  // it stands, rather than answering with the upsert's earlier picture of it.
  const now = await getAudioPair(pair.a, pair.b, scope);
  if (!now.ok) return now;
  if (!now.data) return { ok: false, status: 404, error: 'The pair was saved and then could not be read back' };
  return { ok: true, status: 200, data: now.data };
}

/** Every pair one source is part of, on either side. `(sourceId, scope)`. */
async function listAudioPairsForSource(sourceId, scope = null) {
  const id = safeText(sourceId, 120).toLowerCase();
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  const pairs = [];
  for (const column of ['source_a_id', 'source_b_id']) {
    const query = await scopedListQuery(
      table(),
      `${column}=eq.${encodeURIComponent(id)}&select=${COLUMNS}&order=created_at.asc`,
      scope
    );
    const res = await sbQuery({ method: 'GET', table: table(), query });
    if (!res.ok) return res;
    for (const row of Array.isArray(res.data) ? res.data : []) pairs.push(rowToPair(row));
  }
  return { ok: true, status: 200, data: pairs };
}

/** Dane picks whose sound a pair uses. A later measurement keeps it. */
async function chooseAudioSource(pairId, audioSourceId, scope = null) {
  const id = safeText(pairId, 120);
  if (!id) return { ok: false, status: 400, error: 'pairId is required' };
  const chosen = safeText(audioSourceId, 120).toLowerCase();
  if (!chosen) return { ok: false, status: 400, error: 'audioSourceId is required' };

  const readQuery = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(id)}&select=${COLUMNS}&limit=1`, scope);
  const read = await sbQuery({ method: 'GET', table: table(), query: readQuery });
  if (!read.ok) return read;
  const current = rowToPair(firstRow(read.data));
  if (!current) return { ok: false, status: 404, error: 'That pair does not exist in this project' };
  if (chosen !== current.sourceAId.toLowerCase() && chosen !== current.sourceBId.toLowerCase()) {
    return { ok: false, status: 400, error: 'audioSourceId must be one of the two paired sources' };
  }

  const body = await scopedPatchRow(table(), { audio_source_id: chosen, chosen_by: 'dane' }, scope);
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(id)}&select=${COLUMNS}`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) return res;
  const updated = firstRow(res.data);
  if (!updated) return { ok: false, status: 404, error: 'That pair does not exist in this project' };
  return { ok: true, status: 200, data: rowToPair(updated) };
}

module.exports = {
  PAIR_STATUSES,
  CHOSEN_BY,
  PAIR_FIELDS,
  orderedPair,
  rowToPair,
  getAudioPair,
  upsertAudioPair,
  listAudioPairsForSource,
  chooseAudioSource,
};
