'use strict';

/**
 * Reddit comments 2/4 (task 86bch3jp3) — reads the Reddit post (or comment)
 * a comment will answer, from Reddit's public JSON: the link plus `.json`.
 *
 * MEASURED 2026-10-12 (~9:20pm, from the Mac Mini's home connection, not a
 * cloud server): https://www.reddit.com/r/AskReddit/top.json answered 403
 * with Reddit's page "You've been blocked by network security";
 * api.reddit.com answered 403 too, and old.reddit.com redirected to a login
 * page. Reddit's unauthenticated reads are refused even from a home address,
 * so a Vercel server is very likely refused the same way. That is why every
 * failure here is a plain sentence naming WHICH refusal it was — the first
 * real Add in production records the Vercel answer on the item — and why the
 * store accepts the post pasted by hand when this cannot read it.
 *
 * The ticket's other route, the OpenClaw gateway routes/acquire.js uses, was
 * measured the same evening: OPENCLAW_BASE_URL is an Amazon server, not the
 * Mini, and it did not answer within 10 seconds. It is not used here.
 *
 * SINCE OUTREACH WIZARD 17/19 (task 86bcrmbuv) ADD NO LONGER CALLS
 * readRedditPost: the Mini's signed-in browser reads the post instead
 * (workers/youtube-outreach/adapters/reddit.js, readPending). What still runs
 * from here is parseRedditLink / canonicalUrl (every Add) and describeRefusal
 * (the posting worker's proof read). readRedditPost stays, tested, for the
 * day Reddit answers this server again.
 *
 * Never throws: `{ ok: true, data }` or `{ ok: false, status, error, code }`.
 * The network is `options.fetch` (url, init) → Response-like, for tests.
 */

const USER_AGENT = 'web:starcaster-reddit-comments:1.0 (+https://starcaster.pro)';
const TIMEOUT_MS = 10000;
const TOP_COMMENTS = 10;

const REDDIT_HOSTS = new Set([
  'reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com', 'm.reddit.com',
]);
const ID_RE = /^[a-z0-9]{1,12}$/i;

function safeText(value, max = 20000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function fail(status, error, code) {
  return { ok: false, status, error, code };
}

/**
 * Pull the post id (and the comment id, for a link to a comment) out of a
 * Reddit link. Accepts reddit.com/r/<sub>/comments/<post>/<slug>/[<comment>/],
 * the old/new/np/m hosts, reddit.com/comments/<post> and redd.it/<post>.
 *
 * A share link (reddit.com/r/<sub>/s/<code>) is refused with the fix: it is
 * only a redirect, and following it means asking Reddit, which is the read
 * that is blocked.
 */
function parseRedditLink(input) {
  const text = safeText(input, 2000);
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    url = null;
  }
  if (!text || !url) return fail(400, `"${text}" is not a web address — paste the link to a Reddit post or comment.`, 'BAD_LINK');
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'redd.it') {
    if (parts.length === 1 && ID_RE.test(parts[0])) {
      return { ok: true, data: { postId: parts[0].toLowerCase(), commentId: '', subreddit: '' } };
    }
    return fail(400, `${text} is a redd.it link but not to a post.`, 'BAD_LINK');
  }
  if (!REDDIT_HOSTS.has(host)) {
    return fail(400, `${text} is not a Reddit link — it should start https://www.reddit.com/r/…`, 'BAD_LINK');
  }

  let subreddit = '';
  let rest = parts;
  if (parts[0] && parts[0].toLowerCase() === 'r' && parts[1]) {
    subreddit = parts[1];
    rest = parts.slice(2);
  }
  if (rest[0] === 's') {
    return fail(400, 'That is a Reddit share link (…/s/…), which hides the post\'s real address. Open it in a browser and paste the address it lands on instead.', 'SHARE_LINK');
  }
  if (rest[0] !== 'comments' || !ID_RE.test(rest[1] || '')) {
    return fail(400, `${text} is a Reddit link but not to a post — a post's address has /comments/<id>/ in it.`, 'BAD_LINK');
  }
  const commentId = rest[3] && ID_RE.test(rest[3]) ? rest[3].toLowerCase() : '';
  return { ok: true, data: { postId: rest[1].toLowerCase(), commentId, subreddit } };
}

/** The one address a post or comment is stored under, whatever form it was pasted in. */
function canonicalUrl({ postId, commentId, subreddit }) {
  const base = subreddit
    ? `https://www.reddit.com/r/${subreddit}/comments/${postId}/`
    : `https://www.reddit.com/comments/${postId}/`;
  return commentId ? `${base}_/${commentId}/` : base;
}

