
'use strict';

/**
 * lib/youtubeComments.js
 * Harvest comments from a YouTube video using the YouTube Data API v3.
 *
 * ── What it returns per comment ───────────────────────────────────────────
 *   id, author, author_channel_url, author_channel_id,
 *   text, like_count, reply_count, published_at, updated_at,
 *   is_reply, parent_id
 *
 * ── Quota cost ────────────────────────────────────────────────────────────
 *   1 unit per page of up to 100 top-level comments.
 *   1 unit per page of up to 100 replies.
 *   Free tier: 10,000 units/day → ~1M comments/day before hitting limits.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   const { runYoutubeCommentHarvest } = require('./youtubeComments');
 *   const result = await runYoutubeCommentHarvest({
 *     video_url: 'https://www.youtube.com/watch?v=...',
 *     max_comments: 500,      // top-level comments to fetch (default: 200)
 *     include_replies: true,  // fetch reply threads (default: false)
 *     sort_by: 'relevance',   // 'relevance' | 'time' (default: 'relevance')
 *   });
 */

const { resolveYoutubeApiKey } = require('./youtubeApiKey');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function youtubeApiConfig() {
  const apiKey = resolveYoutubeApiKey();
  return { apiKey };
}

// ---------------------------------------------------------------------------
// URL helpers (reuse the same pattern as youtubeHarvest.js)
// ---------------------------------------------------------------------------

function videoIdFromUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('video_url is required');

  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const url = new URL(withScheme);

  if (url.hostname.includes('youtu.be')) {
    const id = url.pathname.replace(/^\/+/, '');
    if (!id) throw new Error('Invalid youtu.be URL');
    return id;
  }

  const v = url.searchParams.get('v');
  if (!v) throw new Error('YouTube watch URL must include v=VIDEO_ID');
  return v;
}

// ---------------------------------------------------------------------------
// API fetch helper
// ---------------------------------------------------------------------------

