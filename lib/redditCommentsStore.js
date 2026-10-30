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
 * THE POST IS READ BY THE MINI'S BROWSER (Outreach wizard 17/19, task
 * 86bcrmbuv). Reddit refuses reads that are not signed in (measured
 * 2026-10-12, lib/redditPostReader.js), so Add no longer asks Reddit from
 * this server: it saves the row `read_state: reading` and the Mini's worker
 * (workers/youtube-outreach/adapters/reddit.js) opens the link in its
 * signed-in browser and fills the post in, or says why it could not. Add only
 * queues a read while the Mini's last sign-in check says it is signed in —
 * otherwise it answers POST_TEXT_NEEDED with that reason and the screen
 * offers the paste box, as before. Columns: docs/SQL/reddit_comments_browser_read.sql.
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
const feedbackStore = require('./outreachFeedbackStore');
const outreachLessons = require('./outreachLessons');

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
const PASTE_FIELDS = ['postTitle', 'postBody', 'parentCommentText'];

/** Where the Mini's read of the post stands. '' = nothing pending. */
const READ_STATES = Object.freeze(['', 'reading', 'failed']);
/** The most top comments a read keeps. */
const MAX_TOP_COMMENTS = 20;
/**
 * A sign-in check older than this cannot vouch for the Mini: its worker has
 * missed a check. One number, in lib/openclawSignIn.js, read by every screen.
 */
const { MINI_STALE_MS } = require('./openclawSignIn');

/** The one account comments post as today (4/4). The SQL default says the same. */
const DEFAULT_ACCOUNT = 'dane_of_earth';
const ACCOUNT_KEY_RE = /^[a-z0-9_-]{1,60}$/;

/** A browser posting one comment takes minutes at most; `posting` past this means the worker died. */
const POSTING_STALE_MS = 10 * 60 * 1000;

/**
 * The owner stamped on a settings row the Mini's worker creates. The worker
 * acts for a project, not for a signed-in person, and the column may not be
 * blank (landmine 12) — so it says plainly who wrote it.
 */
const WORKER_USER = 'system:mini-posting-worker';

function table() {
  return tableConfig().redditCommentItems || 'reddit_comment_items';
}

