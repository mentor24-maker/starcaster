'use strict';

/**
 * Reddit comments 2/4 (task 86bch3jp3) — one row per Reddit comment
 * Starcaster writes for Dane: the post it answers, the draft, his approval,
 * and (4/4) the proof it was posted.
 *
 * Table: docs/SQL/reddit_comments_setup.sql. Shaped like
 * lib/substackNotesStore.js; the drafting rules live in
 * lib/redditCommentDrafter.js and the Reddit read in lib/redditPostReader.js.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10);
 * the list takes the limit FIRST (landmine 12b).
 *
 * TENANCY FAILS CLOSED, the way lib/canonStore.js does it: both tenant columns
 * are written explicitly from the scope rather than through scopedInsertRow,
 * whose column probe can quietly stamp neither (landmine 12), and every read
 * filters on project_id itself. A scope without a project AND a user is
 * refused before any request is made.
 *
 * THE DATABASE IS THE ONLY STORE. No local-file fallback (landmines 6, 15).
 *
 * Status path (STATUS_MOVES):
 *
 *   idea ─► draft ─► approved ─► posting ─► posted
 *     │       │         │                 └► failed ─► approved (try again)
 *     └───────┴─────────┴─► rejected ─► idea (think again)
 */

const { sbQuery, tableConfig } = require('./supabase');
const { resolveLimit } = require('./storeLimit');
const { readField, unknownKeyError } = require('./storeInput');
const canonStore = require('./canonStore');
const reader = require('./redditPostReader');
const drafter = require('./redditCommentDrafter');

const STATUSES = Object.freeze(['idea', 'draft', 'approved', 'rejected', 'posting', 'posted', 'failed']);

/** Which status may follow which. A status "moved" to itself is not a move. */
const STATUS_MOVES = Object.freeze({
  idea: Object.freeze(['draft', 'rejected']),
  draft: Object.freeze(['approved', 'rejected']),
  approved: Object.freeze(['posting', 'rejected']),
  rejected: Object.freeze(['idea']),
  posting: Object.freeze(['posted', 'failed']),
  posted: Object.freeze([]),
  failed: Object.freeze(['approved', 'rejected']),
});

const MAX_TITLE_LENGTH = 1000;
const MAX_BODY_LENGTH = 20000;
const MAX_COMMENT_LENGTH = 4000;
const MAX_ERROR_LENGTH = 2000;
const ADD_FIELDS = ['url', 'postTitle', 'postBody', 'parentCommentText'];

function table() {
  return tableConfig().redditCommentItems || 'reddit_comment_items';
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400, extra = {}) {
  return { ok: false, status, error, ...extra };
}

