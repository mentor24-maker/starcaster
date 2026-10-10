'use strict';

/**
 * Substack Miner — the Substack writers Starcaster finds for a project
 * (candidates), and the keyword list it searches on (settings). The Substack
 * twin of the YouTube Miner.
 *
 * Tables: docs/SQL/substack_miner_setup.sql. Substack Miner 1/7 (86bcfprx5).
 * Nothing searches or fetches yet; slices 2/7 and 3/7 fill this, 4/7 reads it.
 * The shape follows lib/substackNotesStore.js on purpose.
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10). List functions take the limit FIRST (CLAUDE.md landmine 12b).
 *
 * TENANCY FAILS CLOSED HERE, for the same reason as the Substack Notes store:
 * lib/projectScope.js answers an unscoped query when the scope carries no
 * project or its column probe fails, which is wrong for a table holding one
 * project's prospects. `requireScope` refuses both cases.
 *
 * A writer is ONE row per project however often it is found. `upsertCandidate`
 * merges a second find into the first: keywords and recommenders are added to
 * the lists rather than replacing them, and Dane's decision (status, his note,
 * the contact made on approval) is never touched by a search. So a writer he
 * approved stays approved, and one he rejected stays rejected, when a later
 * search turns them up again.
 *
 * Dane moves a candidate along one path:
 *
 *   candidate ─► approved ─► rejected ─► candidate (think again)
 *       └──────────────────► rejected
 */

const { sbQuery, tableConfig } = require('./supabase');
const {
  supportsProjectColumns, scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow,
} = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { readField, unknownKeyError } = require('./storeInput');

/** The choice lists. The SQL checks the same values. */
const CHOICES = {
  foundVia: ['seed', 'web_search', 'recommendations', 'notes_search'],
  status: ['candidate', 'approved', 'rejected'],
};

/** Which status may follow which. A status "moved" to itself is not a move. */
const STATUS_MOVES = Object.freeze({
  candidate: Object.freeze(['approved', 'rejected']),
  approved: Object.freeze(['rejected']),
  rejected: Object.freeze(['candidate']),
});

/** The settings a project starts with. */
const SETTINGS_DEFAULTS = Object.freeze({
  keywords: Object.freeze([]),
  maxResultsPerKeyword: 20,
  pauseMsBetweenFetches: 1500,
});

/** What a search (or a hand-added row) may say about a writer. */
const CANDIDATE_FIND_FIELDS = [
  'handle', 'publicationUrl', 'name', 'description', 'subscriberText',
  'keywordsHit', 'foundVia', 'recommendedBy',
];
/** What may be changed on a saved writer. The handle never changes. */
const CANDIDATE_UPDATE_FIELDS = [
  'publicationUrl', 'name', 'description', 'subscriberText', 'note', 'contactId', 'status',
];
const CANDIDATE_LOCKED_FIELDS = ['handle', 'foundVia', 'found_via', 'keywordsHit', 'keywords_hit', 'recommendedBy', 'recommended_by'];
/** One row of a seed list. `whyFit` is stored as the description. */
const IMPORT_ROW_FIELDS = ['handle', 'publicationUrl', 'name', 'description', 'whyFit', 'keywordsHit'];
const SETTINGS_FIELDS = Object.keys(SETTINGS_DEFAULTS);

/** Bounds. Refused outside them, never clamped: a typo should not save as a guess. */
const MAX_NAME_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_SUBSCRIBER_TEXT_LENGTH = 120;
const MAX_NOTE_LENGTH = 1000;
const MAX_LIST_ENTRIES = 200;
const MAX_LIST_ENTRY_LENGTH = 200;
const MAX_IMPORT_ROWS = 500;
/** How many of a writer's Notes are kept, newest first (Substack Miner 5/7). */
const MAX_RECENT_NOTES = 10;
/** How many may be sent in one go — a reading pass sends 3. */
const MAX_NOTES_PER_POST = 20;
const MAX_NOTE_TEXT_LENGTH = 5000;
const RECENT_NOTES_SQL = 'docs/SQL/substack_miner_setup.sql';

