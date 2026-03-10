'use strict';

const { getProviderValues } = require('./apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function getRedditCredentials() {
  const stored = getProviderValues('reddit') || {};
  return {
    clientId: safeText(process.env.REDDIT_CLIENT_ID) || safeText(stored.client_id),
    clientSecret: safeText(process.env.REDDIT_CLIENT_SECRET) || safeText(stored.client_secret),
    refreshToken: safeText(process.env.REDDIT_REFRESH_TOKEN) || safeText(stored.refresh_token),
    username: safeText(process.env.REDDIT_USERNAME) || safeText(stored.username),
    userAgent: safeText(process.env.REDDIT_USER_AGENT) || safeText(stored.user_agent) || 'alphire-promo/1.0',
  };
}

function isConfigured(creds = getRedditCredentials()) {
  return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken);
}

async function fetchAccessToken(creds = getRedditCredentials()) {
  if (!isConfigured(creds)) {
    return { ok: false, status: 400, error: 'Reddit credentials are missing. Save Client ID, Client Secret, and Refresh Token in Settings > APIs.' };
  }

  const tokenBody = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
  });

  let response;
  try {
    response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': creds.userAgent,
      },
      body: tokenBody,
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Reddit token network error: ${safeText(err?.message) || 'request failed'}` };
  }

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }

  if (!response.ok) {
    const message = safeText(payload?.error_description || payload?.message || payload?.error || raw) || `Reddit token error (${response.status})`;
    return { ok: false, status: response.status, error: message, data: payload };
  }

  const accessToken = safeText(payload?.access_token);
  if (!accessToken) return { ok: false, status: response.status, error: 'Reddit token response missing access_token', data: payload };
  return { ok: true, status: response.status, accessToken, data: payload };
}

function parseThingId(target, targetKind = 'post') {
  const raw = safeText(target);
  if (!raw) return '';
  if (/^t[13]_[a-z0-9]+$/i.test(raw)) return raw.toLowerCase();

  const bareId = raw.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (/^[a-z0-9]{5,10}$/.test(bareId)) {
    return `${String(targetKind).toLowerCase() === 'comment' ? 't1' : 't3'}_${bareId}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  const parts = parsed.pathname.split('/').map((part) => safeText(part)).filter(Boolean);
  const commentsIdx = parts.findIndex((part) => part.toLowerCase() === 'comments');
  if (commentsIdx < 0) return '';

  const postId = safeText(parts[commentsIdx + 1]).toLowerCase();
  const possibleCommentId = safeText(parts[commentsIdx + 3]).toLowerCase();
  if (String(targetKind).toLowerCase() === 'comment' && /^[a-z0-9]{5,10}$/.test(possibleCommentId)) {
    return `t1_${possibleCommentId}`;
  }
  if (/^[a-z0-9]{5,10}$/.test(postId)) return `t3_${postId}`;
  return '';
}

function normalizeSourceMode(value) {
  const mode = safeText(value).toLowerCase();
  if (mode === 'oauth' || mode === 'public' || mode === 'auto') return mode;
  return 'auto';
}

function sanitizeSnippet(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').replace(/<[^>]+>/g, ' ').trim();
  return text.slice(0, 220);
}