function scopeOrError(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  const userId = safeText(scope?.userId || scope?.user_id, 120);
  if (!projectId) return { error: refuse('No project is selected, so there are no Reddit comments to read or change.') };
  if (!userId) return { error: refuse('No signed-in user was given — both tenant columns are required for a Reddit comment.') };
  return { projectId, userId };
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    targetUrl: safeText(row.target_url),
    postId: safeText(row.post_id, 40),
    parentCommentId: safeText(row.parent_comment_id, 40),
    subreddit: safeText(row.subreddit, 100),
    postTitle: safeText(row.post_title, MAX_TITLE_LENGTH),
    postBody: safeText(row.post_body, MAX_BODY_LENGTH),
    postAuthor: safeText(row.post_author, 100),
    parentCommentAuthor: safeText(row.parent_comment_author, 100),
    parentCommentText: safeText(row.parent_comment_text, MAX_COMMENT_LENGTH),
    topComments: Array.isArray(row.top_comments) ? row.top_comments : [],
    postReadFrom: row.post_read_from || 'reddit',
    draftText: safeText(row.draft_text, drafter.REDDIT_COMMENT_MAX_LENGTH),
    finalText: safeText(row.final_text, drafter.REDDIT_COMMENT_MAX_LENGTH),
    canonUsed: Array.isArray(row.canon_used) ? row.canon_used : [],
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

function textOrError(field, value, max) {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return refuse(`${field} must be text`);
  const text = value.trim();
  if (text.length > max) return refuse(`${field} must be ${max} characters or fewer`);
  return { ok: true, value: text };
}

/**
 * Add a comment to write, from a Reddit post or comment link. The post is
 * read from Reddit; when Reddit refuses, the answer is a 409 with
 * `code: POST_TEXT_NEEDED` and the reason, and Add can be sent again with the
 * post pasted by hand (`postTitle` / `postBody`, and `parentCommentText` for a
 * comment link). Anything pasted wins over a read — Dane chose it.
 *
 * options.readPost  replaces the Reddit read: (url) → reader envelope (tests)
 */
async function addItem(input, scope = null, options = {}) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const unknown = unknownKeyError(input, ADD_FIELDS);
  if (unknown) return unknown;

  if (!safeText(input?.url)) return refuse('url is required — paste the link to a Reddit post or comment.');
  const link = reader.parseRedditLink(input.url);
  if (!link.ok) return refuse(link.error, 400, { code: link.code });
  const pasted = {};
  for (const [field, max] of [['postTitle', MAX_TITLE_LENGTH], ['postBody', MAX_BODY_LENGTH], ['parentCommentText', MAX_COMMENT_LENGTH]]) {
    const supplied = readField(input, field);
    if (!supplied.ok) return supplied;
    const read = textOrError(field, supplied.value, max);
    if (!read.ok) return read;
    pasted[field] = read.value;
  }

  let post;
  let readFrom;
  if (pasted.postTitle || pasted.postBody) {
    if (link.data.commentId && !pasted.parentCommentText) {
      return refuse('That link is to a comment — paste the comment being replied to as well as the post.', 400);
    }
    readFrom = 'pasted';
    post = {
      ...link.data,
      title: pasted.postTitle,
      body: pasted.postBody,
      author: '',
      topComments: [],
      comment: link.data.commentId ? { author: '', body: pasted.parentCommentText } : null,
    };
  } else {
    const readPost = typeof options.readPost === 'function' ? options.readPost : reader.readRedditPost;
    const read = await readPost(input.url);
    if (!read?.ok) {
      const why = safeText(read?.error, 500) || 'no reason given.';
      return refuse(
        `The post could not be read from Reddit: ${why}${/paste/i.test(why) ? '' : ' Paste the post\'s title and text, then Add again.'}`,
        409,
        { code: 'POST_TEXT_NEEDED', readerCode: read?.code || '' },
      );
    }
    readFrom = 'reddit';
    post = read.data;
  }

  const now = new Date().toISOString();
  const row = {
    project_id: s.projectId,
    owner_user_id: s.userId,
    target_url: reader.canonicalUrl({ ...link.data, subreddit: post.subreddit || link.data.subreddit }),
    post_id: link.data.postId,
    parent_comment_id: link.data.commentId,
    subreddit: safeText(post.subreddit, 100),
    post_title: safeText(post.title, MAX_TITLE_LENGTH),
    post_body: safeText(post.body, MAX_BODY_LENGTH),
    post_author: safeText(post.author, 100),
    parent_comment_author: safeText(post.comment?.author, 100),
    parent_comment_text: safeText(post.comment?.body, MAX_COMMENT_LENGTH),
    top_comments: Array.isArray(post.topComments) ? post.topComments : [],
    post_read_from: readFrom,
    status: 'idea',
    created_at: now,
    updated_at: now,
  };
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return refuse(`The Reddit comment was not saved: ${res.error}`, res.status || 502);
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!created) return refuse('The Reddit comment was not saved — the database returned no row.', 500);
  return { ok: true, status: 201, data: rowToItem(created) };
}

async function getItemById(id, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const itemId = safeText(id, 120);
  if (!itemId) return refuse('id is required');
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `id=eq.${encodeURIComponent(itemId)}&project_id=eq.${encodeURIComponent(s.projectId)}&select=*&limit=1`,
  });
  if (!res.ok) return refuse(`Could not read the Reddit comment: ${res.error}`, res.status || 502);
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('Reddit comment not found in this project', 404);
  return { ok: true, status: 200, data: rowToItem(found) };
}

/** The project's Reddit comments, newest first, optionally one status. Limit FIRST. */
async function listItems(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const filters = [`project_id=eq.${encodeURIComponent(s.projectId)}`];
  const status = options?.status;
  if (status !== undefined && status !== null && status !== '') {
    if (!STATUSES.includes(status)) return refuse(`status must be one of ${STATUSES.join(', ')} — got ${JSON.stringify(status)}`);
    filters.push(`status=eq.${encodeURIComponent(status)}`);
  }
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `${filters.join('&')}&select=*&order=created_at.desc&limit=${bounded.limit}`,
  });
  if (!res.ok) return refuse(`Could not read the Reddit comments: ${res.error}`, res.status || 502);
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToItem) };
}

/**
 * Move an item from `item.status` to `columns.status`, writing `columns`, but
 * only if it is still in that status. The status filter is the guard: two
 * clicks racing cannot both win — the second matches no row and gets a 409.
 */
