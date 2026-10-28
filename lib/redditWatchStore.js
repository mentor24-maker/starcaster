'use strict';

/**
 * Reddit watch — the subreddits Dane chose, and the posts the Mini found in
 * them. Outreach wizard 18/19 (task 86bcrmbwm).
 *
 * Tables: docs/SQL/reddit_watch_setup.sql. The keywords are the wizard's
 * shared list (lib/youtubeCreatorsStore.js getKeywords), not a column here.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10);
 * list functions take the limit FIRST (landmine 12b).
 *
 * TENANCY FAILS CLOSED, the way lib/redditCommentsStore.js does it: both
 * tenant columns are written explicitly from the scope, never through
 * scopedInsertRow (landmine 12), and every read filters on project_id itself.
 * A scope without a project AND a user is refused before any request.
 * The Mini's job acts for a project, not a signed-in person, so it passes the
 * owner it read off the subreddit row (lib/acquire/RedditWatchDue.js).
 *
 * THE DATABASE IS THE ONLY STORE. No local-file fallback (landmines 6, 15).
 *
 *   candidate ─► approved ─► rejected ─► candidate (think again)
 *       └──────────────────► rejected
 *
 * A subreddit suggested again keeps Dane's decision: a rejected one stays
 * rejected however often "Find subreddits" proposes it.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { resolveLimit } = require('./storeLimit');

const SQL_FILE = 'docs/SQL/reddit_watch_setup.sql';

const STATUSES = Object.freeze(['candidate', 'approved', 'rejected']);
const STATUS_MOVES = Object.freeze({
  candidate: Object.freeze(['approved', 'rejected']),
  approved: Object.freeze(['rejected']),
  rejected: Object.freeze(['candidate', 'approved']),
});
const READ_STATES = Object.freeze(['read', 'failed', 'signed_out']);
const LISTINGS = Object.freeze(['new', 'rising']);

/** Reddit's own rule for a subreddit's name. */
const SUBREDDIT_RE = /^[a-z0-9_]{2,21}$/;
const POST_ID_RE = /^[a-z0-9]{1,12}$/;

const MAX_WHY_LENGTH = 500;
const MAX_RULE_LENGTH = 1000;
const MAX_ERROR_LENGTH = 1000;
const MAX_TITLE_LENGTH = 1000;
const MAX_BODY_LENGTH = 6000;
const MAX_COMMENT_LENGTH = 2000;
const MAX_COMMENTS = 5;

/**
 * The watch's pace and freshness, kept HERE rather than in
 * lib/acquire/RedditWatchDue.js because the wizard's list
 * (lib/redditConversations.js) needs them too, and that file is on the
 * server's require chain. RedditWatchDue reaches into workers/, which Vercel
 * never uploads (.vercelignore), so a require from the website side to it
 * fails the deploy (the first push of PR #898 did exactly that).
 */
/** Subreddits read each four-hourly pass. */
const SUBREDDITS_PER_PASS = 2;
/** A post older than this is not a conversation to join. */
const FRESH_FOR_MS = 14 * 24 * 60 * 60 * 1000;

function subredditsTable() {
  return tableConfig().redditWatchSubreddits || 'reddit_watch_subreddits';
}