// A Substack subdomain: letters, numbers and dashes, not starting or ending with a dash.
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function candidatesTable() { return tableConfig().substackCandidates; }
function settingsTable() { return tableConfig().substackMinerSettings; }

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function snake(key) {
  return key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

/**
 * The tenant boundary, checked before any query is built. See the file header
 * for why this does not lean on projectScope's own fall-through.
 */
async function requireScope(table, scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) {
    return refuse('No project is selected, so there are no Substack Miner writers or settings to read or change.');
  }
  const supported = await supportsProjectColumns(table);
  if (!supported) {
    return refuse(
      `The ${table} table is not available with its project columns, so it cannot be read safely. `
      + 'Has docs/SQL/substack_miner_setup.sql been applied to this database?',
      503
    );
  }
  return { ok: true };
}

function choiceOrError(field, value) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (!CHOICES[field].includes(text)) {
    return refuse(`${field} must be one of ${CHOICES[field].join(', ')} — got ${JSON.stringify(value)}`);
  }
  return { ok: true, value: text };
}

function textOrError(field, value, max) {
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string') return refuse(`${field} must be text`);
  const text = value.trim();
  if (text.length > max) return refuse(`${field} must be ${max} characters or fewer`);
  return { ok: true, value: text };
}

function parseUrl(text) {
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/**
 * A Substack handle — the part before `.substack.com` — from a bare handle,
 * `@handle`, `handle.substack.com` or the publication's full address.
 * Refused with the reason when the text names something else: a person's
 * substack.com/@name profile is not a publication, and a custom domain does
 * not say which handle it belongs to.
 */
function handleOrError(value, field = 'handle') {
  if (typeof value !== 'string') return refuse(`${field} must be text — the part before .substack.com`);
  const text = value.trim();
  if (!text) return refuse(`${field} is required — the part before .substack.com`);
  let handle = text;
  if (/^https?:\/\//i.test(text) || text.includes('/') || /\.[a-z]{2,}$/i.test(text)) {
    const url = parseUrl(text);
    const host = url ? url.hostname.toLowerCase().replace(/^www\./, '') : '';
    if (host === 'substack.com') {
      return refuse(`${field} ${JSON.stringify(text)} is a substack.com profile link, which names a person rather than a publication — use the publication's address (https://name.substack.com)`);
    }
    if (!host.endsWith('.substack.com')) {
      return refuse(`${field} ${JSON.stringify(text)} is not a substack.com address — for a publication on its own domain, give its handle separately`);
    }
    handle = host.slice(0, -'.substack.com'.length);
  }
  handle = handle.replace(/^@+/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return refuse(`${field} ${JSON.stringify(text)} is not a Substack handle — letters, numbers and dashes only, as in https://name.substack.com`);
  }
  return { ok: true, value: handle };
}

/** A publication's web address, https only, or blank. */
function publicationUrlOrError(value) {
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string') return refuse('publicationUrl must be text');
  const text = value.trim();
  if (!text) return { ok: true, value: '' };
  let url;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:') {
    return refuse(`publicationUrl must be a web address starting with https:// — got ${JSON.stringify(text)}`);
  }
  return { ok: true, value: text.replace(/\/+$/, '') };
}

