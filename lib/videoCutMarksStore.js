'use strict';

/**
 * video_cut_marks — what each recording should cut, one row per source file.
 *
 * Table: docs/SQL/video_cut_marks_setup.sql. Reel Spinner 1a (86bcwaw80).
 * workers/studio/cutMarksPass.js (1c) is what calls upsertCutMarks; 1d shows
 * the marks.
 *
 * A cut mark is a DECISION, never an edit: "from 12.40 s to 12.71 s is an
 * 'uh'". Nothing in the pipeline touches video until its last step.
 *
 * "Not looked at yet" is the ABSENCE of a row, never a state. So the reads
 * here answer a miss with `data: null` (or a source missing from the map),
 * not a 404 — that is the ordinary answer, and a 404 would make it travel the
 * same path as the database being down.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedInsertRow } = require('./projectScope');
const { getSourceById } = require('./videoSourcesStore');
const { readField, unknownKeyError } = require('./storeInput');
const { wordsOrError } = require('./videoTranscriptsStore');

/** The two answers the find-the-cuts step can give. A check constraint too. */
const CUT_MARK_STATES = ['done', 'failed'];

/** What a mark can be cutting. */
const MARK_KINDS = ['pause', 'filler', 'repeat', 'false_start'];

const CUT_MARK_FIELDS = [
  'state', 'reason', 'rulesVersion', 'model', 'durationS',
  'verbatimText', 'verbatimWords', 'marks',
];

const COLUMNS = [
  'id', 'project_id', 'owner_user_id', 'source_id', 'state', 'reason', 'rules_version',
  'model', 'duration_s', 'verbatim_text', 'verbatim_words', 'marks', 'cut_s',
  'created_at', 'updated_at',
].join(',');

/** What a list screen needs per source — no transcript, no marks. */
const STATE_COLUMNS = 'source_id,state,reason,rules_version,cut_s,updated_at';

/** listCutMarkStates asks for at most this many sources in one request. */
const MAX_STATE_IDS = 500;

function table() {
  return tableConfig().videoCutMarks;
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function safeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A finite number of seconds, or not. Strict: '1.5' and true are junk. */
function isSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Seconds rounded to the millisecond, so 0.1 + 0.2 does not store 0.30000000000000004. */
function roundSeconds(value) {
  return Math.round(value * 1000) / 1000;
}

/** "marks[2] (filler at 12.4 s)" — enough for a person to find it. */
function markLabel(item, i) {
  const kind = item && typeof item === 'object' && typeof item.kind === 'string' && item.kind
    ? item.kind : 'mark';
  const at = item && typeof item === 'object' && isSeconds(item.start) ? ` at ${item.start} s` : '';
  return `marks[${i}] (${kind}${at})`;
}

/**
 * `[{ start, end, kind, keep_s, words, why }]`, checked mark by mark, or a 400
 * naming the first bad one. Only the declared keys are kept.
 *
 * `keep_s` is how much of the span stays in — a long pause is shortened, not
 * removed — so it must fit inside the span. It defaults to 0 (cut it all).
 */
function marksOrError(value) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'marks must be an array' };
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    const label = markLabel(item, i);
    const refuse = (why) => ({ ok: false, status: 400, error: `${label}: ${why}` });
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return refuse('must be { start, end, kind, keep_s, words, why }');
    }
    if (!isSeconds(item.start) || !isSeconds(item.end)) {
      return refuse('start and end must be numbers of seconds');
    }
    if (item.start >= item.end) {
      return refuse(`start (${item.start} s) must be before end (${item.end} s)`);
    }
    if (!MARK_KINDS.includes(item.kind)) {
      return refuse(`kind ${JSON.stringify(item.kind)} is not one of ${MARK_KINDS.join(', ')}`);
    }
    const keep = item.keep_s === undefined || item.keep_s === null ? 0 : item.keep_s;
    if (!isSeconds(keep)) return refuse('keep_s must be a number of seconds');
    if (keep > item.end - item.start) {
      return refuse(`keep_s (${keep} s) is longer than the mark itself (${roundSeconds(item.end - item.start)} s)`);
    }
    for (const key of ['words', 'why']) {
      if (item[key] !== undefined && item[key] !== null && typeof item[key] !== 'string') {
        return refuse(`${key} must be text`);
      }
    }
    out.push({
      start: item.start,
      end: item.end,
      kind: item.kind,
      keep_s: keep,
      words: typeof item.words === 'string' ? item.words : '',
      why: typeof item.why === 'string' ? item.why : '',
    });
  }
  return { ok: true, value: out };
}

/**
 * Total seconds the marks remove. Derived, never supplied, so the total can
 * never disagree with the marks it totals.
 */