function settingsTable() {
  return tableConfig().redditCommentSettings || 'reddit_comment_settings';
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

/**
 * A `posting` row a person has to look at: the worker wrote why it could not
 * tell, or it has sat `posting` so long its worker must have died mid-post.
 * Never retried either way — a comment posted twice is posted twice.
 */
function needsHandCheck(row, now = Date.now()) {
  if (!row || row.status !== 'posting') return false;
  if (safeText(row.error, MAX_ERROR_LENGTH)) return true;
  const started = Date.parse(row.posting_started_at || row.updated_at || '');
  return !Number.isFinite(started) || now - started >= POSTING_STALE_MS;
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
    // 17/19. Absent until docs/SQL/reddit_comments_browser_read.sql runs; read as "nothing pending".
    readState: READ_STATES.includes(row.read_state) ? row.read_state || '' : '',
    readError: safeText(row.read_error, MAX_ERROR_LENGTH),
    readCode: safeText(row.read_code, 60),
    readRequestedAt: row.read_requested_at || null,
    readFinishedAt: row.read_finished_at || null,
    draftText: safeText(row.draft_text, drafter.REDDIT_COMMENT_MAX_LENGTH),
    finalText: safeText(row.final_text, drafter.REDDIT_COMMENT_MAX_LENGTH),
    canonUsed: Array.isArray(row.canon_used) ? row.canon_used : [],
    lessonsUsed: Array.isArray(row.lessons_used) ? row.lessons_used : [],
    // Outreach wizard 9/19. Absent until docs/SQL/reddit_comments_draft_options.sql
    // runs; read as "no options", which is how a draft written before it reads.
    draftOptions: Array.isArray(row.draft_options) ? row.draft_options : [],
    chosenOption: Number.isInteger(row.chosen_option) ? row.chosen_option : null,
    status: row.status,
    approvedBy: safeText(row.approved_by, 120),
    approvedAt: row.approved_at || null,
    postedUrl: safeText(row.posted_url),
    screenshotUrl: safeText(row.screenshot_url),
    postedAt: row.posted_at || null,
    error: safeText(row.error, MAX_ERROR_LENGTH),
    // 4/4. Absent until docs/SQL/reddit_comments_posting.sql runs; read as the defaults.
    accountKey: safeText(row.account_key, 80) || DEFAULT_ACCOUNT,
    postingStartedAt: row.posting_started_at || null,
    postNote: safeText(row.post_note, MAX_ERROR_LENGTH),
    waitReason: safeText(row.wait_reason, 500),
    waitCheckedAt: row.wait_checked_at || null,
    needsHandCheck: needsHandCheck(row),
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

/** The pasted post fields of an Add or a paste, each checked: `{ ok, value }`. */
function readPasted(input) {
  const value = {};
  for (const [field, max] of [['postTitle', MAX_TITLE_LENGTH], ['postBody', MAX_BODY_LENGTH], ['parentCommentText', MAX_COMMENT_LENGTH]]) {
    const supplied = readField(input, field);
    if (!supplied.ok) return supplied;
    const read = textOrError(field, supplied.value, max);
    if (!read.ok) return read;
    value[field] = read.value;
  }
  return { ok: true, value };
}

/** "3 hours ago" — for a sentence about the Mini's last check. */
function agoWords(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const PASTE_INSTEAD = 'Paste the post\'s title and text instead.';

/**
 * Can the Mini's browser be asked to read a post right now? Only when its
 * last Reddit sign-in check says signed in, and that check is recent. Every
 * "no" is a sentence naming which one it was, because the screen shows it
 * above the paste box (the ticket's break-test: signed out → paste, with
 * the reason).
 *
 * options.browserCheck  replaces the read of the Mini's last check: () → envelope (tests)
 */
async function miniCanRead(scope, options = {}, now = Date.now()) {
  const read = typeof options.browserCheck === 'function'
    ? await options.browserCheck()
    : await getBrowserCheck(scope);
  if (!read?.ok) {
    return {
      ok: false,
      code: 'MINI_CHECK_UNREADABLE',
      error: `Whether the Mini is signed in to Reddit could not be read (${safeText(read?.error, 300) || 'no reason given'}), so it was not asked to read the post. ${PASTE_INSTEAD}`,
    };
  }
  const check = read.data || {};
  const checkedAt = Date.parse(check.checkedAt || '');
  if (!check.state || !Number.isFinite(checkedAt)) {
    return {
      ok: false,
      code: 'MINI_NOT_CHECKED',
      error: `The Mini has never checked its Reddit sign-in — its worker may not be running — so it cannot read the post. ${PASTE_INSTEAD}`,
    };
  }
  if (now - checkedAt > MINI_STALE_MS) {
    return {
      ok: false,
      code: 'MINI_STALE',
      error: `The Mini last checked its Reddit sign-in ${agoWords(now - checkedAt)}, so its worker may have stopped and would not read the post. ${PASTE_INSTEAD}`,
    };
  }
  if (check.state !== 'signed_in') {
    const said = safeText(check.message, 300).replace(/\.$/, '');
    return {
      ok: false,
      code: 'MINI_SIGNED_OUT',
      error: `The Mini is not signed in to Reddit${said ? ` (${said})` : ''}, so it cannot read the post. ${PASTE_INSTEAD}`,
    };
  }
  return { ok: true };
}

/**
 * Add a comment to write, from a Reddit post or comment link.
 *
 * Nothing pasted: while the Mini is signed in to Reddit, the row is saved
 * with `read_state: reading` and the Mini's browser fills the post in within
 * a couple of minutes (17/19). While it is not, nothing is saved and the
 * answer is a 409 `POST_TEXT_NEEDED` with the reason (`readerCode` names it),
 * and Add can be sent again with the post pasted by hand (`postTitle` /
 * `postBody`, and `parentCommentText` for a comment link). Anything pasted
 * wins — Dane chose it — and the Mini is not asked.
 *
 * options.browserCheck  replaces the read of the Mini's sign-in check (tests)
 */
async function addItem(input, scope = null, options = {}) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const unknown = unknownKeyError(input, ADD_FIELDS);
  if (unknown) return unknown;

  if (!safeText(input?.url)) return refuse('url is required — paste the link to a Reddit post or comment.');
  const link = reader.parseRedditLink(input.url);
  if (!link.ok) return refuse(link.error, 400, { code: link.code });
  const pasted = await readPasted(input);
  if (!pasted.ok) return pasted;

  let post;
  let readFrom;
  let reading = false;
  if (pasted.value.postTitle || pasted.value.postBody) {
    if (link.data.commentId && !pasted.value.parentCommentText) {
      return refuse('That link is to a comment — paste the comment being replied to as well as the post.', 400);
    }
    readFrom = 'pasted';
    post = {
      ...link.data,
      title: pasted.value.postTitle,
      body: pasted.value.postBody,
      author: '',
      topComments: [],
      comment: link.data.commentId ? { author: '', body: pasted.value.parentCommentText } : null,
    };
  } else {
    const mini = await miniCanRead(scope, options);
    if (!mini.ok) return refuse(mini.error, 409, { code: 'POST_TEXT_NEEDED', readerCode: mini.code });
    readFrom = 'reddit';
    reading = true;
    post = { ...link.data, title: '', body: '', author: '', topComments: [], comment: null };
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
  // Only a queued read names the new columns, so a pasted Add still saves
  // before docs/SQL/reddit_comments_browser_read.sql has run.
  if (reading) Object.assign(row, { read_state: 'reading', read_requested_at: now });
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
 * The columns 9/19 added are missing: the SQL has not been run on this
 * database. Said by name, never papered over (landmine 15).
 */
const OPTIONS_SQL = 'docs/SQL/reddit_comments_draft_options.sql';
function missingOptionsColumns(result) {
  if (result.ok) return result;
  if (!/draft_options|chosen_option/.test(String(result.error || ''))) return result;
  return refuse(`${result.error} — this database does not have the three-option columns yet; run ${OPTIONS_SQL}.`, 500, { code: 'SQL_NOT_RUN' });
}

/**
 * "Write with AI" on an idea, and "Three more" on a draft: THREE comments to
 * choose from (Outreach wizard 9/19, task 86bcrmbke). Each is checked on its
 * own; one that breaks a rule twice is dropped and named, the rest are saved
 * in `draft_options`. Only when EVERY option is dropped is nothing saved — the
 * refusal names each rule (422) and the item stays as it was. With no canon
 * copied, nothing is written at all.
 *
 * `draft_text` holds the first option, so everything that reads one draft
 * (the poster, an Approve sent without a pick) still reads a real one.
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
  const lessons = await outreachLessons.lessonsForDraft('reddit', scope, options);
  if (!lessons.ok) return lessons;

  if (item.readState === 'reading') {
    return refuse('The Mini is still reading this post, so there is nothing to answer yet — try again once the post shows here.', 409);
  }
  if (item.readState === 'failed') {
    return refuse('The Mini could not read this post, so there is nothing to answer — paste the post\'s title and text on it first.', 409);
  }

  const drafted = await drafter.writeDraftOptions({ post: itemToPost(item), canonDocs, lessons: lessons.data }, { generate: options.generate, scope });
  if (!drafted.ok) return drafted;
  const draftOptions = [
    ...drafted.data.options.map((o) => ({ text: o.text, angle: o.angle, rule: { ok: true } })),
    ...drafted.data.dropped.map((d) => ({ angle: d.angle, dropped: true, rule: { ok: false, reason: d.reason, problems: d.problems } })),
  ];
  return missingOptionsColumns(outreachLessons.explainMissingLessonsColumn(await moveIfStatus(item, {
    status: 'draft',
    draft_text: drafted.data.options[0].text,
    draft_options: draftOptions,
    chosen_option: null,
    final_text: '',
    canon_used: drafted.data.canonUsed,
    lessons_used: drafted.data.lessonsUsed,
  }, scope)));
}

/**
 * Approve a draft, with Dane's wording (`text`) when he edited it, and which
 * of the options he picked (`option`, its index in draftOptions). His words
 * are re-checked against the CURRENT canon blocklist and Reddit's length —
 * but not the self-promotion rule, because a link or project name in his
 * edit is there because he added it.
 */
async function approveItem(id, input = {}, scope = null, options = {}) {
  const unknown = unknownKeyError(input || {}, ['text', 'option']);
  if (unknown) return unknown;
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;
  const item = existing.data;
  if (item.status !== 'draft') {
    return refuse(`This comment is ${item.status}, not a draft waiting for approval, so it cannot be approved here.`, 409);
  }
  const supplied = input && Object.prototype.hasOwnProperty.call(input, 'text') ? input.text : undefined;
  if (supplied !== undefined && typeof supplied !== 'string') return refuse('text must be the comment\'s wording');

  // Which option he picked. Only a KEPT option can be picked — a dropped one
  // broke a rule twice and its words were never saved.
  const pickedRaw = input && Object.prototype.hasOwnProperty.call(input, 'option') ? input.option : undefined;
  let picked = null;
  if (pickedRaw !== undefined && pickedRaw !== null) {
    const kept = item.draftOptions.map((o, i) => (o && !o.dropped && o.text ? i : -1)).filter((i) => i >= 0);
    if (!Number.isInteger(pickedRaw) || !kept.includes(pickedRaw)) {
      return refuse(kept.length
        ? `option must be the number of one of this draft's replies (${kept.join(', ')}) — got ${JSON.stringify(pickedRaw)}`
        : `This draft has no replies to choose from, so option ${JSON.stringify(pickedRaw)} cannot be picked.`);
    }
    picked = pickedRaw;
  }
  const fallback = picked === null ? item.draftText : item.draftOptions[picked].text;
  const text = String(supplied === undefined ? fallback : supplied).trim();

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
  const columns = {
    status: 'approved',
    final_text: text,
    approved_by: safeText(scope?.userId || scope?.user_id, 120),
    approved_at: new Date().toISOString(),
  };
  // Written only when there is a pick, so approving an older single draft
  // never touches a column the database may not have yet.
  if (picked !== null) columns.chosen_option = picked;
  const decided = missingOptionsColumns(await moveIfStatus(item, columns, scope));
  // What he did with it — the edit and the pick are the signal (12/19).
  return feedbackStore.attachFeedback(decided, {
    channel: 'reddit',
    itemId: item.id,
    action: feedbackStore.approvalAction({ shown: fallback, finalText: text, picked }),
    draftText: fallback,
    finalText: text,
    chosenOption: picked,
  }, scope);
}

/**
 * The post pasted by hand onto a row the Mini is reading or could not read —
 * the screen's fallback. Guarded on the read state it saw, so a paste and
 * the Mini's answer racing cannot both land: whichever is second gets a 409.
 */
async function pasteForItem(id, input = {}, scope = null) {
  const unknown = unknownKeyError(input || {}, PASTE_FIELDS);
  if (unknown) return unknown;
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;
  const item = existing.data;
  if (item.status !== 'idea' || !['reading', 'failed'].includes(item.readState)) {
    return refuse('This post is already in, so there is nothing to paste.', 409);
  }
  const pasted = readPasted(input || {});
  if (!pasted.ok) return pasted;
  const { postTitle, postBody, parentCommentText } = pasted.value;
  if (!postTitle && !postBody) return refuse('Paste the post\'s title or its text.');
  if (item.parentCommentId && !parentCommentText) {
    return refuse('That link is to a comment — paste the comment being replied to as well as the post.');
  }
  return moveIfRead(item.id, item.readState, {
    post_title: postTitle,
    post_body: postBody,
    parent_comment_text: item.parentCommentId ? parentCommentText : '',
    post_read_from: 'pasted',
    read_state: '',
    read_error: '',
    read_code: '',
  }, scope);
}

/** "Try reading again" on a row the Mini could not read. Same sign-in rule as Add. */
async function readAgain(id, scope = null, options = {}) {
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;
  const item = existing.data;
  if (item.status !== 'idea' || item.readState !== 'failed') {
    return refuse('Only a post the Mini could not read can be read again.', 409);
  }
  const mini = await miniCanRead(scope, options);
  if (!mini.ok) return refuse(mini.error, 409, { code: 'POST_TEXT_NEEDED', readerCode: mini.code });
  return moveIfRead(item.id, 'failed', {
    read_state: 'reading',
    read_error: '',
    read_code: '',
    read_requested_at: new Date().toISOString(),
    read_finished_at: null,
  }, scope);
}

/**
 * Write `columns` on an `idea` row only while its read is still `from`.
 * Scoped by project only, so the Mini's worker (no user) can use it too.
 */
async function moveIfRead(id, from, columns, scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) return refuse('No project was given, so there are no Reddit comments to read or change.');
  const itemId = safeText(id, 120);
  if (!itemId) return refuse('id is required');
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${encodeURIComponent(itemId)}&project_id=eq.${encodeURIComponent(projectId)}`
      + `&status=eq.idea&read_state=eq.${encodeURIComponent(from)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { ...columns, updated_at: new Date().toISOString() },
  });
  if (!res.ok) return refuse(`The Reddit comment was not saved: ${res.error}`, res.status || 502);
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('This was already changed somewhere else — reload to see where it stands.', 409);
  return { ok: true, status: 200, data: rowToItem(updated) };
}

/**
 * Reject an idea, a draft or an approved comment. It keeps its draft, marked
 * rejected. `input` carries WHY (Outreach wizard 12/19): `{ reasons, note }`,
 * both optional — none is Skip, recorded as "no reason given".
 */
async function rejectItem(id, scope = null, input = {}) {
  const why = feedbackStore.readRejectInput(input);
  if (!why.ok) return why;
  const existing = await getItemById(id, scope);
  if (!existing.ok) return existing;
  const item = existing.data;
  if (!STATUS_MOVES[item.status].includes('rejected')) {
    return refuse(`This comment is ${item.status}, so it cannot be rejected.`, 409);
  }
  const decided = await moveIfStatus(item, { status: 'rejected', approved_by: '', approved_at: null }, scope);
  return feedbackStore.attachFeedback(decided, {
    channel: 'reddit',
    itemId: item.id,
    action: 'rejected',
    reasons: why.data.reasons,
    note: why.data.note,
    draftText: item.finalText || item.draftText,
    finalText: '',
  }, scope);
}

// ── The Mini's posting worker (Reddit comments 4/4, task 86bch3jpg) ───────
//
// Read and moved only by workers/youtube-outreach/adapters/reddit.js. The
// worker acts for a PROJECT, not a signed-in person, so these take a scope
// with a project and no user. Every read still filters on project_id, and
// EVERY MOVE IS GUARDED ON THE STATUS IT LEAVES: only one writer can take a
// row out of `approved`, and a `posting` row is settled once. "Never twice" is
// a property of the database, not of the worker's memory.

const { BROWSER_STATES } = require('./openclawSignIn');

function projectOrError(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) return { error: refuse('No project was given, so there are no Reddit comments to read or change.') };
  return { projectId };
}

function accountOrError(options) {
  const raw = options?.accountKey;
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: DEFAULT_ACCOUNT };
  const key = safeText(raw, 80);
  if (!ACCOUNT_KEY_RE.test(key)) return refuse(`accountKey "${key}" is not an account key (lowercase letters, digits, _ and -)`);
  return { ok: true, value: key };
}

