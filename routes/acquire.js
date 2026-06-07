
'use strict';

/**
 * routes/acquire.js
 * All /api/acquire/* routes: direct web acquire, YouTube acquire, and job management.
 *
 * #8 — Request Validation Layer
 * #9 — Standardized API Response Envelope: sendOk() / sendErr()
 * Rate limiting: expensive endpoints check per-endpoint limits via checkEndpointLimit()
 *   in addition to the global ceiling already applied in routes/index.js.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { listAcquireJobs }    = require('../lib/acquireJobs');
const { deleteMirroredAcquireJob } = require('../lib/acquireMirror');
const { runDirectAcquire, listDirectAcquireRuns, getDirectAcquireRun } = require('../lib/directAcquire');
const { runPeerDiscovery } = require('../lib/peerDiscovery');
const { requestProjectScope } = require('../lib/requestProjectScope');
const {
  listWebsitePeers,
  getWebsitePeer,
  createWebsitePeer,
  updateWebsitePeer,
  deleteWebsitePeer,
  upsertWebsitePeersFromRun,
} = require('../lib/websitePeersStore');
const { runYoutubeAcquire } = require('../lib/acquire/YoutubeDetailsRun');
const { runXAcquire } = require('../lib/acquire/XAcquireRun');
const { runRedditAcquire } = require('../lib/acquire/RedditAcquireRun');
const {
  createXAcquireRun,
  listXAcquireRuns,
  getXAcquireRun,
  deleteXAcquireRun,
} = require('../lib/acquire/XAcquireStore');
const {
  createRedditAcquireRun,
  listRedditAcquireRuns,
  getRedditAcquireRun,
  deleteRedditAcquireRun,
} = require('../lib/acquire/RedditAcquireStore');
const { runYoutubeCommentAcquire } = require('../lib/acquire/YoutubeCommentsRun');
const { runYoutubeCommentMiner } = require('../lib/acquire/YoutubeCommentMiner');
const { resolveYoutubeApiKey } = require('../lib/acquire/youtubeApiKey');
const { postYoutubeComment } = require('../lib/acquire/YoutubeCommentPost');
const {
  buildYoutubeCommentSuggestionInput,
  generateYoutubeCommentSuggestions
} = require('../lib/acquire/YoutubeCommentSuggestions');
const {
  createYoutubeAcquireRun,
  listYoutubeAcquireRuns,
  getYoutubeAcquireRun,
  updateYoutubeAcquireRun,
  deleteYoutubeAcquireRun,
  runSummary
} = require('../lib/acquire/YoutubeDetailsStore');
const { captureYoutubeContact } = require('../lib/acquire/YoutubeContactCapture');
const {
  createCommentRun,
  listCommentRuns,
  getCommentRun,
  deleteCommentRun,
  createMinerRun,
  listMinerRuns,
  getMinerRun,
  listTargetHistory,
  createResearchRun,
  listResearchRuns,
  getResearchRun,
  deleteResearchRun,
} = require('../lib/acquire/YoutubeCommentsStore');
const {
  listYoutubeVideos,
  getYoutubeVideo,
  updateYoutubeVideo,
  deleteYoutubeVideo,
} = require('../lib/acquire/YoutubeVideosStore');
const { sbQuery, tableConfig } = require('../lib/supabase');
const { scopedListQuery, scopedIdQuery } = require('../lib/projectScope');
const {
  listYoutubeTopics,
  createYoutubeTopic,
  getYoutubeTopicById,
  updateYoutubeTopic,
  deleteYoutubeTopic,
  rowToYoutubeTopic,
} = require('../lib/acquire/YoutubeTopicsStore');
const { logActivity } = require('../lib/activityLog');
const { getProviderValues } = require('../lib/apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(ms) || 1)));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return '';
}

function splitPhraseList(value) {
  return String(value || '')
    .split(/\r?\n|,/g)
    .map((item) => safeText(item))
    .filter(Boolean);
}

function splitTagList(value) {
  return String(value || '')
    .split(/[\s,|;]+/g)
    .map((item) => safeText(item).toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith('#') ? item : `#${item}`));
}

function parseTextTagTokens(value) {
  return String(value || '')
    .split(/[,\n]/g)
    .map((item) => safeText(item).toLowerCase())
    .filter(Boolean);
}

function normalizedTitleKey(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokenSet(value) {
  return new Set(
    normalizedTitleKey(value)
      .split(/\s+/g)
      .filter((token) => token.length >= 4)
  );
}

function overlapCount(leftSet, rightSet) {
  let count = 0;
  leftSet.forEach((item) => {
    if (rightSet.has(item)) count += 1;
  });
  return count;
}

function extractYoutubeBanReason(tags) {
  const tokens = parseTextTagTokens(tags);
  const reasonToken = tokens.find((token) => token.startsWith('ban_reason:'));
  return reasonToken ? safeText(reasonToken.split(':')[1]) : '';
}

function isYoutubeVideoBanned(tags) {
  const tokens = parseTextTagTokens(tags);
  return tokens.includes('banned') || tokens.some((token) => token.startsWith('ban_reason:'));
}

async function listYoutubeBanProfiles(limit = 1000, scope = null) {
  const res = await listYoutubeVideos(limit, scope);
  if (!res.ok) return [];
  return toArray(res.data)
    .filter((row) => isYoutubeVideoBanned(row?.tags))
    .map((row) => ({
      video_id: safeText(row?.video_id),
      video_url: safeText(row?.video_url),
      channel_name: safeText(row?.channel_name).toLowerCase(),
      title_key: normalizedTitleKey(row?.title),
      title_tokens: titleTokenSet(row?.title),
      reason: extractYoutubeBanReason(row?.tags),
    }));
}

function isResearchCandidateExcluded(candidate, banProfiles) {
  const videoId = safeText(candidate?.video_id);
  const videoUrl = safeText(candidate?.video_url);
  const channelName = safeText(candidate?.channel_name).toLowerCase();
  const titleKey = normalizedTitleKey(candidate?.title || candidate?.video_title);
  const titleTokens = titleTokenSet(candidate?.title || candidate?.video_title);
  return toArray(banProfiles).some((profile) => {
    if (videoId && profile.video_id && profile.video_id === videoId) return true;
    if (videoUrl && profile.video_url && profile.video_url === videoUrl) return true;
    if (titleKey && profile.title_key && profile.title_key === titleKey) return true;
    const sharedTokens = overlapCount(titleTokens, profile.title_tokens);
    if (channelName && profile.channel_name && channelName === profile.channel_name) {
      if (profile.reason === 'corporate' || profile.reason === 'personal') return true;
      if (sharedTokens >= 2) return true;
    }
    if (profile.reason === 'not_serious' && sharedTokens >= 3) return true;
    return false;
  });
}

function hasYoutubeVideoDetails(video) {
  if (!video) return false;
  return Boolean(
    safeText(video.title) &&
    safeText(video.channel_name) &&
    (safeText(video.description) || safeText(video.thumbnail_url) || safeText(video.detail_run_id))
  );
}

function uniqueYoutubeUrls(values) {
  const seen = new Set();
  return toArray(values)
    .map((item) => safeText(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
        return true;
    });
}

function extractYoutubeVideoId(value) {
  const raw = safeText(value);
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = safeText(url.hostname).toLowerCase();
    if (host.includes('youtu.be')) {
      const shortId = safeText(url.pathname.split('/').filter(Boolean)[0]);
      return /^[A-Za-z0-9_-]{11}$/.test(shortId) ? shortId : '';
    }
    const queryId = safeText(url.searchParams.get('v'));
    if (/^[A-Za-z0-9_-]{11}$/.test(queryId)) return queryId;
  } catch (_) {
    return '';
  }
  return '';
}

async function listYoutubeDiagnosticsForUrl(videoUrl, scope = null) {
  const normalizedUrl = safeText(videoUrl);
  const videoId = extractYoutubeVideoId(normalizedUrl);
  const cfg = tableConfig();
  const detailsTable = cfg.acquireYoutubeDetails;
  const commentsTable = cfg.acquireYoutubeComments;
  const detailsByUrlQuery = normalizedUrl
    ? await scopedListQuery(detailsTable, `video_url=eq.${encodeURIComponent(normalizedUrl)}&select=run_id,video_url,video_id,title,channel_name,topic,tags,transcript_status,created_at,updated_at&order=created_at.desc&limit=10`, scope)
    : '';
  const detailsByIdQuery = videoId
    ? await scopedListQuery(detailsTable, `video_id=eq.${encodeURIComponent(videoId)}&select=run_id,video_url,video_id,title,channel_name,topic,tags,transcript_status,created_at,updated_at&order=created_at.desc&limit=10`, scope)
    : '';
  const commentsByUrlQuery = normalizedUrl
    ? await scopedListQuery(commentsTable, `video_url=eq.${encodeURIComponent(normalizedUrl)}&select=run_id,video_url,video_id,title,channel_name,comment_count,created_at,updated_at&order=created_at.desc&limit=10`, scope)
    : '';
  const commentsByIdQuery = videoId
    ? await scopedListQuery(commentsTable, `video_id=eq.${encodeURIComponent(videoId)}&select=run_id,video_url,video_id,title,channel_name,comment_count,created_at,updated_at&order=created_at.desc&limit=10`, scope)
    : '';
  const [videosRes, detailsByUrlRes, detailsByIdRes, commentsByUrlRes, commentsByIdRes] = await Promise.all([
    listYoutubeVideos(1000, scope),
    normalizedUrl ? sbQuery({ method: 'GET', table: detailsTable, query: detailsByUrlQuery }) : Promise.resolve({ ok: true, data: [] }),
    videoId ? sbQuery({ method: 'GET', table: detailsTable, query: detailsByIdQuery }) : Promise.resolve({ ok: true, data: [] }),
    normalizedUrl ? sbQuery({ method: 'GET', table: commentsTable, query: commentsByUrlQuery }) : Promise.resolve({ ok: true, data: [] }),
    videoId ? sbQuery({ method: 'GET', table: commentsTable, query: commentsByIdQuery }) : Promise.resolve({ ok: true, data: [] }),
  ]);

  const canonicalVideos = videosRes.ok
    ? toArray(videosRes.data).filter((item) => {
        const itemUrl = safeText(item?.video_url);
        const itemId = safeText(item?.video_id);
        return (normalizedUrl && itemUrl === normalizedUrl) || (videoId && itemId === videoId);
      })
    : [];

  const dedupeBy = (rows, keyFn) => {
    const seen = new Set();
    return toArray(rows).filter((row) => {
      const key = safeText(keyFn(row));
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    video_url: normalizedUrl,
    video_id: videoId,
    canonical: canonicalVideos,
    detail_runs: dedupeBy([...(detailsByUrlRes.data || []), ...(detailsByIdRes.data || [])], (row) => row?.run_id),
    comment_runs: dedupeBy([...(commentsByUrlRes.data || []), ...(commentsByIdRes.data || [])], (row) => row?.run_id),
    errors: [
      !videosRes.ok ? safeText(videosRes.error) : '',
      !detailsByUrlRes.ok ? safeText(detailsByUrlRes.error) : '',
      !detailsByIdRes.ok ? safeText(detailsByIdRes.error) : '',
      !commentsByUrlRes.ok ? safeText(commentsByUrlRes.error) : '',
      !commentsByIdRes.ok ? safeText(commentsByIdRes.error) : '',
    ].filter(Boolean),
  };
}

async function previewYoutubeAcquireDiagnostics(videoUrl) {
  const normalizedUrl = safeText(videoUrl);
  if (!normalizedUrl) {
    return { video_url: '', ok: false, error: 'video_url is required' };
  }

  try {
    const result = await runYoutubeAcquire({ video_url: normalizedUrl });
    return {
      video_url: normalizedUrl,
      ok: true,
      acquired_at: new Date().toISOString(),
      result: result || {},
    };
  } catch (error) {
    return {
      video_url: normalizedUrl,
      ok: false,
      acquired_at: new Date().toISOString(),
      error: safeText(error?.message) || 'YouTube acquire preview failed',
    };
  }
}

function normalizeKeyword(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordsFromText(value) {
  const text = normalizeKeyword(value);
  if (!text) return [];
  const words = text.split(' ').filter(Boolean);
  if (!words.length) return [];
  if (words.length <= 5) return [words.join(' ')];
  return [words.slice(0, 5).join(' '), words.slice(-5).join(' ')];
}

function extractPhraseCandidatesFromRow(row = {}) {
  const out = [];
  Object.entries(row || {}).forEach(([key, value]) => {
    const field = String(key || '').toLowerCase();
    if (field.includes('id') || field.includes('created') || field.includes('updated')) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        keywordsFromText(item).forEach((k) => out.push(k));
      });
      return;
    }
    if (typeof value === 'string') {
      if (field.includes('hashtag') || field === 'tag' || field === 'tags') {
        splitPhraseList(value).forEach((k) => out.push(normalizeKeyword(k)));
        return;
      }
      keywordsFromText(value).forEach((k) => out.push(k));
    }
  });
  return out.filter(Boolean);
}

function extractTagCandidatesFromRow(row = {}) {
  const out = [];
  Object.entries(row || {}).forEach(([key, value]) => {
    const field = String(key || '').toLowerCase();
    if (field.includes('hashtag') || field === 'tag' || field === 'tags') {
      splitTagList(value).forEach((tag) => out.push(tag));
      return;
    }
    if (typeof value === 'string' && value.indexOf('#') >= 0) {
      const matches = value.match(/#[a-z0-9_]+/gi) || [];
      matches.forEach((tag) => out.push(safeText(tag).toLowerCase()));
    }
  });
  return out.filter(Boolean);
}

function dedupePhrases(phrases = [], limit = 40) {
  const seen = new Set();
  const out = [];
  for (const raw of phrases) {
    const text = normalizeKeyword(raw);
    if (!text || text.length < 3) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchMessagingRows(tableName, limit = 120) {
  if (!tableName) return [];
  const res = await sbQuery({
    method: 'GET',
    table: tableName,
    query: `select=*&order=created_at.desc&limit=${Math.max(1, Math.min(Number(limit) || 120, 500))}`,
  });
  if (!res.ok) return [];
  return Array.isArray(res.data) ? res.data : [];
}

async function searchYoutubeVideosByPhrase(phrase, apiKey, perPhrase = 4) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('maxResults', String(Math.max(1, Math.min(Number(perPhrase) || 4, 50))));
  url.searchParams.set('q', safeText(phrase));
  url.searchParams.set('key', apiKey);
  const response = await fetch(url.toString(), {
    headers: { accept: 'application/json', 'user-agent': 'APH-YoutubeResearch/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok) {
    const message = safeText(body?.error?.message || body?.error?.errors?.[0]?.message) || `YouTube API error (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  const items = Array.isArray(body?.items) ? body.items : [];
  const baseItems = items.map((item) => ({
    video_id: safeText(item?.id?.videoId),
    video_url: safeText(item?.id?.videoId) ? `https://www.youtube.com/watch?v=${safeText(item?.id?.videoId)}` : '',
    title: safeText(item?.snippet?.title),
    channel_name: safeText(item?.snippet?.channelTitle),
    published_at: safeText(item?.snippet?.publishedAt),
  })).filter((item) => item.video_id && item.video_url);
  const ids = baseItems.map((item) => item.video_id).filter(Boolean);
  if (!ids.length) return baseItems;

  const statsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  statsUrl.searchParams.set('part', 'statistics');
  statsUrl.searchParams.set('id', ids.join(','));
  statsUrl.searchParams.set('key', apiKey);
  try {
    const statsResponse = await fetch(statsUrl.toString(), {
      headers: { accept: 'application/json', 'user-agent': 'APH-YoutubeResearch/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    const statsBody = await statsResponse.json();
    if (statsResponse.ok) {
      const statsById = new Map(
        (Array.isArray(statsBody?.items) ? statsBody.items : []).map((item) => {
          return [
            safeText(item?.id),
            {
              view_count: Number(item?.statistics?.viewCount || 0) || 0,
              like_count: Number(item?.statistics?.likeCount || 0) || 0,
              comment_count: Number(item?.statistics?.commentCount || 0) || 0,
            },
          ];
        })
      );
      return baseItems.map((item) => Object.assign({}, item, statsById.get(item.video_id) || {
        view_count: 0,
        like_count: 0,
        comment_count: 0,
      }));
    }
  } catch (_) {
    // Fall back to snippet-only results when statistics lookup fails.
  }
  return baseItems.map((item) => Object.assign({}, item, {
    view_count: 0,
    like_count: 0,
    comment_count: 0,
  }));
}

async function hydrateYoutubeVideoStats(items, apiKey) {
  const rows = Array.isArray(items) ? items : [];
  const ids = rows.map((item) => safeText(item && item.video_id)).filter(Boolean);
  if (!rows.length || !ids.length || !apiKey) return rows;
  const statsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  statsUrl.searchParams.set('part', 'statistics');
  statsUrl.searchParams.set('id', ids.join(','));
  statsUrl.searchParams.set('key', apiKey);
  try {
    const response = await fetch(statsUrl.toString(), {
      headers: { accept: 'application/json', 'user-agent': 'APH-YoutubeResearch/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok) return rows;
    const statsById = new Map(
      (Array.isArray(body?.items) ? body.items : []).map((item) => {
        return [
          safeText(item?.id),
          {
            view_count: Number(item?.statistics?.viewCount || 0) || 0,
            like_count: Number(item?.statistics?.likeCount || 0) || 0,
            comment_count: Number(item?.statistics?.commentCount || 0) || 0,
          },
        ];
      })
    );
    return rows.map((item) => Object.assign({}, item, statsById.get(safeText(item && item.video_id)) || {}));
  } catch (_) {
    return rows;
  }
}

function maybeParseJson(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      try {
        const reparsed = JSON.parse(parsed);
        if (reparsed && typeof reparsed === 'object') return reparsed;
      } catch {
        // ignore
      }
    }
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // ignore
  }
  return null;
}

function extractOpenClawOutputText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];
  for (const message of output) {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const part of content) {
      const text = safeText(
        part?.text
        || part?.value
        || (typeof part?.json === 'string' ? part.json : '')
        || (part?.json && typeof part.json === 'object' ? JSON.stringify(part.json) : '')
      );
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n').trim();
}

function extractBalancedJsonCandidates(raw) {
  const text = safeText(raw);
  if (!text) return [];
  const out = [];
  const starts = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      starts.push({ idx: i, ch });
      continue;
    }
    if (ch === '}' || ch === ']') {
      for (let s = starts.length - 1; s >= 0; s -= 1) {
        const start = starts[s];
        const match = (start.ch === '{' && ch === '}') || (start.ch === '[' && ch === ']');
        if (!match) continue;
        const candidate = text.slice(start.idx, i + 1);
        if (candidate.length >= 2) out.push(candidate);
        starts.splice(s, 1);
        break;
      }
    }
  }
  // Favor larger candidates first (more likely full payload shape).
  out.sort((a, b) => b.length - a.length);
  return out;
}

function extractJsonFromText(text) {
  const raw = safeText(text);
  if (!raw) return null;
  const direct = maybeParseJson(raw);
  if (direct) return direct;
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    const parsed = maybeParseJson(fencedMatch[1]);
    if (parsed) return parsed;
  }
  // Try extracting the largest JSON-like object/array from mixed prose.
  const startObj = raw.indexOf('{');
  const endObj = raw.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    const slice = raw.slice(startObj, endObj + 1);
    const parsed = maybeParseJson(slice);
    if (parsed) return parsed;
  }
  const startArr = raw.indexOf('[');
  const endArr = raw.lastIndexOf(']');
  if (startArr >= 0 && endArr > startArr) {
    const slice = raw.slice(startArr, endArr + 1);
    const parsed = maybeParseJson(slice);
    if (parsed) return parsed;
  }
  const candidates = extractBalancedJsonCandidates(raw);
  for (const candidate of candidates) {
    const parsed = maybeParseJson(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeOffersFromFreeformText(text) {
  const raw = safeText(text);
  if (!raw) return [];
  const blocks = raw
    .split(/\n{2,}/g)
    .map((item) => safeText(item))
    .filter(Boolean);
  const lines = raw
    .split(/\r?\n/g)
    .map((item) => safeText(item))
    .filter(Boolean);
  const candidates = blocks.concat(lines)
    .map((line) => line
      .replace(/^[\-\*\u2022]\s*/, '')
      .replace(/^\d+[\)\].:-]?\s*/, '')
      .replace(/^offer\s*\d+[:\-]?\s*/i, '')
      .replace(/^reply\s*\d+[:\-]?\s*/i, '')
      .replace(/^why[:\-]?\s*/i, '')
      .trim())
    .filter((line) => line.length >= 20)
    .filter((line) => !/^(strict json|json only|return only|no markdown)/i.test(line));

  const deduped = [];
  const seen = new Set();
  for (const line of candidates) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ text: line, why: '' });
    if (deduped.length >= 3) break;
  }
  return deduped;
}