async function moveIfStatus(item, columns, scope) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const to = columns.status || item.status;
  if (to !== item.status && !STATUS_MOVES[item.status].includes(to)) {
    const next = STATUS_MOVES[item.status];
    return refuse(`status cannot move from ${item.status} to ${to} — from ${item.status} it can go to ${next.length ? next.join(', ') : 'nothing (it is finished)'}`, 409);
  }
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${encodeURIComponent(item.id)}&project_id=eq.${encodeURIComponent(s.projectId)}`
      + `&status=eq.${encodeURIComponent(item.status)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { ...columns, updated_at: new Date().toISOString() },
  });
  if (!res.ok) return refuse(`The Reddit comment was not saved: ${res.error}`, res.status || 502);
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('This was already changed somewhere else — reload to see where it stands.', 409);
  return { ok: true, status: 200, data: rowToItem(updated) };
}

/** The post as the drafter wants it, from a stored item. */
function itemToPost(item) {
  return {
    subreddit: item.subreddit,
    title: item.postTitle,
    body: item.postBody,
    author: item.postAuthor,
    topComments: item.topComments,
    comment: item.parentCommentId ? { author: item.parentCommentAuthor, body: item.parentCommentText } : null,
  };
}

/**
 * "Write a draft" on an idea, and "Write another" on a draft. A draft that
 * breaks a rule is NOT saved; the refusal names the rule (422) and the item
 * stays as it was. With no canon copied, nothing is written at all.
 *
 * options.generate  replaces the AI call (tests)
 * options.canonDocs replaces the canon read (tests)
 */
async function writeDraftForItem(id, scope = null, options = {}) {
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;
  const item = existing.data;
  if (item.status !== 'idea' && item.status !== 'draft') {
    return refuse(`This comment is ${item.status}, so no draft was written — only an idea or a waiting draft can be drafted.`, 409);
  }

  let canonDocs = options.canonDocs;
  if (!Array.isArray(canonDocs)) {
    const canon = await canonStore.listCanon(100, scope);
    if (!canon.ok) return refuse(`Not written: the canon could not be read (${canon.error}).`, canon.status || 502);
    canonDocs = canon.data;
  }

  const drafted = await drafter.writeDraft({ post: itemToPost(item), canonDocs }, { generate: options.generate, scope });
  if (!drafted.ok) return drafted;
  return moveIfStatus(item, {
    status: 'draft',
    draft_text: drafted.data.text,
    final_text: '',
    canon_used: drafted.data.canonUsed,
  }, scope);
}

/**
 * Approve a draft, with Dane's wording (`text`) when he edited it. His words
 * are re-checked against the CURRENT canon blocklist and Reddit's length —
 * but not the self-promotion rule, because a link or project name in his
 * edit is there because he added it.
 */
async function approveItem(id, input = {}, scope = null, options = {}) {
  const unknown = unknownKeyError(input || {}, ['text']);
  if (unknown) return unknown;
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;
  const item = existing.data;
  if (item.status !== 'draft') {
    return refuse(`This comment is ${item.status}, not a draft waiting for approval, so it cannot be approved here.`, 409);
  }
  const supplied = input && Object.prototype.hasOwnProperty.call(input, 'text') ? input.text : undefined;
  if (supplied !== undefined && typeof supplied !== 'string') return refuse('text must be the comment\'s wording');
  const text = String(supplied === undefined ? item.draftText : supplied).trim();

  let canonDocs = options.canonDocs;
  if (!Array.isArray(canonDocs)) {
    const canon = await canonStore.listCanon(100, scope);
    if (!canon.ok) return refuse(`Not approved: the canon could not be read (${canon.error}).`, canon.status || 502);
    canonDocs = canon.data;
  }
  const canon = drafter.prepareCanon(canonDocs);
  if (!canon.ok) return { ...canon, error: canon.error.replace(/^Not written/, 'Not approved') };
  const checked = drafter.checkCommentText(text, { blocked: canon.blocked, allowSelfPromotion: true });
  if (!checked.ok) {
    return refuse(`Not approved: ${drafter.describeProblems(checked.problems)}.`, 422, { problems: checked.problems });
  }
  return moveIfStatus(item, {
    status: 'approved',
    final_text: text,
    approved_by: safeText(scope?.userId || scope?.user_id, 120),
    approved_at: new Date().toISOString(),
  }, scope);
}

/** Reject an idea, a draft or an approved comment. It keeps its draft, marked rejected. */
async function rejectItem(id, scope = null) {
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;
  const item = existing.data;
  if (!STATUS_MOVES[item.status].includes('rejected')) {
    return refuse(`This comment is ${item.status}, so it cannot be rejected.`, 409);
  }
  return moveIfStatus(item, { status: 'rejected', approved_by: '', approved_at: null }, scope);
}

module.exports = {
  STATUSES,
  STATUS_MOVES,
  addItem,
  getItemById,
  listItems,
  writeDraftForItem,
  approveItem,
  rejectItem,
  moveIfStatus,
  rowToItem,
};
