'use strict';

/**
 * video_transcripts — what was said in a recording, one row per source file.
 *
 * Table: docs/SQL/video_transcripts_setup.sql. Studio Phase 2 · 1 of 6
 * (86bcdejyr). Nothing transcribes yet: 3 of 6 is the step that calls
 * upsertTranscript, and the Footage screen (4 and 5 of 6) reads the rest.
 *
 * "Not transcribed yet" is the ABSENCE of a row, never a state. So the reads
 * here answer a miss with `data: null` (or a source missing from the map),
 * not a 404 — that is the ordinary answer, and a 404 would make it travel the
 * same path as the database being down.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedInsertRow } = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { getSourceById } = require('./videoSourcesStore');
const { readField, unknownKeyError } = require('./storeInput');

/** The three answers the transcribe step can give. A check constraint too. */
const TRANSCRIPT_STATES = ['done', 'failed', 'no_audio'];

const TRANSCRIPT_FIELDS = [
  'state', 'reason', 'language', 'model', 'durationS', 'text', 'segments', 'words',
];

/**
 * Every column a read returns. Named rather than `*` so the generated
 * `search_tsv` column — a search index, not data — never leaves the database.
 */
const COLUMNS = [
  'id', 'project_id', 'owner_user_id', 'source_id', 'state', 'reason', 'language',
  'model', 'duration_s', 'text', 'segments', 'words', 'created_at', 'updated_at',
].join(',');

/** What the Footage screen needs per source — no transcript text. */
const STATE_COLUMNS = 'source_id,state,reason,language,duration_s,updated_at';

/** listTranscriptStates asks for at most this many sources in one request. */
const MAX_STATE_IDS = 500;

function table() {
  return tableConfig().videoTranscripts;
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function safeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The words in a piece of text, the way the search compares them: lower-cased
 * and split on anything that is not a letter or a digit.
 *
 * This is the JS half of the 'simple' text-search configuration the SQL uses.
 * The database decides WHICH transcripts match; this decides which SEGMENTS of
 * a match contain the words. If the two disagreed about what a word is, a
 * recording would come back as a hit with no moment to jump to — which is why
 * the SQL does not stem (see the note on search_tsv).
 */
function searchWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A finite number of seconds, or null. Strict: '1.5' and true are junk. */
function isSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * `[{ start, end, text }]`, checked item by item, or a 400 naming the first
 * bad one. Only the declared keys are kept, so whatever else a model emits
 * (token ids, temperatures) does not end up stored as if it were part of the
 * transcript.
 */
function segmentsOrError(value) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'segments must be an array' };
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !isSeconds(item.start) || !isSeconds(item.end) || typeof item.text !== 'string') {
      return {
        ok: false,
        status: 400,
        error: `segments[${i}] must be { start, end, text } with start and end in seconds`,
      };
    }
    out.push({ start: item.start, end: item.end, text: item.text });
  }
  return { ok: true, value: out };
}

/** `[{ start, end, word, p }]`; p is optional, and 0..1 when present. */
function wordsOrError(value) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'words must be an array' };
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    const p = item && typeof item === 'object' ? item.p : undefined;
    const pOk = p === undefined || p === null
      || (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1);
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !isSeconds(item.start) || !isSeconds(item.end) || typeof item.word !== 'string' || !pOk) {
      return {
        ok: false,
        status: 400,
        error: `words[${i}] must be { start, end, word, p } with times in seconds and p between 0 and 1`,
      };
    }
    out.push({ start: item.start, end: item.end, word: item.word, p: p === undefined ? null : p });
  }
  return { ok: true, value: out };
}

/** Text or nothing; an object or a boolean is a 400, never '[object Object]'. */
function optionalText(value, field, max) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, status: 400, error: `${field} must be text` };
  const text = value.trim();
  if (text.length > max) {
    return { ok: false, status: 400, error: `${field} must be ${max} characters or fewer (got ${text.length})` };
  }
  return { ok: true, value: text || null };
}