async function callOpenClawResponses(inputPayload) {
  const cfg = getProviderValues('openclaw');
  const baseUrl = safeText(cfg?.base_url).replace(/\/+$/, '');
  const apiKey = safeText(cfg?.api_key);
  const timeoutMs = Math.max(5000, Number(cfg?.timeout_ms || 120000) || 120000);
  if (!baseUrl) {
    return { ok: false, status: 400, error: 'OpenClaw API is not configured in Settings > APIs' };
  }
  if (!apiKey) {
    return { ok: false, status: 400, error: 'OpenClaw API key is missing in Settings > APIs' };
  }

  const basePrompt = [
    'You are acquiring Reddit data for analytics.',
    'Use browser automation with human-in-the-loop as needed.',
    `Target: ${safeText(inputPayload?.target)}`,
    `Mode: ${safeText(inputPayload?.mode || 'auto')}`,
    `Sort: ${safeText(inputPayload?.sort || 'new')}`,
    `Max posts: ${Number(inputPayload?.max_posts || 100) || 100}`,
    `Max comments: ${Number(inputPayload?.max_comments || 500) || 500}`,
    `Keyword: ${safeText(inputPayload?.keyword) || '(none)'}`,
    `Start date: ${safeText(inputPayload?.start_time) || '(none)'}`,
    `End date: ${safeText(inputPayload?.end_time) || '(none)'}`,
    `Include replies: ${inputPayload?.include_replies !== false}`,
    '',
    'Return ONLY valid JSON with this shape:',
    '{"subreddit":"","post":null,"posts":[],"comments":[],"errors":[]}',
    'Each comment should include id, author, score, body, created_utc, permalink when available.',
    'No markdown fences. No prose. JSON only.',
  ].join('\n');

  async function sendPrompt(inputText) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openclaw:main',
          input: inputText,
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { raw };
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status || 502,
          error: safeText(payload?.error?.message || payload?.message || payload?.error) || `OpenClaw /v1/responses failed (${response.status})`,
          data: payload,
        };
      }
      return { ok: true, status: response.status || 200, data: payload };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { ok: false, status: 504, error: 'OpenClaw /v1/responses request timed out' };
      }
      return { ok: false, status: 502, error: `OpenClaw /v1/responses request failed: ${safeText(err?.message) || 'unknown error'}` };
    } finally {
      clearTimeout(timer);
    }
  }

  const first = await sendPrompt(basePrompt);
  if (!first.ok) return first;
  const firstText = extractOpenClawOutputText(first.data || {});
  const firstJson = extractJsonFromText(firstText);
  if (firstJson) return first;

  // Retry once with an explicit JSON-repair instruction when model responds with prose.
  const retryPrompt = [
    'Convert the following content into strict JSON with keys:',
    '{"subreddit":"","post":null,"posts":[],"comments":[],"errors":[]}',
    'If content is not acquire data, return empty arrays and set errors with a short explanation.',
    'No markdown. No prose. JSON only.',
    '',
    'CONTENT START',
    firstText || '(empty)',
    'CONTENT END',
  ].join('\n');
  const second = await sendPrompt(retryPrompt);
  if (!second.ok) return second;
  const secondText = extractOpenClawOutputText(second.data || {});
  const secondJson = extractJsonFromText(secondText);
  if (secondJson) return second;

  return {
    ok: false,
    status: 502,
    error: 'OpenClaw returned non-JSON output.',
    data: { first_output: firstText || '', second_output: secondText || '' },
  };
}

