'use strict';

/**
 * Find YouTube creators for Dane's keywords (Outreach wizard 15/19, task
 * 86bcrmbrf) — the YouTube twin of the Substack Miner's web search.
 *
 * ONE PASS:
 *
 *   1. for each keyword in the wizard's list (lib/youtubeCreatorsStore.js
 *      getKeywords — the Substack Miner's until he saves his own), ask the
 *      YouTube Data API for channels (`search.list type=channel`);
 *   2. add the channels behind the videos Acquire has already collected
 *      (lib/acquire/YoutubeVideosStore.js), which he chose to look at once;
 *   3. read every channel's details in batches of 50 (`channels.list`: name,
 *      description, picture, subscribers, uploads list) and its newest three
 *      uploads (`playlistItems.list`), which the suggestion pass judges from;
 *   4. save each one (upsertCreator), which never touches a decision he made.
 *
 * QUOTA. YouTube gives each API key 10,000 units a day, reset at midnight
 * Pacific. A channel search costs 100; a details batch or an uploads read costs
 * 1. So a run is capped at MAX_KEYWORDS_PER_RUN searches. When YouTube says the
 * quota is used up, the pass stops, keeps what it already saved, and answers
 * `cannotTell` with the time it comes back — never "found nothing", which
 * would read as "there are no channels for these words" (landmine 17).
 *
 * Every outside dependency comes in through `deps` (store, ytFetch, listVideos,
 * apiKey, now), so scripts/builder/youtubeCreators.test.js drives it with no
 * network.
 */

const { resolveYoutubeApiKey } = require('./youtubeApiKey');

/** At 100 units a search, ten keywords is a tenth of a day's quota. */
const MAX_KEYWORDS_PER_RUN = 10;
const DEFAULT_PER_KEYWORD = 10;
const MAX_PER_KEYWORD = 50;
const DETAILS_BATCH = 50;
/** Stop starting new work after this long — a serverless request ends at 300s. */
const DEFAULT_TIME_BUDGET_MS = 200000;

const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);

function text(value, max = 400) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

async function defaultYtFetch(endpoint, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: apiKey })) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { accept: 'application/json', 'user-agent': 'Starcaster-OutreachWizard/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      reason: body?.error?.errors?.[0]?.reason || '',
      // YouTube's messages carry HTML (`<code>playlistId</code>`); the screen shows plain text.
      error: String(body?.error?.message || `YouTube answered HTTP ${res.status}`).replace(/<[^>]+>/g, ''),
    };
  }
  return { ok: true, data: body };
}

/** True when a YouTube answer means the day's quota is used up. */
function isQuotaExhausted(reply) {
  return !!reply && !reply.ok && (QUOTA_REASONS.has(reply.reason) || (reply.status === 403 && /quota/i.test(String(reply.error || ''))));
}

/** The wall-clock hour in Los Angeles at `ms`. */
function pacificHour(ms) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
}

/** The next midnight Pacific after `nowMs` — when YouTube resets the quota. */
function nextPacificMidnight(nowMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  for (const offset of [7, 8]) {
    const t = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1, offset);
    if (pacificHour(t) === 0) return new Date(t).toISOString();
  }
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1, 8)).toISOString();
}

/** The sentence for an exhausted quota. The screen formats the time itself, in the viewer's clock. */
function quotaSentence(resetsAt) {
  const at = new Date(resetsAt);
  const when = Number.isNaN(at.getTime())
    ? 'midnight Pacific'
    : `${at.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Eastern (midnight Pacific)`;
  return `Cannot tell — YouTube quota used up until ${when}.`;
}

function bestThumbnail(thumbnails) {
  const t = thumbnails || {};
  return text((t.medium || t.default || t.high || {}).url, 1000);
}

/**
 * Find and save channels. Answers `{ ok, data: summary }` where summary counts
 * what was searched, found, added and merged, names what could not be read,
 * and carries `cannotTell` + `quota.resetsAt` when the quota ran out.
 */
