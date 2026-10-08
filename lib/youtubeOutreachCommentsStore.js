'use strict';

/**
 * YouTube outreach 4/7 (task 86bcda661) — the comments the outreach agent
 * writes for each target video, and Dane's approve / reject on each.
 *
 * Table: docs/SQL/youtube_outreach_comments_setup.sql. The drafting itself is
 * lib/youtubeOutreachDrafter.js; the targets and account settings it reads are
 * lib/youtubeOutreachStore.js (slice 1/7). Nothing here posts: the Mini's
 * worker (workers/youtube-outreach/, ticket 5/7) does, and moves each row
 * through `approved -> posting -> posted | failed` with the guarded writes at
 * the bottom of this file.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10);
 * list functions take the limit FIRST (landmine 12b). Tenancy fails closed
 * exactly as the targets store does — see its header for why.
 *
 * A DECISION IS MADE ONCE. Approve and reject only move a row out of `draft`,
 * and the write itself is filtered on `status=eq.draft`, so two clicks racing
 * (two tabs, a double-click) cannot both win: the second finds no draft row
 * and is told the comment was already decided, rather than overwriting the
 * first decision.
 */

const { sbQuery, tableConfig } = require('./supabase');
const {
  supportsProjectColumns, scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow,
} = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { unknownKeyError } = require('./storeInput');
const targetsStore = require('./youtubeOutreachStore');
const drafter = require('./youtubeOutreachDrafter');

const STATUSES = ['draft', 'approved', 'rejected', 'posting', 'posted', 'failed'];

/** What the screen calls each status. */
const STATUS_WORDS = {
  draft: 'waiting for approval',
  approved: 'approved',
  rejected: 'rejected',
  posting: 'being posted',
  posted: 'posted',
  failed: 'failed to post',
};

/**
 * A row still `posting` this long after the worker took it is one whose worker
 * died mid-post (or could not prove what happened). Posting a comment takes a
 * browser a minute or two; ten is well past that. It is never retried — the
 * screen asks Dane to check it by hand, because a second attempt could post the
 * same words twice under his name.
 */
const POSTING_STALE_MS = 10 * 60 * 1000;

function commentsTable() { return tableConfig().youtubeOutreachComments; }

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400, extra = {}) {
  return { ok: false, status, error, ...extra };
}

async function requireScope(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) {
    return refuse('No project is selected, so there are no outreach comments to read or change.');
  }
  if (!(await supportsProjectColumns(commentsTable()))) {
    return refuse(
      `The ${commentsTable()} table is not available with its project columns, so it cannot be read safely. `
      + 'Has docs/SQL/youtube_outreach_comments_setup.sql been applied to this database?',
      503
    );
  }
  return { ok: true };
}

/** True when a `posting` row needs a person to look at YouTube before anything else happens. */
function needsHandCheck(row, now = Date.now()) {
  if (!row || row.status !== 'posting') return false;
  if (safeText(row.post_error, 1000)) return true;
  const started = Date.parse(row.posting_started_at || row.updated_at || '');
  return !Number.isFinite(started) || now - started >= POSTING_STALE_MS;
}

