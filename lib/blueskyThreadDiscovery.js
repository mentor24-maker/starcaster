'use strict';

const blueskyClient = require('./blueskyClient');

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

function normalizeSourceMode(value) {
  const text = safeText(value).toLowerCase();
  if (text === 'api' || text === 'browser') return text;
  return 'auto';
}

function isHttpUrl(value) {
  const text = safeText(value);
  if (!text) return false;
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractBskyPostParts(target) {
  const text = safeText(target);
  if (!isHttpUrl(text)) return null;
  try {
    const url = new URL(text);
    const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/i);
    if (!match) return null;
    return {
      handle: safeText(decodeURIComponent(match[1] || '')),
      postId: safeText(decodeURIComponent(match[2] || '')),
    };
  } catch {
    return null;
  }
}

function extractBskyFeedParts(target) {
  const text = safeText(target);
  if (!isHttpUrl(text)) return null;
  try {
    const url = new URL(text);
    const match = url.pathname.match(/^\/profile\/([^/]+)\/feed\/([^/?#]+)/i);
    if (!match) return null;
    return {
      handle: safeText(decodeURIComponent(match[1] || '')),
      feedId: safeText(decodeURIComponent(match[2] || '')),
    };
  } catch {
    return null;
  }
}

function normalizeHandle(value) {
  const text = safeText(value).replace(/^@+/, '');
  if (!text) return '';
  if (text.startsWith('https://bsky.app/profile/')) {
    try {
      const url = new URL(text);
      const match = url.pathname.match(/^\/profile\/([^/]+)/i);
      return safeText(match && match[1]);
    } catch {
      return '';
    }
  }
  return text;
}

function ageHours(createdAt) {
  const ts = Date.parse(safeText(createdAt));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 3600000);
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
  if (!needle || !haystack) return 0;
  if (haystack.includes(needle)) return 22;
  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const matches = words.filter((word) => haystack.includes(word)).length;
  return matches ? Math.min(18, matches * 6) : 0;
}

async function fetchJson(endpoint, accessJwt) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(accessJwt ? { authorization: `Bearer ${accessJwt}` } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return { ok: false, status: 0, endpoint, error: safeText(err?.message) || 'request failed' };
  }
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      endpoint,
      error: safeText(payload?.message || payload?.error || raw) || `Bluesky request failed (${response.status})`,
      data: payload,
    };
  }
  return { ok: true, status: response.status, endpoint, data: payload };
}