function totalCut(marks) {
  return roundSeconds(marks.reduce((sum, mark) => sum + (mark.end - mark.start - mark.keep_s), 0));
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

function rowToCutMarks(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    sourceId: safeText(row.source_id, 120),
    state: safeText(row.state, 40),
    reason: safeText(row.reason, 2000),
    rulesVersion: safeText(row.rules_version, 200),
    model: safeText(row.model, 200),
    durationS: safeNumber(row.duration_s),
    verbatimText: typeof row.verbatim_text === 'string' ? row.verbatim_text : '',
    verbatimWords: Array.isArray(row.verbatim_words) ? row.verbatim_words : [],
    marks: Array.isArray(row.marks) ? row.marks : [],
    cutS: safeNumber(row.cut_s) ?? 0,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/**
 * Write the cut marks for one source, replacing whatever was there.
 *
 * A REPLACEMENT, not a patch: every column is sent every time, so a source
 * re-checked after a failure does not keep the old failure's `reason`, and a
 * `failed` run does not leave the last good run's marks behind it.
 *
 * The upsert needs BOTH halves (CLAUDE.md landmine 15): `on_conflict=` only
 * names the columns; PostgREST merges a conflicting row solely when the
 * `Prefer: resolution=merge-duplicates` header asks it to. Without the header
 * the first write for a source inserts and every one after it is a 409.
 * And there is no fallback when the database refuses — the refusal is returned
 * as itself.
 */
async function upsertCutMarks(sourceId, data, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, error: 'cut mark data must be an object' };
  }
  const unknown = unknownKeyError(data, CUT_MARK_FIELDS);
  if (unknown) return unknown;

  const suppliedState = readField(data, 'state');
  if (!suppliedState.ok) return suppliedState;
  const state = safeText(suppliedState.value, 40);
  if (!CUT_MARK_STATES.includes(state)) {
    return { ok: false, status: 400, error: `state must be one of ${CUT_MARK_STATES.join(', ')}` };
  }

  const fields = {};
  for (const [key, max] of [['reason', 2000], ['rulesVersion', 200], ['model', 200]]) {
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

  const suppliedText = readField(data, 'verbatimText');
  if (!suppliedText.ok) return suppliedText;
  if (suppliedText.value !== undefined && suppliedText.value !== null && typeof suppliedText.value !== 'string') {
    return { ok: false, status: 400, error: 'verbatimText must be text' };
  }
  const verbatimText = typeof suppliedText.value === 'string' ? suppliedText.value.trim() : '';

  const suppliedWords = readField(data, 'verbatimWords');
  if (!suppliedWords.ok) return suppliedWords;
  const words = wordsOrError(suppliedWords.value);
  if (!words.ok) return { ...words, error: `verbatimWords: ${words.error}` };

  const suppliedMarks = readField(data, 'marks');
  if (!suppliedMarks.ok) return suppliedMarks;
  const marks = marksOrError(suppliedMarks.value);
  if (!marks.ok) return marks;

  // The source must belong to THIS project. The foreign key alone is satisfied
  // by any source anywhere, so without this project A could file marks against
  // project B's recording. Only a genuine 404 is reported as missing; a
  // database that is down says so as itself.
  const owner = await getSourceById(id, scope);
  if (!owner.ok && owner.status !== 404) return owner;
  if (!owner.ok || !owner.data) {
    return { ok: false, status: 404, error: 'That source does not exist in this project' };
  }

  const row = await scopedInsertRow(table(), {
    source_id: owner.data.id,
    state,
    reason: fields.reason,
    rules_version: fields.rulesVersion,
    model: fields.model,
    duration_s: durationS,
    verbatim_text: verbatimText,
    verbatim_words: words.value,
    marks: marks.value,
    cut_s: totalCut(marks.value),
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
    return { ok: false, status: 502, error: 'The database accepted the cut marks but returned no row' };
  }
  return { ok: true, status: 200, data: rowToCutMarks(saved) };
}

/** The cut marks of one source, or `data: null` if it has not been looked at. */
async function getCutMarksBySource(sourceId, scope = null) {
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
  return { ok: true, status: 200, data: found ? rowToCutMarks(found) : null };
}

/**
 * The cut-marks state of each listed source, keyed by source id (lower-cased).
 * A source with no entry has not been looked at — the absence of a row, not a
 * state.
 *
 * `(sourceIds, scope)`, the parent-keyed shape listTranscriptStates uses. More
 * than MAX_STATE_IDS ids is refused rather than silently cut.
 */
async function listCutMarkStates(sourceIds, scope = null) {
  if (!Array.isArray(sourceIds)) {
    return {
      ok: false,
      status: 400,
      error: 'sourceIds must be an array — listCutMarkStates is (sourceIds, scope)',
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
      rulesVersion: safeText(row.rules_version, 200),
      cutS: safeNumber(row.cut_s) ?? 0,
      updatedAt: row.updated_at || '',
    };
  }
  return { ok: true, status: 200, data: states };
}

module.exports = {
  CUT_MARK_STATES,
  MARK_KINDS,
  CUT_MARK_FIELDS,
  MAX_STATE_IDS,
  marksOrError,
  totalCut,
  rowToCutMarks,
  upsertCutMarks,
  getCutMarksBySource,
  listCutMarkStates,
};
