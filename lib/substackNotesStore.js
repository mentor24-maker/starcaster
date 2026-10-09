'use strict';

/**
 * Substack Notes — everything the Notes agent does for an account (a Note of
 * its own, a reply, a restack, a like), one row per action, plus one set of
 * account-wide settings.
 *
 * Tables: docs/SQL/substack_notes_setup.sql. Substack Notes 1/7 (86bcet65t).
 * Nothing drafts or posts yet; later slices read and move what this writes.
 * The shape follows lib/youtubeOutreachStore.js on purpose.
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10). List functions take the limit FIRST (CLAUDE.md landmine 12b).
 *
 * TENANCY FAILS CLOSED HERE, for the same reason as the YouTube outreach store:
 * lib/projectScope.js answers an unscoped query when the scope carries no
 * project or its column probe fails, which is wrong for a brand-new table
 * holding one account's posting plan. `requireScope` refuses both cases.
 *
 * An item's status moves along one path:
 *
 *   idea ─► draft ─► approved ─► posting ─► posted
 *     │       │         │                 └► failed ─► approved (try again)
 *     └───────┴─────────┴─► rejected ─► idea (think again)
 *
 * A restack or a like carries no text, so it skips `draft` and is approved
 * straight from `idea`. A Note or a reply is approved only with words in it.
 */

const { sbQuery, tableConfig } = require('./supabase');
const {
  supportsProjectColumns, scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow,
} = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { readField, unknownKeyError } = require('./storeInput');

const DEFAULT_ACCOUNT = 'dane_of_earth';

/** The choice lists Dane approved on 2026-10-07. The SQL checks the same values. */
const CHOICES = {
  kind: ['note', 'reply', 'restack', 'like'],
  source: ['jotted', 'topic', 'new_content', 'target'],
  status: ['idea', 'draft', 'approved', 'rejected', 'posting', 'posted', 'failed'],
  linkPolicy: ['never', 'if_natural', 'allowed'],
};

/** Where an idea for each kind may come from. Anything else is refused by name. */
const SOURCES_BY_KIND = Object.freeze({
  note: Object.freeze(['jotted', 'topic', 'new_content']),
  reply: Object.freeze(['target']),
  restack: Object.freeze(['target']),
  like: Object.freeze(['target']),
});

/** Which status may follow which. A status "moved" to itself is not a move. */
const STATUS_MOVES = Object.freeze({
  idea: Object.freeze(['draft', 'approved', 'rejected']),
  draft: Object.freeze(['approved', 'rejected']),
  approved: Object.freeze(['posting', 'rejected']),
  rejected: Object.freeze(['idea']),
  posting: Object.freeze(['posted', 'failed']),
  posted: Object.freeze([]),
  failed: Object.freeze(['approved', 'rejected']),
});

/** Kinds that carry words of their own. The others are approved without text. */
const TEXT_KINDS = Object.freeze(['note', 'reply']);

/** The account-wide settings a project starts with. */
const SETTINGS_DEFAULTS = Object.freeze({
  substackUrl: '',
  youtubeChannelId: '',
  maxActionsPerDay: 3,
  minMinutesBetween: 90,
  jitterMinutes: 30,
  activeStartHour: 8,
  activeEndHour: 22,
  timeZone: '',
  voice: '',
  topics: Object.freeze([]),
  avoidWords: Object.freeze([]),
  linkPolicy: 'if_natural',
});

/** Item fields holding text a caller may set. */
const ITEM_TEXT_FIELDS = [
  'ideaText', 'contentUrl', 'contentTitle', 'targetUrl', 'targetText',
  'draftText', 'finalText', 'postedUrl', 'screenshotUrl', 'error',
];
const ITEM_CREATE_FIELDS = ['accountKey', 'kind', 'source', ...ITEM_TEXT_FIELDS];
// kind, source and account are fixed once saved; status moves only along STATUS_MOVES.
const ITEM_UPDATE_FIELDS = [...ITEM_TEXT_FIELDS, 'status'];
const ITEM_LOCKED_FIELDS = ['kind', 'source', 'accountKey', 'account_key'];
const SETTINGS_FIELDS = Object.keys(SETTINGS_DEFAULTS);

