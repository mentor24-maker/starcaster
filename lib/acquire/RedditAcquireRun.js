'use strict';

const redditClient = require('../redditClient');

function safeText(value) {
  return String(value || '').trim();
}

function normalizeInput(input = {}) {
  return {
    target: safeText(input.target),
    mode: safeText(input.mode || 'auto').toLowerCase(),
    source_mode: safeText(input.source_mode || input.sourceMode || 'auto').toLowerCase(),
    subreddit: safeText(input.subreddit),
    post_id: safeText(input.post_id || input.postId),
    sort: safeText(input.sort || 'new').toLowerCase(),
    keyword: safeText(input.keyword),
    start_time: safeText(input.start_time || input.startTime),
    end_time: safeText(input.end_time || input.endTime),
    max_posts: Math.max(1, Math.min(Number(input.max_posts || input.maxPosts || 100) || 100, 500)),
    max_comments: Math.max(1, Math.min(Number(input.max_comments || input.maxComments || 500) || 500, 5000)),
    include_replies: input.include_replies !== false && input.includeReplies !== false,
  };
}

function inferMode(input) {
  if (input.mode === 'subreddit' || input.mode === 'post') return input.mode;
  if (redditClient.parsePostIdFromTarget(input.target || input.post_id)) return 'post';
  return 'subreddit';
}

function parseDateFloorEpoch(value) {
  const text = safeText(value);
  if (!text) return 0;
  const iso = text.length <= 10 ? `${text}T00:00:00.000Z` : text;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function parseDateCeilEpoch(value) {
  const text = safeText(value);
  if (!text) return 0;
  const iso = text.length <= 10 ? `${text}T23:59:59.999Z` : text;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function includesKeyword(item, keyword) {
  if (!keyword) return true;
  const haystack = [
    item?.title,
    item?.selftext,
    item?.body,
    item?.author,
    item?.post_title,
  ].map((v) => safeText(v).toLowerCase()).join('\n');
  return haystack.includes(keyword);
}

function inDateWindow(item, minEpoch, maxEpoch) {
  if (!minEpoch && !maxEpoch) return true;
  const created = Number(item?.created_utc || 0) || 0;
  if (!created) return false;
  if (minEpoch && created < minEpoch) return false;
  if (maxEpoch && created > maxEpoch) return false;
  return true;
}

async function runRedditHarvest(rawInput = {}) {
  const input = normalizeInput(rawInput);
  if (!input.target && !input.subreddit && !input.post_id) {
    return { ok: false, status: 400, error: 'Provide a subreddit link/name or a specific Reddit post link.' };
  }

  const sourceMode = redditClient.normalizeSourceMode(input.source_mode);
  const keyword = safeText(input.keyword).toLowerCase();
  const minEpoch = parseDateFloorEpoch(input.start_time);
  const maxEpoch = parseDateCeilEpoch(input.end_time);
  if (minEpoch && maxEpoch && minEpoch > maxEpoch) {
    return { ok: false, status: 400, error: 'Start date must be before end date.' };
  }

  const mode = inferMode(input);
  const hardTimeoutMs = Math.max(15000, Number(process.env.REDDIT_HARVEST_TIMEOUT_MS || 90000) || 90000);
  const deadlineAt = Date.now() + hardTimeoutMs;
  if (mode === 'post') {
    const target = input.target || input.post_id;
    const thread = await redditClient.getPostThread({
      target,
      limit: input.max_comments,
      includeReplies: input.include_replies,
      sourceMode,
    });
    if (!thread.ok) return thread;
    const post = thread.data?.post || null;
    const postAllowed = post && includesKeyword(post, keyword) && inDateWindow(post, minEpoch, maxEpoch);
    const filteredComments = (Array.isArray(thread.data?.comments) ? thread.data.comments : [])
      .filter((comment) => includesKeyword(comment, keyword) && inDateWindow(comment, minEpoch, maxEpoch));
    return {
      ok: true,
      status: thread.status,
      data: {
        mode: 'post',
        post: postAllowed ? post : null,
        comments: postAllowed ? filteredComments : [],
        posts: postAllowed ? [post] : [],
        subreddit: safeText(post?.subreddit),
        endpoint: safeText(thread.data?.endpoint),
        auth_mode: safeText(thread.data?.auth_mode || ''),
        filters: {
          keyword,
          start_time: input.start_time || '',
          end_time: input.end_time || '',
        },
        errors: [],
      },
    };
  }

  const target = input.target || input.subreddit;
  const listing = await redditClient.listSubredditPosts({
    target,
    subreddit: input.subreddit,
    sort: input.sort,
    limit: input.max_posts,
    sourceMode,
  });
  if (!listing.ok) return listing;

  const posts = (Array.isArray(listing.data?.posts) ? listing.data.posts : [])
    .filter((post) => includesKeyword(post, keyword) && inDateWindow(post, minEpoch, maxEpoch));
  const comments = [];
  const errors = [];
  let remainingComments = input.max_comments;
  let consecutiveFailures = 0;

  // Comment collection on subreddit harvest is budgeted to keep runs reliable/fast.
  const commentPostBudget = Math.min(posts.length, 30);
  for (let idx = 0; idx < commentPostBudget && remainingComments > 0; idx += 1) {
    if (Date.now() >= deadlineAt) {
      errors.push({
        error: `Reddit harvest time budget exceeded after ${hardTimeoutMs}ms`,
        status: 504,
      });
      break;
    }
    const post = posts[idx] || {};
    const postTarget = post.permalink
      ? `https://www.reddit.com${post.permalink}`
      : (post.id || post.name || '');
    if (!postTarget) continue;

    const perPostLimit = Math.max(1, Math.min(remainingComments, 100));
    const thread = await redditClient.getPostThread({
      target: postTarget,
      limit: perPostLimit,
      includeReplies: input.include_replies,
      sourceMode,
    });
    if (!thread.ok) {
      consecutiveFailures += 1;
      errors.push({
        post_id: safeText(post.id || post.name),
        error: safeText(thread.error || 'Failed to load comments'),
        status: Number(thread.status || 0) || 0,
      });
      if (consecutiveFailures >= 3 && comments.length === 0) {
        errors.push({
          error: 'Stopping early after repeated Reddit thread fetch failures.',
          status: 502,
        });
        break;
      }
      continue;
    }
    consecutiveFailures = 0;
    const threadComments = Array.isArray(thread.data?.comments) ? thread.data.comments : [];
    threadComments.forEach((comment) => {
      if (!includesKeyword(comment, keyword) || !inDateWindow(comment, minEpoch, maxEpoch)) return;
      comments.push({
        ...comment,
        post_id: safeText(post.id),
        post_name: safeText(post.name),
        post_title: safeText(post.title),
        post_permalink: safeText(post.permalink),
      });
    });
    remainingComments -= threadComments.length;
  }

  return {
    ok: true,
    status: listing.status,
    data: {
      mode: 'subreddit',
      subreddit: safeText(listing.data?.subreddit),
      sort: safeText(listing.data?.sort),
      posts,
      comments,
      endpoint: safeText(listing.data?.endpoint),
      auth_mode: safeText(listing.data?.auth_mode || ''),
      filters: {
        keyword,
        start_time: input.start_time || '',
        end_time: input.end_time || '',
      },
      errors,
    },
  };
}

module.exports = {
  runRedditHarvest,
  normalizeInput,
};
