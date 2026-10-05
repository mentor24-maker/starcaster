'use strict';

/**
 * YouTube outreach — the list of videos the outreach agent should comment on,
 * each with its own comment settings, plus one set of account-wide limits.
 *
 * Tables: docs/SQL/youtube_outreach_setup.sql. YouTube outreach 1/7 (86bcda5vb).
 * Nothing drafts or posts a comment yet; later slices read what this writes.
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10). List functions take the limit FIRST (CLAUDE.md landmine 12b).
 *
 * TENANCY FAILS CLOSED HERE. lib/projectScope.js answers an unscoped query when
 * the scope carries no project, or when its column probe fails (the migration
 * not applied yet, a cold start) — the right call for older tables whose rows
 * predate tenancy, and the wrong one for a brand-new table holding one client's
 * outreach plan. So every entry point here refuses without a project, and
 * refuses when the probe cannot confirm the tenant columns, rather than reading
 * every project's rows. `requireScope` is that one check.
 */

const { sbQuery, tableConfig } = require('./supabase');
const {
  supportsProjectColumns, scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow,
} = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { readField, unknownKeyError, timestampOrError } = require('./storeInput');
const { resolveYoutubeApiKey } = require('./acquire/youtubeApiKey');
const { ytFetch } = require('./acquire/YoutubeCommentsRun');
const { extractYoutubeVideoId } = require('./acquire/YoutubeVideosStore');

const DEFAULT_ACCOUNT = 'dane_of_earth';

/** The choice lists Dane approved on 2026-10-05. The SQL checks the same values. */
const CHOICES = {
  source: ['manual', 'search', 'own_channel'],
  objective: ['join_conversation', 'awareness', 'drive_link', 'appreciation', 'answer_question'],
  commentPlacement: ['top_level', 'reply_top_comment', 'reply_specific'],
  messageTypes: ['insight', 'question', 'story', 'appreciation', 'mention_work'],
  commentLength: ['short', 'medium', 'long'],
  linkPolicy: ['never', 'if_natural', 'allowed'],
  mentionPolicy: ['never', 'subtle', 'open'],
  repeatMode: ['once', 'repeat'],
  priority: ['high', 'normal', 'low'],
  status: ['active', 'paused', 'done'],
};

/** What a target gets when the caller supplies nothing but a link. */
const TARGET_DEFAULTS = Object.freeze({
  source: 'manual',
  objective: 'join_conversation',
  commentPlacement: 'top_level',
  replyToCommentId: '',
  messageTypes: Object.freeze(['insight', 'question']),
  commentLength: 'medium',
  linkPolicy: 'never',
  linkUrl: '',
  mentionPolicy: 'never',
  repeatMode: 'once',
  repeatEveryDays: null,
  repeatMaxTimes: null,
  repeatUntil: null,
  priority: 'normal',
  notes: '',
  status: 'active',
});

/** The account-wide limits a project starts with. */
const SETTINGS_DEFAULTS = Object.freeze({
  maxCommentsPerDay: 10,
  minMinutesBetween: 45,
  jitterMinutes: 15,
  activeStartHour: 8,
  activeEndHour: 22,
  timeZone: '',
  oneCommentPerVideo: true,
  avoidChannels: Object.freeze([]),
  avoidWords: Object.freeze([]),
  voice: '',
});

/** Settings a target carries that a caller may set, create and update alike. */
const TARGET_SETTING_FIELDS = Object.keys(TARGET_DEFAULTS);
const TARGET_CREATE_FIELDS = ['videoUrl', 'accountKey', ...TARGET_SETTING_FIELDS];
const TARGET_UPDATE_FIELDS = [...TARGET_SETTING_FIELDS];
const SETTINGS_FIELDS = Object.keys(SETTINGS_DEFAULTS);