function postsTable() {
  return tableConfig().redditWatchPosts || 'reddit_watch_posts';
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function text(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function scopeOrError(scope) {
  const projectId = text(scope?.projectId, 120);
  const userId = text(scope?.userId, 120);
  if (!projectId || !userId) {
    return { error: refuse('No project is selected (or nobody is signed in), so nothing was read or saved.', 400) };
  }
  return { projectId, userId };
}

/** A table that is not there yet: name the SQL to run, rather than a bare PostgREST error. */
function explainMissing(res, what) {
  if (res.ok) return res;
  const why = String(res.error || '');
  if (/reddit_watch_(subreddits|posts)/.test(why) && /(does not exist|schema cache|not find)/i.test(why)) {
    return refuse(`${what}: the Reddit watch tables are not set up yet — run ${SQL_FILE} on Supabase.`, 503);
  }
  return refuse(`${what}: ${why || 'unknown error'}`, res.status || 502);
}

/** "r/Philosophy", "/r/philosophy/", "https://reddit.com/r/philosophy" → "philosophy"; '' if not a name. */
function subredditName(value) {
  let raw = text(value, 200).toLowerCase();
  const fromLink = raw.match(/reddit\.com\/r\/([^/?#\s]+)/);
  if (fromLink) raw = fromLink[1];
  raw = raw.replace(/^\/?r\//, '').replace(/\/+$/, '');
  return SUBREDDIT_RE.test(raw) ? raw : '';
}

function rowToSubreddit(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    suggestedBy: row.suggested_by,
    why: row.why || '',
    decidedAt: row.decided_at || null,
    promotionRule: row.promotion_rule || '',
    lastReadState: row.last_read_state || '',
    lastReadAt: row.last_read_at || null,
    lastReadError: row.last_read_error || '',
    lastReadSeen: Number(row.last_read_seen) || 0,
    lastReadKept: Number(row.last_read_kept) || 0,
    ownerUserId: row.owner_user_id || '',
    createdAt: row.created_at || null,
  };
}

function commentsOf(list) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    id: text(c?.id, 40),
    author: text(c?.author, 100).replace(/^\/?u\//i, ''),
    body: text(c?.body, MAX_COMMENT_LENGTH),
    score: Number.isFinite(Number(c?.score)) ? Math.round(Number(c.score)) : 0,
  })).filter((c) => c.body && !['[removed]', '[deleted]'].includes(c.body))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COMMENTS);
}

function rowToPost(row) {
  return {
    id: row.id,
    postId: row.post_id,
    subreddit: row.subreddit || '',
    url: row.url || '',
    title: row.title || '',
    body: row.body || '',
    author: row.author || '',
    postedAt: row.posted_at || '',
    score: Number(row.score) || 0,
    numComments: Number(row.num_comments) || 0,
    listing: row.listing || 'new',
    keyword: row.keyword || '',
    topComments: commentsOf(row.top_comments),
    commentsReadAt: row.comments_read_at || null,
    foundAt: row.found_at || '',
  };
}

// ── Subreddits ─────────────────────────────────────────────────────────────

async function listSubreddits(limit = 500, scope = null) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const res = await sbQuery({
    method: 'GET',
    table: subredditsTable(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&select=*&order=created_at.asc&limit=${bounded.limit}`,
  });
  if (!res.ok) return explainMissing(res, 'The subreddit list could not be read');
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToSubreddit) };
}

/**
 * Add subreddits to the list as candidates: `[{ name, why }]`. One already on
 * the list is left exactly as it is — Dane's decision included. Answers
 * `{ added: [subreddit], kept: [name], refused: [{ name, why }] }`.
 */
async function addSubreddits(list, scope = null, { suggestedBy = 'hand' } = {}) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  if (!Array.isArray(list) || !list.length) return refuse('Give at least one subreddit to add.');
  if (!['ai', 'hand'].includes(suggestedBy)) return refuse(`suggestedBy must be "ai" or "hand" — got ${JSON.stringify(suggestedBy)}`);
  const current = await listSubreddits(1000, scope);
  if (!current.ok) return current;
  const have = new Set(current.data.map((r) => r.name));
  const added = [];
  const kept = [];
  const refused = [];
  for (const entry of list.slice(0, 50)) {
    const given = typeof entry === 'string' ? entry : entry?.name;
    const name = subredditName(given);
    if (!name) { refused.push({ name: text(given, 100), why: 'not a subreddit name (2-21 letters, numbers or underscores)' }); continue; }
    if (have.has(name)) { kept.push(name); continue; }
    const now = new Date().toISOString();
    // eslint-disable-next-line no-await-in-loop
    const res = await sbQuery({
      method: 'POST',
      table: subredditsTable(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [{
        project_id: s.projectId,
        owner_user_id: s.userId,
        name,
        status: 'candidate',
        suggested_by: suggestedBy,
        why: text(typeof entry === 'string' ? '' : entry?.why, MAX_WHY_LENGTH),
        created_at: now,
        updated_at: now,
      }],
    });
    if (!res.ok) {
      // Two adds racing: the other one won, which is the same outcome.
      if (res.status === 409) { kept.push(name); have.add(name); continue; }
      return explainMissing(res, `r/${name} was not added`);
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) return refuse(`r/${name} was not added — the database returned no row.`, 500);
    have.add(name);
    added.push(rowToSubreddit(row));
  }
  return { ok: true, status: added.length ? 201 : 200, data: { added, kept, refused } };
}

async function getSubreddit(id, scope) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const res = await sbQuery({
    method: 'GET',
    table: subredditsTable(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&id=eq.${encodeURIComponent(text(id, 80))}&select=*&limit=1`,
  });
  if (!res.ok) return explainMissing(res, 'The subreddit could not be read');
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return refuse('That subreddit is not on this project\'s list.', 404);
  return { ok: true, status: 200, data: rowToSubreddit(row) };
}

/** Approve or reject a subreddit (or put a rejected one back). */
async function decideSubreddit(id, status, scope = null) {
  if (!STATUSES.includes(status)) return refuse(`status must be one of ${STATUSES.join(', ')} — got ${JSON.stringify(status)}`);
  if (!/^[0-9a-f-]{36}$/i.test(text(id, 80))) return refuse('That is not a subreddit id from this list.');
  const found = await getSubreddit(id, scope);
  if (!found.ok) return found;
  const current = found.data;
  if (current.status === status) return { ok: true, status: 200, data: current };
  if (!STATUS_MOVES[current.status].includes(status)) {
    return refuse(`r/${current.name} is ${current.status}, so it cannot be moved to ${status}.`, 409);
  }
  const s = scopeOrError(scope);
  const now = new Date().toISOString();
  const res = await sbQuery({
    method: 'PATCH',
    table: subredditsTable(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&id=eq.${encodeURIComponent(current.id)}&status=eq.${encodeURIComponent(current.status)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { status, decided_at: status === 'candidate' ? null : now, updated_at: now },
  });
  if (!res.ok) return explainMissing(res, 'The decision was not saved');
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return refuse(`r/${current.name} changed while you were deciding — reload the list.`, 409);
  return { ok: true, status: 200, data: rowToSubreddit(row) };
}

/**
 * What the Mini's read of one subreddit found: `{ state, error, seen, kept,
 * promotionRule }`. A rule is only replaced by a read that succeeded — a
 * failed read says nothing about the sidebar.
 */
async function recordRead(id, reading = {}, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  if (!READ_STATES.includes(reading.state)) return refuse(`state must be one of ${READ_STATES.join(', ')}`);
  const columns = {
    last_read_state: reading.state,
    last_read_at: new Date().toISOString(),
    last_read_error: reading.state === 'read' ? '' : (text(reading.error, MAX_ERROR_LENGTH) || 'The read failed and nothing said why.'),
    updated_at: new Date().toISOString(),
  };
  if (reading.state === 'read') {
    columns.last_read_seen = Math.max(0, Math.round(Number(reading.seen) || 0));
    columns.last_read_kept = Math.max(0, Math.round(Number(reading.kept) || 0));
    columns.promotion_rule = text(reading.promotionRule, MAX_RULE_LENGTH);
  }
  const res = await sbQuery({
    method: 'PATCH',
    table: subredditsTable(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&id=eq.${encodeURIComponent(text(id, 80))}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: columns,
  });
  if (!res.ok) return explainMissing(res, 'The read was not recorded');
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return refuse('The subreddit was not found to record its read on.', 404);
  return { ok: true, status: 200, data: rowToSubreddit(row) };
}

/**
 * Every project with at least one approved subreddit, and the owner to act
 * as (the person who added it) — for the Mini's job, across projects.
 */
async function listWatchedProjects(deps = {}) {
  const query = deps.sbQuery || sbQuery;
  const res = await query({
    method: 'GET',
    table: subredditsTable(),
    query: 'status=eq.approved&select=project_id,owner_user_id&limit=5000',
  });
  if (!res.ok) return explainMissing(res, 'The watched subreddits could not be read');
  const seen = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    const userId = text(row.owner_user_id, 120);
    if (!projectId || !userId || seen.has(projectId)) continue;
    seen.set(projectId, { projectId, userId });
  }
  return { ok: true, status: 200, data: [...seen.values()] };
}

// ── Posts ──────────────────────────────────────────────────────────────────

function cleanPost(p) {
  const postId = text(p?.postId, 20).toLowerCase();
  if (!POST_ID_RE.test(postId)) return null;
  const title = text(p?.title, MAX_TITLE_LENGTH);
  if (!title) return null;
  const subreddit = subredditName(p?.subreddit);
  const posted = Date.parse(p?.postedAt || '');
  return {
    post_id: postId,
    subreddit,
    url: subreddit ? `https://www.reddit.com/r/${subreddit}/comments/${postId}/` : `https://www.reddit.com/comments/${postId}/`,
    title,
    body: text(p?.body, MAX_BODY_LENGTH),
    author: text(p?.author, 100).replace(/^\/?u\//i, ''),
    posted_at: Number.isFinite(posted) ? new Date(posted).toISOString() : null,
    score: Number.isFinite(Number(p?.score)) ? Math.round(Number(p.score)) : 0,
    num_comments: Math.max(0, Math.round(Number(p?.numComments) || 0)),
    listing: LISTINGS.includes(p?.listing) ? p.listing : 'new',
    keyword: text(p?.keyword, 200),
  };
}

async function postsByIds(postIds, s) {
  if (!postIds.length) return { ok: true, data: new Map() };
  const res = await sbQuery({
    method: 'GET',
    table: postsTable(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&post_id=in.(${postIds.map(encodeURIComponent).join(',')})&select=*&limit=${postIds.length}`,
  });
  if (!res.ok) return explainMissing(res, 'The posts already found could not be read');
  return { ok: true, data: new Map((Array.isArray(res.data) ? res.data : []).map((r) => [r.post_id, r])) };
}

/**
 * Keep what the Mini found. A post already kept is refreshed (score, comment
 * count, title and body) and keeps its first found_at and its comments; a new
 * one is added. Answers `{ added, refreshed }`.
 */
async function savePosts(posts, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const clean = [];
  const ids = new Set();
  for (const p of Array.isArray(posts) ? posts : []) {
    const row = cleanPost(p);
    if (!row || ids.has(row.post_id)) continue;
    ids.add(row.post_id);
    clean.push(row);
  }
  const existing = await postsByIds([...ids], s);
  if (!existing.ok) return existing;
  let added = 0;
  let refreshed = 0;
  const now = new Date().toISOString();
  for (const row of clean) {
    const prior = existing.data.get(row.post_id);
    let res;
    if (prior) {
      const { post_id: _id, keyword, ...rest } = row;
      // eslint-disable-next-line no-await-in-loop
      res = await sbQuery({
        method: 'PATCH',
        table: postsTable(),
        query: `project_id=eq.${encodeURIComponent(s.projectId)}&id=eq.${encodeURIComponent(prior.id)}&select=id`,
        headers: { Prefer: 'return=representation' },
        body: { ...rest, keyword: keyword || prior.keyword || '', updated_at: now },
      });
      if (res.ok) refreshed += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop
      res = await sbQuery({
        method: 'POST',
        table: postsTable(),
        query: 'select=id',
        headers: { Prefer: 'return=representation' },
        body: [{ ...row, project_id: s.projectId, owner_user_id: s.userId, found_at: now, created_at: now, updated_at: now }],
      });
      if (res.ok) added += 1;
    }
    if (!res.ok) return explainMissing(res, `The post ${row.post_id} was not kept`);
  }
  return { ok: true, status: 200, data: { added, refreshed } };
}

/** The strongest comments under one kept post, as the Mini's browser read them. */
async function saveComments(postId, comments, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const id = text(postId, 20).toLowerCase();
  if (!POST_ID_RE.test(id)) return refuse('That is not a Reddit post id.');
  const now = new Date().toISOString();
  const res = await sbQuery({
    method: 'PATCH',
    table: postsTable(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&post_id=eq.${encodeURIComponent(id)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { top_comments: commentsOf(comments), comments_read_at: now, updated_at: now },
  });
  if (!res.ok) return explainMissing(res, 'The comments were not saved');
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return refuse(`The post ${id} is not kept for this project.`, 404);
  return { ok: true, status: 200, data: rowToPost(row) };
}

/** The kept posts, newest found first. */
async function listPosts(limit = 500, scope = null) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const res = await sbQuery({
    method: 'GET',
    table: postsTable(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&select=*&order=found_at.desc&limit=${bounded.limit}`,
  });
  if (!res.ok) return explainMissing(res, 'The posts found could not be read');
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToPost) };
}

module.exports = {
  SQL_FILE,
  STATUSES,
  STATUS_MOVES,
  MAX_COMMENTS,
  SUBREDDITS_PER_PASS,
  FRESH_FOR_MS,
  subredditName,
  listSubreddits,
  addSubreddits,
  getSubreddit,
  decideSubreddit,
  recordRead,
  listWatchedProjects,
  savePosts,
  saveComments,
  listPosts,
  rowToPost,
  rowToSubreddit,
};
