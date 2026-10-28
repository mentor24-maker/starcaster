'use strict';

/**
 * The scheduled YouTube comments read — Outreach wizard 16/19 (task
 * 86bcrmbtn). Vercel Cron calls GET /api/outreach/youtube/conversations/read-due
 * every three hours; for every project with approved YouTube creators
 * (lib/youtubeCreatorsStore.js) this reads each channel's uploads from the
 * last 14 days and the top-level comments on the newest few, and keeps them on
 * the channel's row (`recent_videos`, docs/SQL/youtube_conversations_setup.sql).
 * lib/youtubeConversationFinder.js ranks them for the wizard.
 *
 * Until this existed, replying to one particular comment meant typing its
 * YouTube comment id by hand.
 *
 * QUOTA. Every call here costs 1 unit of the key's 10,000 a day: one uploads
 * read per channel, one comments read per video. With MAX_VIDEOS videos a
 * channel, a channel costs at most 6 units a pass, 48 a day. When YouTube says
 * the quota is used up the pass stops at once — nothing more can be read
 * today — and the channel it was reading records why, so the screen says
 * "Cannot tell" with the reason instead of an empty list (landmine 17).
 *
 * Cross-project on purpose, and cron-only for that reason (the route checks
 * `req.cronPublish`). The ONE cross-project read is the discovery below —
 * which projects have approved channels. Everything after it goes through the
 * store with that project's own scope.
 *
 * ONE CLOCK FOR THE WHOLE PASS, as in lib/acquire/SubstackNotesReadDue.js:
 * Vercel stops the function at 300 seconds. Within a project the channels read
 * longest ago go first, so a pass that runs out of time reaches the others
 * next time rather than starving the same ones.
 *
 * Every outside dependency comes in through `deps` (store, ytFetch, discover,
 * apiKey, now), so scripts/builder/youtubeConversations.test.js drives it with
 * no network.
 */

const { sbQuery, tableConfig } = require('../supabase');
const { resolveYoutubeApiKey } = require('./youtubeApiKey');
const { defaultYtFetch, isQuotaExhausted, nextPacificMidnight, quotaSentence } = require('./YoutubeCreatorsFindRun');

const DAY_MS = 24 * 60 * 60 * 1000;
/** Only uploads this new are read for comments. */
const VIDEO_WINDOW_MS = 14 * DAY_MS;
/** The newest this many uploads in the window are read. */
const MAX_VIDEOS = 5;
/** How many uploads one uploads read lists — enough to find MAX_VIDEOS in the window. */
const UPLOADS_PAGE = 10;
/** Top-level comments read per video, most relevant first (YouTube's own order). */
const COMMENTS_PER_VIDEO = 20;
const PASS_BUDGET_MS = 240000;
/** Below this much time left, a channel is not started. */
const MIN_CHANNEL_BUDGET_MS = 8000;