/** A list of words or phrases, trimmed, blank entries dropped, repeats (any case) dropped. */
function textListOrError(field, value, { normalize = null } = {}) {
  if (value === null || value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return refuse(`${field} must be a list`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') return refuse(`${field} must contain only text — got ${JSON.stringify(item)}`);
    let text = item.trim();
    if (!text) continue;
    if (text.length > MAX_LIST_ENTRY_LENGTH) {
      return refuse(`${field} entries must be ${MAX_LIST_ENTRY_LENGTH} characters or fewer`);
    }
    if (normalize) {
      const checked = normalize(text);
      if (!checked.ok) return checked;
      text = checked.value;
    }
    if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  if (out.length > MAX_LIST_ENTRIES) return refuse(`${field} can hold at most ${MAX_LIST_ENTRIES} entries`);
  return { ok: true, value: out };
}

/** `base` with every entry of `extra` it does not already have (any case), in order. */
function mergeList(base, extra) {
  const out = Array.isArray(base) ? [...base] : [];
  for (const item of extra || []) {
    if (!out.some((existing) => String(existing).toLowerCase() === String(item).toLowerCase())) out.push(item);
  }
  return out.slice(0, MAX_LIST_ENTRIES);
}

function readCandidateValue(field, value) {
  switch (field) {
    case 'handle': return handleOrError(value);
    case 'publicationUrl': return publicationUrlOrError(value);
    case 'name': return textOrError(field, value, MAX_NAME_LENGTH);
    case 'description': return textOrError(field, value, MAX_DESCRIPTION_LENGTH);
    case 'subscriberText': return textOrError(field, value, MAX_SUBSCRIBER_TEXT_LENGTH);
    case 'note': return textOrError(field, value, MAX_NOTE_LENGTH);
    case 'contactId': return textOrError(field, value, 120);
    case 'keywordsHit': return textListOrError(field, value);
    case 'recommendedBy': return textListOrError(field, value, { normalize: (text) => handleOrError(text, 'recommendedBy') });
    case 'foundVia': return choiceOrError('foundVia', value);
    case 'status': return choiceOrError('status', value);
    default: return refuse(`Unknown field: ${field}`);
  }
}

/** Read `fields` from `input`, each checked; absent fields are left out. */
function readFields(input, fields) {
  const out = {};
  for (const field of fields) {
    const read = readField(input, field);
    if (!read.ok) return read;
    if (!read.present) continue;
    const checked = readCandidateValue(field, read.value);
    if (!checked.ok) return checked;
    out[field] = checked.value;
  }
  return { ok: true, value: out };
}

function rowToCandidate(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    handle: safeText(row.handle, 80),
    publicationUrl: safeText(row.publication_url),
    name: safeText(row.name, MAX_NAME_LENGTH),
    description: safeText(row.description, MAX_DESCRIPTION_LENGTH),
    subscriberText: safeText(row.subscriber_text, MAX_SUBSCRIBER_TEXT_LENGTH),
    keywordsHit: Array.isArray(row.keywords_hit) ? [...row.keywords_hit] : [],
    foundVia: row.found_via,
    recommendedBy: Array.isArray(row.recommended_by) ? [...row.recommended_by] : [],
    lastSeenAt: row.last_seen_at || null,
    status: row.status,
    contactId: safeText(row.contact_id, 120),
    note: safeText(row.note, MAX_NOTE_LENGTH),
    recentNotes: Array.isArray(row.recent_notes) ? row.recent_notes.map((n) => ({ ...n })) : [],
    lastNotesReadAt: row.last_notes_read_at || null,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

async function readCandidateByHandle(handle, scope) {
  const query = await scopedListQuery(
    candidatesTable(),
    `handle=eq.${encodeURIComponent(handle)}&select=*&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: candidatesTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

/**
 * Record a writer someone or something found. A writer new to this project is
 * added as a `candidate` (201); one already here is MERGED (200): its keyword
 * and recommender lists gain the new entries, its name, description,
 * subscriber wording and address take any new non-blank value, and
 * `last_seen_at` moves to now. `found_via` keeps how it was FIRST found, and
 * Dane's own fields — status, note, contact — are never touched, so a search
 * can never downgrade a writer he approved.
 *
 * Read-then-write rather than a database upsert: the lists have to be merged,
 * which `resolution=merge-duplicates` would REPLACE. Two first finds racing is
 * the one gap, and the unique index turns it into a 409 that is retried once
 * as a merge. A database refusal is returned as-is — there is no fallback.
 */
async function upsertCandidate(input, scope = null, attempt = 0) {
  const gate = await requireScope(candidatesTable(), scope);
  if (!gate.ok) return gate;

  const unknown = unknownKeyError(input, CANDIDATE_FIND_FIELDS);
  if (unknown) {
    const decision = Object.keys(input || {}).find((key) => ['status', 'note', 'contactId', 'contact_id'].includes(key));
    if (decision) return refuse(`${decision} is Dane's decision, set on a saved writer with an update — a find cannot carry it`);
    return unknown;
  }

  const read = readFields(input, CANDIDATE_FIND_FIELDS);
  if (!read.ok) return read;
  const found = read.value;

  if (!found.handle && found.publicationUrl) {
    const derived = handleOrError(found.publicationUrl, 'publicationUrl');
    if (!derived.ok) return refuse(`handle is required — ${derived.error}`);
    found.handle = derived.value;
  }
  if (!found.handle) return refuse('handle is required — the part before .substack.com');

  const existing = await readCandidateByHandle(found.handle, scope);
  if (!existing.ok) return existing;
  const now = new Date().toISOString();

  let res;
  if (existing.data) {
    const current = rowToCandidate(existing.data);
    const columns = {
      keywords_hit: mergeList(current.keywordsHit, found.keywordsHit),
      recommended_by: mergeList(current.recommendedBy, found.recommendedBy),
      last_seen_at: now,
      updated_at: now,
    };
    for (const field of ['publicationUrl', 'name', 'description', 'subscriberText']) {
      if (found[field]) columns[snake(field)] = found[field];
    }
    const body = await scopedPatchRow(candidatesTable(), columns, scope);
    const query = await scopedIdQuery(candidatesTable(), `id=eq.${encodeURIComponent(current.id)}&select=*`, scope);
    res = await sbQuery({ method: 'PATCH', table: candidatesTable(), query, headers: { Prefer: 'return=representation' }, body });
  } else {
    const row = await scopedInsertRow(candidatesTable(), {
      handle: found.handle,
      publication_url: found.publicationUrl || `https://${found.handle}.substack.com`,
      name: found.name || '',
      description: found.description || '',
      subscriber_text: found.subscriberText || '',
      keywords_hit: found.keywordsHit || [],
      found_via: found.foundVia || 'seed',
      recommended_by: found.recommendedBy || [],
      last_seen_at: now,
      status: 'candidate',
    }, scope);
    res = await sbQuery({ method: 'POST', table: candidatesTable(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
    if (!res.ok && res.status === 409 && attempt === 0) {
      return upsertCandidate(input, scope, attempt + 1);
    }
  }
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The writer was not saved — the database returned no row.', 500);
  return { ok: true, status: existing.data ? 200 : 201, data: rowToCandidate(saved) };
}

/**
 * Add a seed list of writers, each as `found_via: seed`. Every row is judged
 * on its own: a bad row is refused and NAMED (its position and why) while the
 * good ones are saved, and the answer counts all three outcomes so nothing in
 * the list goes unaccounted for.
 */
async function importCandidates(rows, scope = null) {
  const gate = await requireScope(candidatesTable(), scope);
  if (!gate.ok) return gate;
  if (!Array.isArray(rows)) return refuse('candidates must be a list of writers');
  if (!rows.length) return refuse('candidates is empty — there is nothing to import');
  if (rows.length > MAX_IMPORT_ROWS) {
    return refuse(`candidates can hold at most ${MAX_IMPORT_ROWS} writers per import — got ${rows.length}`);
  }

  const result = { added: 0, merged: 0, refused: 0, refusals: [] };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const label = row && typeof row === 'object' ? safeText(row.handle || row.publicationUrl, 120) : '';
    const fail = (error) => {
      result.refused += 1;
      result.refusals.push({ index, handle: label, error });
    };
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fail('each writer must be an object like { handle, publicationUrl, name, whyFit, keywordsHit }');
      continue;
    }
    const unknown = unknownKeyError(row, IMPORT_ROW_FIELDS);
    if (unknown) {
      fail(unknown.error);
      continue;
    }
    const { whyFit, why_fit: whyFitSnake, ...rest } = row;
    const why = whyFit !== undefined ? whyFit : whyFitSnake;
    const find = { ...rest, foundVia: 'seed' };
    if (why !== undefined && find.description === undefined) find.description = why;
    const saved = await upsertCandidate(find, scope);
    if (!saved.ok) {
      // A tenancy or database failure is not one row's fault: stop and say so,
      // rather than refusing every remaining row with the same message.
      if (saved.status !== 400) return saved;
      fail(saved.error);
      continue;
    }
    if (saved.status === 201) result.added += 1;
    else result.merged += 1;
  }
  return { ok: true, status: 200, data: result };
}

async function getCandidateById(id, scope = null) {
  const gate = await requireScope(candidatesTable(), scope);
  if (!gate.ok) return gate;
  const candidateId = safeText(id, 120);
  if (!candidateId) return refuse('id is required');
  const query = await scopedIdQuery(candidatesTable(), `id=eq.${encodeURIComponent(candidateId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: candidatesTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('Writer not found in this project', 404);
  return { ok: true, status: 200, data: rowToCandidate(found) };
}

/**
 * The project's writers, most recently seen first, optionally one status or
 * one way of finding. Limit FIRST, scope second (DOCTRINE 5.10) — resolveLimit
 * refuses a scope in the limit's place.
 */
async function listCandidates(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(candidatesTable(), scope);
  if (!gate.ok) return gate;

  const filters = [];
  for (const [field, column] of [['status', 'status'], ['foundVia', 'found_via']]) {
    const value = options[field];
    if (value === undefined || value === null || value === '') continue;
    const checked = choiceOrError(field, value);
    if (!checked.ok) return checked;
    filters.push(`${column}=eq.${encodeURIComponent(checked.value)}`);
  }
  filters.push('select=*', 'order=last_seen_at.desc', `limit=${bounded.limit}`);
  const query = await scopedListQuery(candidatesTable(), filters.join('&'), scope);
  const res = await sbQuery({ method: 'GET', table: candidatesTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToCandidate) };
}

/**
 * Change a saved writer's details or move its status. The handle, how it was
 * found, and the keyword and recommender lists belong to the finds and are
 * refused here by name.
 */
async function updateCandidate(id, patch, scope = null) {
  const existing = await getCandidateById(id, scope);
  if (!existing.ok) return existing;

  const unknown = unknownKeyError(patch, CANDIDATE_UPDATE_FIELDS);
  if (unknown) {
    const lockedField = Object.keys(patch || {}).find((key) => CANDIDATE_LOCKED_FIELDS.includes(key));
    if (lockedField) return refuse(`${lockedField} cannot be changed on a saved writer — it is set by the searches that find them`);
    return unknown;
  }
  if (!Object.keys(patch || {}).length) return refuse('Nothing to update');

  const read = readFields(patch, CANDIDATE_UPDATE_FIELDS);
  if (!read.ok) return read;
  const next = read.value;

  const from = existing.data.status;
  if (next.status && next.status !== from && !STATUS_MOVES[from].includes(next.status)) {
    return refuse(`status cannot move from ${from} to ${next.status} — from ${from} it can go to ${STATUS_MOVES[from].join(', ')}`);
  }

  const columns = { updated_at: new Date().toISOString() };
  for (const field of CANDIDATE_UPDATE_FIELDS) {
    if (next[field] !== undefined) columns[snake(field)] = next[field];
  }
  const body = await scopedPatchRow(candidatesTable(), columns, scope);
  const query = await scopedIdQuery(candidatesTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
  const res = await sbQuery({ method: 'PATCH', table: candidatesTable(), query, headers: { Prefer: 'return=representation' }, body });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('Writer not found in this project', 404);
  return { ok: true, status: 200, data: rowToCandidate(updated) };
}

// ── A writer's newest Notes (Substack Miner 5/7, task 86bcfpry0) ───────────

/**
 * Check a list of Notes as sent: `[{ url, text, postedAt }]`. Each link must
 * be a Substack Note's own address, and is stored in the one shape the
 * Substack Notes store keeps (lib/substackNotesStore.js normalizeNoteUrl), so
 * the "already lined up?" question compares like with like. A link sent twice
 * in one list is kept once.
 */
function notesListOrError(value) {
  if (!Array.isArray(value)) return refuse('notes must be a list like [{ "url", "text", "postedAt" }]');
  if (value.length > MAX_NOTES_PER_POST) return refuse(`notes can hold at most ${MAX_NOTES_PER_POST} Notes at a time — got ${value.length}`);
  const { normalizeNoteUrl } = require('./substackNotesStore');
  const out = [];
  for (let index = 0; index < value.length; index += 1) {
    const note = value[index];
    const where = `notes[${index}]`;
    if (!note || typeof note !== 'object' || Array.isArray(note)) return refuse(`${where} must be an object like { "url", "text", "postedAt" }`);
    const unknown = unknownKeyError(note, ['url', 'text', 'postedAt']);
    if (unknown) return refuse(`${where}: ${unknown.error}`);
    const url = normalizeNoteUrl(note.url);
    if (!url.ok) return refuse(`${where}.url: ${url.error.replace(/^targetUrl /, '')}`);
    if (!url.value) return refuse(`${where}.url is required — the Note's own link, ending /note/c-<number>`);
    if (note.text !== undefined && note.text !== null && typeof note.text !== 'string') return refuse(`${where}.text must be text`);
    const text = safeText(note.text, MAX_NOTE_TEXT_LENGTH);
    const postedMs = Date.parse(safeText(note.postedAt, 60));
    if (!Number.isFinite(postedMs)) return refuse(`${where}.postedAt must be a date and time — got ${JSON.stringify(note.postedAt)}`);
    if (out.some((n) => n.url === url.value)) continue;
    out.push({ url: url.value, text, postedAt: new Date(postedMs).toISOString() });
  }
  return { ok: true, value: out };
}

/**
 * Newest first by postedAt; ties keep the order given. A Note with no date (one
 * a Notes search found, 6/7) sorts after every dated one — a NaN in the
 * comparison would otherwise leave the order up to the sort.
 */
function newestFirst(notes) {
  const when = (n) => {
    const ms = Date.parse(n.postedAt);
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  return notes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (when(b.n) === when(a.n) ? a.i - b.i : (when(b.n) > when(a.n) ? 1 : -1)))
    .map(({ n }) => n);
}

/**
 * Store what a reading pass found on one writer's Notes. The new Notes are
 * merged into the ones already kept (a link already here takes the new text),
 * newest first, at most MAX_RECENT_NOTES, and `last_notes_read_at` moves to
 * now — an empty list included, because "read, and they have posted nothing"
 * is a reading too, and is what lets the pass skip them for a week.
 *
 * Answers `{ ok, status, data: { candidate, notes } }` where `notes` is the
 * checked list as sent, newest first, for the caller to line up.
 */
async function recordRecentNotes(id, notes, scope = null, options = {}) {
  const existing = await getCandidateById(id, scope);
  if (!existing.ok) return existing;
  const checked = notesListOrError(notes);
  if (!checked.ok) return checked;
  const sent = newestFirst(checked.value);

  const kept = existing.data.recentNotes.filter((old) => !sent.some((n) => n.url === old.url));
  const merged = newestFirst([...sent, ...kept]).slice(0, MAX_RECENT_NOTES);
  const now = options.now ? new Date(options.now) : new Date();
  const columns = {
    recent_notes: merged,
    last_notes_read_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  const body = await scopedPatchRow(candidatesTable(), columns, scope);
  const query = await scopedIdQuery(candidatesTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
  const res = await sbQuery({ method: 'PATCH', table: candidatesTable(), query, headers: { Prefer: 'return=representation' }, body });
  if (!res.ok) {
    // The likeliest cause in a fresh database is the two columns not added yet.
    if (/recent_notes|last_notes_read_at/i.test(String(res.error || ''))) {
      return { ...res, error: `${res.error} — has the Substack Miner 5/7 part of ${RECENT_NOTES_SQL} been applied to this database?` };
    }
    return res;
  }
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('Writer not found in this project', 404);
  return { ok: true, status: 200, data: { candidate: rowToCandidate(updated), notes: sent } };
}

// ── Notes that surfaced a writer in a search (Substack Miner 6/7, 86bcfpry2) ─

/** How much of a found Note is kept — the first 300 characters, as the ticket asks. */
const MAX_FOUND_NOTE_TEXT_LENGTH = 300;

/**
 * Keep the Notes a Notes search found a writer by, as evidence for Dane.
 * Each is stored on `recent_notes` as `{ url, text, postedAt: '', keyword,
 * foundBy: 'notes_search', foundAt }` — `postedAt` blank because the search
 * page shows no date it is safe to read as one. A Note whose link is already
 * kept is left alone, so the same search sent twice stores nothing new.
 *
 * Unlike recordRecentNotes this does NOT move `last_notes_read_at`: finding a
 * Note in a search is not reading the writer's Notes, and stamping it would
 * make the 5/7 reading pass skip a newly approved writer for a week.
 *
 * `notes` is `[{ url, text }]`; answers `{ ok, status, data: { candidate, stored } }`.
 */
async function recordFoundNotes(id, notes, keyword, scope = null, options = {}) {
  const existing = await getCandidateById(id, scope);
  if (!existing.ok) return existing;
  const word = safeText(keyword, MAX_LIST_ENTRY_LENGTH);
  if (!word) return refuse('keyword is required — the keyword whose search found these Notes');
  if (!Array.isArray(notes)) return refuse('notes must be a list like [{ "url", "text" }]');
  const { normalizeNoteUrl } = require('./substackNotesStore');
  const now = (options.now ? new Date(options.now) : new Date()).toISOString();

  const kept = existing.data.recentNotes;
  const fresh = [];
  for (const note of notes) {
    const url = normalizeNoteUrl(note?.url);
    if (!url.ok || !url.value) continue;
    if (kept.some((n) => n.url === url.value) || fresh.some((n) => n.url === url.value)) continue;
    fresh.push({
      url: url.value,
      text: safeText(note.text, MAX_FOUND_NOTE_TEXT_LENGTH),
      postedAt: '',
      keyword: word,
      foundBy: 'notes_search',
      foundAt: now,
    });
  }
  if (!fresh.length) return { ok: true, status: 200, data: { candidate: existing.data, stored: 0 } };

  // Found Notes go in front of what is kept; the list stays at MAX_RECENT_NOTES.
  const columns = { recent_notes: [...fresh, ...kept].slice(0, MAX_RECENT_NOTES), updated_at: now };
  const body = await scopedPatchRow(candidatesTable(), columns, scope);
  const query = await scopedIdQuery(candidatesTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
  const res = await sbQuery({ method: 'PATCH', table: candidatesTable(), query, headers: { Prefer: 'return=representation' }, body });
  if (!res.ok) {
    if (/recent_notes/i.test(String(res.error || ''))) {
      return { ...res, error: `${res.error} — has the Substack Miner 5/7 part of ${RECENT_NOTES_SQL} been applied to this database?` };
    }
    return res;
  }
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('Writer not found in this project', 404);
  return { ok: true, status: 200, data: { candidate: rowToCandidate(updated), stored: fresh.length } };
}

// ── Settings ───────────────────────────────────────────────────────────────

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToSettings(row) {
  if (!row) {
    return {
      id: '',
      ...SETTINGS_DEFAULTS,
      keywords: [],
      // Not saved yet: these are the defaults, and the screen can say so.
      saved: false,
      updatedAt: '',
    };
  }
  return {
    id: safeText(row.id, 120),
    keywords: Array.isArray(row.keywords) ? [...row.keywords] : [],
    maxResultsPerKeyword: numberOrNull(row.max_results_per_keyword),
    pauseMsBetweenFetches: numberOrNull(row.pause_ms_between_fetches),
    saved: true,
    updatedAt: row.updated_at || '',
  };
}

/** A whole number in [min, max]. */
function integerOrError(field, value, { min, max }) {
  if (value === undefined || value === null || value === '') return refuse(`${field} is required`);
  const parsed = typeof value === 'string' && value.trim() ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    return refuse(`${field} must be a whole number — got ${JSON.stringify(value)}`);
  }
  if (parsed < min || parsed > max) {
    return refuse(`${field} must be between ${min} and ${max} — got ${parsed}`);
  }
  return { ok: true, value: parsed };
}

function readSettingsValue(field, value) {
  switch (field) {
    case 'keywords': return textListOrError(field, value);
    case 'maxResultsPerKeyword': return integerOrError(field, value, { min: 1, max: 100 });
    case 'pauseMsBetweenFetches': return integerOrError(field, value, { min: 0, max: 60000 });
    default: return refuse(`Unknown field: ${field}`);
  }
}

async function readSettingsRow(scope) {
  const query = await scopedListQuery(settingsTable(), 'select=*&limit=1', scope);
  const res = await sbQuery({ method: 'GET', table: settingsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

/** The project's settings — the saved row, or the defaults marked `saved: false`. */
async function getSettings(scope = null) {
  const gate = await requireScope(settingsTable(), scope);
  if (!gate.ok) return gate;
  const found = await readSettingsRow(scope);
  if (!found.ok) return found;
  return { ok: true, status: 200, data: rowToSettings(found.data) };
}

/**
 * Save some or all of the project's settings. The first save inserts a row
 * carrying the defaults for anything not supplied; later saves patch it.
 * Read-then-write for the same reasons as lib/substackNotesStore.js
 * saveSettings (landmine 15): a 409 from two first saves racing is retried
 * once as a patch, and a database refusal is returned as-is.
 */
async function saveSettings(input, scope = null, attempt = 0) {
  const gate = await requireScope(settingsTable(), scope);
  if (!gate.ok) return gate;

  const unknown = unknownKeyError(input, SETTINGS_FIELDS);
  if (unknown) return unknown;

  const existing = await readSettingsRow(scope);
  if (!existing.ok) return existing;
  const current = rowToSettings(existing.data);

  const next = {};
  for (const field of SETTINGS_FIELDS) next[field] = current[field];
  let changed = 0;
  for (const field of SETTINGS_FIELDS) {
    const read = readField(input, field);
    if (!read.ok) return read;
    if (!read.present) continue;
    const checked = readSettingsValue(field, read.value);
    if (!checked.ok) return checked;
    next[field] = checked.value;
    changed += 1;
  }
  if (!changed) return refuse('Nothing to save');

  const columns = {};
  for (const field of SETTINGS_FIELDS) columns[snake(field)] = next[field];
  columns.updated_at = new Date().toISOString();

  let res;
  if (existing.data) {
    const body = await scopedPatchRow(settingsTable(), columns, scope);
    const query = await scopedIdQuery(settingsTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
    res = await sbQuery({ method: 'PATCH', table: settingsTable(), query, headers: { Prefer: 'return=representation' }, body });
  } else {
    const row = await scopedInsertRow(settingsTable(), columns, scope);
    res = await sbQuery({ method: 'POST', table: settingsTable(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
    if (!res.ok && res.status === 409 && attempt === 0) {
      return saveSettings(input, scope, attempt + 1);
    }
  }
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The settings were not saved — the database returned no row.', 500);
  return { ok: true, status: existing.data ? 200 : 201, data: rowToSettings(saved) };
}

module.exports = {
  CHOICES,
  STATUS_MOVES,
  SETTINGS_DEFAULTS,
  CANDIDATE_FIND_FIELDS,
  CANDIDATE_UPDATE_FIELDS,
  IMPORT_ROW_FIELDS,
  SETTINGS_FIELDS,
  MAX_IMPORT_ROWS,
  MAX_RECENT_NOTES,
  handleOrError,
  upsertCandidate,
  importCandidates,
  getCandidateById,
  listCandidates,
  updateCandidate,
  recordRecentNotes,
  recordFoundNotes,
  MAX_FOUND_NOTE_TEXT_LENGTH,
  notesListOrError,
  getSettings,
  saveSettings,
  rowToCandidate,
  rowToSettings,
};
