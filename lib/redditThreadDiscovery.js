'use strict';

const redditClient = require('./redditClient');

function safeText(value) {
  return String(value || '').trim();
}

function clampInteger(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeDateInput(value) {
  const text = safeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function parseDateStartMs(value) {
  const text = normalizeDateInput(value);
  return text ? Date.parse(`${text}T00:00:00.000Z`) : NaN;
}

function parseDateEndMs(value) {
  const text = normalizeDateInput(value);
  return text ? Date.parse(`${text}T23:59:59.999Z`) : NaN;
}

function ageHours(createdUtc) {
  const tsMs = Number(createdUtc || 0) * 1000;
  if (!Number.isFinite(tsMs) || tsMs <= 0) return null;
  return Math.max(0, (Date.now() - tsMs) / 3600000);
}

function recencyPoints(hours) {
  if (hours == null) return 0;
  if (hours <= 6) return 35;
  if (hours <= 24) return 28;
  if (hours <= 72) return 20;
  if (hours <= 168) return 12;
  if (hours <= 336) return 6;
  return 0;
}

function keywordPoints(text, keyword) {
  const haystack = safeText(text).toLowerCase();
  const needle = safeText(keyword).toLowerCase();
  if (!needle) return 0;
  if (!haystack) return 0;
  if (haystack.includes(needle)) return 22;
  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const matches = words.filter((word) => haystack.includes(word)).length;
  return matches ? Math.min(18, matches * 6) : 0;
}

function scorePost(post, options = {}) {
  const score = Number(post?.score || 0) || 0;
  const comments = Number(post?.num_comments || 0) || 0;
  const hours = ageHours(post?.created_utc);
  const title = safeText(post?.title);
  const body = safeText(post?.selftext);
  const keyword = safeText(options.keyword);
  let total = 0;
  const reasons = [];

  const recency = recencyPoints(hours);
  total += recency;
  if (recency) reasons.push(hours <= 24 ? 'fresh discussion' : 'recent discussion');

  const engagement = Math.min(24, Math.floor(Math.log10(score + 1) * 10) + Math.floor(Math.log10(comments + 1) * 8));
  total += engagement;
  if (engagement >= 18) reasons.push('strong engagement');
  else if (engagement >= 8) reasons.push('moderate engagement');

  const relevance = keywordPoints(`${title}\n${body}`, keyword);
  total += relevance;
  if (relevance) reasons.push(`matches "${keyword}"`);

  if (post?.over_18) {
    total -= 50;
    reasons.push('nsfw');
  }

  if (comments < (Number(options.minComments || 0) || 0)) {
    total -= 20;
  }

  if (score < (Number(options.minScore || 0) || 0)) {
    total -= 20;
  }

  return {
    score: total,
    reasons: reasons.filter(Boolean),
  };
}

function filterPost(post, options = {}) {
  const startMs = parseDateStartMs(options.startTime || options.start_time);
  const endMs = parseDateEndMs(options.endTime || options.end_time);
  const createdMs = Number(post?.created_utc || 0) * 1000;
  const keyword = safeText(options.keyword).toLowerCase();
  const score = Number(post?.score || 0) || 0;
  const comments = Number(post?.num_comments || 0) || 0;

  if (options.includeNsfw !== true && post?.over_18) return false;
  if (Number.isFinite(startMs) && createdMs && createdMs < startMs) return false;
  if (Number.isFinite(endMs) && createdMs && createdMs > endMs) return false;
  if (score < (Number(options.minScore || 0) || 0)) return false;
  if (comments < (Number(options.minComments || 0) || 0)) return false;
  if (keyword) {
    const haystack = `${safeText(post?.title)}\n${safeText(post?.selftext)}`.toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  return true;
}

function mapCandidate(post, ranking) {
  const permalink = safeText(post?.permalink);
  return {
    post_id: safeText(post?.id),
    thing_id: safeText(post?.name),
    subreddit: safeText(post?.subreddit),
    title: safeText(post?.title),
    author: safeText(post?.author),
    permalink,
    discussion_url: permalink ? `https://www.reddit.com${permalink}` : '',
    url: safeText(post?.url),
    selftext: safeText(post?.selftext),
    score: Number(post?.score || 0) || 0,
    num_comments: Number(post?.num_comments || 0) || 0,
    created_utc: Number(post?.created_utc || 0) || 0,
    created_at: Number(post?.created_utc || 0) ? new Date(Number(post.created_utc) * 1000).toISOString() : '',
    over_18: Boolean(post?.over_18),
    upvote_ratio: Number(post?.upvote_ratio || 0) || 0,
    discovery_score: Number(ranking?.score || 0) || 0,
    reasons: Array.isArray(ranking?.reasons) ? ranking.reasons : [],
  };
}

async function discoverRedditThreads(input = {}) {
  const target = safeText(input.target);
  const subreddit = redditClient.parseSubredditFromTarget(target || input.subreddit || '');
  const postId = redditClient.parsePostIdFromTarget(target || input.postId || input.post_id || '');
  const sourceMode = redditClient.normalizeSourceMode(input.sourceMode || input.source_mode || 'auto');
  const sort = safeText(input.sort || 'new').toLowerCase() || 'new';
  const maxPosts = clampInteger(input.maxPosts || input.max_posts, 1, 100, 25);
  const keyword = safeText(input.keyword);
  const minScore = clampInteger(input.minScore || input.min_score, 0, 100000, 0);
  const minComments = clampInteger(input.minComments || input.min_comments, 0, 100000, 0);
  const startTime = normalizeDateInput(input.startTime || input.start_time);
  const endTime = normalizeDateInput(input.endTime || input.end_time);

  if (!subreddit && !postId) {
    return { ok: false, status: 400, error: 'A subreddit or Reddit post URL is required.' };
  }

  if (postId) {
    const thread = await redditClient.getPostThread({
      target,
      postId,
      sourceMode,
      includeReplies: false,
      limit: 25,
      depth: 3,
    });
    if (!thread.ok) return thread;
    const post = thread.data?.post || null;
    if (!post) return { ok: false, status: 404, error: 'Reddit post not found.' };
    const ranking = scorePost(post, { keyword, minScore, minComments, startTime, endTime });
    return {
      ok: true,
      status: 200,
      data: {
        mode: 'post',
        source_mode: thread.data?.auth_mode || sourceMode,
        subreddit: safeText(post?.subreddit),
        sort: '',
        target: target || postId,
        filters: { keyword, min_score: minScore, min_comments: minComments, start_time: startTime, end_time: endTime },
        candidates: [mapCandidate(post, ranking)],
      },
    };
  }

  const listing = await redditClient.listSubredditPosts({
    target,
    subreddit,
    sourceMode,
    sort,
    limit: Math.min(100, maxPosts * 2),
  });
  if (!listing.ok) return listing;

  const rawPosts = Array.isArray(listing.data?.posts) ? listing.data.posts : [];
  const candidates = rawPosts
    .filter((post) => filterPost(post, { keyword, minScore, minComments, startTime, endTime }))
    .map((post) => ({ post, ranking: scorePost(post, { keyword, minScore, minComments, startTime, endTime }) }))
    .sort((a, b) => Number(b.ranking.score || 0) - Number(a.ranking.score || 0))
    .slice(0, maxPosts)
    .map(({ post, ranking }) => mapCandidate(post, ranking));

  return {
    ok: true,
    status: 200,
    data: {
      mode: 'subreddit',
      source_mode: listing.data?.auth_mode || sourceMode,
      subreddit,
      sort,
      target: target || subreddit,
      filters: { keyword, min_score: minScore, min_comments: minComments, start_time: startTime, end_time: endTime },
      candidates,
    },
  };
}

module.exports = {
  discoverRedditThreads,
};