function rowToComment(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    accountKey: safeText(row.account_key, 80),
    targetId: safeText(row.target_id, 120),
    videoId: safeText(row.video_id, 40),
    videoTitle: safeText(row.video_title, 500),
    channelName: safeText(row.channel_name, 300),
    followed: row.followed && typeof row.followed === 'object' ? row.followed : {},
    draftText: String(row.draft_text || ''),
    finalText: String(row.final_text || ''),
    status: row.status,
    approvedBy: safeText(row.approved_by, 120),
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    postedUrl: safeText(row.posted_url),
    postedAt: row.posted_at || null,
    postError: safeText(row.post_error, 1000),
    postingStartedAt: row.posting_started_at || null,
    screenshotUrl: safeText(row.screenshot_url),
    postNote: safeText(row.post_note, 1000),
    waitReason: safeText(row.wait_reason, 500),
    waitCheckedAt: row.wait_checked_at || null,
    needsHandCheck: needsHandCheck(row),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

async function getComment(id, scope = null) {
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const commentId = safeText(id, 120);
  if (!commentId) return refuse('id is required');
  const query = await scopedIdQuery(commentsTable(), `id=eq.${encodeURIComponent(commentId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: commentsTable(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('Comment not found in this project', 404);
  return { ok: true, status: 200, data: rowToComment(found) };
}

/**
 * Comments, newest first. `options.statuses` narrows to some statuses (the
 * Approvals tab asks for draft + approved); `options.targetId` narrows to one
 * video's history, every status included.
 */
async function listComments(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;

  const filters = [];
  const statuses = Array.isArray(options.statuses) ? options.statuses.map((s) => safeText(s, 20)).filter(Boolean) : [];
  for (const status of statuses) {
    if (!STATUSES.includes(status)) return refuse(`status must be one of ${STATUSES.join(', ')} — got ${JSON.stringify(status)}`);
  }
  if (statuses.length) filters.push(`status=in.(${statuses.join(',')})`);
  const targetId = safeText(options.targetId, 120);
  if (targetId) filters.push(`target_id=eq.${encodeURIComponent(targetId)}`);
  const accountKey = safeText(options.accountKey, 80);
  if (accountKey) filters.push(`account_key=eq.${encodeURIComponent(accountKey)}`);

  const query = await scopedListQuery(
    commentsTable(),
    `${filters.length ? `${filters.join('&')}&` : ''}select=*&order=created_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: commentsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToComment) };
}

/** The target a comment belongs to and its account's settings — what every rule check reads. */
async function readRules(targetId, scope) {
  const target = await targetsStore.getTargetById(targetId, scope);
  if (!target.ok) return target;
  const settings = await targetsStore.getSettings(scope, { accountKey: target.data.accountKey });
  if (!settings.ok) return settings;
  return { ok: true, target: target.data, settings: settings.data };
}

/**
 * Write a draft for one target and save it as `draft`. A draft that breaks a
 * rule is NOT saved; the refusal names the rule (422).
 *
 * options.generate  replaces the AI call (tests)
 * options.readVideo replaces the YouTube read: (videoId) → context (tests)
 */