/** Approved comments, oldest approval first — the poster's queue. Limit FIRST. */
async function listApprovedForPosting(limit = 50, scope = null) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const s = projectOrError(scope);
  if (s.error) return s.error;
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&status=eq.approved&select=*&order=approved_at.asc&limit=${bounded.limit}`,
  });
  if (!res.ok) return refuse(`Could not read the approved Reddit comments: ${res.error}`, res.status || 502);
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToItem) };
}

/**
 * Comments that went out — or may have — for one account, newest first. A
 * `posting` row counts as used: one the worker died holding may well be on
 * Reddit, and counting it is the side that cannot over-post.
 */
async function listPostedForLimits(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const s = projectOrError(scope);
  if (s.error) return s.error;
  const account = accountOrError(options);
  if (!account.ok) return account;
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&status=in.(posting,posted)`
      + `&account_key=eq.${encodeURIComponent(account.value)}&select=*&order=updated_at.desc&limit=${bounded.limit}`,
  });
  if (!res.ok) return refuse(`Could not read what has already been posted to Reddit: ${res.error}`, res.status || 502);
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToItem) };
}

/** Write `columns` on the row only while it is still `from`. 409 when it has moved. */
async function moveFromStatus(id, from, columns, scope) {
  const s = projectOrError(scope);
  if (s.error) return s.error;
  const itemId = safeText(id, 120);
  if (!itemId) return refuse('id is required');
  const to = columns.status || from;
  if (to !== from && !STATUS_MOVES[from].includes(to)) {
    return refuse(`status cannot move from ${from} to ${to}`, 409);
  }
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${encodeURIComponent(itemId)}&project_id=eq.${encodeURIComponent(s.projectId)}`
      + `&status=eq.${encodeURIComponent(from)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { ...columns, updated_at: new Date().toISOString() },
  });
  if (!res.ok) return refuse(`The Reddit comment was not saved: ${res.error}`, res.status || 502);
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse(`This comment is no longer ${from} — something else moved it first.`, 409);
  return { ok: true, status: 200, data: rowToItem(updated) };
}