/** Bounds. Refused outside them, never clamped: a typo should not save as a guess. */
const MAX_TEXT_LENGTH = 5000;
const MAX_TITLE_LENGTH = 500;
const MAX_ERROR_LENGTH = 2000;
const MAX_VOICE_LENGTH = 4000;
const MAX_LIST_ENTRIES = 200;
const MAX_LIST_ENTRY_LENGTH = 200;
const URL_FIELDS = ['contentUrl', 'postedUrl', 'screenshotUrl'];

const ACCOUNT_KEY_RE = /^[a-z0-9_-]{1,60}$/;
const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
// A Note's own address: substack.com/@handle/note/c-123 (or the older /note/c-123).
const NOTE_PATH_RE = /^\/(?:@[A-Za-z0-9_.-]+\/)?note\/c-\d+\/?$/;

function itemsTable() { return tableConfig().substackNotesItems; }
function settingsTable() { return tableConfig().substackNotesSettings; }

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
    return refuse('No project is selected, so there are no Substack Notes to read or change.');
  }
  const supported = await supportsProjectColumns(table);
  if (!supported) {
    return refuse(
      `The ${table} table is not available with its project columns, so it cannot be read safely. `
      + 'Has docs/SQL/substack_notes_setup.sql been applied to this database?',
      503
    );
  }
  return { ok: true };
}

function accountKeyOrError(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: DEFAULT_ACCOUNT };
  const key = safeText(value, 80);
  if (!ACCOUNT_KEY_RE.test(key)) {
    return refuse(`accountKey "${key}" is not valid — use lowercase letters, numbers, dashes or underscores (for example ${DEFAULT_ACCOUNT})`);
  }
  return { ok: true, value: key };
}

