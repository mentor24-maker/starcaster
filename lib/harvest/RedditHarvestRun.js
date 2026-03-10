'use strict';

const redditClient = require('../redditClient');

function safeText(value) {
  return String(value || '').trim();
}

function normalizeInput(input = {}) {
  return {
    target: safeText(input.target),
    mode: safeText(input.mode || 'auto').toLowerCase(),
    subreddit: safeText(input.subreddit),
    post_id: safeText(input.post_id || input.postId),
    sort: safeText(input.sort || 'new').toLowerCase(),
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

async function runRedditHarvest(rawInput = {}) {
  const input = normalizeInput(rawInput);
  if (!input.target && !input.subreddit && !input.post_id) {
    return { ok: false, status: 400, error: 'Provide a subreddit link/name or a specific Reddit post link.' };
  }

  const mode = inferMode(input);
  if (mode === 'post') {
    const target = input.target || input.post_id;
    const thread = await redditClient.getPostThread({
      target,
      limit: input.max_comments,
      includeReplies: input.include_replies,
    });
    if (!thread.ok) return thread;
    return {
      ok: true,
      status: thread.status,
      data: {
        mode: 'post',
        post: thread.data?.post || null,
        comments: Array.isArray(thread.data?.comments) ? thread.data.comments : [],
        posts: thread.data?.post ? [thread.data.post] : [],
        subreddit: safeText(thread.data?.post?.subreddit),
        endpoint: safeText(thread.data?.endpoint),
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
  });
  if (!listing.ok) return listing;

  const posts = Array.isArray(listing.data?.posts) ? listing.data.posts : [];
  const comments = [];
  const errors = [];
  let remainingComments = input.max_comments;

  // Comment collection on subreddit harvest is budgeted to keep runs reliable/fast.
  const commentPostBudget = Math.min(posts.length, 30);
  for (let idx = 0; idx < commentPostBudget && remainingComments > 0; idx += 1) {
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
    });
    if (!thread.ok) {
      errors.push({
        post_id: safeText(post.id || post.name),
        error: safeText(thread.error || 'Failed to load comments'),
        status: Number(thread.status || 0) || 0,
      });
      continue;
    }
    const threadComments = Array.isArray(thread.data?.comments) ? thread.data.comments : [];
    threadComments.forEach((comment) => {
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
      errors,
    },
  };
}

module.exports = {
  runRedditHarvest,
  normalizeInput,
};
