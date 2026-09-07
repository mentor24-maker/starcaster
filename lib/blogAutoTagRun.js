'use strict';

/**
 * The Auto-tag extension's run: read a project's posts, add the clearly
 * matching EXISTING tags to each, remember exactly what was added, and undo
 * a whole run in one call (ticket 86bbw4dch, slice 2 of 3).
 *
 * The scoring is lib/blogAutoTag.js (slice 1, measured on 86bbw4dcd). This
 * file is the orchestration around it, and it keeps its decisions in pure
 * functions so the node suite can test them without a database:
 *
 *   tagsToAdd(current, suggestions)     what the run appends to one post
 *   tagsToRemoveOnUndo(current, added)  what undo takes back off one post
 *   undoDecision(entries)               missing | already-undone | ok
 *   assertBatch(postIds)                at most BATCH_SIZE ids per call
 *
 * THE CLIENT IS THE LOOP. One call handles at most BATCH_SIZE posts, exactly
 * as the bulk blog import does (lib/blogImportStore.js): a single long
 * request is cut off server-side on Vercel, and a run that dies halfway with
 * nothing recorded is one that cannot be undone. Every write here is read
 * back before it is recorded, and every failure is NAMED in the response
 * rather than swallowed -- a partial run that reports success is the PR #21
 * failure (routes/builder.js, the propagation undo).
 *
 * PROFILES SEE THE START STATE. Later batches of one run would otherwise
 * learn from the tags earlier batches added, so a suggestion could reinforce
 * itself. Before building profiles, the tags this run already added are
 * subtracted from the posts that received them.
 */

const crypto = require('node:crypto');
const { listPosts, getPost, updatePost } = require('./blogPostsStore');
const { buildTagProfiles, suggestTags, collapseKey, tagKey, normalizeTags } = require('./blogAutoTag');
const { recordRunEntries, listRunEntries, markRunUndone } = require('./blogTagRunsStore');
const { listExtensions, trackExtensionUse } = require('./builderExtensionsStore');

const BATCH_SIZE = 10;
const PAGE_LIMIT = 100;
const EXTENSION_SLUG = 'auto-tag';

function safeText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

/** Every post in the project, page by page (the limit is capped at 100 a page). */
async function allPosts(scope) {
  const out = [];
  for (let page = 1; page < 200; page++) {
    const batch = await listPosts({ page, limit: PAGE_LIMIT }, scope);
    if (!Array.isArray(batch) || !batch.length) break;
    out.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
  }
  return out;
}

/**
 * What the run appends to a post: each suggestion's (canonical) tag unless
 * the post already carries it by near-duplicate key. Order is the
 * suggestion order (best first); duplicates within the suggestions collapse.
 */