function rowToTranscript(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    sourceId: safeText(row.source_id, 120),
    state: safeText(row.state, 40),
    reason: safeText(row.reason, 2000),
    language: safeText(row.language, 40),
    model: safeText(row.model, 200),
    durationS: safeNumber(row.duration_s),
    text: typeof row.text === 'string' ? row.text : '',
    segments: Array.isArray(row.segments) ? row.segments : [],
    words: Array.isArray(row.words) ? row.words : [],
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/**
 * Write the transcript for one source, replacing whatever was there.
 *
 * A REPLACEMENT, not a patch: every column is sent every time, so a source
 * re-transcribed after a failure does not keep the old failure's `reason`, and
 * a `failed` run does not leave the last good transcript's text behind it.
 *
 * The upsert needs BOTH halves (CLAUDE.md landmine 15): `on_conflict=` only
 * names the columns; PostgREST merges a conflicting row solely when the
 * `Prefer: resolution=merge-duplicates` header asks it to. Without the header
 * the first transcript for a source inserts and every one after it is a 409.
 * And there is no fallback when the database refuses — the refusal is returned
 * as itself (the blog card template was frozen for two months behind one).
 */
async function upsertTranscript(sourceId, data, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, error: 'transcript data must be an object' };
  }
  const unknown = unknownKeyError(data, TRANSCRIPT_FIELDS);
  if (unknown) return unknown;

  const suppliedState = readField(data, 'state');
  if (!suppliedState.ok) return suppliedState;
  const state = safeText(suppliedState.value, 40);
  if (!TRANSCRIPT_STATES.includes(state)) {
    return { ok: false, status: 400, error: `state must be one of ${TRANSCRIPT_STATES.join(', ')}` };
  }

  const fields = {};
  for (const [key, max] of [['reason', 2000], ['language', 40], ['model', 200]]) {
    const supplied = readField(data, key);
    if (!supplied.ok) return supplied;
    const parsed = optionalText(supplied.value, key, max);
    if (!parsed.ok) return parsed;
    fields[key] = parsed.value;
  }
  // A failure nobody can explain reads as a broken screen (CLAUDE.md landmine
  // 17), so the one state that needs a why must carry one.
  if (state === 'failed' && !fields.reason) {
    return { ok: false, status: 400, error: 'reason is required when state is failed' };
  }

  const suppliedDuration = readField(data, 'durationS');
  if (!suppliedDuration.ok) return suppliedDuration;
  let durationS = null;
  if (suppliedDuration.value !== undefined && suppliedDuration.value !== null) {
    if (!isSeconds(suppliedDuration.value)) {
      return { ok: false, status: 400, error: 'durationS must be a number of seconds' };
    }
    durationS = suppliedDuration.value;
  }

  const suppliedText = readField(data, 'text');
  if (!suppliedText.ok) return suppliedText;
  if (suppliedText.value !== undefined && suppliedText.value !== null && typeof suppliedText.value !== 'string') {
    return { ok: false, status: 400, error: 'text must be text' };
  }
  const text = typeof suppliedText.value === 'string' ? suppliedText.value.trim() : '';

  const suppliedSegments = readField(data, 'segments');
  if (!suppliedSegments.ok) return suppliedSegments;
  const segments = segmentsOrError(suppliedSegments.value);
  if (!segments.ok) return segments;

  const suppliedWords = readField(data, 'words');
  if (!suppliedWords.ok) return suppliedWords;
  const words = wordsOrError(suppliedWords.value);
  if (!words.ok) return words;

  // The source must belong to THIS project. The foreign key alone is satisfied
  // by any source anywhere, so without this project A could file a transcript
  // against project B's recording — stamped A, living under B's source, and
  // deleted when B deletes it. Only a genuine 404 is reported as missing; a
  // database that is down says so as itself (the same rule createSource keeps).
  const owner = await getSourceById(id, scope);
  if (!owner.ok && owner.status !== 404) return owner;
  if (!owner.ok || !owner.data) {
    return { ok: false, status: 404, error: 'That source does not exist in this project' };
  }

  const row = await scopedInsertRow(table(), {
    source_id: owner.data.id,
    state,
    reason: fields.reason,
    language: fields.language,
    model: fields.model,
    duration_s: durationS,
    text,
    segments: segments.value,
    words: words.value,
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: `on_conflict=project_id,source_id&select=${COLUMNS}`,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) {
    return { ok: false, status: 502, error: 'The database accepted the transcript but returned no row' };
  }
  return { ok: true, status: 200, data: rowToTranscript(saved) };
}