async function callOpenClawYoutubeReplyOffers(inputPayload) {
  const cfg = getProviderValues('openclaw');
  const baseUrl = safeText(cfg?.base_url).replace(/\/+$/, '');
  const apiKey = safeText(cfg?.api_key);
  const timeoutMs = Math.max(5000, Number(cfg?.timeout_ms || 90000) || 90000);
  if (!baseUrl) {
    return { ok: false, status: 400, error: 'OpenClaw API is not configured in Settings > APIs' };
  }
  if (!apiKey) {
    return { ok: false, status: 400, error: 'OpenClaw API key is missing in Settings > APIs' };
  }

  const comment = safeText(inputPayload?.comment);
  const context = safeText(inputPayload?.response_context);
  const guidelines = safeText(inputPayload?.response_guidelines);
  const categories = toArray(inputPayload?.categories).map((v) => safeText(v)).filter(Boolean);
  const attributes = toArray(inputPayload?.attributes).map((v) => safeText(v)).filter(Boolean);
  const approaches = toArray(inputPayload?.approaches).map((v) => safeText(v)).filter(Boolean);
  const trainingNotes = safeText(inputPayload?.training_notes);
  const usedReplies = toArray(inputPayload?.used_replies).map((v) => safeText(v)).filter(Boolean);
  const discouragedPhrases = toArray(inputPayload?.discouraged_phrases).map((v) => safeText(v)).filter(Boolean);
  const videoTitle = safeText(inputPayload?.video_title);
  const videoId = safeText(inputPayload?.video_id);

  if (!comment) {
    return { ok: false, status: 400, error: 'comment is required' };
  }

  const prompt = [
    'You generate high-quality, specific YouTube comment replies.',
    '',
    'MANDATORY RULES:',
    '- Return STRICT JSON only (no markdown, no prose, no code fences).',
    '- JSON shape exactly: {"offers":[{"text":"","why":""},{"text":"","why":""},{"text":"","why":""}]}',
    '- Exactly 3 offers.',
    '- Each offer must be unique and directly grounded in the exact comment text.',
    '- Avoid generic coaching phrases and generic templates.',
    '- Do not ask the same stock question across offers.',
    '- No links unless context explicitly requires one.',
    '- Each "why" must briefly explain why this reply fits THIS comment.',
    '',
    `COMMENT: ${comment}`,
    `VIDEO TITLE: ${videoTitle || '(unknown)'}`,
    `VIDEO ID: ${videoId || '(unknown)'}`,
    `CATEGORY HINTS: ${categories.join(', ') || '(none)'}`,
    `ATTRIBUTE HINTS: ${attributes.join(', ') || '(none)'}`,
    `APPROACH HINTS: ${approaches.join(', ') || '(none)'}`,
    `TRAINING NOTES: ${trainingNotes || '(none)'}`,
    `RESPONSE CONTEXT: ${context || '(none)'}`,
    `RESPONSE GUIDELINES: ${guidelines || '(none)'}`,
    `DISCOURAGED PHRASES (MUST AVOID): ${discouragedPhrases.join(' | ') || '(none)'}`,
    `ALREADY USED REPLIES IN CURRENT RUN (MUST AVOID): ${usedReplies.join(' | ') || '(none)'}`,
  ].join('\n');

  async function sendPrompt(inputText) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openclaw:main',
          input: inputText,
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { raw };
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status || 502,
          error: safeText(payload?.error?.message || payload?.message || payload?.error) || `OpenClaw /v1/responses failed (${response.status})`,
          data: payload,
        };
      }
      return { ok: true, status: response.status || 200, data: payload };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { ok: false, status: 504, error: 'OpenClaw /v1/responses request timed out' };
      }
      return { ok: false, status: 502, error: `OpenClaw /v1/responses request failed: ${safeText(err?.message) || 'unknown error'}` };
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeOffersFromParsed(parsed) {
    const candidateArrays = [
      parsed?.offers,
      parsed?.replies,
      parsed?.options,
      parsed?.data?.offers,
      parsed?.result?.offers,
    ];
    for (const candidate of candidateArrays) {
      if (!Array.isArray(candidate)) continue;
      const normalized = candidate.map((item) => {
        if (typeof item === 'string') return { text: safeText(item), why: '' };
        return {
          text: safeText(item?.text || item?.offer || item?.response || item?.reply),
          why: safeText(item?.why || item?.reason || item?.rationale),
        };
      }).filter((item) => item.text);
      if (normalized.length) return normalized;
    }
    return [];
  }

  const first = await sendPrompt(prompt);
  if (!first.ok) return first;
  const firstText = extractOpenClawOutputText(first.data || {});
  const firstParsed = extractJsonFromText(firstText);
  let offers = normalizeOffersFromParsed(firstParsed || {});
  let secondText = '';
  let thirdText = '';

  if (offers.length < 3) {
    const repairPrompt = [
      'Convert the following into STRICT JSON with shape:',
      '{"offers":[{"text":"","why":""},{"text":"","why":""},{"text":"","why":""}]}',
      'Exactly 3 offers. No markdown fences. No prose. JSON only.',
      '',
      'CONTENT START',
      firstText || '(empty)',
      'CONTENT END',
    ].join('\n');
    const second = await sendPrompt(repairPrompt);
    if (!second.ok) return second;
    secondText = extractOpenClawOutputText(second.data || {});
    const secondParsed = extractJsonFromText(secondText);
    offers = normalizeOffersFromParsed(secondParsed || {});
  }

  if (offers.length < 3) {
    offers = normalizeOffersFromFreeformText(secondText || firstText);
  }

  if (offers.length < 3) {
    const thirdPrompt = [
      'Write exactly 3 unique YouTube replies for the COMMENT below.',
      'Rules:',
      '- Keep each reply specific to the comment',
      '- No generic coaching language',
      '- No links',
      '- Output EXACTLY 3 lines and nothing else',
      '- Each line must start with "1) ", "2) ", "3) " respectively',
      '',
      `COMMENT: ${comment}`,
      `VIDEO TITLE: ${videoTitle || '(unknown)'}`,
      `CATEGORY HINTS: ${categories.join(', ') || '(none)'}`,
      `ATTRIBUTE HINTS: ${attributes.join(', ') || '(none)'}`,
      `APPROACH HINTS: ${approaches.join(', ') || '(none)'}`,
      `RESPONSE CONTEXT: ${context || '(none)'}`,
      `RESPONSE GUIDELINES: ${guidelines || '(none)'}`,
      `DISCOURAGED PHRASES (MUST AVOID): ${discouragedPhrases.join(' | ') || '(none)'}`,
      `ALREADY USED REPLIES IN CURRENT RUN (MUST AVOID): ${usedReplies.join(' | ') || '(none)'}`,
    ].join('\n');
    const third = await sendPrompt(thirdPrompt);
    if (!third.ok) return third;
    thirdText = extractOpenClawOutputText(third.data || {});
    offers = normalizeOffersFromFreeformText(thirdText);
  }

  const deduped = [];
  const seen = new Set();
  for (const offer of offers) {
    const key = safeText(offer?.text).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      text: safeText(offer?.text),
      why: safeText(offer?.why),
    });
    if (deduped.length >= 3) break;
  }
  if (deduped.length < 3) {
    const excerpt = safeText(thirdText || secondText || firstText).slice(0, 220).replace(/\s+/g, ' ');
    return {
      ok: false,
      status: 502,
      error: `OpenClaw returned invalid offers payload. Excerpt: ${excerpt || '(empty output)'}`,
      data: {
        offers_count: deduped.length,
        sample: offers.slice(0, 5),
        first_output_excerpt: safeText(firstText).slice(0, 1200),
        second_output_excerpt: safeText(secondText).slice(0, 1200),
        third_output_excerpt: safeText(thirdText).slice(0, 1200),
      },
    };
  }
  return { ok: true, status: 200, data: { offers: deduped } };
}