function parseJsonBody(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

function nonJsonRedditError(kind, status, raw) {
  const lowered = String(raw || '').toLowerCase();
  const looksHtml = lowered.includes('<html') || lowered.includes('<body') || lowered.includes('<!doctype');
  const snippet = sanitizeSnippet(raw);
  const detail = looksHtml
    ? 'Reddit returned HTML instead of API JSON (likely anti-bot/challenge page).'
    : `Reddit returned non-JSON ${kind} response.`;
  const message = snippet ? `${detail} ${snippet}` : detail;
  return {
    ok: false,
    status: Number(status || 0) || 502,
    error: message,
    data: {
      type: 'non_json',
      source: kind,
      html: looksHtml,
    },
  };
}

async function apiGet(path, accessToken, creds = getRedditCredentials()) {
  let response;
  try {
    response = await fetch(`https://oauth.reddit.com${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': creds.userAgent,
      },
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Reddit API network error: ${safeText(err?.message) || 'request failed'}` };
  }
  const raw = await response.text();
  const payload = parseJsonBody(raw);
  if (!payload) {
    return nonJsonRedditError('oauth', response.status, raw);
  }
  if (!response.ok) {
    const message = safeText(payload?.message || payload?.error) || `Reddit API error (${response.status})`;
    return { ok: false, status: response.status, error: message, data: payload };
  }
  return { ok: true, status: response.status, data: payload };
}

async function publicApiGet(path, creds = getRedditCredentials()) {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath.startsWith('/')) {
    return { ok: false, status: 400, error: 'Invalid Reddit path' };
  }
  const withJson = normalizedPath.includes('.json')
    ? normalizedPath
    : normalizedPath.replace(/\?/, '.json?') + (normalizedPath.includes('?') ? '' : '.json');
  const url = new URL(`https://www.reddit.com${withJson}`);
  if (!url.searchParams.has('raw_json')) url.searchParams.set('raw_json', '1');

  let response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': creds.userAgent,
      },
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Reddit public API network error: ${safeText(err?.message) || 'request failed'}` };
  }
  const raw = await response.text();
  const payload = parseJsonBody(raw);
  if (!payload) {
    return nonJsonRedditError('public', response.status, raw);
  }
  if (!response.ok) {
    const message = safeText(payload?.message || payload?.error) || `Reddit public API error (${response.status})`;
    return { ok: false, status: response.status, error: message, data: payload };
  }
  return { ok: true, status: response.status, data: payload };
}

async function createComment({ thingId, text }, creds = getRedditCredentials()) {
  const tokenResult = await fetchAccessToken(creds);
  if (!tokenResult.ok) return tokenResult;

  let response;
  try {
    response = await fetch('https://oauth.reddit.com/api/comment', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': creds.userAgent,
      },
      body: new URLSearchParams({
        api_type: 'json',
        thing_id: thingId,
        text,
      }),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Reddit comment network error: ${safeText(err?.message) || 'request failed'}` };
  }

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    const message = safeText(payload?.message || payload?.error || raw) || `Reddit comment error (${response.status})`;
    return { ok: false, status: response.status, error: message, data: payload };
  }

  const jsonErrors = Array.isArray(payload?.json?.errors) ? payload.json.errors : [];
  if (jsonErrors.length) {
    const message = jsonErrors.map((row) => row.filter(Boolean).join(': ')).join('; ');
    return { ok: false, status: response.status, error: message || 'Reddit rejected the comment', data: payload };
  }

  const thing = Array.isArray(payload?.json?.data?.things) ? payload.json.data.things[0] : null;
  return {
    ok: true,
    status: response.status,
    data: {
      thingId,
      comment: thing || null,
      response: payload,
    },
  };
}

async function checkAuth(creds = getRedditCredentials()) {
  const tokenResult = await fetchAccessToken(creds);
  if (!tokenResult.ok) return tokenResult;
  const me = await apiGet('/api/v1/me', tokenResult.accessToken, creds);
  if (!me.ok) return me;
  return { ok: true, status: me.status, data: me.data };
}

function parseSubredditFromTarget(targetInput) {
  const raw = safeText(targetInput);
  if (!raw) return '';
  const bare = raw.replace(/^\/+|\/+$/g, '');
  if (/^r\/[a-z0-9_]+$/i.test(bare)) return bare.split('/')[1].toLowerCase();
  if (/^[a-z0-9_]+$/i.test(bare)) return bare.toLowerCase();
  let parsed;
  try { parsed = new URL(raw); } catch { return ''; }
  const parts = parsed.pathname.split('/').map((p) => safeText(p)).filter(Boolean);
  const idx = parts.findIndex((part) => part.toLowerCase() === 'r');
  if (idx < 0) return '';
  const subreddit = safeText(parts[idx + 1]).toLowerCase();
  return /^[a-z0-9_]+$/.test(subreddit) ? subreddit : '';
}

