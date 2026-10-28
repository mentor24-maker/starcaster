'use strict';

/**
 * YouTube creators — the channels Starcaster finds for a project and what Dane
 * decided about each, plus the wizard's shared keyword list. Outreach wizard
 * 15/19 (task 86bcrmbrf): the YouTube twin of the Substack Miner's writers
 * (lib/substackMinerStore.js), deliberately the same shape so one suggestion
 * pass (lib/acquire/SubstackSuggestRun.js) serves both.
 *
 * Tables: docs/SQL/youtube_creators_setup.sql.
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10). List functions take the limit FIRST (landmine 12b).
 *
 * TENANCY FAILS CLOSED, as in the Substack Miner store: projectScope answers an
 * unscoped query when the scope has no project or its column probe fails, which
 * is wrong for one project's prospects, so `requireScope` refuses both.
 *
 * A channel is ONE row per project however often it is found. A second find
 * adds its keywords and refreshes the channel's details, and never touches
 * Dane's decision — so a channel he rejected stays rejected when a later search
 * turns it up again.
 *
 *   candidate ─► approved ─► rejected ─► candidate (think again)
 *       └──────────────────► rejected
 */

const { sbQuery, tableConfig } = require('./supabase');
const {
  supportsProjectColumns, scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow,
} = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { unknownKeyError } = require('./storeInput');
const minerStore = require('./substackMinerStore');

const SQL_FILE = 'docs/SQL/youtube_creators_setup.sql';

const CHOICES = Object.freeze({
  foundVia: Object.freeze(['keyword_search', 'acquire_results', 'hand_added']),
  status: Object.freeze(['candidate', 'approved', 'rejected']),
});

/** The same path the Substack Miner's writers take. */
const STATUS_MOVES = minerStore.STATUS_MOVES;

const FIND_FIELDS = [
  'channelId', 'channelUrl', 'name', 'description', 'avatarUrl', 'subscriberCount',
  'latestVideos', 'keywordsHit', 'foundVia',
];
const DECIDE_FIELDS = ['status', 'decisionReasons', 'note'];

const MAX_NAME_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_URL_LENGTH = 1000;
const MAX_NOTE_LENGTH = 1000;
const MAX_LATEST_VIDEOS = 3;
const MAX_VIDEO_TITLE_LENGTH = 300;
const MAX_KEYWORDS = 200;
const MAX_KEYWORD_LENGTH = 200;

// YouTube channel ids are "UC" and 22 more letters, numbers, dashes or underscores.
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

function creatorsTable() { return tableConfig().youtubeCreators; }
function settingsTable() { return tableConfig().outreachWizardSettings; }

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

async function requireScope(table, scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) return refuse('No project is selected, so there are no YouTube creators to read or change.');
  if (!(await supportsProjectColumns(table))) {
    return refuse(
      `The ${table} table is not available with its project columns, so it cannot be read safely. `
      + `Has ${SQL_FILE} been applied to this database?`,
      503,
    );
  }
  return { ok: true };
}

/** A channel id from a bare id or a youtube.com/channel/<id> address; '' when it is neither. */
function channelIdFrom(value) {
  const text = safeText(value, MAX_URL_LENGTH);
  if (CHANNEL_ID_RE.test(text)) return text;
  const match = text.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/i);
  return match ? match[1] : '';
}

function textOrError(field, value, max) {
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string') return refuse(`${field} must be text`);
  const text = value.trim();
  if (text.length > max) return refuse(`${field} must be ${max} characters or fewer`);
  return { ok: true, value: text };
}