function findAcquireShape(node, depth = 0) {
  if (!node || depth > 12) return null;
  if (typeof node === 'string') {
    const parsedFromMixed = extractJsonFromText(node);
    if (parsedFromMixed) {
      return findAcquireShape(parsedFromMixed, depth + 1);
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findAcquireShape(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;

  const hasPost = node.post && typeof node.post === 'object';
  const hasPosts = Array.isArray(node.posts);
  const hasComments = Array.isArray(node.comments);
  if (hasPost || hasPosts || hasComments) {
    return node;
  }

  for (const value of Object.values(node)) {
    const parsed = maybeParseJson(value);
    if (parsed) {
      const foundParsed = findAcquireShape(parsed, depth + 1);
      if (foundParsed) return foundParsed;
    }
    const found = findAcquireShape(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeOpenClawAcquireResult(rawPayload, inputPayload, trace = {}) {
  const shaped = findAcquireShape(rawPayload) || {};
  const postsFromShape = Array.isArray(shaped.posts) ? shaped.posts : [];
  const postFromShape = shaped.post && typeof shaped.post === 'object' ? shaped.post : null;
  const comments = Array.isArray(shaped.comments) ? shaped.comments : [];
  const posts = postsFromShape.length
    ? postsFromShape
    : (postFromShape ? [postFromShape] : []);
  const primaryPost = postFromShape || posts[0] || null;
  const subreddit = firstNonEmpty(
    primaryPost?.subreddit,
    shaped?.subreddit,
    inputPayload?.subreddit
  );

  return {
    mode: safeText(inputPayload?.mode || 'auto') || 'auto',
    source_mode: 'openclaw',
    target: safeText(inputPayload?.target),
    subreddit,
    post: primaryPost || null,
    posts,
    comments,
    errors: [],
    endpoint: firstNonEmpty(shaped?.endpoint, 'openclaw'),
    auth_mode: 'openclaw',
    openclaw: {
      job_id: safeText(trace?.jobId),
      approval_token_present: Boolean(trace?.approvalToken),
      steps: trace?.steps || [],
    },
    raw: rawPayload && typeof rawPayload === 'object' ? rawPayload : {},
  };
}

async function runRedditAcquireViaOpenClaw(inputPayload) {
  const responseCall = await callOpenClawResponses(inputPayload);
  if (!responseCall.ok) {
    try {
      const backup = await runRedditAcquire({
        ...inputPayload,
        source_mode: 'public',
        max_posts: Math.min(Number(inputPayload?.max_posts || 100) || 100, 5),
        max_comments: Math.min(Number(inputPayload?.max_comments || 500) || 500, 100),
      });
      if (backup?.ok && backup?.data) {
        return {
          ok: true,
          status: Number(backup.status || 200) || 200,
          data: {
            ...backup.data,
            source_mode: 'openclaw_fallback_public',
            openclaw: {
              job_id: safeText(responseCall?.data?.id),
              approval_token_present: false,
              steps: [{ action: 'responses', ok: false, status: Number(responseCall.status || 0) || 502 }],
            },
            errors: [
              ...(Array.isArray(backup.data.errors) ? backup.data.errors : []),
              {
                stage: 'openclaw',
                message: safeText(responseCall.error) || 'OpenClaw request failed; used Reddit public fallback.',
              },
            ],
            raw: responseCall.data && typeof responseCall.data === 'object' ? responseCall.data : {},
          },
        };
      }
    } catch (_) {}

    // Never hard-stop the run on OpenClaw transport/format errors.
    return {
      ok: true,
      status: 200,
      data: {
        mode: safeText(inputPayload?.mode || 'auto') || 'auto',
        source_mode: 'openclaw_unavailable',
        target: safeText(inputPayload?.target),
        subreddit: '',
        post: null,
        posts: [],
        comments: [],
        endpoint: 'openclaw',
        auth_mode: 'openclaw',
        errors: [
          {
            stage: 'openclaw',
            message: safeText(responseCall.error) || 'OpenClaw request failed.',
          },
        ],
        openclaw: {
          job_id: safeText(responseCall?.data?.id),
          approval_token_present: false,
          steps: [{ action: 'responses', ok: false, status: Number(responseCall.status || 0) || 502 }],
        },
        raw: responseCall.data && typeof responseCall.data === 'object' ? responseCall.data : {},
      },
    };
  }
  const outputText = extractOpenClawOutputText(responseCall.data || {});
  const parsedFromText = extractJsonFromText(outputText);
  const rawPayload = parsedFromText || responseCall.data || {};
  const normalized = normalizeOpenClawAcquireResult(rawPayload, inputPayload, {
    jobId: safeText(responseCall.data?.id),
    steps: [{ action: 'responses', ok: true, status: Number(responseCall.status || 0) || 200 }],
  });

  if (!normalized.posts.length && !normalized.comments.length && !normalized.post) {
    // Fallback: attempt direct Reddit acquire path so the run can still complete.
    try {
      const backup = await runRedditAcquire({
        ...inputPayload,
        source_mode: 'public',
        max_posts: Math.min(Number(inputPayload?.max_posts || 100) || 100, 5),
        max_comments: Math.min(Number(inputPayload?.max_comments || 500) || 500, 100),
      });
      if (backup?.ok && backup?.data) {
        return {
          ok: true,
          status: Number(backup.status || responseCall.status || 200) || 200,
          data: {
            ...backup.data,
            source_mode: 'openclaw_fallback_public',
            openclaw: {
              job_id: safeText(responseCall.data?.id),
              approval_token_present: false,
              steps: [{ action: 'responses', ok: true, status: Number(responseCall.status || 0) || 200 }],
            },
            errors: [
              ...(Array.isArray(backup.data.errors) ? backup.data.errors : []),
              {
                stage: 'openclaw',
                message: 'OpenClaw returned non-structured output; used Reddit public fallback.',
              },
            ],
            raw: responseCall.data && typeof responseCall.data === 'object' ? responseCall.data : {},
            output_text: outputText || '',
          },
        };
      }
    } catch (_) {}

    // Last resort: persist a structured run shell with diagnostics instead of hard-failing.
    return {
      ok: true,
      status: 200,
      data: {
        mode: safeText(inputPayload?.mode || 'auto') || 'auto',
        source_mode: 'openclaw_unstructured',
        target: safeText(inputPayload?.target),
        subreddit: '',
        post: null,
        posts: [],
        comments: [],
        endpoint: 'openclaw',
        auth_mode: 'openclaw',
        errors: [
          {
            stage: 'openclaw',
            message: 'OpenClaw finished but did not return structured Reddit acquire data.',
            hint: 'Use smaller limits (10 posts / 100 comments) and retry, or inspect raw payload in Run Detail.',
          },
        ],
        openclaw: {
          job_id: safeText(responseCall.data?.id),
          approval_token_present: false,
          steps: [{ action: 'responses', ok: true, status: Number(responseCall.status || 0) || 200 }],
        },
        raw: responseCall.data && typeof responseCall.data === 'object' ? responseCall.data : {},
        output_text: outputText || '',
      },
    };
  }

  return { ok: true, status: responseCall.status || 200, data: normalized };
}

async function handle(req, res, pathname, method) {
  const urlObj = getUrlObj(req);
  const projectScope = requestProjectScope(req);

  // GET /api/acquire/jobs — read-only, no extra limit
  if (pathname === '/api/acquire/jobs' && method === 'GET') {
    const limit  = Number(urlObj.searchParams.get('limit') || 200);
    const scope = requestProjectScope(req);
    const result = await listAcquireJobs(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const jobs = result.data || [];
    return sendOk(res, 200, jobs, { jobs }, { total: jobs.length }), true;
  }

  // DELETE /api/acquire/jobs/:id — write, but cheap
  const acquireJobMatch = pathname.match(/^\/api\/acquire\/jobs\/([^/]+)$/);
  if (acquireJobMatch && method === 'DELETE') {
    const id     = decodeURIComponent(acquireJobMatch[1]);
    const scope = requestProjectScope(req);
    const result = await deleteMirroredAcquireJob(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.job_deleted', entityType: 'acquire', entityId: id,
      summary: `Acquire job deleted: ${id}`
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // GET /api/acquire/direct-runs — read-only
  if (pathname === '/api/acquire/direct-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 20);
    const scope = requestProjectScope(req);
    const runs = await listDirectAcquireRuns(limit, scope);
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/direct-runs/:id — read-only
  const directRunMatch = pathname.match(/^\/api\/acquire\/direct-runs\/([^/]+)$/);
  if (directRunMatch && method === 'GET') {
    const scope = requestProjectScope(req);
    const run = await getDirectAcquireRun(decodeURIComponent(directRunMatch[1]), scope);
    if (!run) return sendErr(res, 404, 'Run not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, run, { run }), true;
  }

  // GET /api/acquire/website-peers — project-scoped persistent peer website dataset
  if (pathname === '/api/acquire/website-peers' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 500);
    const scope = requestProjectScope(req);
    const result = await listWebsitePeers(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const websitePeers = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, websitePeers, { websitePeers }, { total: websitePeers.length }), true;
  }

  // POST /api/acquire/website-peers — manual create/update support for curated peer dataset
  if (pathname === '/api/acquire/website-peers' && method === 'POST') {
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const result = await createWebsitePeer(body || {}, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { websitePeer: result.data }), true;
  }

  // POST /api/acquire/peer-discovery — keyword-only crawl, Google search, similarity rank (top 5)
  if (pathname === '/api/acquire/peer-discovery' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.direct')) return true;
    const body = await parseJsonBody(req);
    const sourceUrl = safeText(body?.source_url || body?.site_url);
    if (!sourceUrl) return sendErr(res, 400, 'source_url is required'), true;
    const scope = requestProjectScope(req);
    const discovery = await runPeerDiscovery({
      source_url: sourceUrl,
      max_pages: Number(body?.max_pages || 10) || 10,
      body_snippet_chars: Number(body?.body_snippet_chars || 500) || 500,
      keyword_exclusions: body?.keyword_exclusions || '',
      keyword_count: Number(body?.keyword_count || 5) || 5,
      results_per_keyword: Number(body?.results_per_keyword || 30) || 30,
      output_count: Number(body?.output_count || 5) || 5,
      light_fetch_count: Number(body?.light_fetch_count || 20) || 20,
    }, scope);
    return sendOk(res, 200, discovery, discovery), true;
  }

  // POST /api/acquire/website-peers/discover — discover peer-site candidates without saving them yet
  if (pathname === '/api/acquire/website-peers/discover' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.direct')) return true;
    const body = await parseJsonBody(req);
    const sourceUrl = safeText(body?.source_url || body?.site_url);
    if (!sourceUrl) return sendErr(res, 400, 'source_url is required'), true;
    const scope = requestProjectScope(req);
    const discovery = await runPeerDiscovery({
      source_url: sourceUrl,
      max_pages: Number(body?.max_pages || 10) || 10,
      body_snippet_chars: Number(body?.body_snippet_chars || 500) || 500,
      keyword_exclusions: body?.keyword_exclusions || '',
      keyword_count: Number(body?.keyword_count || 5) || 5,
      results_per_keyword: Number(body?.results_per_keyword || 30) || 30,
      output_count: Number(body?.peer_sites_limit || body?.output_count || 5) || 5,
      light_fetch_count: Number(body?.light_fetch_count || 20) || 20,
    }, scope);
    const peers = Array.isArray(discovery?.results) ? discovery.results : [];
    const peerSummary = {
      enabled: true,
      configured: !!discovery?.configured,
      provider: String(discovery?.provider || 'google_custom_search'),
      error: String(discovery?.error || '').trim(),
      searched_keywords: Array.isArray(discovery?.searched_keywords) ? discovery.searched_keywords : [],
      raw_results_count: Number(discovery?.raw_results_count || 0) || 0,
      unique_domains_count: Number(discovery?.unique_domains_count || 0) || 0,
      filtered_count: Number(discovery?.filtered_count || 0) || 0,
      peers: peers.map((item) => ({
        domain: item.domain,
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        rank: item.rank,
        hits: item.hits,
        matched_keywords: item.matched_keywords,
        model: item.website_model,
        other_models: item.other_models,
        similarity_score: item.similarity_score,
        suggested_reference_role: item.suggested_reference_role,
        reasons: item.reasons,
      })),
      suggested_models: [],
      errors: Array.isArray(discovery?.errors) ? discovery.errors : [],
      version: String(discovery?.version || '').trim(),
    };
    return sendOk(res, 200, {
      source_url: discovery?.source_url || sourceUrl,
      pages_succeeded: Number(discovery?.pages_succeeded || 0) || 0,
      keyword_summary: discovery?.keyword_summary || {},
      peer_summary: peerSummary,
      discovery,
    }, {
      source_url: discovery?.source_url || sourceUrl,
      pages_succeeded: Number(discovery?.pages_succeeded || 0) || 0,
      keyword_summary: discovery?.keyword_summary || {},
      peer_summary: peerSummary,
      discovery,
    }), true;
  }

  const websitePeerMatch = pathname.match(/^\/api\/acquire\/website-peers\/([^/]+)$/);
  if (websitePeerMatch && method === 'GET') {
    const scope = requestProjectScope(req);
    const result = await getWebsitePeer(decodeURIComponent(websitePeerMatch[1]), scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { websitePeer: result.data }), true;
  }

  if (websitePeerMatch && method === 'PATCH') {
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const result = await updateWebsitePeer(decodeURIComponent(websitePeerMatch[1]), body || {}, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { websitePeer: result.data }), true;
  }

  if (websitePeerMatch && method === 'DELETE') {
    const scope = requestProjectScope(req);
    const result = await deleteWebsitePeer(decodeURIComponent(websitePeerMatch[1]), scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { websitePeer: result.data }), true;
  }

  // POST /api/acquire/direct-run — ⚡ RATE LIMITED (hits external web)
  if (pathname === '/api/acquire/direct-run' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.direct')) return true;

    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const run = await runDirectAcquire(body || {}, scope);
    let websitePeersSavedCount = 0;
    let websitePeersError = '';
    const websitePeersResult = await upsertWebsitePeersFromRun(run, scope);
    if (websitePeersResult.ok) {
      websitePeersSavedCount = Number(websitePeersResult.data?.count || 0) || 0;
    } else {
      websitePeersError = String(websitePeersResult.error || '').trim();
    }
    logActivity({
      action: 'acquire.direct_run', entityType: 'acquire', entityId: run?.id,
      summary: `Direct acquire run: ${body.url || 'unknown URL'}`
    });
    return sendOk(res, 201, run, {
      run,
      website_peers_saved_count: websitePeersSavedCount,
      website_peers_error: websitePeersError,
    }), true;
  }

  // POST /api/acquire/youtube — ⚡ RATE LIMITED (hits YouTube + transcript APIs)
  if (pathname === '/api/acquire/youtube' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;

    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const inputPayload = {
      ...(body || {}),
      category: String(body?.category || '').trim(),
    };
    const result    = await runYoutubeAcquire(inputPayload);
    const createRes = await createYoutubeAcquireRun(inputPayload, result, scope);
    if (!createRes.ok) {
      return sendErr(res, createRes.status || 500, createRes.error,
        { details: createRes.raw ? [String(createRes.raw)] : [] }), true;
    }
    const summary = runSummary(createRes.data);
    let contactCapture = null;
    if (body?.capture_contact === true) {
      const captureRes = await captureYoutubeContact(result, summary.video_url);
      if (!captureRes.ok) {
        return sendErr(res, captureRes.status || 500, captureRes.error || 'Contact capture failed'), true;
      }
      contactCapture = captureRes.data;
    }
    logActivity({
      action: 'acquire.youtube', entityType: 'acquire', entityId: summary.run_id,
      summary: `YouTube acquired: ${summary.title || body.video_url || 'unknown'}`,
      meta: {
        video_url: summary.video_url,
        channel: summary.channel_name,
        transcript_status: summary.transcript_status,
        category: summary.category || ''
      }
    });
    if (contactCapture?.contact?.id) {
      logActivity({
        action: 'contact.captured_youtube',
        entityType: 'contact',
        entityId: contactCapture.contact.id,
        summary: `YouTube contact ${contactCapture.mode}: ${contactCapture.contact.company || contactCapture.contact.email || contactCapture.contact.id}`,
        meta: { run_id: summary.run_id, video_url: summary.video_url, mode: contactCapture.mode }
      });
    }
    const payload = { result, run: summary, contactCapture };
    return sendOk(res, 200, payload, payload), true;
  }

  // POST /api/acquire/x-acquire
  if (pathname === '/api/acquire/x-acquire' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.x')) return true;

    const body = await parseJsonBody(req);
    const inputPayload = {
      query: String(body?.query || '').trim(),
      hashtags: Array.isArray(body?.hashtags)
        ? body.hashtags
        : String(body?.hashtags || '').split(/[,\s]+/g).map((item) => item.trim()).filter(Boolean),
      lang: String(body?.lang || '').trim(),
      start_time: String(body?.start_time || '').trim(),
      end_time: String(body?.end_time || '').trim(),
      max_tweets: Number(body?.max_tweets || 25) || 25,
      max_replies_per_tweet: Number(body?.max_replies_per_tweet || 10) || 10,
      include_replies: body?.include_replies === true,
      exclude_retweets: body?.exclude_retweets !== false,
      exclude_replies: body?.exclude_replies === true,
      segment_id: String(body?.segment_id || '').trim(),
      segment_label: String(body?.segment_label || '').trim(),
    };
    const acquireResult = await runXAcquire(inputPayload);
    if (!acquireResult.ok) {
      return sendErr(res, acquireResult.status || 500, acquireResult.error || 'X acquire failed', {
        details: [
          String(acquireResult.endpoint || ''),
          acquireResult.oauth1 ? `oauth1: ${JSON.stringify(acquireResult.oauth1)}` : '',
          acquireResult.oauth2 ? `oauth2: ${JSON.stringify(acquireResult.oauth2)}` : '',
          JSON.stringify(acquireResult.data || {}),
        ].filter(Boolean),
      }), true;
    }
    const scope = requestProjectScope(req);
    const saved = createXAcquireRun(inputPayload, acquireResult.data || {}, scope);
    const run = saved.data || null;
    logActivity({
      action: 'acquire.x',
      entityType: 'acquire',
      entityId: run?.run_id || null,
      summary: `X acquire acquired ${Number(run?.stats?.total_tweets || 0) || 0} tweets`,
      meta: {
        query: String(run?.query || ''),
        hashtags: Array.isArray(run?.hashtags) ? run.hashtags.join(',') : '',
        total_tweets: Number(run?.stats?.total_tweets || 0) || 0,
        total_replies: Number(run?.stats?.total_replies || 0) || 0,
      },
    });
    return sendOk(res, 200, { run: run || null, result: acquireResult.data || {} }, { run: run || null, result: acquireResult.data || {} }), true;
  }

  // GET /api/acquire/x-runs — read-only
  if (pathname === '/api/acquire/x-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 20);
    const scope = requestProjectScope(req);
    const result = listXAcquireRuns(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/x-runs/:id — read-only
  const xRunMatch = pathname.match(/^\/api\/acquire\/x-runs\/([^/]+)$/);
  if (xRunMatch && method === 'GET') {
    const id = decodeURIComponent(xRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = getXAcquireRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // DELETE /api/acquire/x-runs/:id
  if (xRunMatch && method === 'DELETE') {
    const id = decodeURIComponent(xRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = deleteXAcquireRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.x_deleted',
      entityType: 'acquire',
      entityId: id,
      summary: `X acquire run deleted: ${id}`,
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // POST /api/acquire/reddit-acquire
  if (pathname === '/api/acquire/reddit-acquire' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.reddit')) return true;

    const body = await parseJsonBody(req);
    const inputPayload = {
      target: String(body?.target || '').trim(),
      mode: String(body?.mode || 'auto').trim().toLowerCase(),
      source_mode: String(body?.source_mode || body?.sourceMode || 'auto').trim().toLowerCase(),
      subreddit: String(body?.subreddit || '').trim(),
      post_id: String(body?.post_id || body?.postId || '').trim(),
      sort: String(body?.sort || 'new').trim().toLowerCase(),
      max_posts: Number(body?.max_posts || body?.maxPosts || 100) || 100,
      max_comments: Number(body?.max_comments || body?.maxComments || 500) || 500,
      keyword: String(body?.keyword || '').trim(),
      start_time: String(body?.start_time || body?.startTime || '').trim(),
      end_time: String(body?.end_time || body?.endTime || '').trim(),
      include_replies: body?.include_replies !== false,
      source_mode: 'openclaw',
    };
    const startedAt = Date.now();
    const routeBudgetMs = Math.max(20000, Number(process.env.REDDIT_ROUTE_TIMEOUT_MS || 120000) || 120000);
    console.log('[acquire.reddit] start', {
      target: inputPayload.target,
      mode: inputPayload.mode,
      max_posts: inputPayload.max_posts,
      max_comments: inputPayload.max_comments,
      routeBudgetMs,
    });
    const acquireResult = await Promise.race([
      runRedditAcquireViaOpenClaw(inputPayload),
      (async () => {
        await waitFor(routeBudgetMs);
        return { ok: false, status: 504, error: `Reddit acquire route timed out after ${routeBudgetMs}ms` };
      })(),
    ]);
    console.log('[acquire.reddit] acquire-finished', {
      ok: !!acquireResult?.ok,
      status: Number(acquireResult?.status || 0) || 0,
      elapsedMs: Date.now() - startedAt,
    });
    if (!acquireResult.ok) {
      return sendErr(res, acquireResult.status || 500, acquireResult.error || 'Reddit acquire failed', {
        details: [
          String(acquireResult.data?.hint || ''),
          String(acquireResult.data?.type || ''),
          String(acquireResult.data?.job_id || ''),
        ].filter(Boolean),
      }), true;
    }
    const scope = requestProjectScope(req);
    const saved = await Promise.race([
      Promise.resolve(createRedditAcquireRun(inputPayload, acquireResult.data || {}, scope)),
      (async () => {
        await waitFor(10000);
        return { ok: false, status: 504, error: 'Reddit acquire save timed out after 10000ms' };
      })(),
    ]);
    if (!saved?.ok) {
      console.log('[acquire.reddit] save-failed', {
        status: Number(saved?.status || 0) || 0,
        error: safeText(saved?.error),
      });
      return sendErr(res, saved.status || 500, saved.error || 'Failed to save Reddit acquire run'), true;
    }
    const run = saved.data || null;
    console.log('[acquire.reddit] done', {
      run_id: run?.run_id || null,
      elapsedMs: Date.now() - startedAt,
      posts: Number(run?.stats?.total_posts || 0) || 0,
      comments: Number(run?.stats?.total_comments || 0) || 0,
    });
    logActivity({
      action: 'acquire.reddit',
      entityType: 'acquire',
      entityId: run?.run_id || null,
      summary: `Reddit acquire acquired ${Number(run?.stats?.total_posts || 0) || 0} posts`,
      meta: {
        mode: String(run?.mode || ''),
        target: String(run?.target || ''),
        subreddit: String(run?.subreddit || ''),
        total_posts: Number(run?.stats?.total_posts || 0) || 0,
        total_comments: Number(run?.stats?.total_comments || 0) || 0,
      },
    });
    return sendOk(res, 200, { run: run || null, result: acquireResult.data || {} }, { run: run || null, result: acquireResult.data || {} }), true;
  }

  // GET /api/acquire/reddit-runs — read-only
  if (pathname === '/api/acquire/reddit-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 20);
    const scope = requestProjectScope(req);
    const result = listRedditAcquireRuns(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/reddit-runs/:id
  const redditRunMatch = pathname.match(/^\/api\/acquire\/reddit-runs\/([^/]+)$/);
  if (redditRunMatch && method === 'GET') {
    const id = decodeURIComponent(redditRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = getRedditAcquireRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // DELETE /api/acquire/reddit-runs/:id
  if (redditRunMatch && method === 'DELETE') {
    const id = decodeURIComponent(redditRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = deleteRedditAcquireRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.reddit_deleted',
      entityType: 'acquire',
      entityId: id,
      summary: `Reddit acquire run deleted: ${id}`,
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (pathname === '/api/acquire/youtube-topics' && method === 'GET') {
    const scope = requestProjectScope(req);
    const result = await listYoutubeTopics(scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const topics = (Array.isArray(result.data) ? result.data : []).map(rowToYoutubeTopic);
    return sendOk(res, 200, topics, { topics }, { total: topics.length }), true;
  }

  if (pathname === '/api/acquire/youtube-topics' && method === 'POST') {
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const topic = String(body?.topic || '').trim();
    if (!topic) {
      return sendErr(res, 400, 'topic is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await createYoutubeTopic({ topic }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 201, rowToYoutubeTopic(created), { topic: rowToYoutubeTopic(created) }), true;
  }

  const youtubeTopicIdMatch = pathname.match(/^\/api\/acquire\/youtube-topics\/(\d+)\/?$/);
  if (youtubeTopicIdMatch && method === 'GET') {
    const topicId = Number(youtubeTopicIdMatch[1]);
    const scope = requestProjectScope(req);
    const result = await getYoutubeTopicById(topicId, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return sendErr(res, 404, 'Topic not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToYoutubeTopic(row), { topic: rowToYoutubeTopic(row) }), true;
  }

  if (youtubeTopicIdMatch && method === 'PATCH') {
    const topicId = Number(youtubeTopicIdMatch[1]);
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const topic = String(body?.topic || '').trim();
    if (!topic) {
      return sendErr(res, 400, 'topic is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateYoutubeTopic(topicId, { topic }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Topic not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToYoutubeTopic(updated), { topic: rowToYoutubeTopic(updated) }), true;
  }

  if (youtubeTopicIdMatch && method === 'DELETE') {
    const topicId = Number(youtubeTopicIdMatch[1]);
    const scope = requestProjectScope(req);
    const result = await deleteYoutubeTopic(topicId, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!deleted) return sendErr(res, 404, 'Topic not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToYoutubeTopic(deleted), { topic: rowToYoutubeTopic(deleted) }), true;
  }

  // POST /api/acquire/youtube-comments — ⚡ RATE LIMITED (hits YouTube Data API)
  if (pathname === '/api/acquire/youtube-comments' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;

    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const videoUrl = String(body?.video_url || '').trim();
    if (!videoUrl) {
      return sendErr(res, 400, 'video_url is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const input = {
      video_url:       videoUrl,
      max_comments:    Number(body?.max_comments || 200) || 200,
      include_replies: body?.include_replies === true,
      sort_by:         String(body?.sort_by || 'relevance'),
    };

    try {
      const result = await runYoutubeCommentAcquire(input);

      // Persist to the acquire YouTube comments table
      const saveRes = await createCommentRun(input, result, scope);
      const run_id = saveRes.data?.run_id || null;

      logActivity({
        action: 'acquire.youtube_comments',
        entityType: 'acquire',
        entityId: run_id,
        summary: `YouTube comments acquired: ${result?.video_url || videoUrl}`,
        meta: { run_id, total_comments: Number(result?.stats?.total_comments || 0) || 0 }
      });
      return sendOk(res, 200, { result, run_id }, { result, run_id }), true;
    } catch (err) {
      return sendErr(res, err.status || 500, err.message || 'YouTube comments acquire failed'), true;
    }
  }

  // POST /api/acquire/youtube-comments/miner — ⚡ RATE LIMITED (batch comments + filtering/tagging)
  if (pathname === '/api/acquire/youtube-comments/miner' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;

    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const input = {
      targets: body?.targets || body?.targets_text || '',
      videos_per_channel: Number(body?.videos_per_channel || 5) || 5,
      max_comments_per_video: Number(body?.max_comments_per_video || 100) || 100,
      include_replies: body?.include_replies === true,
      sort_by: String(body?.sort_by || 'relevance'),
      min_score: Number(body?.min_score || 3) || 3,
      exclude_noise: body?.exclude_noise !== false,
      include_phrases_text: safeText(body?.include_phrases_text),
      exclude_phrases_text: safeText(body?.exclude_phrases_text),
      category_config: Array.isArray(body?.category_config) ? body.category_config : [],
      attribute_config: Array.isArray(body?.attribute_config) ? body.attribute_config : [],
      approach_config: Array.isArray(body?.approach_config) ? body.approach_config : [],
      response_context: safeText(body?.response_context),
      response_guidelines: safeText(body?.response_guidelines),
      training_feedback: Array.isArray(body?.training_feedback) ? body.training_feedback : [],
    };

    const mined = await runYoutubeCommentMiner(input);
    if (!mined.ok) {
      return sendErr(res, mined.status || 500, mined.error || 'YouTube comment miner failed', {
        details: Array.isArray(mined?.data?.warnings) ? mined.data.warnings : [],
      }), true;
    }

    const saveRes = await createMinerRun(input, mined.data || {}, scope);
    const runId = saveRes?.ok ? safeText(saveRes?.data?.run_id) : '';

    logActivity({
      action: 'acquire.youtube_comment_miner',
      entityType: 'acquire',
      entityId: runId || null,
      summary: `YouTube Comment Miner processed ${Number(mined?.data?.stats?.acquired_videos || 0) || 0} videos`,
      meta: {
        run_id: runId || null,
        resolved_videos: Number(mined?.data?.stats?.resolved_videos || 0) || 0,
        acquired_videos: Number(mined?.data?.stats?.acquired_videos || 0) || 0,
        total_comments_raw: Number(mined?.data?.stats?.total_comments_raw || 0) || 0,
        total_comments_filtered: Number(mined?.data?.stats?.total_comments_filtered || 0) || 0,
      },
    });

    return sendOk(res, 200, { run_id: runId, result: mined.data }, { run_id: runId, result: mined.data }), true;
  }

  // POST /api/acquire/youtube-comments/assign (Assign individual comments to a campaign)
  if (pathname === '/api/acquire/youtube-comments/assign' && method === 'POST') {
    const body = await parseJsonBody(req);
    const commentsToAssign = Array.isArray(body.comments) ? body.comments : [];
    const campaignId = safeText(body.campaignId);
    
    if (!commentsToAssign.length) {
      return sendErr(res, 400, 'comments array is required'), true;
    }
    
    const { assignCommentsToCampaign } = require('../lib/acquire/YoutubeCommentsStore');
    const assignRes = await assignCommentsToCampaign(commentsToAssign, campaignId);
    if (!assignRes.ok) {
      return sendErr(res, assignRes.status || 500, assignRes.error || 'Failed to assign comments to campaign'), true;
    }
    
    logActivity({
      action: 'acquire.youtube_comments_assigned',
      entityType: 'campaign',
      entityId: campaignId || null,
      summary: `Assigned ${commentsToAssign.length} YouTube comments to campaign`,
    });
    
    return sendOk(res, 200, { assigned: commentsToAssign.length }, { assigned: commentsToAssign.length }), true;
  }

  // POST /api/acquire/youtube-reply-offers — generate 3 tailored reply offers for one comment
  if (pathname === '/api/acquire/youtube-reply-offers' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;
    const body = await parseJsonBody(req);
    const input = {
      comment: safeText(body?.comment),
      video_title: safeText(body?.video_title),
      video_id: safeText(body?.video_id),
      categories: toArray(body?.categories),
      attributes: toArray(body?.attributes),
      approaches: toArray(body?.approaches),
      training_notes: safeText(body?.training_notes),
      response_context: safeText(body?.response_context),
      response_guidelines: safeText(body?.response_guidelines),
      discouraged_phrases: toArray(body?.discouraged_phrases),
      used_replies: toArray(body?.used_replies),
    };
    if (!input.comment) {
      return sendErr(res, 400, 'comment is required'), true;
    }
    const ai = await callOpenClawYoutubeReplyOffers(input);
    if (!ai.ok) {
      return sendErr(res, ai.status || 502, ai.error || 'Could not generate reply offers', {
        details: ai?.data || null,
      }), true;
    }
    return sendOk(res, 200, ai.data, ai.data), true;
  }

  // POST /api/acquire/youtube-research — build candidate YouTube targets from messaging + phrases
  if (pathname === '/api/acquire/youtube-research' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;

    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const apiKey = resolveYoutubeApiKey();
    if (!apiKey) {
      return sendErr(res, 400, 'YouTube API key is not configured. Go to Settings > APIs > YouTube and add your key.'), true;
    }

    const rawManualPhrases = splitPhraseList(body?.manual_phrases_text || body?.manual_phrases || '');
    const includeMessaging = body?.include_messaging !== false;
    const messagingCategory = safeText(body?.messaging_category || '').toLowerCase();
    const messagingHashtag = safeText(body?.messaging_hashtag || '').toLowerCase();
    const maxPhrases = Math.max(1, Math.min(Number(body?.max_phrases || 25) || 25, 120));
    let videosPerPhrase = Math.max(1, Math.min(Number(body?.videos_per_phrase || 3) || 3, 50));
    const distilledTargetLimit = Math.max(1, Math.min(Number(body?.distilled_target_limit || 30) || 30, 200));

    let messagingPhrases = [];
    const phraseSources = [];
    if (includeMessaging) {
      const tables = tableConfig();
      const sourceDefs = [
        { table: tables.messagingHashtags, label: 'hashtags' },
        { table: tables.messagingTweets, label: 'tweets' },
        { table: tables.messagingPosts, label: 'posts' },
        { table: tables.messagingArticles, label: 'articles' },
      ];
      for (const source of sourceDefs) {
        let rows = await fetchMessagingRows(source.table, 150);
        if (messagingCategory) {
          rows = rows.filter((row) => safeText(row?.category || '').toLowerCase() === messagingCategory);
        }
        if (messagingHashtag) {
          rows = rows.filter((row) => extractTagCandidatesFromRow(row).includes(messagingHashtag));
        }
        const sourcePhrases = dedupePhrases(rows.flatMap(extractPhraseCandidatesFromRow), 50);
        if (sourcePhrases.length) {
          messagingPhrases.push(...sourcePhrases);
          phraseSources.push({ source: source.label, count: sourcePhrases.length });
        }
      }
    }

    const phrases = dedupePhrases([
      ...rawManualPhrases,
      ...messagingPhrases,
    ], maxPhrases);
    if (!phrases.length) {
      return sendErr(res, 400, 'No research phrases available. Add manual phrases or enable messaging sources.'), true;
    }

    if (phrases.length > 0) {
      const neededPerPhrase = Math.ceil(distilledTargetLimit / phrases.length) * 2;
      if (neededPerPhrase > videosPerPhrase) {
        videosPerPhrase = Math.min(neededPerPhrase, 50);
      }
    }

    const discovered = [];
    const warnings = [];
    for (const phrase of phrases) {
      try {
        const hits = await searchYoutubeVideosByPhrase(phrase, apiKey, videosPerPhrase);
        hits.forEach((hit) => {
          discovered.push({
            phrase,
            ...hit,
          });
        });
      } catch (err) {
        warnings.push(`Phrase "${phrase}": ${safeText(err?.message) || 'search failed'}`);
      }
    }

    const banProfiles = await listYoutubeBanProfiles(1000, scope);
    const filteredDiscovered = discovered.filter((hit) => !isResearchCandidateExcluded(hit, banProfiles));

    const dedupedVideos = [];
    const seenVideoIds = new Set();
    for (const hit of filteredDiscovered) {
      const videoId = safeText(hit.video_id);
      if (!videoId || seenVideoIds.has(videoId)) continue;
      seenVideoIds.add(videoId);
      dedupedVideos.push(hit);
      if (dedupedVideos.length >= distilledTargetLimit) break;
    }

    if (!dedupedVideos.length) {
      if (discovered.length === 0 && warnings.length === 0) {
        warnings.push(`Search completed but YouTube returned 0 videos for: ${phrases.join(', ')}`);
      } else if (discovered.length > 0) {
        warnings.push(`YouTube returned ${discovered.length} videos, but all were excluded by your active Ban set.`);
      }
      return sendErr(res, 400, 'No YouTube targets discovered from research phrases.', { details: warnings }), true;
    }

    const researchInput = {
      phrase_count: phrases.length,
      discovered_target_count: discovered.length,
      excluded_target_count: Math.max(0, discovered.length - filteredDiscovered.length),
      distilled_target_count: dedupedVideos.length,
      phrases,
      discovered_targets: discovered.map((item) => item.video_url).filter(Boolean),
      distilled_targets: dedupedVideos.map((item) => item.video_url).filter(Boolean),
      distilled_target_items: dedupedVideos.map((item) => ({
        video_url: safeText(item?.video_url),
        video_id: safeText(item?.video_id),
        title: firstNonEmpty(item?.title, item?.video_title),
        channel_name: safeText(item?.channel_name),
        channel_url: safeText(item?.channel_url),
        description: safeText(item?.description),
        thumbnail_url: safeText(item?.thumbnail_url),
      })).filter((item) => item.video_url),
      raw_input: {
        include_messaging: includeMessaging,
        manual_phrases_text: String(body?.manual_phrases_text || body?.manual_phrases || '').trim(),
        max_phrases: maxPhrases,
        videos_per_phrase: videosPerPhrase,
        distilled_target_limit: distilledTargetLimit,
        include_transcript: body?.include_transcript === true,
        messaging_category: messagingCategory,
        messaging_hashtag: messagingHashtag,
      },
    };
    const resultPayload = {
      research: {
        run_id: '',
        phrase_sources: phraseSources,
        phrases,
        discovered_count: discovered.length,
        excluded_count: Math.max(0, discovered.length - filteredDiscovered.length),
        distilled_count: dedupedVideos.length,
        discovered: filteredDiscovered.slice(0, 500),
        distilled_targets: dedupedVideos.map((item) => item.video_url).filter(Boolean),
        distilled_target_items: dedupedVideos.map((item) => ({
          video_url: safeText(item?.video_url),
          video_id: safeText(item?.video_id),
          title: firstNonEmpty(item?.title, item?.video_title),
          channel_name: safeText(item?.channel_name),
          channel_url: safeText(item?.channel_url),
          description: safeText(item?.description),
          thumbnail_url: safeText(item?.thumbnail_url),
          phrase: safeText(item?.phrase),
          published_at: safeText(item?.published_at),
          view_count: Number(item?.view_count || 0) || 0,
          like_count: Number(item?.like_count || 0) || 0,
          comment_count: Number(item?.comment_count || 0) || 0,
        })).filter((item) => item.video_url),
      },
      stats: {
        phrase_count: phrases.length,
        discovered_target_count: discovered.length,
        excluded_target_count: Math.max(0, discovered.length - filteredDiscovered.length),
        distilled_target_count: dedupedVideos.length,
      },
      warnings: warnings.slice(0, 300),
    };
    const saveRes = await createResearchRun(researchInput, resultPayload, scope);
    const runId = saveRes?.ok ? safeText(saveRes?.data?.run_id) : '';
    resultPayload.research.run_id = runId;

    logActivity({
      action: 'acquire.youtube_research',
      entityType: 'acquire',
      entityId: runId || null,
      summary: `YouTube Research: ${phrases.length} phrases, ${dedupedVideos.length} distilled targets`,
      meta: {
        run_id: runId || null,
        phrase_count: phrases.length,
        discovered_target_count: discovered.length,
        excluded_target_count: Math.max(0, discovered.length - filteredDiscovered.length),
        distilled_target_count: dedupedVideos.length,
      },
    });

    return sendOk(res, 200, { run_id: runId, result: resultPayload }, { run_id: runId, result: resultPayload }), true;
  }

  // GET /api/acquire/youtube-research-runs
  if (pathname === '/api/acquire/youtube-research-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 20);
    const scope = requestProjectScope(req);
    const result = await listResearchRuns(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data || [], { runs: result.data || [] }, { total: Array.isArray(result.data) ? result.data.length : 0 }), true;
  }

  // GET /api/acquire/youtube-research-runs/:id
  const youtubeResearchRunMatch = pathname.match(/^\/api\/acquire\/youtube-research-runs\/([^/]+)$/);
  if (youtubeResearchRunMatch && method === 'GET') {
    const id = decodeURIComponent(youtubeResearchRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = await getResearchRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const run = result.data || {};
    const research = run?.result?.research || {};
    const candidateItems = Array.isArray(research?.distilled_target_items) ? research.distilled_target_items : [];
    const needsHydration = candidateItems.some((item) => {
      return safeText(item?.video_id)
        && !safeText(item?.view_count)
        && !safeText(item?.like_count)
        && !safeText(item?.comment_count);
    });
    if (needsHydration) {
      const apiKey = resolveYoutubeApiKey();
      const hydratedItems = await hydrateYoutubeVideoStats(candidateItems, apiKey);
      if (run.result && run.result.research) {
        run.result.research.distilled_target_items = hydratedItems;
      }
    }
    return sendOk(res, 200, run, { run }), true;
  }

  // DELETE /api/acquire/youtube-research-runs/:id
  if (youtubeResearchRunMatch && method === 'DELETE') {
    const id = decodeURIComponent(youtubeResearchRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = await deleteResearchRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.youtube_research_deleted',
      entityType: 'acquire',
      entityId: id,
      summary: `YouTube research run deleted: ${id}`
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // GET /api/acquire/youtube-miner-runs
  if (pathname === '/api/acquire/youtube-miner-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 30);
    const scope = requestProjectScope(req);
    const result = await listMinerRuns(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data || [], { runs: result.data || [] }, { total: Array.isArray(result.data) ? result.data.length : 0 }), true;
  }

  // GET /api/acquire/youtube-miner-runs/:id
  const youtubeMinerRunMatch = pathname.match(/^\/api\/acquire\/youtube-miner-runs\/([^/]+)$/);
  if (youtubeMinerRunMatch && method === 'GET') {
    const id = decodeURIComponent(youtubeMinerRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = await getMinerRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // GET /api/acquire/youtube-target-history
  if (pathname === '/api/acquire/youtube-target-history' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 400);
    const scope = requestProjectScope(req);
    const result = await listTargetHistory(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data || [], { targets: result.data || [] }, { total: Array.isArray(result.data) ? result.data.length : 0 }), true;
  }

  // POST /api/acquire/youtube-comment — ⚡ RATE LIMITED (writes to YouTube)
  if (pathname === '/api/acquire/youtube-comment' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;

    const body = await parseJsonBody(req);
    const videoUrl = String(body?.video_url || '').trim();
    const commentText = String(body?.comment_text || '').trim();
    if (!videoUrl) {
      return sendErr(res, 400, 'video_url is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if (!commentText) {
      return sendErr(res, 400, 'comment_text is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const postRes = await postYoutubeComment({ video_url: videoUrl, comment_text: commentText });
    if (!postRes.ok) return sendErr(res, postRes.status || 500, postRes.error), true;

    logActivity({
      action: 'acquire.youtube_comment_posted',
      entityType: 'acquire',
      entityId: postRes.data?.comment_id || postRes.data?.thread_id || null,
      summary: `YouTube comment posted: ${postRes.data?.video_url || videoUrl}`,
      meta: {
        video_id: postRes.data?.video_id || '',
        comment_id: postRes.data?.comment_id || '',
        thread_id: postRes.data?.thread_id || ''
      }
    });
    return sendOk(res, 201, postRes.data, { comment: postRes.data }), true;
  }

  // POST /api/acquire/youtube-comment-suggestions — ⚡ RATE LIMITED (LLM)
  if (pathname === '/api/acquire/youtube-comment-suggestions' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;

    const body = await parseJsonBody(req);
    const input = buildYoutubeCommentSuggestionInput({
      video_url: body?.video_url,
      title: body?.title,
      channel_name: body?.channel_name,
      description: body?.description,
      transcript: body?.transcript,
    });
    const genRes = await generateYoutubeCommentSuggestions(input, projectScope);
    if (!genRes.ok) return sendErr(res, genRes.status || 500, genRes.error), true;

    const comments = Array.isArray(genRes.data) ? genRes.data : [];
    return sendOk(res, 200, comments, { comments }, { total: comments.length }), true;
  }

  // GET /api/acquire/youtube-comment-runs — list persisted comment runs
  if (pathname === '/api/acquire/youtube-comment-runs' && method === 'GET') {
    const limit  = Number(urlObj.searchParams.get('limit') || 20);
    const scope = requestProjectScope(req);
    const result = await listCommentRuns(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = result.data || [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/youtube-videos — canonical video repository
  if (pathname === '/api/acquire/youtube-videos' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 200);
    const scope = requestProjectScope(req);
    const result = await listYoutubeVideos(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const videos = result.data || [];
    return sendOk(res, 200, videos, { videos }, { total: videos.length }), true;
  }

  // POST /api/acquire/youtube-videos/backfill-details
  if (pathname === '/api/acquire/youtube-videos/backfill-details' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube')) return true;

    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const limit = Math.max(1, Math.min(Number(body?.limit || 25) || 25, 200));
    const delayMs = Math.max(0, Math.min(Number(body?.delay_ms || 0) || 0, 5000));
    const force = body?.force === true;
    const requestedUrls = uniqueYoutubeUrls(body?.video_urls);
    const bodyItems = Array.isArray(body?.items) ? body.items : [];
    const itemsByUrl = new Map();
    bodyItems.forEach(item => {
      if (item && item.video_url) {
        itemsByUrl.set(safeText(item.video_url), item);
      }
    });

    let targets = requestedUrls;
    if (!targets.length) {
      const videosRes = await listYoutubeVideos(1000, scope);
      if (!videosRes.ok) return sendErr(res, videosRes.status || 500, videosRes.error), true;
      targets = toArray(videosRes.data)
        .filter((video) => safeText(video.video_url))
        .filter((video) => force || !hasYoutubeVideoDetails(video))
        .map((video) => safeText(video.video_url))
        .slice(0, limit);
    } else {
      targets = targets.slice(0, limit);
    }

    if (!targets.length) {
      return sendOk(res, 200, {
        ok: true,
        requested: 0,
        processed: 0,
        created_runs: 0,
        skipped: 0,
        failed: 0,
        items: [],
      }, {
        backfill: {
          requested: 0,
          processed: 0,
          created_runs: 0,
          skipped: 0,
          failed: 0,
          items: [],
        },
      }), true;
    }

    const existingVideosRes = await listYoutubeVideos(1000, scope);
    const existingVideos = existingVideosRes.ok ? toArray(existingVideosRes.data) : [];
    const byUrl = new Map(existingVideos.map((video) => [safeText(video.video_url), video]));
    const items = [];

    for (const videoUrl of targets) {
      const existing = byUrl.get(videoUrl) || null;
      if (!force && hasYoutubeVideoDetails(existing)) {
        items.push({
          video_url: videoUrl,
          status: 'skipped',
          reason: 'already_has_details',
          title: safeText(existing?.title),
          channel_name: safeText(existing?.channel_name),
          detail_run_id: safeText(existing?.detail_run_id),
        });
        continue;
      }

      try {
        const providedMetadata = itemsByUrl.get(videoUrl) || {};
        const acquireInput = {
          video_url: videoUrl,
          title: safeText(providedMetadata.title || existing?.title),
          channel_name: safeText(providedMetadata.channel_name || existing?.channel_name),
          category: safeText(existing?.category),
          tags: safeText(existing?.tags),
        };
        const result = await runYoutubeAcquire(acquireInput);
        const createRes = await createYoutubeAcquireRun(acquireInput, result, scope);
        if (!createRes.ok) {
          items.push({
            video_url: videoUrl,
            status: 'failed',
            error: safeText(createRes.error) || 'Failed to save acquired details',
          });
        } else {
          const summary = runSummary(createRes.data);
          items.push({
            video_url: videoUrl,
            status: 'updated',
            run_id: safeText(summary.run_id),
            title: safeText(summary.title),
            channel_name: safeText(summary.channel_name),
            transcript_status: safeText(summary.transcript_status),
          });
        }
      } catch (err) {
        items.push({
          video_url: videoUrl,
          status: 'failed',
          error: safeText(err?.message) || 'YouTube detail acquire failed',
        });
      }

      if (delayMs > 0) await waitFor(delayMs);
    }

    const payload = {
      requested: targets.length,
      processed: items.filter((item) => item.status !== 'skipped').length,
      created_runs: items.filter((item) => item.status === 'updated').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
      items,
    };

    logActivity({
      action: 'acquire.youtube_backfill_details',
      entityType: 'acquire',
      entityId: null,
      summary: `YouTube details backfill processed ${payload.requested} video(s)`,
      meta: {
        requested: payload.requested,
        created_runs: payload.created_runs,
        skipped: payload.skipped,
        failed: payload.failed,
        force,
      },
    });

    return sendOk(res, 200, payload, { backfill: payload }), true;
  }

  // POST /api/acquire/youtube-videos/diagnostics
  if (pathname === '/api/acquire/youtube-videos/diagnostics' && method === 'POST') {
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const targets = uniqueYoutubeUrls(body?.video_urls).slice(0, 25);
    const includeAcquirePreview = body?.include_acquire_preview === true;
    if (!targets.length) {
      return sendErr(res, 400, 'video_urls is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const diagnostics = [];
    for (const videoUrl of targets) {
      const item = await listYoutubeDiagnosticsForUrl(videoUrl, scope);
      if (includeAcquirePreview) {
        item.acquire_preview = await previewYoutubeAcquireDiagnostics(videoUrl);
      }
      diagnostics.push(item);
    }

    return sendOk(res, 200, diagnostics, { diagnostics }, { total: diagnostics.length }), true;
  }

  // GET /api/acquire/youtube-videos/:id
  const youtubeVideoMatch = pathname.match(/^\/api\/acquire\/youtube-videos\/([^/]+)$/);
  if (youtubeVideoMatch && method === 'GET') {
    const id = decodeURIComponent(youtubeVideoMatch[1]);
    const scope = requestProjectScope(req);
    const result = await getYoutubeVideo(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { video: result.data }), true;
  }

  // PATCH /api/acquire/youtube-videos/:id
  if (youtubeVideoMatch && method === 'PATCH') {
    const id = decodeURIComponent(youtubeVideoMatch[1]);
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const patch = {};
    if (body?.category != null) patch.topic = safeText(body.category);
    if (body?.topic != null) patch.topic = safeText(body.topic);
    if (body?.tags != null) patch.tags = safeText(body.tags);
    if (body?.title != null) patch.title = safeText(body.title);
    if (!Object.keys(patch).length) {
      return sendErr(res, 400, 'No fields to update', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateYoutubeVideo(id, patch, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;

    // Keep the detail run in sync for flows that still read from the original acquire table.
    if (safeText(result.data?.detail_run_id)) {
      await updateYoutubeAcquireRun(result.data.detail_run_id, patch, scope).catch(() => null);
    }

    return sendOk(res, 200, result.data, { video: result.data }), true;
  }

  // DELETE /api/acquire/youtube-videos/:id
  if (youtubeVideoMatch && method === 'DELETE') {
    const id = decodeURIComponent(youtubeVideoMatch[1]);
    const scope = requestProjectScope(req);
    const result = await deleteYoutubeVideo(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { video: result.data }), true;
  }

  // GET /api/acquire/youtube-comment-runs/:id
  const commentRunMatch = pathname.match(/^\/api\/acquire\/youtube-comment-runs\/([^/]+)$/);
  if (commentRunMatch && method === 'GET') {
    const id     = decodeURIComponent(commentRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = await getCommentRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // DELETE /api/acquire/youtube-comment-runs/:id
  if (commentRunMatch && method === 'DELETE') {
    const id     = decodeURIComponent(commentRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = await deleteCommentRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.youtube_comments_deleted', entityType: 'acquire', entityId: id,
      summary: `YouTube comment run deleted: ${id}`
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // GET /api/acquire/youtube-runs — read-only
  if (pathname === '/api/acquire/youtube-runs' && method === 'GET') {
    const limit  = Number(urlObj.searchParams.get('limit') || 20);
    const scope = requestProjectScope(req);
    const result = await listYoutubeAcquireRuns(limit, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = result.data || [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // POST /api/acquire/youtube-runs/:id/rerun — ⚡ RATE LIMITED
  const youtubeRerunMatch = pathname.match(/^\/api\/acquire\/youtube-runs\/([^/]+)\/rerun$/);
  if (youtubeRerunMatch && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube.rerun')) return true;

    await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const priorRes = await getYoutubeAcquireRun(decodeURIComponent(youtubeRerunMatch[1]), scope);
    if (!priorRes.ok) return sendErr(res, priorRes.status || 500, priorRes.error), true;
    const prior     = priorRes.data;
    const rerunInput = { video_url: prior.video_url, category: String(prior.category || '').trim() };
    const result    = await runYoutubeAcquire(rerunInput);
    const createRes = await createYoutubeAcquireRun(rerunInput, result, scope);
    if (!createRes.ok) return sendErr(res, createRes.status || 500, createRes.error), true;
    const summary = runSummary(createRes.data);
    logActivity({
      action: 'acquire.youtube_rerun', entityType: 'acquire', entityId: summary.run_id,
      summary: `YouTube re-acquired: ${summary.title || prior.video_url || 'unknown'}`,
      meta: { rerun_of: prior.run_id, video_url: prior.video_url }
    });
    const payload = { result, run: summary, rerun_of: prior.run_id };
    return sendOk(res, 200, payload, payload), true;
  }

  // GET /api/acquire/youtube-runs/:id — read-only
  const youtubeRunMatch = pathname.match(/^\/api\/acquire\/youtube-runs\/([^/]+)$/);
  if (youtubeRunMatch && method === 'GET') {
    const scope = requestProjectScope(req);
    const result = await getYoutubeAcquireRun(decodeURIComponent(youtubeRunMatch[1]), scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  if (youtubeRunMatch && method === 'PATCH') {
    const id = decodeURIComponent(youtubeRunMatch[1]);
    const scope = requestProjectScope(req);
    const existingRes = await getYoutubeAcquireRun(id, scope);
    if (!existingRes.ok) return sendErr(res, existingRes.status || 500, existingRes.error), true;

    const body = await parseJsonBody(req);
    const patch = {};
    if (body?.category != null) patch.topic = String(body.category || '').trim();
    if (body?.topic != null) patch.topic = String(body.topic || '').trim();
    if (body?.tags != null) patch.tags = String(body.tags || '').trim();
    if (body?.title != null) patch.title = String(body.title || '').trim();
    if (!Object.keys(patch).length) {
      return sendErr(res, 400, 'No fields to update', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateYoutubeAcquireRun(id, patch, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: runSummary(result.data) }), true;
  }

  // DELETE /api/acquire/youtube-runs/:id
  if (youtubeRunMatch && method === 'DELETE') {
    const id     = decodeURIComponent(youtubeRunMatch[1]);
    const scope = requestProjectScope(req);
    const result = await deleteYoutubeAcquireRun(id, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.youtube_deleted', entityType: 'acquire', entityId: id,
      summary: `YouTube acquire run deleted: ${id}`
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // POST /api/acquire/youtube-runs/:id/add-contact
  const youtubeAddContactMatch = pathname.match(/^\/api\/acquire\/youtube-runs\/([^/]+)\/add-contact$/);
  if (youtubeAddContactMatch && method === 'POST') {
    const runId = decodeURIComponent(youtubeAddContactMatch[1]);
    const scope = requestProjectScope(req);
    const runRes = await getYoutubeAcquireRun(runId, scope);
    if (!runRes.ok) return sendErr(res, runRes.status || 500, runRes.error), true;

    const captureRes = await captureYoutubeContact(runRes.data?.result || {}, runRes.data?.video_url || '');
    if (!captureRes.ok) {
      return sendErr(res, captureRes.status || 500, captureRes.error || 'Contact capture failed'), true;
    }

    const run = runRes.data || {};
    const nextRequest = { ...(run.request_json || {}), capture_contact: true };
    const nextResult = { ...(run.result_json || {}), contact_captured: true };
    await updateYoutubeAcquireRun(runId, {
      request_json: nextRequest,
      result_json: nextResult,
    }, scope);

    if (captureRes.data?.contact?.id) {
      logActivity({
        action: 'contact.captured_youtube',
        entityType: 'contact',
        entityId: captureRes.data.contact.id,
        summary: `YouTube contact ${captureRes.data.mode}: ${captureRes.data.contact.company || captureRes.data.contact.email || captureRes.data.contact.id}`,
        meta: { run_id: runId, mode: captureRes.data.mode }
      });
    }

    const payload = { run_id: runId, contactCapture: captureRes.data };
    return sendOk(res, 200, payload, payload), true;
  }

  const youtubeRefreshTranscriptMatch = pathname.match(/^\/api\/acquire\/youtube-runs\/([^/]+)\/refresh-transcript\/?$/);
  if (youtubeRefreshTranscriptMatch && method === 'POST') {
    if (checkEndpointLimit(req, res, 'acquire.youtube.rerun')) return true;

    await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const id = decodeURIComponent(youtubeRefreshTranscriptMatch[1]);
    const existingRes = await getYoutubeAcquireRun(id, scope);
    if (!existingRes.ok) return sendErr(res, existingRes.status || 500, existingRes.error), true;
    const existing = existingRes.data;

    const result = await runYoutubeAcquire({
      video_url: existing.video_url,
      category: String(existing.category || '').trim(),
    });

    const owner = result?.channel_owner || {};
    const video = result?.video || {};
    const patch = {
      video_url: String(existing.video_url || video.url || '').trim(),
      video_id: String(video.id || existing.video_id || '').trim(),
      title: String(video.title || '').trim(),
      channel_name: String(owner.name || '').trim(),
      transcript_status: String(video.transcript_status || 'unavailable'),
      transcript_source: String(video.transcript_source || 'none'),
      transcript_provider: String(video.transcript_provider || 'youtube-native'),
      result_json: {
        ...result,
        contact_captured: existing.contact_captured === true || existing?.result_json?.contact_captured === true,
      },
    };

    const updateRes = await updateYoutubeAcquireRun(id, patch, scope);
    if (!updateRes.ok) return sendErr(res, updateRes.status || 500, updateRes.error), true;
    return sendOk(res, 200, updateRes.data, { run: runSummary(updateRes.data) }), true;
  }

  return false;
}

const manifest = {
  id:       'acquire',
  label:    'Acquire',
  prefixes: ['/api/acquire']
};

module.exports = { handle, manifest };