async function findYoutubeCreators(scope = null, options = {}, deps = {}) {
  const store = deps.creatorsStore || require('../youtubeCreatorsStore');
  const apiKey = deps.apiKey !== undefined ? deps.apiKey : resolveYoutubeApiKey();
  const ytFetch = deps.ytFetch || ((endpoint, params) => defaultYtFetch(endpoint, params, apiKey));
  const listVideos = deps.listVideos || ((limit, sc) => require('./YoutubeVideosStore').listYoutubeVideos(limit, sc));
  const now = deps.now || Date.now;
  const timeBudgetMs = deps.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;
  const started = now();
  const perKeyword = Math.min(MAX_PER_KEYWORD, Number.isInteger(options.perKeyword) && options.perKeyword > 0 ? options.perKeyword : DEFAULT_PER_KEYWORD);

  if (!apiKey) return refuse('No YouTube API key is set up, so YouTube cannot be searched. The server needs YOUTUBE_API_KEY set.', 503);

  const keywordsRead = await store.getKeywords(scope);
  if (!keywordsRead.ok) return keywordsRead;
  const allKeywords = keywordsRead.data.keywords || [];
  if (!allKeywords.length) {
    return refuse('There are no keywords to search YouTube for. Add a few words or phrases for the subjects you want creators in, then run it again.', 409);
  }
  const keywords = allKeywords.slice(0, MAX_KEYWORDS_PER_RUN);

  const summary = {
    keywordsSource: keywordsRead.data.source,
    keywordsSearched: [],
    keywordsSkipped: allKeywords.slice(MAX_KEYWORDS_PER_RUN),
    fromAcquire: 0,
    found: 0,
    added: 0,
    merged: 0,
    notRead: [],
    notSaved: [],
    cannotTell: '',
    quota: null,
  };
  const stopForQuota = (reply) => {
    const resetsAt = nextPacificMidnight(now());
    summary.quota = { exhausted: true, resetsAt, detail: text(reply.error, 300) };
    summary.cannotTell = quotaSentence(resetsAt);
  };

  // channelId → { keywords, foundVia }
  const found = new Map();
  const note = (channelId, keyword, foundVia) => {
    const hit = found.get(channelId) || { keywords: [], foundVia };
    if (keyword && !hit.keywords.includes(keyword)) hit.keywords.push(keyword);
    found.set(channelId, hit);
  };

  for (const keyword of keywords) {
    if (now() - started > timeBudgetMs) break;
    const reply = await ytFetch('search', { part: 'snippet', type: 'channel', q: keyword, maxResults: perKeyword });
    if (isQuotaExhausted(reply)) { stopForQuota(reply); break; }
    if (!reply.ok) {
      summary.notRead.push({ what: `the search for "${keyword}"`, reason: text(reply.error, 300) });
      continue;
    }
    summary.keywordsSearched.push(keyword);
    for (const item of reply.data?.items || []) {
      const id = store.channelIdFrom(item?.id?.channelId || item?.snippet?.channelId);
      if (id) note(id, keyword, 'keyword_search');
    }
  }

  // The channels behind the videos Acquire already holds. A failed read is
  // named, not skipped: "found nothing there" and "could not look" differ.
  if (!summary.quota) {
    try {
      const videos = await listVideos(200, scope);
      if (!videos?.ok) {
        summary.notRead.push({ what: "Acquire's YouTube videos", reason: text(videos?.error, 300) || 'no reason was given' });
      } else {
        for (const v of videos.data || []) {
          const id = store.channelIdFrom(v?.channelUrl || v?.channel_url || v?.channelId);
          if (id && !found.has(id)) { note(id, '', 'acquire_results'); summary.fromAcquire += 1; }
        }
      }
    } catch (err) {
      summary.notRead.push({ what: "Acquire's YouTube videos", reason: text(err?.message, 300) || 'unknown error' });
    }
  }
  summary.found = found.size;

  // Details, 50 channels a call.
  const details = new Map();
  const ids = [...found.keys()];
  for (let i = 0; i < ids.length && !summary.quota; i += DETAILS_BATCH) {
    const batch = ids.slice(i, i + DETAILS_BATCH);
    const reply = await ytFetch('channels', { part: 'snippet,statistics,contentDetails', id: batch.join(','), maxResults: DETAILS_BATCH });
    if (isQuotaExhausted(reply)) { stopForQuota(reply); break; }
    if (!reply.ok) {
      summary.notRead.push({ what: `the details of ${batch.length} channels`, reason: text(reply.error, 300) });
      continue;
    }
    for (const item of reply.data?.items || []) if (item?.id) details.set(item.id, item);
  }

  for (const channelId of ids) {
    const item = details.get(channelId);
    if (!item) continue; // unread details are already named above; quota stops are in cannotTell
    if (now() - started > timeBudgetMs) {
      summary.notSaved.push({ channelId, name: text(item.snippet?.title, 120), reason: 'not reached before the time limit — run it again for the rest' });
      continue;
    }
    let latestVideos = [];
    const uploads = item.contentDetails?.relatedPlaylists?.uploads;
    if (uploads && !summary.quota) {
      const reply = await ytFetch('playlistItems', { part: 'snippet', playlistId: uploads, maxResults: store.MAX_LATEST_VIDEOS });
      if (isQuotaExhausted(reply)) stopForQuota(reply);
      else if (reply.ok) {
        latestVideos = (reply.data?.items || [])
          .map((v) => ({ videoId: text(v?.snippet?.resourceId?.videoId, 20), title: text(v?.snippet?.title, 300), publishedAt: text(v?.snippet?.publishedAt, 40) }))
          .filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.videoId));
      } else {
        summary.notRead.push({ what: `the newest videos of ${text(item.snippet?.title, 120) || channelId}`, reason: text(reply.error, 300) });
      }
    }
    const hidden = item.statistics?.hiddenSubscriberCount === true;
    const subs = Number(item.statistics?.subscriberCount);
    const hit = found.get(channelId);
    const saved = await store.upsertCreator({
      channelId,
      channelUrl: item.snippet?.customUrl
        ? `https://www.youtube.com/${String(item.snippet.customUrl).startsWith('@') ? '' : '@'}${text(item.snippet.customUrl, 200)}`
        : `https://www.youtube.com/channel/${channelId}`,
      name: text(item.snippet?.title, 300),
      description: text(item.snippet?.description, 4000),
      avatarUrl: bestThumbnail(item.snippet?.thumbnails),
      subscriberCount: !hidden && Number.isInteger(subs) && subs >= 0 ? subs : null,
      latestVideos,
      keywordsHit: hit.keywords,
      foundVia: hit.foundVia,
    }, scope);
    if (!saved.ok) {
      // Tenancy or database failure is not one channel's fault: stop and say so.
      if (saved.status >= 500) return saved;
      summary.notSaved.push({ channelId, name: text(item.snippet?.title, 120), reason: saved.error });
      continue;
    }
    if (saved.status === 201) summary.added += 1;
    else summary.merged += 1;
  }
  return { ok: true, status: 200, data: summary };
}

module.exports = {
  findYoutubeCreators,
  defaultYtFetch,
  isQuotaExhausted,
  nextPacificMidnight,
  quotaSentence,
  MAX_KEYWORDS_PER_RUN,
};