/** Bounds on the numbers. Refused outside them, never clamped: a typo should not save as a guess. */
const REPEAT_EVERY_DAYS_MAX = 365;
const REPEAT_MAX_TIMES_MAX = 100;
const MAX_NOTES_LENGTH = 4000;
const MAX_VOICE_LENGTH = 4000;
const MAX_AVOID_ENTRIES = 200;
const MAX_AVOID_ENTRY_LENGTH = 200;

const ACCOUNT_KEY_RE = /^[a-z0-9_-]{1,60}$/;
const COMMENT_ID_RE = /^[A-Za-z0-9_.-]{1,200}$/;

function targetsTable() { return tableConfig().youtubeOutreachTargets; }
function settingsTable() { return tableConfig().youtubeOutreachSettings; }

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
    return refuse('No project is selected, so there is no outreach list to read or change.');
  }
  const supported = await supportsProjectColumns(table);
  if (!supported) {
    return refuse(
      `The ${table} table is not available with its project columns, so it cannot be read safely. `
      + 'Has docs/SQL/youtube_outreach_setup.sql been applied to this database?',
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

function choiceOrError(field, value) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (!CHOICES[field].includes(text)) {
    return refuse(`${field} must be one of ${CHOICES[field].join(', ')} — got ${JSON.stringify(value)}`);
  }
  return { ok: true, value: text };
}

/** A whole number in [min, max], or null when blank and `nullable`. */
function integerOrError(field, value, { min, max, nullable = false }) {
  if (value === undefined || value === null || value === '') {
    return nullable ? { ok: true, value: null } : refuse(`${field} is required`);
  }
  const parsed = typeof value === 'string' && value.trim() ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    return refuse(`${field} must be a whole number — got ${JSON.stringify(value)}`);
  }
  if (parsed < min || parsed > max) {
    return refuse(`${field} must be between ${min} and ${max} — got ${parsed}`);
  }
  return { ok: true, value: parsed };
}

function messageTypesOrError(value) {
  if (!Array.isArray(value)) {
    return refuse(`messageTypes must be a list of one or more of ${CHOICES.messageTypes.join(', ')}`);
  }
  const out = [];
  for (const item of value) {
    const type = typeof item === 'string' ? item.trim() : item;
    if (!CHOICES.messageTypes.includes(type)) {
      return refuse(`messageTypes must contain only ${CHOICES.messageTypes.join(', ')} — got ${JSON.stringify(item)}`);
    }
    if (!out.includes(type)) out.push(type);
  }
  if (!out.length) return refuse('messageTypes needs at least one message type');
  return { ok: true, value: out };
}

function linkUrlOrError(value) {
  const text = safeText(value, 2000);
  if (!text) return { ok: true, value: '' };
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
  } catch {
    return refuse(`linkUrl must be a web address starting with https:// — got ${JSON.stringify(text)}`);
  }
  return { ok: true, value: text };
}

function dateOnlyOrError(field, value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return refuse(`${field} must be a date written 2026-12-31 — got ${JSON.stringify(value)}`);
  }
  const checked = timestampOrError(value.trim(), field);
  if (!checked.ok) return checked;
  return { ok: true, value: value.trim() };
}