async function defaultFetch(url, init) {
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** A failed answer from Reddit, as a sentence naming which refusal it was. */
function describeRefusal(status, body, location) {
  const raw = String(body || '');
  let json = null;
  try { json = JSON.parse(raw); } catch { json = null; }
  const reason = safeText(json?.reason || json?.message, 200).toLowerCase();

  if (status >= 300 && status < 400) {
    if (/\/login/i.test(location || '')) {
      return fail(403, 'Reddit refused to show the post without a login (it redirected to its sign-in page). Paste the post\'s title and text instead.', 'REDDIT_LOGIN_REQUIRED');
    }
    return fail(502, `Reddit redirected the read elsewhere (${status}${location ? ` to ${location}` : ''}) instead of answering.`, 'REDDIT_REDIRECTED');
  }
  if (status === 429) {
    return fail(429, 'Reddit is rate-limiting this server (429 Too Many Requests). Wait a few minutes, or paste the post\'s title and text instead.', 'REDDIT_RATE_LIMITED');
  }
  if (status === 404) {
    return fail(404, 'Reddit says there is no such post (404) — the link may be mistyped, or the post deleted.', 'REDDIT_NOT_FOUND');
  }
  if (status === 403 && reason === 'private') {
    return fail(403, 'That subreddit is private, so its posts cannot be read (403).', 'REDDIT_PRIVATE');
  }
  if (status === 403 && reason === 'quarantined') {
    return fail(403, 'That subreddit is quarantined, so its posts cannot be read without a login (403).', 'REDDIT_QUARANTINED');
  }
  if (status === 403 && /blocked by network security/i.test(raw)) {
    return fail(403, 'Reddit blocked this server ("You\'ve been blocked by network security", 403). It refuses reads that are not signed in. Paste the post\'s title and text instead.', 'REDDIT_BLOCKED');
  }
  if (status === 451) {
    return fail(451, 'Reddit will not show that post here for legal reasons (451).', 'REDDIT_UNAVAILABLE');
  }
  return fail(502, `Reddit answered ${status}${reason ? ` (${reason})` : ''} instead of the post.`, 'REDDIT_ERROR');
}

function mapComment(child) {
  const d = child?.data || {};
  return { author: safeText(d.author, 100), body: safeText(d.body, 4000), score: Number(d.score) || 0 };
}

const GONE = new Set(['[removed]', '[deleted]']);

/**
 * Read a post (and, for a comment link, that comment) from Reddit.
 * data: { postId, commentId, subreddit, title, body, author, permalink,
 *         topComments: [{author, body, score}], comment: {author, body} | null }
 */
async function readRedditPost(link, options = {}) {
  const parsed = parseRedditLink(link);
  if (!parsed.ok) return parsed;
  const { postId, commentId } = parsed.data;
  const doFetch = typeof options.fetch === 'function' ? options.fetch : defaultFetch;

  const path = commentId ? `/comments/${postId}/_/${commentId}.json` : `/comments/${postId}.json`;
  const url = `https://www.reddit.com${path}?raw_json=1&limit=${TOP_COMMENTS}&sort=top`;

  let res;
  let body;
  try {
    res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    body = await res.text();
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return fail(504, timedOut
      ? `Reddit did not answer within ${TIMEOUT_MS / 1000} seconds.`
      : `Reddit could not be reached (${safeText(err?.message, 200) || 'network error'}).`, 'REDDIT_UNREACHABLE');
  }
  const location = typeof res.headers?.get === 'function' ? res.headers.get('location') : '';
  if (res.status !== 200) return describeRefusal(res.status, body, location);

  let payload;
  try { payload = JSON.parse(body); } catch { payload = null; }
  const post = Array.isArray(payload) ? payload[0]?.data?.children?.[0]?.data : null;
  if (!post) {
    return fail(502, 'Reddit answered, but not with a post — it sent a page instead of the post\'s data.', 'REDDIT_NOT_A_POST');
  }
  if (post.removed_by_category || post.selftext === '[removed]') {
    const by = safeText(post.removed_by_category, 60);
    return fail(410, `That post has been removed${by ? ` (by ${by.replace(/_/g, ' ')})` : ''}, so there is nothing to answer.`, 'REDDIT_REMOVED');
  }
  if (post.author === '[deleted]' && GONE.has(post.selftext)) {
    return fail(410, 'That post has been deleted by its author, so there is nothing to answer.', 'REDDIT_DELETED');
  }

  const children = (Array.isArray(payload) ? payload[1]?.data?.children : null) || [];
  const comments = children.filter((c) => c?.kind === 't1');
  let comment = null;
  if (commentId) {
    const found = comments.find((c) => String(c?.data?.id || '').toLowerCase() === commentId);
    if (!found) return fail(404, `Reddit sent the post but not comment ${commentId} — it may have been deleted.`, 'REDDIT_COMMENT_NOT_FOUND');
    comment = mapComment(found);
    if (GONE.has(comment.body)) {
      return fail(410, 'That comment has been removed or deleted, so there is nothing to reply to.', 'REDDIT_COMMENT_GONE');
    }
  }

  return {
    ok: true,
    status: 200,
    data: {
      postId,
      commentId,
      subreddit: safeText(post.subreddit, 100) || parsed.data.subreddit,
      title: safeText(post.title, 1000),
      body: GONE.has(post.selftext) ? '' : safeText(post.selftext, 20000),
      author: safeText(post.author, 100),
      permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : '',
      topComments: commentId ? [] : comments.slice(0, TOP_COMMENTS).map(mapComment).filter((c) => c.body && !GONE.has(c.body)),
      comment,
    },
  };
}

module.exports = { parseRedditLink, canonicalUrl, readRedditPost, describeRefusal, USER_AGENT };