function text(value, max = 500) {
  return String(value === 0 || value ? value : '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A channel's uploads playlist: its id with "UC" turned to "UU" (YouTube's own rule). */
function uploadsPlaylistId(channelId) {
  return /^UC[A-Za-z0-9_-]{22}$/.test(String(channelId || '')) ? `UU${String(channelId).slice(2)}` : '';
}

/** Every project with at least one approved channel, and an owner to act as. */
async function discoverProjects(deps = {}) {
  const query = deps.sbQuery || sbQuery;
  const res = await query({
    method: 'GET',
    table: tableConfig().youtubeCreators,
    query: 'status=eq.approved&select=project_id,owner_user_id&limit=5000',
  });
  if (!res.ok) return res;
  const seen = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    if (!projectId || seen.has(projectId)) continue;
    seen.set(projectId, { projectId, userId: text(row.owner_user_id, 120) });
  }
  return { ok: true, status: 200, data: [...seen.values()] };
}

/** One top-level comment thread from commentThreads.list, in the shape the store keeps. */
function threadToComment(thread) {
  const top = thread?.snippet?.topLevelComment;
  const s = top?.snippet || {};
  const authorChannelId = text(s.authorChannelId?.value, 40);
  return {
    commentId: text(top?.id || thread?.id, 200),
    text: text(s.textOriginal || s.textDisplay, 2000),
    authorName: text(s.authorDisplayName, 300).replace(/^@/, ''),
    // YouTube hands these out as http://; the store keeps https:// links only.
    authorChannelUrl: text(s.authorChannelUrl, 1000).replace(/^http:\/\//i, 'https://') || (authorChannelId ? `https://www.youtube.com/channel/${authorChannelId}` : ''),
    authorChannelId,
    likes: Number(s.likeCount) || 0,
    replies: Number(thread?.snippet?.totalReplyCount) || 0,
    publishedAt: text(s.publishedAt, 40),
  };
}

/**
 * Read one channel. Answers `{ ok: true, videos }`, or `{ ok: false, error,
 * quota? }` — `quota` set when YouTube said the day's quota is used up, which
 * stops the whole pass.
 */
async function readChannel(creator, { ytFetch, now }) {
  const playlistId = uploadsPlaylistId(creator.channelId);
  if (!playlistId) return { ok: false, error: `"${creator.channelId}" is not a YouTube channel id, so its uploads cannot be read.` };
  const uploads = await ytFetch('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: UPLOADS_PAGE });
  if (isQuotaExhausted(uploads)) return { ok: false, quota: true, error: text(uploads.error, 300) };
  // A channel that has never uploaded has no uploads list at all: that is "no videos", not a failure.
  if (!uploads.ok && uploads.reason === 'playlistNotFound') return { ok: true, videos: [] };
  if (!uploads.ok) return { ok: false, error: `YouTube did not list the channel's uploads: ${text(uploads.error, 300)}` };

  const nowMs = now();
  const recent = (uploads.data?.items || [])
    .map((v) => ({
      videoId: text(v?.snippet?.resourceId?.videoId, 20),
      title: text(v?.snippet?.title, 300),
      publishedAt: text(v?.contentDetails?.videoPublishedAt || v?.snippet?.publishedAt, 40),
    }))
    .filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.videoId))
    .filter((v) => {
      const at = Date.parse(v.publishedAt);
      return Number.isFinite(at) && nowMs - at <= VIDEO_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_VIDEOS);

  const videos = [];
  for (const video of recent) {
    // eslint-disable-next-line no-await-in-loop
    const threads = await ytFetch('commentThreads', {
      part: 'snippet', videoId: video.videoId, order: 'relevance', maxResults: COMMENTS_PER_VIDEO, textFormat: 'plainText',
    });
    if (isQuotaExhausted(threads)) return { ok: false, quota: true, error: text(threads.error, 300) };
    if (!threads.ok && threads.reason === 'commentsDisabled') {
      videos.push({ ...video, commentsDisabled: true, comments: [] });
      continue;
    }
    // A video deleted or made private since it was listed: leave it out.
    if (!threads.ok && threads.reason === 'videoNotFound') continue;
    if (!threads.ok) return { ok: false, error: `YouTube did not return the comments on "${video.title || video.videoId}": ${text(threads.error, 300)}` };
    videos.push({ ...video, commentsDisabled: false, comments: (threads.data?.items || []).map(threadToComment).filter((c) => c.commentId) });
  }
  return { ok: true, videos };
}

/**
 * One pass. `deps`:
 *   discover   () → { ok, data: [{ projectId, userId }] } (tests)
 *   store      lib/youtubeCreatorsStore.js (tests)
 *   ytFetch    (endpoint, params) → { ok, data } | { ok: false, status, reason, error } (tests)
 *   apiKey     the YouTube key ('' = none)
 *   now        the clock (ms)
 *   budgetMs   the pass's clock (default PASS_BUDGET_MS)
 *
 * Returns `{ ok, status, data: { projects, channels, read, comments, failed,
 * notReached, quota } }`. `ok` is false only when nothing could be looked at:
 * no key, or discovery failed.
 */
async function runCommentsReadDue(deps = {}) {
  const store = deps.store || require('../youtubeCreatorsStore');
  const apiKey = deps.apiKey !== undefined ? deps.apiKey : resolveYoutubeApiKey();
  const ytFetch = deps.ytFetch || ((endpoint, params) => defaultYtFetch(endpoint, params, apiKey));
  const discover = deps.discover || (() => discoverProjects(deps));
  const now = deps.now || Date.now;
  const budgetMs = deps.budgetMs || PASS_BUDGET_MS;

  if (!apiKey) return { ok: false, status: 503, error: 'No YouTube API key is set up, so no comments can be read. The server needs YOUTUBE_API_KEY set.' };

  const found = await discover();
  if (!found.ok) {
    return {
      ok: false,
      status: found.status || 500,
      error: `Could not read which projects have approved YouTube channels: ${found.error || 'unknown error'}. `
        + `Have ${store.SQL_FILE} and ${store.CONVERSATIONS_SQL_FILE} been applied to this database?`,
    };
  }

  const report = { projects: found.data.length, channels: 0, read: 0, comments: 0, failed: [], notReached: [], quota: null };
  const startedAt = now();
  const outOfTime = () => budgetMs - (now() - startedAt) < MIN_CHANNEL_BUDGET_MS;

  for (const { projectId, userId } of found.data) {
    if (report.quota) { report.notReached.push({ projectId, reason: 'not read — the YouTube quota is used up for today' }); continue; }
    if (outOfTime()) { report.notReached.push({ projectId, reason: 'not read — the pass ran out of time; it is read next pass' }); continue; }
    const scope = { projectId, userId };
    // eslint-disable-next-line no-await-in-loop
    const listed = await store.listCreators(500, scope, { status: 'approved' });
    if (!listed.ok) { report.failed.push({ projectId, channel: '', error: `the approved channels could not be read: ${listed.error}` }); continue; }
    // Longest since a read first; never-read ones before all of them.
    const creators = [...listed.data].sort((a, b) => (Date.parse(a.lastCommentsReadAt || '') || 0) - (Date.parse(b.lastCommentsReadAt || '') || 0));
    report.channels += creators.length;

    for (const creator of creators) {
      if (outOfTime()) {
        report.notReached.push({ projectId, channel: creator.name || creator.channelId, reason: 'not read — the pass ran out of time; it is read next pass' });
        continue;
      }
      if (report.quota) {
        report.notReached.push({ projectId, channel: creator.name || creator.channelId, reason: 'not read — the YouTube quota is used up for today' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await readChannel(creator, { ytFetch, now });
      let error = result.ok ? '' : result.error;
      if (result.quota) {
        const resetsAt = nextPacificMidnight(now());
        report.quota = { resetsAt, detail: result.error };
        error = quotaSentence(resetsAt);
      }
      // eslint-disable-next-line no-await-in-loop
      const saved = await store.recordCommentsRead(creator.id, result.ok ? { videos: result.videos } : { error }, scope);
      if (!saved.ok) {
        report.failed.push({ projectId, channel: creator.name || creator.channelId, error: `what was read could not be saved: ${saved.error}` });
        // A database that refuses every write (a missing column) refuses them all: stop this project.
        if (saved.status >= 500) break;
        continue;
      }
      if (result.ok) {
        report.read += 1;
        report.comments += result.videos.reduce((n, v) => n + v.comments.length, 0);
      } else if (!result.quota) {
        report.failed.push({ projectId, channel: creator.name || creator.channelId, error });
      }
    }
  }
  return { ok: true, status: 200, data: report };
}

/** The log lines for one pass: one summary, then each failure by name. */
function formatCommentsReadLog(report) {
  const lines = [`[youtube-conversations] read-due projects=${report.projects} channels=${report.channels} read=${report.read} `
    + `comments=${report.comments} failed=${report.failed.length} not_reached=${report.notReached.length}${report.quota ? ' QUOTA_USED_UP' : ''}`];
  for (const f of report.failed) lines.push(`[youtube-conversations] read-due FAILED project=${f.projectId}${f.channel ? ` channel="${f.channel}"` : ''}: ${f.error}`);
  for (const f of report.notReached) lines.push(`[youtube-conversations] read-due NOT REACHED project=${f.projectId}${f.channel ? ` channel="${f.channel}"` : ''}: ${f.reason}`);
  if (report.quota) lines.push(`[youtube-conversations] read-due QUOTA USED UP until ${report.quota.resetsAt}: ${report.quota.detail}`);
  return lines;
}

module.exports = {
  runCommentsReadDue,
  readChannel,
  discoverProjects,
  formatCommentsReadLog,
  uploadsPlaylistId,
  threadToComment,
  VIDEO_WINDOW_MS,
  MAX_VIDEOS,
  COMMENTS_PER_VIDEO,
};