async function ytFetch(endpoint, params, timeoutMs = 15000) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { accept: 'application/json', 'user-agent': 'APH-YoutubeComments/1.0' },
    signal:  AbortSignal.timeout(timeoutMs),
  });

  const body = await res.json();

  if (!res.ok) {
    const msg = body?.error?.message || body?.error?.errors?.[0]?.message || `HTTP ${res.status}`;
    const code = body?.error?.errors?.[0]?.reason || String(res.status);
    throw Object.assign(new Error(msg), { code, status: res.status });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Comment normalizer
// ---------------------------------------------------------------------------

function normalizeComment(snippet, id, isReply = false, parentId = null) {
  return {
    id,
    author:              String(snippet.authorDisplayName      || '').trim(),
    author_channel_url:  String(snippet.authorChannelUrl       || '').trim(),
    author_channel_id:   String(snippet.authorChannelId?.value || '').trim(),
    text:                String(snippet.textDisplay            || snippet.textOriginal || '').trim(),
    like_count:          Number(snippet.likeCount              || 0),
    reply_count:         Number(snippet.totalReplyCount        || 0),
    published_at:        snippet.publishedAt  || null,
    updated_at:          snippet.updatedAt    || null,
    is_reply:            isReply,
    parent_id:           parentId || null,
  };
}

// ---------------------------------------------------------------------------
// Fetch top-level comment threads (paginated)
// ---------------------------------------------------------------------------

async function fetchCommentThreads(videoId, apiKey, { maxComments, sortBy }) {
  const comments   = [];
  const threadMap  = {};   // id → comment (for attaching replies)
  let pageToken    = undefined;
  let pagesfetched = 0;
  const maxPages   = Math.ceil(maxComments / 100) + 1;

  while (comments.length < maxComments && pagesfetched < maxPages) {
    const params = {
      part:       'snippet',
      videoId,
      key:        apiKey,
      maxResults: Math.min(100, maxComments - comments.length),
      order:      sortBy === 'time' ? 'time' : 'relevance',
      textFormat: 'plainText',
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await ytFetch('commentThreads', params);

    for (const item of (data.items || [])) {
      const top     = item.snippet?.topLevelComment;
      const comment = normalizeComment(
        top?.snippet || {},
        top?.id || item.id,
        false,
        null
      );
      // Attach reply count from thread
      comment.reply_count = Number(item.snippet?.totalReplyCount || 0);
      comments.push(comment);
      threadMap[item.id] = comment;
    }

    pageToken   = data.nextPageToken;
    pagesfetched++;

    if (!pageToken) break;
  }

  return { comments, threadMap };
}

// ---------------------------------------------------------------------------
// Fetch replies for a single thread
// ---------------------------------------------------------------------------

async function fetchRepliesForThread(parentId, apiKey) {
  const replies  = [];
  let pageToken  = undefined;

  while (true) {
    const params = {
      part:      'snippet',
      parentId,
      key:       apiKey,
      maxResults: 100,
      textFormat: 'plainText',
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await ytFetch('comments', params);

    for (const item of (data.items || [])) {
      replies.push(normalizeComment(item.snippet || {}, item.id, true, parentId));
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return replies;
}

// ---------------------------------------------------------------------------
// Signal extraction — emails and social handles from comment text
// ---------------------------------------------------------------------------

function extractSignals(comments) {
  const emailSet   = new Set();
  const handleSet  = new Set();

  for (const c of comments) {
    const text = c.text;
    // Emails
    const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    emails.forEach(e => emailSet.add(e.toLowerCase()));
    // @handles (Twitter/Instagram style)
    const handles = text.match(/@[A-Za-z0-9_]{2,30}/g) || [];
    handles.forEach(h => handleSet.add(h.toLowerCase()));
  }

  return {
    emails:  Array.from(emailSet).slice(0, 100),
    handles: Array.from(handleSet).slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Harvest comments from a YouTube video.
 *
 * @param {object} input
 * @param {string}  input.video_url       - YouTube video URL
 * @param {number}  [input.max_comments]  - Max top-level comments (default 200, max 2000)
 * @param {boolean} [input.include_replies] - Also fetch reply threads (default false)
 * @param {string}  [input.sort_by]       - 'relevance' | 'time' (default 'relevance')
 *
 * @returns {Promise<object>} Structured result with comments, stats, signals
 */
async function runYoutubeCommentHarvest(input) {
  const cfg = youtubeApiConfig();

  if (!cfg.apiKey) {
    throw new Error(
      'YouTube API key is not configured. Go to Settings → APIs → YouTube Data API and add your key.'
    );
  }

  const videoId      = videoIdFromUrl(input.video_url);
  const maxComments  = Math.min(Math.max(Number(input.max_comments  || 200), 1), 2000);
  const includeReplies = input.include_replies === true || input.include_replies === 'true';
  const sortBy       = input.sort_by === 'time' ? 'time' : 'relevance';

  // ── Fetch top-level comments ─────────────────────────────────────────────
  const { comments: topLevel, threadMap } = await fetchCommentThreads(
    videoId, cfg.apiKey, { maxComments, sortBy }
  );

  // ── Optionally fetch replies ─────────────────────────────────────────────
  const replies = [];
  if (includeReplies) {
    // Only fetch replies for threads that have them, limit to top 50 threads
    const threadsWithReplies = Object.keys(threadMap)
      .filter(id => threadMap[id].reply_count > 0)
      .slice(0, 50);

    for (const threadId of threadsWithReplies) {
      try {
        const threadReplies = await fetchRepliesForThread(threadId, cfg.apiKey);
        replies.push(...threadReplies);
      } catch (err) {
        // Don't let one failed reply thread abort the whole harvest
        console.warn(`[youtubeComments] Failed to fetch replies for thread ${threadId}: ${err.message}`);
      }
    }
  }

  const allComments = [...topLevel, ...replies];

  // ── Extract signals ───────────────────────────────────────────────────────
  const signals = extractSignals(allComments);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalLikes    = allComments.reduce((sum, c) => sum + c.like_count, 0);
  const topByLikes    = [...topLevel]
    .sort((a, b) => b.like_count - a.like_count)
    .slice(0, 10)
    .map(c => ({ id: c.id, author: c.author, text: c.text.slice(0, 200), like_count: c.like_count }));

  const uniqueAuthors = new Set(allComments.map(c => c.author_channel_id || c.author));

  return {
    video_id:        videoId,
    video_url:       `https://www.youtube.com/watch?v=${videoId}`,
    sort_by:         sortBy,
    fetched_at:      new Date().toISOString(),
    stats: {
      top_level_count:  topLevel.length,
      reply_count:      replies.length,
      total_comments:   allComments.length,
      unique_authors:   uniqueAuthors.size,
      total_likes:      totalLikes,
    },
    top_comments:    topByLikes,
    comments:        allComments,
    signals,
  };
}

module.exports = { runYoutubeCommentHarvest };