async function writeDraftForTarget(targetId, scope = null, options = {}) {
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const rules = await readRules(targetId, scope);
  if (!rules.ok) return rules;
  const { target, settings } = rules;
  const name = target.videoTitle || target.videoUrl;
  if (target.status !== 'active') {
    return refuse(`"${name}" is ${target.status}, so no draft was written. Resume it first.`, 409);
  }

  const readVideo = typeof options.readVideo === 'function' ? options.readVideo : drafter.readVideoContext;
  const video = await readVideo(target.videoId);
  const drafted = await drafter.writeDraft({ target, settings, video }, { generate: options.generate, scope });
  if (!drafted.ok) return drafted;

  const row = await scopedInsertRow(commentsTable(), {
    account_key: target.accountKey,
    target_id: target.id,
    video_id: target.videoId,
    video_title: target.videoTitle,
    channel_name: target.channelName,
    followed: drafted.data.followed,
    draft_text: drafted.data.text,
    final_text: '',
    status: 'draft',
  }, scope);
  const res = await sbQuery({
    method: 'POST',
    table: commentsTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!created) return refuse('The draft was not saved — the database returned no row.', 500);
  return { ok: true, status: 201, data: { ...rowToComment(created), note: drafted.data.note || '' } };
}

/**
 * Move a draft to `next`, only if it is still a draft. The `status=eq.draft`
 * filter is the guard: a row decided meanwhile matches nothing and comes back
 * as a 409, never as a second decision written over the first.
 */
async function decide(existing, columns, scope) {
  const body = await scopedPatchRow(commentsTable(), { ...columns, updated_at: new Date().toISOString() }, scope);
  const query = await scopedIdQuery(
    commentsTable(),
    `id=eq.${encodeURIComponent(existing.id)}&status=eq.draft&select=*`,
    scope
  );
  const res = await sbQuery({ method: 'PATCH', table: commentsTable(), query, headers: { Prefer: 'return=representation' }, body });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('This comment was already decided — reload to see where it stands.', 409);
  return { ok: true, status: 200, data: rowToComment(updated) };
}

function notADraft(comment) {
  return refuse(`This comment is ${STATUS_WORDS[comment.status] || comment.status}, not waiting for approval, so it cannot be changed here.`, 409);
}

/**
 * Approve a draft, with Dane's edited wording if he changed it. The edited
 * text is checked against the target's CURRENT rules (link policy, words to
 * avoid, YouTube's ceiling); one that breaks a rule is refused with the rule
 * named, and the draft stays a draft.
 */
async function approveComment(id, input = {}, scope = null) {
  const unknown = unknownKeyError(input || {}, ['text']);
  if (unknown) return unknown;
  const existing = await getComment(id, scope);
  if (!existing.ok) return existing;
  if (existing.data.status !== 'draft') return notADraft(existing.data);

  const supplied = input && Object.prototype.hasOwnProperty.call(input, 'text') ? input.text : undefined;
  if (supplied !== undefined && typeof supplied !== 'string') return refuse('text must be the comment\'s wording');
  const text = String(supplied === undefined ? existing.data.draftText : supplied).trim();

  const rules = await readRules(existing.data.targetId, scope);
  if (!rules.ok) return rules;
  const checked = drafter.checkComment(text, rules, { forApproval: true });
  if (!checked.ok) {
    return refuse(`Not approved: ${drafter.describeProblems(checked.problems)}.`, 422, { problems: checked.problems });
  }

  return decide(existing.data, {
    status: 'approved',
    final_text: text,
    approved_by: safeText(scope?.userId || scope?.user_id, 120),
    approved_at: new Date().toISOString(),
  }, scope);
}

/** Reject a draft. It stays in the target's history, marked rejected. */
async function rejectComment(id, scope = null) {
  const existing = await getComment(id, scope);
  if (!existing.ok) return existing;
  if (existing.data.status !== 'draft') return notADraft(existing.data);
  return decide(existing.data, { status: 'rejected', rejected_at: new Date().toISOString() }, scope);
}

/**
 * "Write another": a fresh draft for the same video, and the old one marked
 * rejected. The new one is written FIRST, so a failed rewrite leaves the old
 * draft waiting rather than leaving nothing.
 */
async function redraftComment(id, scope = null, options = {}) {
  const existing = await getComment(id, scope);
  if (!existing.ok) return existing;
  if (existing.data.status !== 'draft') return notADraft(existing.data);
  const fresh = await writeDraftForTarget(existing.data.targetId, scope, options);
  if (!fresh.ok) return fresh;
  const rejected = await decide(existing.data, { status: 'rejected', rejected_at: new Date().toISOString() }, scope);
  if (!rejected.ok && rejected.status !== 409) return rejected;
  return { ok: true, status: 201, data: fresh.data };
}

// ── The Mini's poster (ticket 5/7) ─────────────────────────────────────────
//
// EVERY MOVE IS GUARDED ON THE STATUS IT LEAVES, the same way approve/reject
// are guarded on `draft`. That is what makes "never post twice" a property of
// the database rather than of the worker's memory: only one writer can move a
// row out of `approved`, and a `posting` row can only be settled once. A move
// whose guard matches nothing comes back 409 and changes nothing.

/**
 * Move one row from `from` to whatever `columns` says, only if it is still
 * `from`. `updated_at` is always written.
 */
async function moveFrom(id, from, columns, scope) {
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const commentId = safeText(id, 120);
  if (!commentId) return refuse('id is required');
  const body = await scopedPatchRow(commentsTable(), { ...columns, updated_at: new Date().toISOString() }, scope);
  const query = await scopedIdQuery(
    commentsTable(),
    `id=eq.${encodeURIComponent(commentId)}&status=eq.${from}&select=*`,
    scope
  );
  const res = await sbQuery({ method: 'PATCH', table: commentsTable(), query, headers: { Prefer: 'return=representation' }, body });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse(`This comment is no longer ${STATUS_WORDS[from] || from}, so it was left alone.`, 409);
  return { ok: true, status: 200, data: rowToComment(updated) };
}

/** Approved comments for one account, oldest approval first — the poster's queue. */
async function listApprovedForPosting(limit = 50, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const accountKey = safeText(options.accountKey, 80);
  const query = await scopedListQuery(
    commentsTable(),
    `status=eq.approved${accountKey ? `&account_key=eq.${encodeURIComponent(accountKey)}` : ''}`
      + `&select=*&order=approved_at.asc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: commentsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToComment) };
}

/**
 * Comments that went out — or may have — for one account, newest first. The
 * limits count `posting` rows as used: a row the worker died holding may well
 * be on YouTube, and counting it is the side that cannot over-post.
 */
async function listPostedForLimits(limit = 200, scope = null, options = {}) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return refuse(bounded.error);
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const accountKey = safeText(options.accountKey, 80);
  const query = await scopedListQuery(
    commentsTable(),
    `status=in.(posting,posted)${accountKey ? `&account_key=eq.${encodeURIComponent(accountKey)}` : ''}`
      + `&select=*&order=updated_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: commentsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToComment) };
}

