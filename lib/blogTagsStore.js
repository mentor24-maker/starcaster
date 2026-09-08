'use strict';

/**
 * The blog's tag list.
 *
 * There is no tags table -- `blog_posts.tags` is a text[] column, so the set
 * of tags that exists is whatever the posts carry. "Managing tags" therefore
 * means rewriting arrays on the posts that carry a word, and this store is
 * where that rewrite is planned and applied.
 *
 * Tags are matched case-INSENSITIVELY but stored with the casing the author
 * typed, so "Immigration" and "immigration" are one tag with two spellings.
 * Listing them separately would make a rename leave half the posts behind and
 * report a count that is not true.
 */

const { listPosts, getPost, updatePost } = require('./blogPostsStore');

/** How many posts to scan when building the tag list. */
const TAG_SCAN_LIMIT = 100;

function safeText(v) { return String(v || '').trim(); }
function tagKey(v) { return safeText(v).toLowerCase(); }

/**
 * Every post in the project, page by page.
 *
 * listPosts caps a page at 100 (CLAUDE.md landmine 12: the limit is the FIRST
 * argument and a scope passed in its place reads as a limit), so a project
 * with more than one page of posts needs every page walked -- otherwise a tag
 * on post 101 is invisible, and a rename silently skips it.
 */
async function allPosts(scope) {
  const out = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await listPosts({ page, limit: TAG_SCAN_LIMIT }, scope);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < TAG_SCAN_LIMIT) break;
  }
  return out;
}

function normalizedTags(post) {
  const tags = Array.isArray(post?.tags) ? post.tags : [];
  return tags.map(safeText).filter(Boolean);
}

/**
 * Is this post on the website? Only a published post is; a draft carries the
 * tag and is invisible to every visitor.
 *
 * This is the whole point of livePostCount below. The manager used to report
 * one number -- "13 posts" -- for a tag whose thirteen posts were all drafts,
 * while the public tag page correctly showed none. Two screens disagreeing
 * with no explanation reads as a broken site, and did (2026-09-03).
 */
function isLive(post) {
  return safeText(post?.status).toLowerCase() === 'published';
}

/**
 * Every distinct tag with a post count, busiest first then alphabetical.
 * A post carrying the same tag twice counts once.
 *
 * Each tag carries TWO counts: `postCount`, every post with the tag, and
 * `livePostCount`, the published ones a visitor can actually reach. They come
 * out of the same scan of the same posts on purpose -- computed separately
 * they could disagree, and a count that contradicts its own total is worse
 * than the single misleading number this replaced.
 */
async function listTags(scope = null) {
  const posts = await allPosts(scope);
  const counts = new Map();
  const liveCounts = new Map();
  const spellings = new Map();

  for (const post of posts) {
    const seenInPost = new Set();
    for (const display of normalizedTags(post)) {
      const key = tagKey(display);
      if (!key || seenInPost.has(key)) continue;
      seenInPost.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (isLive(post)) liveCounts.set(key, (liveCounts.get(key) || 0) + 1);
      const bySpelling = spellings.get(key) || new Map();
      bySpelling.set(display, (bySpelling.get(display) || 0) + 1);
      spellings.set(key, bySpelling);
    }
  }

  const out = [];
  for (const [key, postCount] of counts) {
    out.push({
      tag: preferredSpelling(spellings.get(key), key),
      postCount,
      livePostCount: liveCounts.get(key) || 0,
    });
  }
  out.sort((a, b) => b.postCount - a.postCount || a.tag.localeCompare(b.tag));
  return out;
}

/** The most common spelling; ties break alphabetically so the answer is stable. */
function preferredSpelling(bySpelling, fallback) {
  if (!bySpelling || bySpelling.size === 0) return fallback;
  let best = '';
  let bestCount = -1;
  for (const [spelling, count] of bySpelling) {
    if (count > bestCount || (count === bestCount && spelling.localeCompare(best) < 0)) {
      best = spelling;
      bestCount = count;
    }
  }
  return best || fallback;
}