function parsePostIdFromTarget(targetInput) {
  const raw = safeText(targetInput);
  if (!raw) return '';
  const bare = raw.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (/^t3_[a-z0-9]+$/.test(bare)) return bare.slice(3);
  if (/^[a-z0-9]{5,10}$/.test(bare)) return bare;
  let parsed;
  try { parsed = new URL(raw); } catch { return ''; }
  const parts = parsed.pathname.split('/').map((p) => safeText(p)).filter(Boolean);
  const idx = parts.findIndex((part) => part.toLowerCase() === 'comments');
  if (idx < 0) return '';
  const postId = safeText(parts[idx + 1]).toLowerCase();
  return /^[a-z0-9]{5,10}$/.test(postId) ? postId : '';
}

function pickListingChildren(payload) {
  const children = payload?.data?.children;
  return Array.isArray(children) ? children : [];
}

function mapPost(child) {
  const data = child?.data || {};
  return {
    id: safeText(data.id),
    name: safeText(data.name),
    subreddit: safeText(data.subreddit),
    title: safeText(data.title),
    author: safeText(data.author),
    permalink: safeText(data.permalink),
    url: safeText(data.url),
    selftext: safeText(data.selftext),
    score: Number(data.score || 0) || 0,
    num_comments: Number(data.num_comments || 0) || 0,
    created_utc: Number(data.created_utc || 0) || 0,
    over_18: Boolean(data.over_18),
    is_video: Boolean(data.is_video),
    upvote_ratio: Number(data.upvote_ratio || 0) || 0,
    raw: data,
  };
}

function flattenComments(children, out = [], options = {}) {
  const maxComments = Math.max(1, Math.min(Number(options.maxComments || 500) || 500, 5000));
  const includeReplies = options.includeReplies !== false;
  const queue = Array.isArray(children) ? children.slice() : [];
  while (queue.length && out.length < maxComments) {
    const node = queue.shift();
    if (!node || node.kind !== 't1') continue;
    const data = node.data || {};
    out.push({
      id: safeText(data.id),
      name: safeText(data.name),
      parent_id: safeText(data.parent_id),
      author: safeText(data.author),
      body: safeText(data.body),
      score: Number(data.score || 0) || 0,
      created_utc: Number(data.created_utc || 0) || 0,
      permalink: safeText(data.permalink),
      depth: Number(data.depth || 0) || 0,
      raw: data,
    });
    if (includeReplies) {
      const replyChildren = data?.replies?.data?.children;
      if (Array.isArray(replyChildren) && replyChildren.length) {
        replyChildren.forEach((child) => queue.push(child));
      }
    }
  }
}

async function listSubredditPosts(options = {}, creds = getRedditCredentials()) {
  const sourceMode = normalizeSourceMode(options.sourceMode || options.source_mode);
  const subreddit = parseSubredditFromTarget(options.subreddit || options.target || '');
  if (!subreddit) return { ok: false, status: 400, error: 'Valid subreddit is required (name, r/name, or subreddit URL).' };
  const sort = safeText(options.sort || 'new').toLowerCase();
  const allowedSort = new Set(['new', 'hot', 'top', 'rising']);
  const feed = allowedSort.has(sort) ? sort : 'new';
  const limit = Math.max(1, Math.min(Number(options.limit || 100) || 100, 500));
  const oauthPath = `/r/${encodeURIComponent(subreddit)}/${feed}?limit=${limit}&raw_json=1`;
  const publicPath = `/r/${encodeURIComponent(subreddit)}/${feed}.json?limit=${limit}&raw_json=1`;

  let listing = null;
  let authMode = 'public';
  if (sourceMode !== 'public' && isConfigured(creds)) {
    const tokenResult = await fetchAccessToken(creds);
    if (tokenResult.ok) {
      listing = await apiGet(oauthPath, tokenResult.accessToken, creds);
      authMode = 'oauth';
    } else if (sourceMode === 'oauth') {
      return tokenResult;
    }
  } else if (sourceMode === 'oauth') {
    return { ok: false, status: 400, error: 'Reddit OAuth mode requires Client ID, Client Secret, and Refresh Token in Settings > APIs.' };
  }
  if (sourceMode !== 'oauth' && (!listing || !listing.ok)) {
    const fallback = await publicApiGet(publicPath, creds);
    if (!fallback.ok) {
      return listing && !listing.ok ? listing : fallback;
    }
    listing = fallback;
    authMode = 'public';
  }
  if (!listing.ok) return listing;
  if (!listing.data || typeof listing.data !== 'object' || !listing.data.data) {
    return {
      ok: false,
      status: listing.status || 502,
      error: 'Reddit response did not contain a post listing payload.',
      data: { type: 'invalid_payload', source: 'listing' },
    };
  }
  const posts = pickListingChildren(listing.data).map(mapPost);
  return {
    ok: true,
    status: listing.status,
    data: {
      mode: 'subreddit',
      subreddit,
      sort: feed,
      posts,
      endpoint: authMode === 'oauth' ? oauthPath : publicPath,
      auth_mode: authMode,
    },
  };
}