/** The transcript of one source, or `data: null` if it has none yet. */
async function getTranscriptBySource(sourceId, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  const query = await scopedListQuery(
    table(),
    `source_id=eq.${encodeURIComponent(id)}&select=${COLUMNS}&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found ? rowToTranscript(found) : null };
}

/**
 * For the Footage screen: the transcript state of each listed source, keyed by
 * source id (lower-cased). A source with no entry has not been transcribed —
 * that is the absence of a row, not a state.
 *
 * Takes the ids first and the scope second, the parent-keyed shape every list
 * here uses. Not a limit: the number of rows is bounded by the ids asked for,
 * and more than MAX_STATE_IDS of those is refused rather than silently cut.
 */
async function listTranscriptStates(sourceIds, scope = null) {
  if (!Array.isArray(sourceIds)) {
    return {
      ok: false,
      status: 400,
      error: 'sourceIds must be an array — listTranscriptStates is (sourceIds, scope)',
    };
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
    `source_id=in.(${list})&select=${STATE_COLUMNS}&limit=${ids.length}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const states = {};
  for (const row of Array.isArray(res.data) ? res.data : []) {
    states[safeText(row.source_id, 120).toLowerCase()] = {
      state: safeText(row.state, 40),
      reason: safeText(row.reason, 2000),
      language: safeText(row.language, 40),
      durationS: safeNumber(row.duration_s),
      updatedAt: row.updated_at || '',
    };
  }
  return { ok: true, status: 200, data: states };
}

/**
 * The recordings in which ALL the query's words were said, newest transcript
 * first — each with the segments that contain any of those words, so the
 * Footage screen can jump straight to the moment.
 *
 * `(query, scope, limit)`: the query leads because it is what is being asked,
 * like the parent id in listSourcesForSession. The limit-first rule (DOCTRINE
 * 5.10) exists so a scope object never lands where a number is read and gets
 * coerced away; both misorderings are refused here instead — an object or a
 * number in the query slot is a 400, and resolveLimit refuses an object in the
 * limit slot.
 *
 * A word nobody said is an empty list, not an error. A blank query is a 400:
 * "search for nothing" is a caller mistake, not a search with no results.
 */
async function searchTranscripts(query, scope = null, limit = 20) {
  if (typeof query !== 'string') {
    return {
      ok: false,
      status: 400,
      error: 'query must be text — searchTranscripts is (query, scope, limit)',
    };
  }
  const bounded = resolveLimit(limit, { fallback: 20, max: 100 });
  if (!bounded.ok) return { ok: false, status: 400, error: bounded.error };
  const words = [...new Set(searchWords(query))];
  if (!words.length) return { ok: false, status: 400, error: 'Type a word to search for' };

  const filter = `search_tsv=plfts(simple).${encodeURIComponent(words.join(' '))}`;
  const listQuery = await scopedListQuery(
    table(),
    `state=eq.done&${filter}&select=source_id,language,duration_s,segments,updated_at`
      + `&order=updated_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query: listQuery });
  if (!res.ok) return res;

  const wanted = new Set(words);
  const results = (Array.isArray(res.data) ? res.data : []).map((row) => {
    const segments = Array.isArray(row.segments) ? row.segments : [];
    return {
      sourceId: safeText(row.source_id, 120),
      language: safeText(row.language, 40),
      durationS: safeNumber(row.duration_s),
      matches: segments
        .filter((segment) => searchWords(segment?.text).some((word) => wanted.has(word)))
        .map((segment) => ({ start: segment.start, end: segment.end, text: segment.text })),
    };
  });
  return { ok: true, status: 200, data: results };
}

module.exports = {
  TRANSCRIPT_STATES,
  TRANSCRIPT_FIELDS,
  MAX_STATE_IDS,
  searchWords,
  segmentsOrError,
  wordsOrError,
  rowToTranscript,
  upsertTranscript,
  getTranscriptBySource,
  listTranscriptStates,
  searchTranscripts,
};