/** Take an approved comment: `approved -> posting`. Only one taker can win (409 otherwise). */
function markPosting(id, scope = null) {
  return moveFromStatus(id, 'approved', {
    status: 'posting',
    posting_started_at: new Date().toISOString(),
    wait_reason: '',
    error: '',
    post_note: '',
  }, scope);
}

/** `posting -> posted`, with the proof. Only the worker that proved it calls this. */
function markPosted(id, proof = {}, scope = null) {
  return moveFromStatus(id, 'posting', {
    status: 'posted',
    posted_url: safeText(proof.url),
    posted_at: new Date().toISOString(),
    screenshot_url: safeText(proof.screenshotUrl),
    post_note: safeText(proof.note, MAX_ERROR_LENGTH),
    error: '',
  }, scope);
}

/** `posting -> failed`, with the reason in OpenClaw's (or Reddit's) own words. */
function markFailed(id, failure = {}, scope = null) {
  return moveFromStatus(id, 'posting', {
    status: 'failed',
    error: safeText(failure.error, MAX_ERROR_LENGTH) || 'Posting failed, and nothing said why.',
    posted_url: safeText(failure.url),
    screenshot_url: safeText(failure.screenshotUrl),
    post_note: safeText(failure.note, MAX_ERROR_LENGTH),
  }, scope);
}