/** Take an approved comment: `approved -> posting`. Only one taker can win. */
function markPosting(id, scope = null) {
  return moveFrom(id, 'approved', {
    status: 'posting',
    posting_started_at: new Date().toISOString(),
    wait_reason: '',
    post_error: '',
  }, scope);
}

/** `posting -> posted`, with the proof. Only the worker that proved it calls this. */
function markPosted(id, proof = {}, scope = null) {
  return moveFrom(id, 'posting', {
    status: 'posted',
    posted_url: safeText(proof.url),
    posted_at: new Date().toISOString(),
    screenshot_url: safeText(proof.screenshotUrl),
    post_note: safeText(proof.note, 1000),
    post_error: '',
  }, scope);
}

/** `posting -> failed`, with the reason in OpenClaw's (or YouTube's) own words. */
function markFailed(id, failure = {}, scope = null) {
  return moveFrom(id, 'posting', {
    status: 'failed',
    post_error: safeText(failure.error, 1000) || 'Posting failed, and nothing said why.',
    posted_url: safeText(failure.url),
    screenshot_url: safeText(failure.screenshotUrl),
    post_note: safeText(failure.note, 1000),
  }, scope);
}

/**
 * Leave a row `posting` and say why a person has to look: the outcome could
 * not be proven either way, so retrying could post twice and calling it failed
 * could hide a comment that is live.
 */
function flagForHandCheck(id, details = {}, scope = null) {
  return moveFrom(id, 'posting', {
    post_error: safeText(details.error, 1000) || 'The worker could not tell whether this posted.',
    posted_url: safeText(details.url),
    screenshot_url: safeText(details.screenshotUrl),
    post_note: safeText(details.note, 1000),
  }, scope);
}

/** Say why an approved comment is still waiting. Blank clears it. */
function noteWaiting(id, reason, scope = null) {
  return moveFrom(id, 'approved', {
    wait_reason: safeText(reason, 500),
    wait_checked_at: new Date().toISOString(),
  }, scope);
}

module.exports = {
  STATUSES,
  STATUS_WORDS,
  POSTING_STALE_MS,
  needsHandCheck,
  listApprovedForPosting,
  listPostedForLimits,
  markPosting,
  markPosted,
  markFailed,
  flagForHandCheck,
  noteWaiting,
  getComment,
  listComments,
  writeDraftForTarget,
  approveComment,
  rejectComment,
  redraftComment,
  rowToComment,
};