async function resolveActorDid(actor, serviceUrl, accessJwt) {
  const endpoint = `${serviceUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
  const res = await fetchJson(endpoint, accessJwt);
  if (!res.ok) return res;
  const did = safeText(res.data?.did);
  if (!did) return { ok: false, status: 404, endpoint, error: 'Could not resolve BlueSky actor DID.' };
  return { ok: true, did, profile: res.data };
}

function scorePost(post, options = {}) {
  const likeCount = Number(post?.like_count || 0) || 0;
  const replyCount = Number(post?.reply_count || 0) || 0;
  const repostCount = Number(post?.repost_count || 0) || 0;
  const quoteCount = Number(post?.quote_count || 0) || 0;
  const hours = ageHours(post?.created_at);
  const text = safeText(post?.text);
  const keyword = safeText(options.keyword);
  let total = 0;
  const reasons = [];

  const recency = recencyPoints(hours);
  total += recency;
  if (recency) reasons.push(hours <= 24 ? 'fresh discussion' : 'recent discussion');

  const engagement = Math.min(28, Math.floor(Math.log10(likeCount + 1) * 12) + Math.floor(Math.log10(replyCount + repostCount + quoteCount + 1) * 10));
  total += engagement;
  if (engagement >= 18) reasons.push('strong engagement');
  else if (engagement >= 8) reasons.push('moderate engagement');

  const relevance = keywordPoints(text, keyword);
  total += relevance;
  if (relevance) reasons.push(`matches "${keyword}"`);

  return {
    score: total,
    reasons: reasons.filter(Boolean),
  };
}

function filterPost(post, options = {}) {
  const startMs = parseDateStartMs(options.startTime || options.start_time);
  const endMs = parseDateEndMs(options.endTime || options.end_time);
  const createdMs = Date.parse(safeText(post?.created_at));
  const keyword = safeText(options.keyword).toLowerCase();
  const likeCount = Number(post?.like_count || 0) || 0;
  const replyCount = Number(post?.reply_count || 0) || 0;
  const text = safeText(post?.text).toLowerCase();

  if (Number.isFinite(startMs) && Number.isFinite(createdMs) && createdMs < startMs) return false;
  if (Number.isFinite(endMs) && Number.isFinite(createdMs) && createdMs > endMs) return false;
  if (likeCount < (Number(options.minLikes || 0) || 0)) return false;
  if (replyCount < (Number(options.minReplies || 0) || 0)) return false;
  if (keyword && !text.includes(keyword)) return false;
  return true;
}

function mapViewerPost(view) {
  if (!view || typeof view !== 'object') return null;
  const post = view.post || view;
  const author = post?.author || view.author || {};
  const uri = safeText(post?.uri);
  const record = post?.record || {};
  const text = safeText(record?.text || post?.text);
  const handle = safeText(author?.handle);
  const rkey = safeText(uri.split('/').pop());
  return {
    post_uri: uri,
    post_url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : '',
    author_handle: handle,
    author_display_name: safeText(author?.displayName),
    text,
    created_at: safeText(record?.createdAt || post?.indexedAt || post?.createdAt),
    reply_count: Number(post?.replyCount || 0) || 0,
    like_count: Number(post?.likeCount || 0) || 0,
    repost_count: Number(post?.repostCount || 0) || 0,
    quote_count: Number(post?.quoteCount || 0) || 0,
  };
}

function collectThreadReplies(node, out = [], depth = 0, maxItems = 25) {
  if (!node || out.length >= maxItems) return out;
  const replies = Array.isArray(node.replies) ? node.replies : [];
  replies.forEach((replyNode) => {
    if (out.length >= maxItems) return;
    const mapped = mapViewerPost(replyNode);
    if (mapped) {
      out.push({
        ...mapped,
        depth,
      });
    }
    collectThreadReplies(replyNode, out, depth + 1, maxItems);
  });
  return out;
}

async function fetchPostThreadCandidate(target, serviceUrl, accessJwt, keyword, minLikes, minReplies, startTime, endTime) {
  const parts = extractBskyPostParts(target);
  if (!parts) return null;
  const resolved = await resolveActorDid(parts.handle, serviceUrl, accessJwt);
  if (!resolved.ok) return { ok: false, status: resolved.status || 404, error: resolved.error };
  const uri = `at://${resolved.did}/app.bsky.feed.post/${parts.postId}`;
  const endpoint = `${serviceUrl}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=6`;
  const res = await fetchJson(endpoint, accessJwt);
  if (!res.ok) return res;
  const threadNode = res.data?.thread;
  const candidate = mapViewerPost(threadNode);
  if (!candidate) return { ok: false, status: 404, error: 'BlueSky post not found.' };
  const threadReplies = collectThreadReplies(threadNode)
    .filter((reply) => filterPost(reply, { keyword: '', minLikes: 0, minReplies: 0, startTime, endTime }))
    .slice(0, 25);
  if (!filterPost(candidate, { keyword, minLikes, minReplies, startTime, endTime })) {
    return { ok: true, status: 200, data: { candidates: [], thread_replies: threadReplies } };
  }
  const ranking = scorePost(candidate, { keyword });
  return {
    ok: true,
    status: 200,
    data: {
      mode: 'post',
      thread_replies: threadReplies,
      candidates: [{
        ...candidate,
        discovery_score: ranking.score,
        why_relevant: ranking.reasons.join(', '),
        reply_opportunity: ranking.score >= 30 ? 'high' : 'medium',
      }],
    },
  };
}

async function fetchAuthorFeedCandidates(actor, serviceUrl, accessJwt, sort, maxPosts, keyword, minLikes, minReplies, startTime, endTime) {
  const endpoint = `${serviceUrl}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${encodeURIComponent(String(Math.min(100, maxPosts * 2)))}`;
  const res = await fetchJson(endpoint, accessJwt);
  if (!res.ok) return res;
  const feed = Array.isArray(res.data?.feed) ? res.data.feed : [];
  const candidates = feed
    .map((entry) => mapViewerPost(entry?.post))
    .filter(Boolean)
    .filter((post) => filterPost(post, { keyword, minLikes, minReplies, startTime, endTime }))
    .map((post) => {
      const ranking = scorePost(post, { keyword });
      return {
        ...post,
        discovery_score: ranking.score,
        why_relevant: ranking.reasons.join(', '),
        reply_opportunity: ranking.score >= 30 ? 'high' : 'medium',
      };
    })
    .sort((a, b) => {
      if (sort === 'top' || sort === 'engaging') return Number(b.discovery_score || 0) - Number(a.discovery_score || 0);
      return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0);
    })
    .slice(0, maxPosts);
  return { ok: true, status: 200, data: { mode: 'author_feed', candidates } };
}

async function fetchSearchCandidates(query, serviceUrl, accessJwt, sort, maxPosts, keyword, minLikes, minReplies, startTime, endTime) {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(100, maxPosts * 2)),
    sort: sort === 'top' || sort === 'engaging' ? 'top' : 'latest',
  });
  const endpoint = `${serviceUrl}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`;
  const res = await fetchJson(endpoint, accessJwt);
  if (!res.ok) return res;
  const posts = Array.isArray(res.data?.posts) ? res.data.posts : [];
  const candidates = posts
    .map((view) => mapViewerPost(view))
    .filter(Boolean)
    .filter((post) => filterPost(post, { keyword, minLikes, minReplies, startTime, endTime }))
    .map((post) => {
      const ranking = scorePost(post, { keyword: keyword || query });
      return {
        ...post,
        discovery_score: ranking.score,
        why_relevant: ranking.reasons.join(', '),
        reply_opportunity: ranking.score >= 30 ? 'high' : 'medium',
      };
    })
    .sort((a, b) => Number(b.discovery_score || 0) - Number(a.discovery_score || 0))
    .slice(0, maxPosts);
  return { ok: true, status: 200, data: { mode: 'search', candidates } };
}