async function getPostThread(options = {}, creds = getRedditCredentials()) {
  const sourceMode = normalizeSourceMode(options.sourceMode || options.source_mode);
  const postId = parsePostIdFromTarget(options.postId || options.target || '');
  if (!postId) return { ok: false, status: 400, error: 'Valid Reddit post URL or post id is required.' };
  const limit = Math.max(1, Math.min(Number(options.limit || 500) || 500, 5000));
  const depth = Math.max(1, Math.min(Number(options.depth || 8) || 8, 20));
  const oauthPath = `/comments/${encodeURIComponent(postId)}?limit=${Math.min(limit, 500)}&depth=${depth}&raw_json=1`;
  const publicPath = `/comments/${encodeURIComponent(postId)}.json?limit=${Math.min(limit, 500)}&depth=${depth}&raw_json=1`;

  let thread = null;
  let authMode = 'public';
  if (sourceMode !== 'public' && isConfigured(creds)) {
    const tokenResult = await fetchAccessToken(creds);
    if (tokenResult.ok) {
      thread = await apiGet(oauthPath, tokenResult.accessToken, creds);
      authMode = 'oauth';
    } else if (sourceMode === 'oauth') {
      return tokenResult;
    }
  } else if (sourceMode === 'oauth') {
    return { ok: false, status: 400, error: 'Reddit OAuth mode requires Client ID, Client Secret, and Refresh Token in Settings > APIs.' };
  }
  if (sourceMode !== 'oauth' && (!thread || !thread.ok)) {
    const fallback = await publicApiGet(publicPath, creds);
    if (!fallback.ok) {
      return thread && !thread.ok ? thread : fallback;
    }
    thread = fallback;
    authMode = 'public';
  }
  if (!thread.ok) return thread;

  const listings = Array.isArray(thread.data) ? thread.data : [];
  if (!Array.isArray(thread.data) || listings.length < 2) {
    return {
      ok: false,
      status: thread.status || 502,
      error: 'Reddit response did not contain a thread + comments payload.',
      data: { type: 'invalid_payload', source: 'thread' },
    };
  }
  const postListing = listings[0] || {};
  const commentsListing = listings[1] || {};
  const postChild = pickListingChildren(postListing)[0];
  if (!postChild) return { ok: false, status: 404, error: 'Reddit post not found.' };
  const post = mapPost(postChild);
  const comments = [];
  flattenComments(pickListingChildren(commentsListing), comments, {
    maxComments: limit,
    includeReplies: options.includeReplies !== false,
  });

  return {
    ok: true,
    status: thread.status,
    data: {
      mode: 'post',
      post,
      comments,
      endpoint: authMode === 'oauth' ? oauthPath : publicPath,
      auth_mode: authMode,
    },
  };
}

module.exports = {
  getRedditCredentials,
  isConfigured,
  parseThingId,
  normalizeSourceMode,
  parseSubredditFromTarget,
  parsePostIdFromTarget,
  checkAuth,
  createComment,
  listSubredditPosts,
  getPostThread,
  fetchAccessToken,
  apiGet,
  publicApiGet,
};