function readAccount(options) {
  return accountKeyOrError(options?.accountKey ?? options?.account_key);
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

/** A web address, or blank. `https` only when `httpsOnly`. */
function webUrlOrError(field, value, { httpsOnly = false } = {}) {
  const text = safeText(value, 2000);
  if (!text) return { ok: true, value: '' };
  let url;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  const allowed = httpsOnly ? ['https:'] : ['https:', 'http:'];
  if (!url || !allowed.includes(url.protocol)) {
    return refuse(`${field} must be a web address starting with https:// — got ${JSON.stringify(text)}`);
  }
  return { ok: true, value: text };
}

/**
 * A link to one Substack Note — `https://substack.com/@name/note/c-12345`.
 * A post, a profile or another site is refused with the reason, because the
 * reply/restack/like the agent later makes is aimed at exactly this address.
 */
function noteUrlOrError(value) {
  const text = safeText(value, 2000);
  if (!text) return { ok: true, value: '' };
  let url;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  const host = url ? url.hostname.toLowerCase() : '';
  if (!url || url.protocol !== 'https:' || (host !== 'substack.com' && host !== 'www.substack.com')) {
    return refuse(`targetUrl must be a link to a Note on substack.com (for example https://substack.com/@name/note/c-12345) — got ${JSON.stringify(text)}`);
  }
  if (!NOTE_PATH_RE.test(url.pathname)) {
    return refuse(`targetUrl is a substack.com link but not to a Note — a Note's address ends /note/c-<number>, got ${JSON.stringify(text)}`);
  }
  return { ok: true, value: `https://substack.com${url.pathname.replace(/\/$/, '')}` };
}

function readItemValue(field, value) {
  switch (field) {
    case 'ideaText':
    case 'targetText':
    case 'draftText':
    case 'finalText':
      return textOrError(field, value, MAX_TEXT_LENGTH);
    case 'contentTitle': return textOrError(field, value, MAX_TITLE_LENGTH);
    case 'error': return textOrError(field, value, MAX_ERROR_LENGTH);
    case 'targetUrl': return noteUrlOrError(value);
    case 'status': return choiceOrError('status', value);
    default:
      if (URL_FIELDS.includes(field)) return webUrlOrError(field, value);
      return refuse(`Unknown field: ${field}`);
  }
}

/** What each kind and source needs before it is worth saving at all. */
function checkItemShape(item) {
  const sources = SOURCES_BY_KIND[item.kind];
  if (!sources.includes(item.source)) {
    return refuse(`source ${item.source} does not fit a ${item.kind} — a ${item.kind} comes from ${sources.join(' or ')}`);
  }
  if (item.source === 'target' && !item.targetUrl) {
    return refuse(`targetUrl is required for a ${item.kind} — paste the link to the Note`);
  }
  if (item.source !== 'target' && item.targetUrl) {
    return refuse('targetUrl is only used for a reply, restack or like');
  }
  if (item.source === 'new_content' && !item.contentUrl) {
    return refuse('contentUrl is required when source is new_content — say which video, article or post the Note is about');
  }
  if ((item.source === 'jotted' || item.source === 'topic') && !item.ideaText) {
    return refuse(`ideaText is required when source is ${item.source} — say what the Note is about`);
  }
  return { ok: true };
}

/**
 * Whether `from` → `to` is allowed for this item as it will be after the
 * update, and what the store stamps alongside it. Returns extra columns.
 */
function checkStatusMove(from, item, scope) {
  const to = item.status;
  if (from === to) return { ok: true, value: {} };
  if (!STATUS_MOVES[from].includes(to)) {
    const next = STATUS_MOVES[from];
    return refuse(`status cannot move from ${from} to ${to} — from ${from} it can go to ${next.length ? next.join(', ') : 'nothing (it is finished)'}`);
  }
  const hasText = Boolean(item.finalText || item.draftText);
  const textKind = TEXT_KINDS.includes(item.kind);
  if (to === 'draft' && !textKind) {
    return refuse(`a ${item.kind} has no text to draft — approve it straight from idea`);
  }
  if (to === 'draft' && !item.draftText) {
    return refuse('draftText is required to move to draft');
  }
  if (to === 'approved' && textKind && !hasText) {
    return refuse(`a ${item.kind} cannot be approved with no text — write a draft first`);
  }
  if (to === 'posted' && !item.postedUrl) {
    return refuse('postedUrl is required to mark it posted — the link is the proof it happened');
  }
  if (to === 'failed' && !item.error) {
    return refuse('error is required to mark it failed — say what went wrong');
  }
  const extra = {};
  if (to === 'approved') {
    extra.approved_by = safeText(scope?.userId || scope?.user_id, 120);
    extra.approved_at = new Date().toISOString();
  }
  if (to === 'rejected' || to === 'idea') {
    extra.approved_by = '';
    extra.approved_at = null;
  }
  if (to === 'posted') extra.posted_at = new Date().toISOString();
  return { ok: true, value: extra };
}

/**
 * Apply `input` over `base` field by field. Used by create (base = blanks) and
 * update (base = the stored item), so one item is judged by one set of rules
 * however it got its values.
 */
function applyItemFields(base, input, fields) {
  const next = { ...base };
  for (const field of fields) {
    const read = readField(input, field);
    if (!read.ok) return read;
    if (!read.present) continue;
    const checked = readItemValue(field, read.value);
    if (!checked.ok) return checked;
    next[field] = checked.value;
  }
  return { ok: true, value: next };
}

function itemTextColumns(item) {
  const row = {};
  for (const field of ITEM_TEXT_FIELDS) row[snake(field)] = item[field];
  return row;
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    accountKey: safeText(row.account_key, 80) || DEFAULT_ACCOUNT,
    kind: row.kind,
    source: row.source,
    ideaText: safeText(row.idea_text, MAX_TEXT_LENGTH),
    contentUrl: safeText(row.content_url),
    contentTitle: safeText(row.content_title, MAX_TITLE_LENGTH),
    targetUrl: safeText(row.target_url),
    targetText: safeText(row.target_text, MAX_TEXT_LENGTH),
    draftText: safeText(row.draft_text, MAX_TEXT_LENGTH),
    finalText: safeText(row.final_text, MAX_TEXT_LENGTH),
    status: row.status,
    approvedBy: safeText(row.approved_by, 120),
    approvedAt: row.approved_at || null,
    postedUrl: safeText(row.posted_url),
    screenshotUrl: safeText(row.screenshot_url),
    postedAt: row.posted_at || null,
    error: safeText(row.error, MAX_ERROR_LENGTH),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

const BLANK_ITEM = Object.freeze(Object.fromEntries(ITEM_TEXT_FIELDS.map((field) => [field, ''])));

/**
 * Save a new action. `kind` is required; `source` defaults to `jotted` for a
 * Note and `target` for everything else. Every item starts as an `idea` —
 * the drafting and approval steps move it on.
 */
async function createItem(input, scope = null) {
  const gate = await requireScope(itemsTable(), scope);
  if (!gate.ok) return gate;

  const unknown = unknownKeyError(input, ITEM_CREATE_FIELDS);
  if (unknown) return unknown;

  const suppliedKind = readField(input, 'kind');
  if (!suppliedKind.ok) return suppliedKind;
  if (!suppliedKind.present) return refuse(`kind is required — one of ${CHOICES.kind.join(', ')}`);
  const kind = choiceOrError('kind', suppliedKind.value);
  if (!kind.ok) return kind;

  const suppliedSource = readField(input, 'source');
  if (!suppliedSource.ok) return suppliedSource;
  const source = suppliedSource.present
    ? choiceOrError('source', suppliedSource.value)
    : { ok: true, value: SOURCES_BY_KIND[kind.value][0] };
  if (!source.ok) return source;

  const suppliedAccount = readField(input, 'accountKey');
  if (!suppliedAccount.ok) return suppliedAccount;
  const account = accountKeyOrError(suppliedAccount.value);
  if (!account.ok) return account;

  const applied = applyItemFields(BLANK_ITEM, input, ITEM_TEXT_FIELDS);
  if (!applied.ok) return applied;
  const item = { ...applied.value, kind: kind.value, source: source.value, status: 'idea' };
  const shape = checkItemShape(item);
  if (!shape.ok) return shape;

  const row = await scopedInsertRow(itemsTable(), {
    account_key: account.value,
    kind: item.kind,
    source: item.source,
    status: 'idea',
    ...itemTextColumns(item),
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: itemsTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!created) return refuse('The item was not saved — the database returned no row.', 500);
  return { ok: true, status: 201, data: rowToItem(created) };
}

async function getItemById(id, scope = null) {
  const gate = await requireScope(itemsTable(), scope);
  if (!gate.ok) return gate;
  const itemId = safeText(id, 120);
  if (!itemId) return refuse('id is required');
  const query = await scopedIdQuery(itemsTable(), `id=eq.${encodeURIComponent(itemId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: itemsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('Item not found in this project', 404);
  return { ok: true, status: 200, data: rowToItem(found) };
}

/**
 * One account's items, newest first, optionally only one kind or status.
 * Limit FIRST, scope second (DOCTRINE 5.10) — resolveLimit refuses a scope in
 * the limit's place.
 */
async function listItems(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(itemsTable(), scope);
  if (!gate.ok) return gate;
  const account = readAccount(options);
  if (!account.ok) return account;

  const filters = [`account_key=eq.${encodeURIComponent(account.value)}`];
  for (const field of ['kind', 'status']) {
    const value = options[field];
    if (value === undefined || value === null || value === '') continue;
    const checked = choiceOrError(field, value);
    if (!checked.ok) return checked;
    filters.push(`${field}=eq.${encodeURIComponent(checked.value)}`);
  }
  const query = await scopedListQuery(
    itemsTable(),
    `${filters.join('&')}&select=*&order=created_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: itemsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToItem) };
}

/**
 * Change an item's text or move its status. The stored item is read first and
 * the patch judged against the WHOLE result, so approving a Note with no words
 * in it, or posting one with no link to prove it, is refused rather than saved.
 */
async function updateItem(id, patch, scope = null) {
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;

  const unknown = unknownKeyError(patch, ITEM_UPDATE_FIELDS);
  if (unknown) {
    const lockedField = Object.keys(patch || {}).find((key) => ITEM_LOCKED_FIELDS.includes(key));
    if (lockedField) {
      return refuse(`${lockedField} cannot be changed on a saved item — make a new one instead`);
    }
    return unknown;
  }
  if (!Object.keys(patch || {}).length) return refuse('Nothing to update');

  const applied = applyItemFields(existing.data, patch, ITEM_UPDATE_FIELDS);
  if (!applied.ok) return applied;
  const next = applied.value;
  const shape = checkItemShape(next);
  if (!shape.ok) return shape;
  const move = checkStatusMove(existing.data.status, next, scope);
  if (!move.ok) return move;

  const body = await scopedPatchRow(itemsTable(), {
    ...itemTextColumns(next),
    status: next.status,
    ...move.value,
    updated_at: new Date().toISOString(),
  }, scope);
  const query = await scopedIdQuery(itemsTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: itemsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('Item not found in this project', 404);
  return { ok: true, status: 200, data: rowToItem(updated) };
}

async function deleteItem(id, scope = null) {
  const gate = await requireScope(itemsTable(), scope);
  if (!gate.ok) return gate;
  const itemId = safeText(id, 120);
  if (!itemId) return refuse('id is required');
  const query = await scopedIdQuery(itemsTable(), `id=eq.${encodeURIComponent(itemId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: itemsTable(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  // An empty representation means the scope filter matched nothing: another
  // project's id, or one already gone. Never a silent success.
  if (!removed) return refuse('Item not found in this project', 404);
  return { ok: true, status: 200, data: rowToItem(removed) };
}

// ── Account-wide settings ──────────────────────────────────────────────────

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToSettings(row, accountKey) {
  if (!row) {
    return {
      id: '',
      accountKey,
      ...SETTINGS_DEFAULTS,
      topics: [],
      avoidWords: [],
      // Not saved yet: these are the defaults, and the screen can say so.
      saved: false,
      updatedAt: '',
      browserCheck: rowToBrowserCheck(null),
    };
  }
  return {
    id: safeText(row.id, 120),
    accountKey: safeText(row.account_key, 80) || accountKey,
    substackUrl: safeText(row.substack_url),
    youtubeChannelId: safeText(row.youtube_channel_id, 40),
    maxActionsPerDay: numberOrNull(row.max_actions_per_day),
    minMinutesBetween: numberOrNull(row.min_minutes_between),
    jitterMinutes: numberOrNull(row.jitter_minutes),
    activeStartHour: numberOrNull(row.active_start_hour),
    activeEndHour: numberOrNull(row.active_end_hour),
    timeZone: safeText(row.time_zone, 80),
    voice: safeText(row.voice, MAX_VOICE_LENGTH),
    topics: Array.isArray(row.topics) ? [...row.topics] : [],
    avoidWords: Array.isArray(row.avoid_words) ? [...row.avoid_words] : [],
    linkPolicy: row.link_policy,
    saved: true,
    updatedAt: row.updated_at || '',
    browserCheck: rowToBrowserCheck(row),
  };
}

// ── What the Mini last found in its Substack browser ───────────────────────
//
// Written once an hour by the posting worker on the Mini (YouTube outreach
// 7/7, task 86bcda6dt — workers/youtube-outreach/health.js) and by nothing
// else (docs/SQL/substack_notes_browser_check.sql). The screen's Save cannot
// send these columns (SETTINGS_FIELDS does not list them), so it can neither
// clear nor fake a reading. Same shape as the YouTube outreach settings row.

const { BROWSER_STATES } = require('./openclawSignIn');

function rowToBrowserCheck(row) {
  const state = safeText(row?.browser_state, 40);
  return {
    // Blank: the Mini has never checked. The screen says so rather than
    // reading the silence as "fine".
    state: BROWSER_STATES.includes(state) ? state : '',
    message: safeText(row?.browser_message, 1000),
    checkedAt: row?.browser_checked_at || null,
    signedInAt: row?.browser_signed_in_at || null,
  };
}

/**
 * Record one browser check onto the account's settings row: patch it when it
 * exists, create it with the default settings when it does not. Only the
 * browser_* columns are written; the settings themselves are never touched.
 */
async function recordBrowserCheck(input, scope = null, options = {}, attempt = 0) {
  const gate = await requireScope(settingsTable(), scope);
  if (!gate.ok) return gate;
  const account = readAccount(options);
  if (!account.ok) return account;
  const state = safeText(input?.state, 40);
  if (!BROWSER_STATES.includes(state)) return refuse(`state must be one of: ${BROWSER_STATES.join(', ')}`);
  const checkedAtMs = Date.parse(safeText(input?.checkedAt, 60));
  if (!Number.isFinite(checkedAtMs)) return refuse('checkedAt is required, as a date and time');
  const checkedAt = new Date(checkedAtMs).toISOString();

  const existing = await readSettingsRow(account.value, scope);
  if (!existing.ok) return existing;

  const columns = {
    browser_state: state,
    browser_message: safeText(input?.message, 1000),
    browser_checked_at: checkedAt,
  };
  // Only a good check moves "last signed in"; a bad one leaves the last good
  // time standing, which is what lets the screen say "signed out since …".
  if (state === 'signed_in') columns.browser_signed_in_at = checkedAt;

  let res;
  if (existing.data) {
    const body = await scopedPatchRow(settingsTable(), columns, scope);
    const query = await scopedIdQuery(settingsTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
    res = await sbQuery({ method: 'PATCH', table: settingsTable(), query, headers: { Prefer: 'return=representation' }, body });
  } else {
    const defaults = {};
    for (const field of SETTINGS_FIELDS) {
      const value = SETTINGS_DEFAULTS[field];
      defaults[snake(field)] = Array.isArray(value) ? [...value] : value;
    }
    const row = await scopedInsertRow(settingsTable(), { account_key: account.value, ...defaults, ...columns }, scope);
    res = await sbQuery({ method: 'POST', table: settingsTable(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
    if (!res.ok && res.status === 409 && attempt === 0) {
      return recordBrowserCheck(input, scope, options, attempt + 1);
    }
  }
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The browser check was not saved — the database returned no row.', 500);
  return { ok: true, status: 200, data: rowToBrowserCheck(saved) };
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

function textListOrError(field, value) {
  if (!Array.isArray(value)) return refuse(`${field} must be a list of words or phrases`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') return refuse(`${field} must contain only text — got ${JSON.stringify(item)}`);
    const text = item.trim();
    if (!text) continue;
    if (text.length > MAX_LIST_ENTRY_LENGTH) {
      return refuse(`${field} entries must be ${MAX_LIST_ENTRY_LENGTH} characters or fewer`);
    }
    if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  if (out.length > MAX_LIST_ENTRIES) return refuse(`${field} can hold at most ${MAX_LIST_ENTRIES} entries`);
  return { ok: true, value: out };
}

function timeZoneOrError(value) {
  const text = safeText(value, 80);
  if (!text) return { ok: true, value: '' };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: text });
  } catch {
    return refuse(`timeZone "${text}" is not a time zone this server knows (for example America/Denver)`);
  }
  return { ok: true, value: text };
}

function readSettingsValue(field, value) {
  switch (field) {
    case 'substackUrl': return webUrlOrError(field, value, { httpsOnly: true });
    case 'youtubeChannelId': {
      const text = safeText(value, 80);
      if (text && !YOUTUBE_CHANNEL_ID_RE.test(text)) {
        return refuse(`youtubeChannelId "${text}" is not a YouTube channel id — it starts with UC and is 24 characters long`);
      }
      return { ok: true, value: text };
    }
    case 'maxActionsPerDay': return integerOrError(field, value, { min: 0, max: 50 });
    case 'minMinutesBetween': return integerOrError(field, value, { min: 0, max: 1440 });
    case 'jitterMinutes': return integerOrError(field, value, { min: 0, max: 1440 });
    case 'activeStartHour': return integerOrError(field, value, { min: 0, max: 23 });
    case 'activeEndHour': return integerOrError(field, value, { min: 1, max: 24 });
    case 'timeZone': return timeZoneOrError(value);
    case 'voice': {
      if (typeof value !== 'string') return refuse('voice must be text');
      const text = value.trim();
      if (text.length > MAX_VOICE_LENGTH) return refuse(`voice must be ${MAX_VOICE_LENGTH} characters or fewer`);
      return { ok: true, value: text };
    }
    case 'topics':
    case 'avoidWords':
      return textListOrError(field, value);
    case 'linkPolicy': return choiceOrError('linkPolicy', value);
    default: return refuse(`Unknown field: ${field}`);
  }
}

async function readSettingsRow(accountKey, scope) {
  const query = await scopedListQuery(
    settingsTable(),
    `account_key=eq.${encodeURIComponent(accountKey)}&select=*&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: settingsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

/** The account's settings — the saved row, or the defaults marked `saved: false`. */
async function getSettings(scope = null, options = {}) {
  const gate = await requireScope(settingsTable(), scope);
  if (!gate.ok) return gate;
  const account = readAccount(options);
  if (!account.ok) return account;
  const found = await readSettingsRow(account.value, scope);
  if (!found.ok) return found;
  return { ok: true, status: 200, data: rowToSettings(found.data, account.value) };
}

/**
 * Save some or all of an account's settings. The first save inserts a row
 * carrying the defaults for anything not supplied; later saves patch it.
 *
 * Read-then-write rather than an upsert, as in the YouTube outreach store: an
 * upsert needs `Prefer: resolution=merge-duplicates` or every save after the
 * first is a 409 (landmine 15), and the test fake does not model upserts, so
 * it could not prove that header was there. Two first saves racing is the one
 * gap, and the unique index turns it into a 409 that is retried once as a
 * patch. A database refusal is returned as-is — there is no fallback.
 */
async function saveSettings(input, scope = null, options = {}, attempt = 0) {
  const gate = await requireScope(settingsTable(), scope);
  if (!gate.ok) return gate;
  const account = readAccount(options);
  if (!account.ok) return account;

  const unknown = unknownKeyError(input, SETTINGS_FIELDS);
  if (unknown) return unknown;

  const existing = await readSettingsRow(account.value, scope);
  if (!existing.ok) return existing;
  const current = rowToSettings(existing.data, account.value);

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
  if (next.activeStartHour >= next.activeEndHour) {
    return refuse(`activeStartHour (${next.activeStartHour}) must be earlier than activeEndHour (${next.activeEndHour})`);
  }

  const columns = {};
  for (const field of SETTINGS_FIELDS) columns[snake(field)] = next[field];
  columns.updated_at = new Date().toISOString();

  let res;
  if (existing.data) {
    const body = await scopedPatchRow(settingsTable(), columns, scope);
    const query = await scopedIdQuery(settingsTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
    res = await sbQuery({ method: 'PATCH', table: settingsTable(), query, headers: { Prefer: 'return=representation' }, body });
  } else {
    const row = await scopedInsertRow(settingsTable(), { account_key: account.value, ...columns }, scope);
    res = await sbQuery({ method: 'POST', table: settingsTable(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
    if (!res.ok && res.status === 409 && attempt === 0) {
      return saveSettings(input, scope, options, attempt + 1);
    }
  }
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The settings were not saved — the database returned no row.', 500);
  return { ok: true, status: existing.data ? 200 : 201, data: rowToSettings(saved, account.value) };
}

module.exports = {
  DEFAULT_ACCOUNT,
  CHOICES,
  SOURCES_BY_KIND,
  STATUS_MOVES,
  SETTINGS_DEFAULTS,
  ITEM_CREATE_FIELDS,
  ITEM_UPDATE_FIELDS,
  SETTINGS_FIELDS,
  createItem,
  getItemById,
  listItems,
  updateItem,
  deleteItem,
  getSettings,
  saveSettings,
  recordBrowserCheck,
  rowToItem,
  rowToSettings,
};