/**
 * Leave a row `posting` and say why a person has to look: it could not be
 * proven either way, so retrying could post twice and calling it failed
 * could hide a comment that is live.
 */
function flagForHandCheck(id, details = {}, scope = null) {
  return moveFromStatus(id, 'posting', {
    error: safeText(details.error, MAX_ERROR_LENGTH) || 'The Mini could not tell whether this went out.',
    posted_url: safeText(details.url),
    screenshot_url: safeText(details.screenshotUrl),
    post_note: safeText(details.note, MAX_ERROR_LENGTH),
  }, scope);
}

// ── The Mini's post reader (Outreach wizard 17/19, task 86bcrmbuv) ────────

/** Posts waiting for the Mini to read them, oldest request first. Limit FIRST. */
async function listPendingReads(limit = 10, scope = null) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const s = projectOrError(scope);
  if (s.error) return s.error;
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&status=eq.idea&read_state=eq.reading`
      + `&select=*&order=read_requested_at.asc&limit=${bounded.limit}`,
  });
  if (!res.ok) return refuse(`Could not read the Reddit posts waiting to be read: ${res.error}`, res.status || 502);
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToItem) };
}

function topCommentsOf(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_TOP_COMMENTS).map((c) => ({
    id: safeText(c?.id, 40),
    author: safeText(c?.author, 100),
    body: safeText(c?.body, MAX_COMMENT_LENGTH),
    score: Number.isFinite(Number(c?.score)) ? Number(c.score) : 0,
  })).filter((c) => c.body);
}

/** `reading -> ''`, with the post as the Mini's browser read it. 409 when it has moved. */
function markRead(id, post = {}, scope = null) {
  return moveIfRead(id, 'reading', {
    subreddit: safeText(post.subreddit, 100),
    post_title: safeText(post.title, MAX_TITLE_LENGTH),
    post_body: safeText(post.body, MAX_BODY_LENGTH),
    post_author: safeText(post.author, 100),
    parent_comment_author: safeText(post.comment?.author, 100),
    parent_comment_text: safeText(post.comment?.body, MAX_COMMENT_LENGTH),
    top_comments: topCommentsOf(post.topComments),
    post_read_from: 'reddit',
    read_state: '',
    read_error: '',
    read_code: '',
    read_finished_at: new Date().toISOString(),
  }, scope);
}

/** `reading -> failed`, with the reason in a sentence. 409 when it has moved. */
function markReadFailed(id, failure = {}, scope = null) {
  return moveIfRead(id, 'reading', {
    read_state: 'failed',
    read_error: safeText(failure.error, MAX_ERROR_LENGTH) || 'The Mini could not read the post, and nothing said why.',
    read_code: safeText(failure.code, 60) || 'READ_FAILED',
    read_finished_at: new Date().toISOString(),
  }, scope);
}

/** Say why an approved comment is still waiting. Blank clears it. */
function noteWaiting(id, reason, scope = null) {
  return moveFromStatus(id, 'approved', {
    wait_reason: safeText(reason, 500),
    wait_checked_at: new Date().toISOString(),
  }, scope);
}

// ── What the Mini last found in its Reddit browser ─────────────────────────
//
// Written once an hour by the posting worker (workers/youtube-outreach/health.js)
// and by nothing else. No route writes these columns, so the screen can neither
// clear nor fake a reading.

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

async function readSettingsRow(projectId, accountKey) {
  const res = await sbQuery({
    method: 'GET',
    table: settingsTable(),
    query: `project_id=eq.${encodeURIComponent(projectId)}&account_key=eq.${encodeURIComponent(accountKey)}&select=*&limit=1`,
  });
  if (!res.ok) return refuse(`Could not read the Reddit sign-in check: ${res.error}`, res.status || 502);
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

/** The account's last sign-in reading. A project that has never been checked reads as blank. */
async function getBrowserCheck(scope = null, options = {}) {
  const s = projectOrError(scope);
  if (s.error) return s.error;
  const account = accountOrError(options);
  if (!account.ok) return account;
  const found = await readSettingsRow(s.projectId, account.value);
  if (!found.ok) return found;
  return { ok: true, status: 200, data: { accountKey: account.value, ...rowToBrowserCheck(found.data) } };
}

/**
 * Record one browser check: patch the account's row when it exists, create
 * it when it does not. A first insert racing another is retried once as a
 * patch (the unique index turns the race into a 409). No fallback anywhere —
 * a refusal is returned as-is (landmine 15).
 */
async function recordBrowserCheck(input, scope = null, options = {}, attempt = 0) {
  const s = projectOrError(scope);
  if (s.error) return s.error;
  const account = accountOrError(options);
  if (!account.ok) return account;
  const state = safeText(input?.state, 40);
  if (!BROWSER_STATES.includes(state)) return refuse(`state must be one of: ${BROWSER_STATES.join(', ')}`);
  const checkedAtMs = Date.parse(safeText(input?.checkedAt, 60));
  if (!Number.isFinite(checkedAtMs)) return refuse('checkedAt is required, as a date and time');
  const checkedAt = new Date(checkedAtMs).toISOString();

  const existing = await readSettingsRow(s.projectId, account.value);
  if (!existing.ok) return existing;

  const columns = {
    browser_state: state,
    browser_message: safeText(input?.message, 1000),
    browser_checked_at: checkedAt,
    updated_at: new Date().toISOString(),
  };
  // Only a good check moves "last signed in"; a bad one leaves the last good
  // time standing, which is what lets the screen say "last signed in …".
  // Who the browser was signed in as, when the check could read a name:
  // the Outreach screen offers it as the account to post as (Outreach wizard
  // 2/19, docs/SQL/outreach_expected_account.sql).
  if (safeText(input?.account, 200)) columns.browser_account = safeText(input.account, 200);
  if (state === 'signed_in') columns.browser_signed_in_at = checkedAt;

  let res;
  if (existing.data) {
    res = await sbQuery({
      method: 'PATCH',
      table: settingsTable(),
      query: `id=eq.${encodeURIComponent(existing.data.id)}&project_id=eq.${encodeURIComponent(s.projectId)}&select=*`,
      headers: { Prefer: 'return=representation' },
      body: columns,
    });
  } else {
    const userId = safeText(scope?.userId || scope?.user_id, 120) || WORKER_USER;
    res = await sbQuery({
      method: 'POST',
      table: settingsTable(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [{ project_id: s.projectId, owner_user_id: userId, account_key: account.value, ...columns }],
    });
    if (!res.ok && res.status === 409 && attempt === 0) {
      return recordBrowserCheck(input, scope, options, attempt + 1);
    }
  }
  if (!res.ok) return refuse(`The Reddit sign-in check was not saved: ${res.error}`, res.status || 502);
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The Reddit sign-in check was not saved — the database returned no row.', 500);
  return { ok: true, status: 200, data: rowToBrowserCheck(saved) };
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
  pasteForItem,
  readAgain,
  miniCanRead,
  listPendingReads,
  markRead,
  markReadFailed,
  READ_STATES,
  MAX_TOP_COMMENTS,
  MINI_STALE_MS,
  moveIfStatus,
  rowToItem,
  DEFAULT_ACCOUNT,
  POSTING_STALE_MS,
  WORKER_USER,
  needsHandCheck,
  listApprovedForPosting,
  listPostedForLimits,
  markPosting,
  markPosted,
  markFailed,
  flagForHandCheck,
  noteWaiting,
  getBrowserCheck,
  recordBrowserCheck,
};