function httpsOrError(field, value) {
  const text = textOrError(field, value, MAX_URL_LENGTH);
  if (!text.ok || !text.value) return text;
  if (!/^https:\/\//i.test(text.value)) return refuse(`${field} must be a web address starting with https:// — got ${JSON.stringify(text.value)}`);
  return text;
}

/** Words or phrases: trimmed, blanks dropped, repeats (any case) dropped. */
function wordListOrError(field, value) {
  if (value === null || value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return refuse(`${field} must be a list`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') return refuse(`${field} must contain only text — got ${JSON.stringify(item)}`);
    const text = item.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    if (text.length > MAX_KEYWORD_LENGTH) return refuse(`${field} entries must be ${MAX_KEYWORD_LENGTH} characters or fewer`);
    if (!out.some((o) => o.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  if (out.length > MAX_KEYWORDS) return refuse(`${field} can hold at most ${MAX_KEYWORDS} entries`);
  return { ok: true, value: out };
}

function videosOrError(value) {
  if (value === null || value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return refuse('latestVideos must be a list like [{ "videoId", "title", "publishedAt" }]');
  const out = [];
  for (const v of value) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return refuse('each of latestVideos must be an object like { "videoId", "title", "publishedAt" }');
    const videoId = safeText(v.videoId, 20);
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return refuse(`latestVideos: ${JSON.stringify(v.videoId)} is not a YouTube video id`);
    out.push({ videoId, title: safeText(v.title, MAX_VIDEO_TITLE_LENGTH), publishedAt: safeText(v.publishedAt, 40) });
  }
  return { ok: true, value: out.slice(0, MAX_LATEST_VIDEOS) };
}

function readFindValue(field, value) {
  switch (field) {
    case 'channelId': {
      const id = channelIdFrom(value);
      return id ? { ok: true, value: id } : refuse(`channelId ${JSON.stringify(value)} is not a YouTube channel id — "UC" and 22 more characters`);
    }
    case 'channelUrl': return httpsOrError(field, value);
    case 'avatarUrl': return httpsOrError(field, value);
    case 'name': return textOrError(field, value, MAX_NAME_LENGTH);
    case 'description': return textOrError(field, value, MAX_DESCRIPTION_LENGTH);
    case 'subscriberCount': {
      if (value === null || value === undefined || value === '') return { ok: true, value: null };
      const n = typeof value === 'string' ? Number(value) : value;
      if (!Number.isInteger(n) || n < 0) return refuse(`subscriberCount must be a whole number — got ${JSON.stringify(value)}`);
      return { ok: true, value: n };
    }
    case 'latestVideos': return videosOrError(value);
    case 'keywordsHit': return wordListOrError(field, value);
    case 'foundVia':
      return CHOICES.foundVia.includes(value) ? { ok: true, value } : refuse(`foundVia must be one of ${CHOICES.foundVia.join(', ')} — got ${JSON.stringify(value)}`);
    default: return refuse(`Unknown field: ${field}`);
  }
}

function mergeList(base, extra) {
  const out = Array.isArray(base) ? [...base] : [];
  for (const item of extra || []) {
    if (!out.some((o) => String(o).toLowerCase() === String(item).toLowerCase())) out.push(item);
  }
  return out.slice(0, MAX_KEYWORDS);
}

function rowToCreator(row) {
  if (!row) return null;
  const count = row.subscriber_count;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    channelId: safeText(row.channel_id, 40),
    channelUrl: safeText(row.channel_url, MAX_URL_LENGTH) || `https://www.youtube.com/channel/${safeText(row.channel_id, 40)}`,
    name: safeText(row.name, MAX_NAME_LENGTH),
    description: safeText(row.description, MAX_DESCRIPTION_LENGTH),
    avatarUrl: safeText(row.avatar_url, MAX_URL_LENGTH),
    subscriberCount: count === null || count === undefined || count === '' ? null : Number(count),
    latestVideos: Array.isArray(row.latest_videos) ? row.latest_videos.map((v) => ({ ...v })) : [],
    keywordsHit: Array.isArray(row.keywords_hit) ? [...row.keywords_hit] : [],
    foundVia: row.found_via,
    lastSeenAt: row.last_seen_at || null,
    status: row.status,
    decisionReasons: Array.isArray(row.decision_reasons) ? row.decision_reasons.map((r) => safeText(r, 80)).filter(Boolean) : [],
    note: safeText(row.note, MAX_NOTE_LENGTH),
    suggestion: row.suggestion && typeof row.suggestion === 'object' && !Array.isArray(row.suggestion)
      && (row.suggestion.action === 'approved' || row.suggestion.action === 'rejected')
      ? { ...row.suggestion, reasons: Array.isArray(row.suggestion.reasons) ? [...row.suggestion.reasons] : [] }
      : null,
    // Outreach wizard 16/19 (docs/SQL/youtube_conversations_setup.sql): the
    // newest videos and their comments, as the scheduled read last found them.
    recentVideos: Array.isArray(row.recent_videos) ? row.recent_videos.map((v) => ({ ...v, comments: Array.isArray(v?.comments) ? v.comments.map((c) => ({ ...c })) : [] })) : [],
    lastCommentsReadAt: row.last_comments_read_at || null,
    commentsReadError: safeText(row.comments_read_error, 500),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

async function readByChannelId(channelId, scope) {
  const query = await scopedListQuery(creatorsTable(), `channel_id=eq.${encodeURIComponent(channelId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: creatorsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

async function patchById(id, columns, scope, extraFilter = '') {
  const body = await scopedPatchRow(creatorsTable(), columns, scope);
  const query = await scopedIdQuery(creatorsTable(), `id=eq.${encodeURIComponent(id)}${extraFilter}&select=*`, scope);
  return sbQuery({ method: 'PATCH', table: creatorsTable(), query, headers: { Prefer: 'return=representation' }, body });
}

/**
 * Record a channel a search found. New to this project: added as a `candidate`
 * (201). Already here: MERGED (200) — keywords added, details refreshed with
 * any new non-blank value, last_seen_at moved to now; `found_via` and Dane's
 * decision are never touched. A 409 from two first finds racing is retried
 * once as a merge; any other refusal is returned as-is (no fallback).
 */
async function upsertCreator(input, scope = null, attempt = 0) {
  const gate = await requireScope(creatorsTable(), scope);
  if (!gate.ok) return gate;
  const unknown = unknownKeyError(input, FIND_FIELDS);
  if (unknown) return unknown;

  const found = {};
  for (const field of FIND_FIELDS) {
    if (input[field] === undefined) continue;
    const checked = readFindValue(field, input[field]);
    if (!checked.ok) return checked;
    found[field] = checked.value;
  }
  if (!found.channelId) return refuse('channelId is required — "UC" and 22 more characters');

  const existing = await readByChannelId(found.channelId, scope);
  if (!existing.ok) return existing;
  const now = new Date().toISOString();

  let res;
  if (existing.data) {
    const current = rowToCreator(existing.data);
    const columns = { keywords_hit: mergeList(current.keywordsHit, found.keywordsHit), last_seen_at: now, updated_at: now };
    if (found.channelUrl) columns.channel_url = found.channelUrl;
    if (found.name) columns.name = found.name;
    if (found.description) columns.description = found.description;
    if (found.avatarUrl) columns.avatar_url = found.avatarUrl;
    if (found.subscriberCount !== undefined && found.subscriberCount !== null) columns.subscriber_count = found.subscriberCount;
    if (found.latestVideos && found.latestVideos.length) columns.latest_videos = found.latestVideos;
    res = await patchById(current.id, columns, scope);
  } else {
    const row = await scopedInsertRow(creatorsTable(), {
      channel_id: found.channelId,
      channel_url: found.channelUrl || `https://www.youtube.com/channel/${found.channelId}`,
      name: found.name || '',
      description: found.description || '',
      avatar_url: found.avatarUrl || '',
      subscriber_count: found.subscriberCount === undefined ? null : found.subscriberCount,
      latest_videos: found.latestVideos || [],
      keywords_hit: found.keywordsHit || [],
      found_via: found.foundVia || 'keyword_search',
      last_seen_at: now,
      status: 'candidate',
    }, scope);
    res = await sbQuery({ method: 'POST', table: creatorsTable(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
    if (!res.ok && res.status === 409 && attempt === 0) return upsertCreator(input, scope, attempt + 1);
  }
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The channel was not saved — the database returned no row.', 500);
  return { ok: true, status: existing.data ? 200 : 201, data: rowToCreator(saved) };
}

async function getCreatorById(id, scope = null) {
  const gate = await requireScope(creatorsTable(), scope);
  if (!gate.ok) return gate;
  const creatorId = safeText(id, 120);
  if (!creatorId) return refuse('id is required');
  const query = await scopedIdQuery(creatorsTable(), `id=eq.${encodeURIComponent(creatorId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: creatorsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('Channel not found in this project', 404);
  return { ok: true, status: 200, data: rowToCreator(found) };
}

/** The project's channels, most recently seen first, optionally one status. Limit FIRST. */
async function listCreators(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(creatorsTable(), scope);
  if (!gate.ok) return gate;
  const filters = [];
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    if (!CHOICES.status.includes(options.status)) return refuse(`status must be one of ${CHOICES.status.join(', ')} — got ${JSON.stringify(options.status)}`);
    filters.push(`status=eq.${encodeURIComponent(options.status)}`);
  }
  filters.push('select=*', 'order=last_seen_at.desc', `limit=${bounded.limit}`);
  const query = await scopedListQuery(creatorsTable(), filters.join('&'), scope);
  const res = await sbQuery({ method: 'GET', table: creatorsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToCreator) };
}

/**
 * Dane's decision on one channel: `{ status, decisionReasons?, note? }`. The
 * reasons are checked by the Substack Miner's own rule, so a reason means the
 * same thing on both screens. A move the path does not allow is refused by name.
 */
async function decideCreator(id, input, scope = null) {
  const existing = await getCreatorById(id, scope);
  if (!existing.ok) return existing;
  const unknown = unknownKeyError(input, DECIDE_FIELDS);
  if (unknown) return unknown;
  const status = input?.status;
  if (!CHOICES.status.includes(status)) return refuse(`status must be one of ${CHOICES.status.join(', ')} — got ${JSON.stringify(status)}`);
  const from = existing.data.status;
  if (status !== from && !STATUS_MOVES[from].includes(status)) {
    return refuse(`status cannot move from ${from} to ${status} — from ${from} it can go to ${STATUS_MOVES[from].join(', ')}`);
  }
  const reasons = minerStore.readCandidateValue('decisionReasons', input.decisionReasons === undefined ? [] : input.decisionReasons);
  if (!reasons.ok) return reasons;
  const note = textOrError('note', input.note, MAX_NOTE_LENGTH);
  if (!note.ok) return note;

  const columns = { status, updated_at: new Date().toISOString() };
  // Back to candidate is "think again": the old reasons no longer stand.
  columns.decision_reasons = status === 'candidate' ? [] : reasons.value;
  if (input.note !== undefined || status === 'candidate') columns.note = status === 'candidate' ? '' : note.value;
  const res = await patchById(existing.data.id, columns, scope);
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('Channel not found in this project', 404);
  return { ok: true, status: 200, data: rowToCreator(updated) };
}

/**
 * Store the suggestion pass's guess on one channel. Only an UNDECIDED channel
 * takes one — a channel Dane decided while the pass was thinking keeps his
 * decision. Checked by the Substack Miner's rule (suggestionOrError).
 */
async function recordSuggestion(id, suggestion, scope = null) {
  const existing = await getCreatorById(id, scope);
  if (!existing.ok) return existing;
  if (existing.data.status !== 'candidate') return refuse(`This channel is already ${existing.data.status}, so it takes no suggestion.`, 409);
  const checked = minerStore.suggestionOrError(suggestion);
  if (!checked.ok) return checked;
  const res = await patchById(existing.data.id, { suggestion: checked.value, updated_at: new Date().toISOString() }, scope, '&status=eq.candidate');
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('This channel was decided while the suggestion was being made, so it was not stored.', 409);
  return { ok: true, status: 200, data: rowToCreator(updated) };
}

// ── The comments the scheduled read found (Outreach wizard 16/19) ─────────

const CONVERSATIONS_SQL_FILE = 'docs/SQL/youtube_conversations_setup.sql';
const MAX_RECENT_VIDEOS = 5;
const MAX_COMMENTS_PER_VIDEO = 20;
const MAX_COMMENT_LENGTH = 2000;

function countOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** One video as the read found it, trimmed to what is kept. Null when it has no real video id. */
function cleanVideo(v) {
  const videoId = safeText(v?.videoId, 20);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const comments = [];
  for (const c of Array.isArray(v.comments) ? v.comments : []) {
    const commentId = safeText(c?.commentId, 200);
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(commentId)) continue;
    comments.push({
      commentId,
      text: safeText(c.text, MAX_COMMENT_LENGTH),
      authorName: safeText(c.authorName, MAX_NAME_LENGTH),
      authorChannelUrl: /^https:\/\//i.test(safeText(c.authorChannelUrl, MAX_URL_LENGTH)) ? safeText(c.authorChannelUrl, MAX_URL_LENGTH) : '',
      authorChannelId: safeText(c.authorChannelId, 40),
      likes: countOrZero(c.likes),
      replies: countOrZero(c.replies),
      publishedAt: safeText(c.publishedAt, 40),
    });
    if (comments.length >= MAX_COMMENTS_PER_VIDEO) break;
  }
  return {
    videoId,
    title: safeText(v.title, MAX_VIDEO_TITLE_LENGTH),
    publishedAt: safeText(v.publishedAt, 40),
    commentsDisabled: v.commentsDisabled === true,
    comments,
  };
}

/** The missing-column refusal said by name: the SQL file has not been run here (landmine 15). */
function explainMissingConversationColumns(res) {
  if (res.ok || !/recent_videos|last_comments_read_at|comments_read_error/.test(String(res.error || ''))) return res;
  return refuse(`${res.error} — this database does not have the comment columns yet; run ${CONVERSATIONS_SQL_FILE}.`, 503);
}

/**
 * Keep what one read of a channel found: `{ videos }` when it came back
 * (replaces the stored list and clears the error), or `{ error }` when it did
 * not (keeps the last good list and says why). Never both, never neither.
 */
async function recordCommentsRead(id, result, scope = null) {
  const existing = await getCreatorById(id, scope);
  if (!existing.ok) return existing;
  const now = new Date().toISOString();
  let columns;
  if (result && typeof result.error === 'string' && result.error.trim()) {
    columns = { comments_read_error: safeText(result.error, 500), updated_at: now };
  } else if (result && Array.isArray(result.videos)) {
    const videos = result.videos.map(cleanVideo).filter(Boolean).slice(0, MAX_RECENT_VIDEOS);
    columns = { recent_videos: videos, last_comments_read_at: now, comments_read_error: '', updated_at: now };
  } else {
    return refuse('A comments read must give either { videos: [...] } or { error: "why" }');
  }
  const res = explainMissingConversationColumns(await patchById(existing.data.id, columns, scope));
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('Channel not found in this project', 404);
  return { ok: true, status: 200, data: rowToCreator(updated) };
}

// ── The wizard's keyword list ───────────────────────────────────────────────

async function readSettingsRow(scope) {
  const query = await scopedListQuery(settingsTable(), 'select=*&limit=1', scope);
  const res = await sbQuery({ method: 'GET', table: settingsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

/**
 * The keywords the creator searches use: `{ keywords, source, updatedAt }`.
 * `source` says where they came from, so the screen can say it — `saved` (the
 * wizard's own list), `substack_miner` (none saved yet, so the Substack Miner's
 * stand in) or `none`. A Substack Miner list that cannot be read is a refusal,
 * never an empty list (landmine 17).
 */
async function getKeywords(scope = null, deps = {}) {
  const gate = await requireScope(settingsTable(), scope);
  if (!gate.ok) return gate;
  const row = await readSettingsRow(scope);
  if (!row.ok) return row;
  if (row.data) {
    return { ok: true, status: 200, data: { keywords: Array.isArray(row.data.keywords) ? [...row.data.keywords] : [], source: 'saved', updatedAt: row.data.updated_at || '' } };
  }
  const miner = await (deps.minerStore || minerStore).getSettings(scope);
  if (!miner.ok) return { ...miner, error: `No outreach keywords are saved, and the Substack Miner's could not be read to start from: ${miner.error}` };
  const keywords = Array.isArray(miner.data?.keywords) ? [...miner.data.keywords] : [];
  return { ok: true, status: 200, data: { keywords, source: keywords.length ? 'substack_miner' : 'none', updatedAt: '' } };
}

/** Save the wizard's keyword list (the whole list). A 409 from two first saves racing is retried once. */
async function saveKeywords(keywords, scope = null, attempt = 0) {
  const gate = await requireScope(settingsTable(), scope);
  if (!gate.ok) return gate;
  const checked = wordListOrError('keywords', keywords);
  if (!checked.ok) return checked;
  if (!checked.value.length) return refuse('keywords is empty — give at least one word or phrase to search for');
  const existing = await readSettingsRow(scope);
  if (!existing.ok) return existing;
  const columns = { keywords: checked.value, updated_at: new Date().toISOString() };
  let res;
  if (existing.data) {
    const body = await scopedPatchRow(settingsTable(), columns, scope);
    const query = await scopedIdQuery(settingsTable(), `id=eq.${encodeURIComponent(existing.data.id)}&select=*`, scope);
    res = await sbQuery({ method: 'PATCH', table: settingsTable(), query, headers: { Prefer: 'return=representation' }, body });
  } else {
    const row = await scopedInsertRow(settingsTable(), columns, scope);
    res = await sbQuery({ method: 'POST', table: settingsTable(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
    if (!res.ok && res.status === 409 && attempt === 0) return saveKeywords(keywords, scope, attempt + 1);
  }
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The keywords were not saved — the database returned no row.', 500);
  return { ok: true, status: existing.data ? 200 : 201, data: { keywords: [...saved.keywords], source: 'saved', updatedAt: saved.updated_at || '' } };
}

module.exports = {
  SQL_FILE,
  CHOICES,
  STATUS_MOVES,
  FIND_FIELDS,
  MAX_LATEST_VIDEOS,
  channelIdFrom,
  upsertCreator,
  getCreatorById,
  listCreators,
  decideCreator,
  recordSuggestion,
  recordCommentsRead,
  explainMissingConversationColumns,
  CONVERSATIONS_SQL_FILE,
  MAX_RECENT_VIDEOS,
  MAX_COMMENTS_PER_VIDEO,
  getKeywords,
  saveKeywords,
  rowToCreator,
};