function textListOrError(field, value) {
  if (!Array.isArray(value)) return refuse(`${field} must be a list of words or names`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') return refuse(`${field} must contain only text — got ${JSON.stringify(item)}`);
    const text = item.trim();
    if (!text) continue;
    if (text.length > MAX_AVOID_ENTRY_LENGTH) {
      return refuse(`${field} entries must be ${MAX_AVOID_ENTRY_LENGTH} characters or fewer`);
    }
    if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  if (out.length > MAX_AVOID_ENTRIES) return refuse(`${field} can hold at most ${MAX_AVOID_ENTRIES} entries`);
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

/** One field of a target, checked on its own. Cross-field rules are in checkTarget. */
function readTargetValue(field, value) {
  if (CHOICES[field] && field !== 'messageTypes') return choiceOrError(field, value);
  switch (field) {
    case 'messageTypes': return messageTypesOrError(value);
    case 'replyToCommentId': {
      const text = safeText(value, 200);
      if (text && !COMMENT_ID_RE.test(text)) return refuse(`replyToCommentId "${text}" does not look like a YouTube comment id`);
      return { ok: true, value: text };
    }
    case 'linkUrl': return linkUrlOrError(value);
    case 'repeatEveryDays': return integerOrError(field, value, { min: 1, max: REPEAT_EVERY_DAYS_MAX, nullable: true });
    case 'repeatMaxTimes': return integerOrError(field, value, { min: 1, max: REPEAT_MAX_TIMES_MAX, nullable: true });
    case 'repeatUntil': return dateOnlyOrError(field, value);
    case 'notes': {
      if (value !== null && value !== undefined && typeof value !== 'string') return refuse('notes must be text');
      const text = safeText(value, MAX_NOTES_LENGTH + 1);
      if (text.length > MAX_NOTES_LENGTH) return refuse(`notes must be ${MAX_NOTES_LENGTH} characters or fewer`);
      return { ok: true, value: text };
    }
    default: return refuse(`Unknown field: ${field}`);
  }
}

/**
 * Apply `input` over `base` field by field, then check the rules that span
 * fields. Used by create (base = defaults) and update (base = the stored row),
 * so one target is judged by one set of rules however it got its values.
 */
function checkTarget(base, input, fields) {
  const next = { ...base };
  const supplied = new Set();
  for (const field of fields) {
    const read = readField(input, field);
    if (!read.ok) return read;
    if (!read.present) continue;
    const checked = readTargetValue(field, read.value);
    if (!checked.ok) return checked;
    next[field] = checked.value;
    supplied.add(field);
  }

  if (next.commentPlacement === 'reply_specific' && !next.replyToCommentId) {
    return refuse('replyToCommentId is required when commentPlacement is reply_specific — say which comment to reply to');
  }
  if (next.commentPlacement !== 'reply_specific') {
    if (supplied.has('replyToCommentId') && next.replyToCommentId) {
      return refuse('replyToCommentId is only used when commentPlacement is reply_specific');
    }
    next.replyToCommentId = '';
  }

  if (next.linkPolicy !== 'never' && !next.linkUrl) {
    return refuse(`linkUrl is required when linkPolicy is ${next.linkPolicy} — say which address the comment may link to`);
  }

  if (next.repeatMode === 'repeat') {
    if (next.repeatEveryDays === null) return refuse('repeatEveryDays is required when repeatMode is repeat');
    if (next.repeatMaxTimes === null) return refuse('repeatMaxTimes is required when repeatMode is repeat');
  } else {
    for (const field of ['repeatEveryDays', 'repeatMaxTimes', 'repeatUntil']) {
      if (supplied.has(field) && next[field] !== null) {
        return refuse(`${field} is only used when repeatMode is repeat`);
      }
      next[field] = null;
    }
  }

  return { ok: true, value: next };
}

function targetToColumns(target) {
  const row = {};
  for (const field of TARGET_SETTING_FIELDS) row[snake(field)] = target[field];
  row.message_types = [...target.messageTypes];
  return row;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToTarget(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    accountKey: safeText(row.account_key, 80) || DEFAULT_ACCOUNT,
    videoUrl: safeText(row.video_url),
    videoId: safeText(row.video_id, 40),
    videoTitle: safeText(row.video_title, 500),
    channelName: safeText(row.channel_name, 300),
    channelId: safeText(row.channel_id, 120),
    publishedAt: row.published_at || null,
    viewCount: numberOrNull(row.view_count),
    detailsFetchedAt: row.details_fetched_at || null,
    detailsError: safeText(row.details_error, 500),
    source: row.source,
    objective: row.objective,
    commentPlacement: row.comment_placement,
    replyToCommentId: safeText(row.reply_to_comment_id, 200),
    messageTypes: Array.isArray(row.message_types) ? [...row.message_types] : [],
    commentLength: row.comment_length,
    linkPolicy: row.link_policy,
    linkUrl: safeText(row.link_url),
    mentionPolicy: row.mention_policy,
    repeatMode: row.repeat_mode,
    repeatEveryDays: numberOrNull(row.repeat_every_days),
    repeatMaxTimes: numberOrNull(row.repeat_max_times),
    repeatUntil: row.repeat_until ? String(row.repeat_until).slice(0, 10) : null,
    priority: row.priority,
    notes: safeText(row.notes, MAX_NOTES_LENGTH),
    status: row.status,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/**
 * What YouTube says about one video: title, channel, published date, views.
 *
 * Uses acquire's own client (ytFetch) and key resolver, so there is one way
 * this codebase talks to the YouTube Data API. Never throws — a failure comes
 * back as `ok: false` with the reason, and the target is saved anyway with
 * that reason in details_error. A link Dane pasted is not lost because YouTube
 * was slow; the screen says why the title is blank instead.
 */
async function lookupVideoDetails(videoId) {
  const apiKey = resolveYoutubeApiKey();
  if (!apiKey) return { ok: false, error: 'No YouTube API key is configured, so the video details could not be read.' };
  try {
    const body = await ytFetch('videos', { part: 'snippet,statistics', id: videoId, key: apiKey });
    const item = Array.isArray(body?.items) ? body.items[0] : null;
    if (!item) return { ok: false, error: 'YouTube has no public video with this id — it may be private, deleted or mistyped.' };
    return {
      ok: true,
      data: {
        title: safeText(item.snippet?.title, 500),
        channelName: safeText(item.snippet?.channelTitle, 300),
        channelId: safeText(item.snippet?.channelId, 120),
        publishedAt: safeText(item.snippet?.publishedAt, 40) || null,
        viewCount: numberOrNull(item.statistics?.viewCount),
      },
    };
  } catch (err) {
    return { ok: false, error: `YouTube did not return the video details: ${safeText(err?.message, 300) || 'unknown error'}` };
  }
}

function detailsToColumns(details) {
  if (!details?.ok) {
    return { details_error: safeText(details?.error, 500) || 'The video details could not be read.' };
  }
  const published = timestampOrError(details.data.publishedAt || null, 'publishedAt');
  return {
    video_title: details.data.title,
    channel_name: details.data.channelName,
    channel_id: details.data.channelId,
    published_at: published.ok ? published.value : null,
    view_count: details.data.viewCount,
    details_fetched_at: new Date().toISOString(),
    details_error: '',
  };
}

/** The account a list/settings call is about: `scope`-independent, defaulted, checked. */
function readAccount(options) {
  return accountKeyOrError(options?.accountKey ?? options?.account_key);
}

/**
 * Add a video to the list. Only `videoUrl` is required; every other setting
 * takes Dane's approved default. The video's details are read from YouTube
 * here (`options.lookup` replaces that call in tests).
 */
async function createTarget(input, scope = null, options = {}) {
  const gate = await requireScope(targetsTable(), scope);
  if (!gate.ok) return gate;

  const unknown = unknownKeyError(input, TARGET_CREATE_FIELDS);
  if (unknown) return unknown;

  const suppliedUrl = readField(input, 'videoUrl');
  if (!suppliedUrl.ok) return suppliedUrl;
  const rawUrl = safeText(suppliedUrl.value, 2000);
  if (!rawUrl) return refuse('videoUrl is required — paste the YouTube link');
  const videoId = extractYoutubeVideoId(rawUrl);
  if (!videoId) return refuse(`videoUrl "${rawUrl}" is not a YouTube video link`);

  const suppliedAccount = readField(input, 'accountKey');
  if (!suppliedAccount.ok) return suppliedAccount;
  const account = accountKeyOrError(suppliedAccount.value);
  if (!account.ok) return account;

  const checked = checkTarget({ ...TARGET_DEFAULTS, messageTypes: [...TARGET_DEFAULTS.messageTypes] }, input, TARGET_SETTING_FIELDS);
  if (!checked.ok) return checked;

  const lookup = typeof options.lookup === 'function' ? options.lookup : lookupVideoDetails;
  const details = await lookup(videoId);

  const row = await scopedInsertRow(targetsTable(), {
    account_key: account.value,
    video_url: `https://www.youtube.com/watch?v=${videoId}`,
    video_id: videoId,
    ...targetToColumns(checked.value),
    ...detailsToColumns(details),
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: targetsTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) {
    if (res.status === 409) {
      return refuse(`This video (${videoId}) is already on the ${account.value} list.`, 409);
    }
    return res;
  }
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!created) return refuse('The target was not saved — the database returned no row.', 500);
  return { ok: true, status: 201, data: rowToTarget(created) };
}

async function getTargetById(id, scope = null) {
  const gate = await requireScope(targetsTable(), scope);
  if (!gate.ok) return gate;
  const targetId = safeText(id, 120);
  if (!targetId) return refuse('id is required');
  const query = await scopedIdQuery(targetsTable(), `id=eq.${encodeURIComponent(targetId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: targetsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('Target not found in this project', 404);
  return { ok: true, status: 200, data: rowToTarget(found) };
}

/**
 * One account's targets: high priority first, then newest. Limit FIRST, scope
 * second (DOCTRINE 5.10) — resolveLimit refuses a scope in the limit's place.
 */
async function listTargets(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(targetsTable(), scope);
  if (!gate.ok) return gate;
  const account = readAccount(options);
  if (!account.ok) return account;

  const filters = [`account_key=eq.${encodeURIComponent(account.value)}`];
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    const status = choiceOrError('status', options.status);
    if (!status.ok) return status;
    filters.push(`status=eq.${encodeURIComponent(status.value)}`);
  }
  const query = await scopedListQuery(
    targetsTable(),
    `${filters.join('&')}&select=*&order=created_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: targetsTable(), query });
  if (!res.ok) return res;
  const rank = { high: 0, normal: 1, low: 2 };
  const targets = (Array.isArray(res.data) ? res.data : []).map(rowToTarget);
  // Stable sort: within a priority, the database's newest-first order holds.
  targets.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
  return { ok: true, status: 200, data: targets };
}

/**
 * Change a target's settings. The stored target is read first and the patch
 * judged against the WHOLE result, so switching placement to reply_specific
 * without saying which comment is refused, not saved half-made.
 */
async function updateTarget(id, patch, scope = null) {
  const existing = await getTargetById(id, scope);
  if (!existing.ok) return existing;

  const unknown = unknownKeyError(patch, TARGET_UPDATE_FIELDS);
  if (unknown) {
    const lockedField = Object.keys(patch || {}).find((key) => ['videoUrl', 'video_url', 'accountKey', 'account_key'].includes(key));
    if (lockedField) {
      return refuse(`${lockedField} cannot be changed on a saved target — add the video again instead`);
    }
    return unknown;
  }
  if (!Object.keys(patch || {}).length) return refuse('Nothing to update');

  const base = {};
  for (const field of TARGET_SETTING_FIELDS) base[field] = existing.data[field];
  const checked = checkTarget(base, patch, TARGET_UPDATE_FIELDS);
  if (!checked.ok) return checked;

  const body = await scopedPatchRow(targetsTable(), {
    ...targetToColumns(checked.value),
    updated_at: new Date().toISOString(),
  }, scope);
  const query = await scopedIdQuery(targetsTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: targetsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('Target not found in this project', 404);
  return { ok: true, status: 200, data: rowToTarget(updated) };
}

/** Pause or resume (or mark done). A thin, named wrapper the routes use. */
async function setTargetStatus(id, status, scope = null) {
  return updateTarget(id, { status }, scope);
}

async function deleteTarget(id, scope = null) {
  const gate = await requireScope(targetsTable(), scope);
  if (!gate.ok) return gate;
  const targetId = safeText(id, 120);
  if (!targetId) return refuse('id is required');
  const query = await scopedIdQuery(targetsTable(), `id=eq.${encodeURIComponent(targetId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: targetsTable(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  // An empty representation means the scope filter matched nothing: another
  // project's id, or one already gone. Never a silent success.
  if (!removed) return refuse('Target not found in this project', 404);
  return { ok: true, status: 200, data: rowToTarget(removed) };
}

// ── Account-wide settings ──────────────────────────────────────────────────

function rowToSettings(row, accountKey) {
  if (!row) {
    return {
      id: '',
      accountKey,
      ...SETTINGS_DEFAULTS,
      avoidChannels: [],
      avoidWords: [],
      // Not saved yet: these are the defaults, and the screen can say so.
      saved: false,
      updatedAt: '',
    };
  }
  return {
    id: safeText(row.id, 120),
    accountKey: safeText(row.account_key, 80) || accountKey,
    maxCommentsPerDay: numberOrNull(row.max_comments_per_day),
    minMinutesBetween: numberOrNull(row.min_minutes_between),
    jitterMinutes: numberOrNull(row.jitter_minutes),
    activeStartHour: numberOrNull(row.active_start_hour),
    activeEndHour: numberOrNull(row.active_end_hour),
    timeZone: safeText(row.time_zone, 80),
    oneCommentPerVideo: row.one_comment_per_video !== false,
    avoidChannels: Array.isArray(row.avoid_channels) ? [...row.avoid_channels] : [],
    avoidWords: Array.isArray(row.avoid_words) ? [...row.avoid_words] : [],
    voice: safeText(row.voice, MAX_VOICE_LENGTH),
    saved: true,
    updatedAt: row.updated_at || '',
  };
}

function readSettingsValue(field, value) {
  switch (field) {
    case 'maxCommentsPerDay': return integerOrError(field, value, { min: 0, max: 100 });
    case 'minMinutesBetween': return integerOrError(field, value, { min: 0, max: 1440 });
    case 'jitterMinutes': return integerOrError(field, value, { min: 0, max: 1440 });
    case 'activeStartHour': return integerOrError(field, value, { min: 0, max: 23 });
    case 'activeEndHour': return integerOrError(field, value, { min: 1, max: 24 });
    case 'timeZone': return timeZoneOrError(value);
    case 'oneCommentPerVideo':
      return typeof value === 'boolean' ? { ok: true, value } : refuse('oneCommentPerVideo must be true or false');
    case 'avoidChannels':
    case 'avoidWords':
      return textListOrError(field, value);
    case 'voice': {
      if (typeof value !== 'string') return refuse('voice must be text');
      const text = value.trim();
      if (text.length > MAX_VOICE_LENGTH) return refuse(`voice must be ${MAX_VOICE_LENGTH} characters or fewer`);
      return { ok: true, value: text };
    }
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

/** The account's limits — the saved row, or the defaults marked `saved: false`. */
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
 * Save some or all of an account's limits. The first save inserts a row
 * carrying the defaults for anything not supplied; later saves patch it.
 *
 * Read-then-write rather than an upsert on purpose: an upsert needs
 * `Prefer: resolution=merge-duplicates` or every save after the first is a 409
 * (landmine 15), and the test fake does not model upserts at all, so it could
 * not prove that header was there. Two first saves racing is the one gap, and
 * the unique index turns it into a 409 that is retried once as a patch.
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
  TARGET_DEFAULTS,
  SETTINGS_DEFAULTS,
  TARGET_CREATE_FIELDS,
  TARGET_UPDATE_FIELDS,
  SETTINGS_FIELDS,
  createTarget,
  getTargetById,
  listTargets,
  updateTarget,
  setTargetStatus,
  deleteTarget,
  getSettings,
  saveSettings,
  lookupVideoDetails,
  rowToTarget,
  rowToSettings,
};