function tagsToAdd(currentTags, suggestions) {
  const carried = new Set(normalizeTags(currentTags).map(collapseKey));
  const out = [];
  for (const s of Array.isArray(suggestions) ? suggestions : []) {
    const tag = safeText(s?.tag);
    if (!tag) continue;
    const key = collapseKey(tag);
    if (!key || carried.has(key)) continue;
    carried.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * What undo takes back: exactly the tags the run added that are STILL on the
 * post (matched exactly, case-insensitively). A tag the author renamed or
 * removed since is simply not there; a tag the author added by hand since is
 * not in `added`, so it stays.
 */
function tagsToRemoveOnUndo(currentTags, added) {
  const addedKeys = new Set((Array.isArray(added) ? added : []).map(tagKey).filter(Boolean));
  const current = normalizeTags(currentTags);
  const removed = current.filter((t) => addedKeys.has(tagKey(t)));
  const next = current.filter((t) => !addedKeys.has(tagKey(t)));
  return { next, removed };
}

/** missing = no such run; already-undone = every entry stamped; ok = undo it. */
function undoDecision(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return 'missing';
  if (list.every((e) => e && e.undoneAt)) return 'already-undone';
  return 'ok';
}

/** Returns an error string, or '' when the batch is acceptable. */
function assertBatch(postIds) {
  if (!Array.isArray(postIds) || !postIds.length) return 'postIds is required';
  if (postIds.length > BATCH_SIZE) return `At most ${BATCH_SIZE} posts per call — send the rest in the next batch`;
  if (postIds.some((id) => !safeText(id))) return 'postIds must be non-empty strings';
  return '';
}

/** The whole project, so the client can drive the batches. */
async function listCandidates(scope) {
  const posts = await allPosts(scope);
  const vocabulary = new Set();
  for (const p of posts) for (const t of normalizeTags(p.tags)) vocabulary.add(collapseKey(t));
  return {
    ok: true,
    status: 200,
    data: {
      postIds: posts.map((p) => String(p.id)),
      total: posts.length,
      tagCount: vocabulary.size,
      batchSize: BATCH_SIZE,
    },
  };
}

/** Bump the Auto-tag extension's usage once per run. Best effort, never fails a run. */
async function trackRunUse(scope) {
  try {
    const listed = await listExtensions(500, scope);
    const extension = (listed.ok ? listed.data : []).find((e) => e.slug === EXTENSION_SLUG);
    if (extension) await trackExtensionUse(extension.id, scope);
  } catch (_) {
    /* usage is a nicety; the run is the work */
  }
}

/**
 * Handle one batch of a run.
 *
 * @param {object} input
 * @param {string} [input.runId]   Absent on the first call: a new run is minted.
 * @param {string[]} input.postIds At most BATCH_SIZE.
 * @param {object} [options]
 * @param {number} [options.threshold]  Passed to the scorer; default from slice 1.
 */
async function runBatch(input, scope, options = {}) {
  const problem = assertBatch(input?.postIds);
  if (problem) return { ok: false, status: 400, error: problem, code: 'VALIDATION_ERROR' };
  const postIds = input.postIds.map((id) => safeText(id, 160));
  const isNewRun = !safeText(input.runId, 160);
  const runId = isNewRun ? crypto.randomUUID() : safeText(input.runId, 160);

  const posts = await allPosts(scope);
  if (!posts.length) return { ok: false, status: 404, error: 'This project has no blog posts.', code: 'NOT_FOUND' };

  // Read the run's history FIRST, on a new run too. A missing history table
  // stops the run here, before a single post is rewritten -- a tag added and
  // not remembered is one Undo can never see. And the prior entries are how
  // profiles are built from the START state of this run: subtract what the
  // run has already added, so later batches do not learn from earlier ones.
  const prior = await listRunEntries(runId, scope);
  if (!prior.ok) return prior;
  const priorAdded = new Map();
  for (const e of prior.data) priorAdded.set(e.postId, new Set(e.tagsAdded.map(tagKey)));
  const startState = posts.map((p) => {
    const added = priorAdded.get(String(p.id));
    return added ? { ...p, tags: normalizeTags(p.tags).filter((t) => !added.has(tagKey(t))) } : p;
  });
  const vocabulary = [...new Set(startState.flatMap((p) => normalizeTags(p.tags)))];
  if (!vocabulary.length) return { ok: false, status: 400, error: 'No tags exist yet — add one on a post first.', code: 'NO_TAGS' };
  const model = buildTagProfiles(startState, { vocabulary });
  const byId = new Map(posts.map((p) => [String(p.id), p]));

  const results = [];
  const failed = [];
  const entries = [];
  // Sequential on purpose: each write is a post rewrite and a read-back.
  for (const postId of postIds) {
    const post = byId.get(postId);
    if (!post) { failed.push({ postId, error: 'Post not found in this project' }); continue; }
    const suggestions = suggestTags(post, model, { threshold: options.threshold });
    const add = tagsToAdd(post.tags, suggestions);
    if (!add.length) { results.push({ postId, title: safeText(post.title), added: [] }); continue; }

    const nextTags = [...normalizeTags(post.tags), ...add];
    const updated = await updatePost(postId, { tags: nextTags }, scope);
    if (!updated) { failed.push({ postId, error: 'Save failed' }); continue; }
    const readBack = await getPost(postId, scope);
    const landed = new Set(normalizeTags(readBack?.tags).map(tagKey));
    const missing = add.filter((t) => !landed.has(tagKey(t)));
    if (missing.length) { failed.push({ postId, error: `Saved, but read back without: ${missing.join(', ')}` }); continue; }

    entries.push({ postId, tagsAdded: add });
    const evidenceFor = new Map(suggestions.map((s) => [collapseKey(s.tag), s.evidence]));
    results.push({ postId, title: safeText(post.title), added: add.map((tag) => ({ tag, evidence: evidenceFor.get(collapseKey(tag)) || [] })) });
  }

  if (entries.length) {
    const recorded = await recordRunEntries(runId, entries, scope);
    if (!recorded.ok) {
      // The tags ARE on the posts and the record is not: say so, loudly, with what to undo by hand.
      return {
        ok: false,
        status: recorded.status || 500,
        error: `${recorded.error} — ${entries.length} post(s) were tagged in this batch but the run could not be recorded, so Undo cannot see them: ${entries.map((e) => `${e.postId} (${e.tagsAdded.join(', ')})`).join('; ')}`,
        code: recorded.code || 'RUN_NOT_RECORDED',
      };
    }
  }
  if (isNewRun) await trackRunUse(scope);

  return {
    ok: true,
    status: 200,
    data: {
      runId,
      results,
      failed,
      tagged: entries.length,
      tagsAdded: entries.reduce((n, e) => n + e.tagsAdded.length, 0),
    },
  };
}

/** What an undo would touch NOW -- recomputed from the posts, never remembered. */
async function describeRun(runId, scope) {
  const listed = await listRunEntries(runId, scope);
  if (!listed.ok) return listed;
  const decision = undoDecision(listed.data);
  if (decision === 'missing') return { ok: false, status: 404, error: 'No such run in this project.', code: 'NOT_FOUND' };
  const posts = [];
  let stillPresent = 0;
  for (const entry of listed.data) {
    const post = await getPost(entry.postId, scope);
    const { removed } = tagsToRemoveOnUndo(post?.tags, entry.tagsAdded);
    stillPresent += removed.length;
    posts.push({ postId: entry.postId, title: safeText(post?.title), tagsAdded: entry.tagsAdded, stillPresent: removed, exists: Boolean(post) });
  }
  return {
    ok: true,
    status: 200,
    data: { runId: safeText(runId, 160), undone: decision === 'already-undone', posts, postCount: posts.length, tagsStillPresent: stillPresent },
  };
}

/** Undo one run: sequential, exact, and a second undo changes nothing. */
async function undoRun(runId, scope) {
  const listed = await listRunEntries(runId, scope);
  if (!listed.ok) return listed;
  const decision = undoDecision(listed.data);
  if (decision === 'missing') return { ok: false, status: 404, error: 'No such run in this project.', code: 'NOT_FOUND' };
  if (decision === 'already-undone') return { ok: false, status: 409, error: 'This run was already undone.', code: 'ALREADY_UNDONE' };

  const restored = [];
  const failed = [];
  for (const entry of listed.data) {
    if (entry.undoneAt) continue;
    const post = await getPost(entry.postId, scope);
    if (!post) { failed.push({ postId: entry.postId, error: 'Post no longer exists' }); continue; }
    const { next, removed } = tagsToRemoveOnUndo(post.tags, entry.tagsAdded);
    if (!removed.length) { restored.push({ postId: entry.postId, title: safeText(post.title), removed: [] }); continue; }
    const updated = await updatePost(entry.postId, { tags: next }, scope);
    if (!updated) { failed.push({ postId: entry.postId, error: 'Save failed' }); continue; }
    const readBack = await getPost(entry.postId, scope);
    const left = normalizeTags(readBack?.tags).filter((t) => removed.some((r) => tagKey(r) === tagKey(t)));
    if (left.length) { failed.push({ postId: entry.postId, error: `Saved, but read back still carrying: ${left.join(', ')}` }); continue; }
    restored.push({ postId: entry.postId, title: safeText(post.title), removed });
  }

  // Only a run with NO failures is stamped undone: a partial undo must stay undoable.
  let undone = false;
  if (!failed.length) {
    const marked = await markRunUndone(runId, scope);
    if (!marked.ok) return { ...marked, error: `${marked.error} — the tags were removed but the run is not marked undone; a second undo will find nothing to remove.` };
    undone = true;
  }
  return { ok: true, status: 200, data: { runId: safeText(runId, 160), restored, failed, undone } };
}

module.exports = {
  BATCH_SIZE,
  EXTENSION_SLUG,
  tagsToAdd,
  tagsToRemoveOnUndo,
  undoDecision,
  assertBatch,
  listCandidates,
  runBatch,
  describeRun,
  undoRun,
};