/** The posts carrying a tag, in any spelling. */
async function listPostsWithTag(tag, scope = null) {
  const key = tagKey(tag);
  if (!key) return [];
  const posts = await allPosts(scope);
  return posts.filter((p) => normalizedTags(p).some((t) => tagKey(t) === key));
}

function renameInPost(post, fromKey, target) {
  const out = [];
  const seen = new Set();
  for (const display of normalizedTags(post)) {
    const next = tagKey(display) === fromKey ? target : display;
    const key = tagKey(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function removeInPost(post, key) {
  const out = [];
  const seen = new Set();
  for (const display of normalizedTags(post)) {
    const displayKey = tagKey(display);
    if (displayKey === key || seen.has(displayKey)) continue;
    seen.add(displayKey);
    out.push(display);
  }
  return out;
}

function unchanged(before, after) {
  return before.length === after.length && before.every((t, i) => t === after[i]);
}

/**
 * Rename a tag across every post carrying it.
 *
 * Renaming onto a tag that already exists is a MERGE: a post carrying both
 * ends up with one, not a duplicate. Only the posts that actually change are
 * written -- rewriting every post to change one tag would bump every
 * updated_at and make the operation impossible to audit afterwards.
 *
 * Each write is read back, and a post whose stored tags do not match what was
 * asked for is reported as failed rather than counted as renamed: a write that
 * reports success is not proof the value landed.
 */
async function renameTag(from, to, scope = null) {
  const fromKey = tagKey(from);
  const target = safeText(to);
  if (!fromKey) return { ok: false, error: 'The tag to rename is required.' };
  if (!target) return { ok: false, error: 'The new tag name is required. To delete a tag, remove it instead.' };

  const posts = await allPosts(scope);
  const plan = [];
  for (const post of posts) {
    if (!post?.id) continue;
    const before = normalizedTags(post);
    const after = renameInPost(post, fromKey, target);
    if (unchanged(before, after)) continue;
    plan.push({ id: post.id, tags: after });
  }
  if (plan.length === 0) return { ok: true, updated: 0, failed: [], merged: false };

  const merged = tagKey(target) !== fromKey
    && posts.some((p) => {
      const keys = normalizedTags(p).map(tagKey);
      return keys.includes(fromKey) && keys.includes(tagKey(target));
    });

  const failed = [];
  let updated = 0;
  for (const item of plan) {
    const result = await updatePost(item.id, { tags: item.tags }, scope);
    if (!result) { failed.push(item.id); continue; }
    // Read the row back. A save that returns a value is not proof the value
    // stored is the one asked for.
    const stored = await getPost(item.id, scope);
    const storedKeys = normalizedTags(stored).map(tagKey).sort();
    const wantedKeys = item.tags.map(tagKey).sort();
    if (storedKeys.join('|') !== wantedKeys.join('|')) { failed.push(item.id); continue; }
    updated += 1;
  }

  return { ok: failed.length === 0, updated, failed, merged };
}

/** Remove a tag from every post carrying it, in any spelling. */
async function removeTag(tag, scope = null) {
  const key = tagKey(tag);
  if (!key) return { ok: false, error: 'The tag to remove is required.' };

  const posts = await allPosts(scope);
  const plan = [];
  for (const post of posts) {
    if (!post?.id) continue;
    const before = normalizedTags(post);
    const after = removeInPost(post, key);
    if (unchanged(before, after)) continue;
    plan.push({ id: post.id, tags: after });
  }
  if (plan.length === 0) return { ok: true, updated: 0, failed: [] };

  const failed = [];
  let updated = 0;
  for (const item of plan) {
    const result = await updatePost(item.id, { tags: item.tags }, scope);
    if (!result) { failed.push(item.id); continue; }
    const stored = await getPost(item.id, scope);
    if (normalizedTags(stored).map(tagKey).includes(key)) { failed.push(item.id); continue; }
    updated += 1;
  }

  return { ok: failed.length === 0, updated, failed };
}

module.exports = { listTags, listPostsWithTag, renameTag, removeTag, TAG_SCAN_LIMIT };