async function discoverBlueskyThreads(input = {}) {
  const target = safeText(input.target);
  const sourceMode = normalizeSourceMode(input.sourceMode || input.source_mode || 'auto');
  const sort = safeText(input.sort || 'new').toLowerCase() || 'new';
  const maxPosts = clampInteger(input.maxPosts || input.max_posts, 1, 100, 20);
  const keyword = safeText(input.keyword);
  const minLikes = clampInteger(input.minLikes || input.min_likes, 0, 100000, 0);
  const minReplies = clampInteger(input.minReplies || input.min_replies, 0, 100000, 0);
  const startTime = normalizeDateInput(input.startTime || input.start_time);
  const endTime = normalizeDateInput(input.endTime || input.end_time);

  if (!target) {
    return { ok: false, status: 400, error: 'Handle, feed, or BlueSky post URL is required.' };
  }

  if (sourceMode === 'browser') {
    return { ok: false, status: 400, error: 'OpenClaw browser discovery for BlueSky is not implemented yet. Use Auto or API.' };
  }

  const creds = blueskyClient.getBlueskyCredentials();
  if (!blueskyClient.isConfigured(creds)) {
    return { ok: false, status: 400, error: 'BlueSky API is not configured in Settings > APIs or Vercel env vars.' };
  }
  const auth = await blueskyClient.createSession(creds);
  if (!auth.ok) return auth;
  const accessJwt = auth.accessJwt;
  const serviceUrl = creds.serviceUrl;

  const postResult = await fetchPostThreadCandidate(target, serviceUrl, accessJwt, keyword, minLikes, minReplies, startTime, endTime);
  if (postResult && postResult.ok) {
    return {
      ok: true,
      status: 200,
      data: {
        source_mode: 'api',
        sort,
        target,
        filters: { keyword, min_likes: minLikes, min_replies: minReplies, start_time: startTime, end_time: endTime },
        ...postResult.data,
      },
    };
  }

  const feedParts = extractBskyFeedParts(target);
  if (feedParts) {
    const resolved = await resolveActorDid(feedParts.handle, serviceUrl, accessJwt);
    if (!resolved.ok) return { ok: false, status: resolved.status || 404, error: resolved.error };
    const feedUri = `at://${resolved.did}/app.bsky.feed.generator/${feedParts.feedId}`;
    const endpoint = `${serviceUrl}/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=${encodeURIComponent(String(Math.min(100, maxPosts * 2)))}`;
    const res = await fetchJson(endpoint, accessJwt);
    if (!res.ok) return res;
    const feed = Array.isArray(res.data?.feed) ? res.data.feed : [];
    const candidates = feed
      .map((entry) => mapViewerPost(entry?.post))
      .filter(Boolean)
      .filter((post) => filterPost(post, { keyword, minLikes, minReplies, startTime, endTime }))
      .map((post) => {
        const ranking = scorePost(post, { keyword });
        return {
          ...post,
          discovery_score: ranking.score,
          why_relevant: ranking.reasons.join(', '),
          reply_opportunity: ranking.score >= 30 ? 'high' : 'medium',
        };
      })
      .sort((a, b) => Number(b.discovery_score || 0) - Number(a.discovery_score || 0))
      .slice(0, maxPosts);
    return {
      ok: true,
      status: 200,
      data: {
        mode: 'feed',
        source_mode: 'api',
        sort,
        target,
        filters: { keyword, min_likes: minLikes, min_replies: minReplies, start_time: startTime, end_time: endTime },
        candidates,
      },
    };
  }

  const actor = normalizeHandle(target);
  if (actor && !safeText(actor).includes(' ')) {
    const authorResult = await fetchAuthorFeedCandidates(actor, serviceUrl, accessJwt, sort, maxPosts, keyword, minLikes, minReplies, startTime, endTime);
    if (authorResult.ok) {
      return {
        ok: true,
        status: 200,
        data: {
          source_mode: 'api',
          sort,
          target,
          filters: { keyword, min_likes: minLikes, min_replies: minReplies, start_time: startTime, end_time: endTime },
          ...authorResult.data,
        },
      };
    }
  }

  const query = keyword || target;
  const searchResult = await fetchSearchCandidates(query, serviceUrl, accessJwt, sort, maxPosts, keyword, minLikes, minReplies, startTime, endTime);
  if (!searchResult.ok) return searchResult;
  return {
    ok: true,
    status: 200,
    data: {
      source_mode: 'api',
      sort,
      target,
      filters: { keyword, min_likes: minLikes, min_replies: minReplies, start_time: startTime, end_time: endTime },
      ...searchResult.data,
    },
  };
}

module.exports = {
  discoverBlueskyThreads,
};
