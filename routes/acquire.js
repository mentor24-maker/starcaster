
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
const { runYoutubeHarvest } = require('../lib/harvest/YoutubeDetailsRun');
const { runXHarvest } = require('../lib/harvest/XHarvestRun');
const { runRedditHarvest } = require('../lib/harvest/RedditHarvestRun');
const {
  createXHarvestRun,
  listXHarvestRuns,
  getXHarvestRun,
  deleteXHarvestRun,
} = require('../lib/harvest/XHarvestStore');
const {
  createRedditHarvestRun,
  listRedditHarvestRuns,
  getRedditHarvestRun,
  deleteRedditHarvestRun,
} = require('../lib/harvest/RedditHarvestStore');
const { runYoutubeCommentHarvest } = require('../lib/harvest/YoutubeCommentsRun');
const { runYoutubeCommentMiner } = require('../lib/harvest/YoutubeCommentMiner');
const { resolveYoutubeApiKey } = require('../lib/harvest/youtubeApiKey');
const { postYoutubeComment } = require('../lib/harvest/YoutubeCommentPost');
const { generateYoutubeCommentSuggestions } = require('../lib/harvest/YoutubeCommentSuggestions');
const {
  createYoutubeHarvestRun,
  listYoutubeHarvestRuns,
  getYoutubeHarvestRun,
  updateYoutubeHarvestRun,
  deleteYoutubeHarvestRun,
  runSummary
} = require('../lib/harvest/YoutubeDetailsStore');
const { captureYoutubeContact } = require('../lib/harvest/YoutubeContactCapture');
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
} = require('../lib/harvest/YoutubeCommentsStore');
const {
  listYoutubeVideos,
  getYoutubeVideo,
  updateYoutubeVideo,
} = require('../lib/harvest/YoutubeVideosStore');
const { sbQuery, tableConfig } = require('../lib/supabase');
const {
  listYoutubeCategories,
  createYoutubeCategory,
  getYoutubeCategoryById,
  updateYoutubeCategory,
  deleteYoutubeCategory,
  rowToYoutubeCategory,
} = require('../lib/harvest/YoutubeCategoriesStore');
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

async function listYoutubeDiagnosticsForUrl(videoUrl) {
  const normalizedUrl = safeText(videoUrl);
  const videoId = extractYoutubeVideoId(normalizedUrl);
  const cfg = tableConfig();
  const [videosRes, detailsByUrlRes, detailsByIdRes, commentsByUrlRes, commentsByIdRes] = await Promise.all([
    listYoutubeVideos(1000),
    normalizedUrl ? sbQuery({
      method: 'GET',
      table: cfg.harvestYoutubeDetails,
      query: `video_url=eq.${encodeURIComponent(normalizedUrl)}&select=run_id,video_url,video_id,title,channel_name,category,tags,transcript_status,created_at,updated_at&order=created_at.desc&limit=10`,
    }) : Promise.resolve({ ok: true, data: [] }),
    videoId ? sbQuery({
      method: 'GET',
      table: cfg.harvestYoutubeDetails,
      query: `video_id=eq.${encodeURIComponent(videoId)}&select=run_id,video_url,video_id,title,channel_name,category,tags,transcript_status,created_at,updated_at&order=created_at.desc&limit=10`,
    }) : Promise.resolve({ ok: true, data: [] }),
    normalizedUrl ? sbQuery({
      method: 'GET',
      table: cfg.harvestYoutubeComments,
      query: `video_url=eq.${encodeURIComponent(normalizedUrl)}&select=run_id,video_url,video_id,title,channel_name,comment_count,created_at,updated_at&order=created_at.desc&limit=10`,
    }) : Promise.resolve({ ok: true, data: [] }),
    videoId ? sbQuery({
      method: 'GET',
      table: cfg.harvestYoutubeComments,
      query: `video_id=eq.${encodeURIComponent(videoId)}&select=run_id,video_url,video_id,title,channel_name,comment_count,created_at,updated_at&order=created_at.desc&limit=10`,
    }) : Promise.resolve({ ok: true, data: [] }),
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
  url.searchParams.set('maxResults', String(Math.max(1, Math.min(Number(perPhrase) || 4, 10))));
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
  return items.map((item) => ({
    video_id: safeText(item?.id?.videoId),
    video_url: safeText(item?.id?.videoId) ? `https://www.youtube.com/watch?v=${safeText(item?.id?.videoId)}` : '',
    title: safeText(item?.snippet?.title),
    channel_name: safeText(item?.snippet?.channelTitle),
    published_at: safeText(item?.snippet?.publishedAt),
  })).filter((item) => item.video_id && item.video_url);
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
    'You are harvesting Reddit data for analytics.',
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
    'If content is not harvest data, return empty arrays and set errors with a short explanation.',
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

function findHarvestShape(node, depth = 0) {
  if (!node || depth > 12) return null;
  if (typeof node === 'string') {
    const parsedFromMixed = extractJsonFromText(node);
    if (parsedFromMixed) {
      return findHarvestShape(parsedFromMixed, depth + 1);
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findHarvestShape(item, depth + 1);
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
      const foundParsed = findHarvestShape(parsed, depth + 1);
      if (foundParsed) return foundParsed;
    }
    const found = findHarvestShape(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeOpenClawHarvestResult(rawPayload, inputPayload, trace = {}) {
  const shaped = findHarvestShape(rawPayload) || {};
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

async function runRedditHarvestViaOpenClaw(inputPayload) {
  const responseCall = await callOpenClawResponses(inputPayload);
  if (!responseCall.ok) {
    try {
      const backup = await runRedditHarvest({
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
  const normalized = normalizeOpenClawHarvestResult(rawPayload, inputPayload, {
    jobId: safeText(responseCall.data?.id),
    steps: [{ action: 'responses', ok: true, status: Number(responseCall.status || 0) || 200 }],
  });

  if (!normalized.posts.length && !normalized.comments.length && !normalized.post) {
    // Fallback: attempt direct Reddit harvest path so the run can still complete.
    try {
      const backup = await runRedditHarvest({
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
            message: 'OpenClaw finished but did not return structured Reddit harvest data.',
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
  pathname = String(pathname || '').replace(/^\/api\/harvest(?=\/|$)/, '/api/acquire');

  // GET /api/acquire/jobs — read-only, no extra limit
  if (pathname === '/api/acquire/jobs' && method === 'GET') {
    const limit  = Number(urlObj.searchParams.get('limit') || 200);
    const result = await listAcquireJobs(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const jobs = result.data || [];
    return sendOk(res, 200, jobs, { jobs }, { total: jobs.length }), true;
  }

  // DELETE /api/acquire/jobs/:id — write, but cheap
  const acquireJobMatch = pathname.match(/^\/api\/acquire\/jobs\/([^/]+)$/);
  if (acquireJobMatch && method === 'DELETE') {
    const id     = decodeURIComponent(acquireJobMatch[1]);
    const result = deleteMirroredAcquireJob(id);
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
    const runs  = listDirectAcquireRuns(limit);
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/direct-runs/:id — read-only
  const directRunMatch = pathname.match(/^\/api\/acquire\/direct-runs\/([^/]+)$/);
  if (directRunMatch && method === 'GET') {
    const run = getDirectAcquireRun(decodeURIComponent(directRunMatch[1]));
    if (!run) return sendErr(res, 404, 'Run not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, run, { run }), true;
  }

  // POST /api/acquire/direct-run — ⚡ RATE LIMITED (hits external web)
  if (pathname === '/api/acquire/direct-run' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.direct')) return true;

    const body = await parseJsonBody(req);
    const run = await runDirectAcquire(body || {});
    logActivity({
      action: 'acquire.direct_run', entityType: 'acquire', entityId: run?.id,
      summary: `Direct acquire run: ${body.url || 'unknown URL'}`
    });
    return sendOk(res, 201, run, { run }), true;
  }

  // POST /api/acquire/youtube — ⚡ RATE LIMITED (hits YouTube + transcript APIs)
  if (pathname === '/api/acquire/youtube' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;

    const body = await parseJsonBody(req);
    const inputPayload = {
      ...(body || {}),
      category: String(body?.category || '').trim(),
    };
    const result    = await runYoutubeHarvest(inputPayload);
    const createRes = await createYoutubeHarvestRun(inputPayload, result);
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

  // POST /api/acquire/x-harvest — ⚡ RATE LIMITED (hits X recent search API)
  if (pathname === '/api/acquire/x-harvest' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.x')) return true;

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
    const harvest = await runXHarvest(inputPayload);
    if (!harvest.ok) {
      return sendErr(res, harvest.status || 500, harvest.error || 'X harvest failed', {
        details: [
          String(harvest.endpoint || ''),
          harvest.oauth1 ? `oauth1: ${JSON.stringify(harvest.oauth1)}` : '',
          harvest.oauth2 ? `oauth2: ${JSON.stringify(harvest.oauth2)}` : '',
          JSON.stringify(harvest.data || {}),
        ].filter(Boolean),
      }), true;
    }
    const saved = createXHarvestRun(inputPayload, harvest.data || {});
    const run = saved.data || null;
    logActivity({
      action: 'acquire.x',
      entityType: 'acquire',
      entityId: run?.run_id || null,
      summary: `X harvest acquired ${Number(run?.stats?.total_tweets || 0) || 0} tweets`,
      meta: {
        query: String(run?.query || ''),
        hashtags: Array.isArray(run?.hashtags) ? run.hashtags.join(',') : '',
        total_tweets: Number(run?.stats?.total_tweets || 0) || 0,
        total_replies: Number(run?.stats?.total_replies || 0) || 0,
      },
    });
    return sendOk(res, 200, { run: run || null, result: harvest.data || {} }, { run: run || null, result: harvest.data || {} }), true;
  }

  // GET /api/acquire/x-runs — read-only
  if (pathname === '/api/acquire/x-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 20);
    const result = listXHarvestRuns(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/x-runs/:id — read-only
  const xRunMatch = pathname.match(/^\/api\/acquire\/x-runs\/([^/]+)$/);
  if (xRunMatch && method === 'GET') {
    const id = decodeURIComponent(xRunMatch[1]);
    const result = getXHarvestRun(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // DELETE /api/acquire/x-runs/:id
  if (xRunMatch && method === 'DELETE') {
    const id = decodeURIComponent(xRunMatch[1]);
    const result = deleteXHarvestRun(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.x_deleted',
      entityType: 'acquire',
      entityId: id,
      summary: `X harvest run deleted: ${id}`,
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // POST /api/acquire/reddit-harvest — ⚡ RATE LIMITED (OpenClaw browser-based harvest)
  if (pathname === '/api/acquire/reddit-harvest' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.reddit')) return true;

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
    const harvest = await Promise.race([
      runRedditHarvestViaOpenClaw(inputPayload),
      (async () => {
        await waitFor(routeBudgetMs);
        return { ok: false, status: 504, error: `Reddit harvest route timed out after ${routeBudgetMs}ms` };
      })(),
    ]);
    console.log('[acquire.reddit] harvest-finished', {
      ok: !!harvest?.ok,
      status: Number(harvest?.status || 0) || 0,
      elapsedMs: Date.now() - startedAt,
    });
    if (!harvest.ok) {
      return sendErr(res, harvest.status || 500, harvest.error || 'Reddit harvest failed', {
        details: [
          String(harvest.data?.hint || ''),
          String(harvest.data?.type || ''),
          String(harvest.data?.job_id || ''),
        ].filter(Boolean),
      }), true;
    }
    const saved = await Promise.race([
      Promise.resolve(createRedditHarvestRun(inputPayload, harvest.data || {})),
      (async () => {
        await waitFor(10000);
        return { ok: false, status: 504, error: 'Reddit harvest save timed out after 10000ms' };
      })(),
    ]);
    if (!saved?.ok) {
      console.log('[acquire.reddit] save-failed', {
        status: Number(saved?.status || 0) || 0,
        error: safeText(saved?.error),
      });
      return sendErr(res, saved.status || 500, saved.error || 'Failed to save Reddit harvest run'), true;
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
      summary: `Reddit harvest acquired ${Number(run?.stats?.total_posts || 0) || 0} posts`,
      meta: {
        mode: String(run?.mode || ''),
        target: String(run?.target || ''),
        subreddit: String(run?.subreddit || ''),
        total_posts: Number(run?.stats?.total_posts || 0) || 0,
        total_comments: Number(run?.stats?.total_comments || 0) || 0,
      },
    });
    return sendOk(res, 200, { run: run || null, result: harvest.data || {} }, { run: run || null, result: harvest.data || {} }), true;
  }

  // GET /api/acquire/reddit-runs — read-only
  if (pathname === '/api/acquire/reddit-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 20);
    const result = listRedditHarvestRuns(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/reddit-runs/:id
  const redditRunMatch = pathname.match(/^\/api\/acquire\/reddit-runs\/([^/]+)$/);
  if (redditRunMatch && method === 'GET') {
    const id = decodeURIComponent(redditRunMatch[1]);
    const result = getRedditHarvestRun(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // DELETE /api/acquire/reddit-runs/:id
  if (redditRunMatch && method === 'DELETE') {
    const id = decodeURIComponent(redditRunMatch[1]);
    const result = deleteRedditHarvestRun(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'acquire.reddit_deleted',
      entityType: 'acquire',
      entityId: id,
      summary: `Reddit harvest run deleted: ${id}`,
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (pathname === '/api/acquire/youtube-categories' && method === 'GET') {
    const result = await listYoutubeCategories();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const categories = (Array.isArray(result.data) ? result.data : []).map(rowToYoutubeCategory);
    return sendOk(res, 200, categories, { categories }, { total: categories.length }), true;
  }

  if (pathname === '/api/acquire/youtube-categories' && method === 'POST') {
    const body = await parseJsonBody(req);
    const category = String(body?.category || '').trim();
    if (!category) {
      return sendErr(res, 400, 'category is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await createYoutubeCategory({ category });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 201, rowToYoutubeCategory(created), { category: rowToYoutubeCategory(created) }), true;
  }

  const youtubeCategoryIdMatch = pathname.match(/^\/api\/acquire\/youtube-categories\/(\d+)\/?$/);
  if (youtubeCategoryIdMatch && method === 'GET') {
    const categoryId = Number(youtubeCategoryIdMatch[1]);
    const result = await getYoutubeCategoryById(categoryId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToYoutubeCategory(row), { category: rowToYoutubeCategory(row) }), true;
  }

  if (youtubeCategoryIdMatch && method === 'PATCH') {
    const categoryId = Number(youtubeCategoryIdMatch[1]);
    const body = await parseJsonBody(req);
    const category = String(body?.category || '').trim();
    if (!category) {
      return sendErr(res, 400, 'category is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateYoutubeCategory(categoryId, { category });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToYoutubeCategory(updated), { category: rowToYoutubeCategory(updated) }), true;
  }

  if (youtubeCategoryIdMatch && method === 'DELETE') {
    const categoryId = Number(youtubeCategoryIdMatch[1]);
    const result = await deleteYoutubeCategory(categoryId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!deleted) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToYoutubeCategory(deleted), { category: rowToYoutubeCategory(deleted) }), true;
  }

  // POST /api/acquire/youtube-comments — ⚡ RATE LIMITED (hits YouTube Data API)
  if (pathname === '/api/acquire/youtube-comments' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;

    const body = await parseJsonBody(req);
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
      const result = await runYoutubeCommentHarvest(input);

      // Persist to the acquire YouTube comments table
      const saveRes = await createCommentRun(input, result);
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
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;

    const body = await parseJsonBody(req);
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

    const saveRes = await createMinerRun(input, mined.data || {});
    const runId = saveRes?.ok ? safeText(saveRes?.data?.run_id) : '';

    logActivity({
      action: 'acquire.youtube_comment_miner',
      entityType: 'acquire',
      entityId: runId || null,
      summary: `YouTube Comment Miner processed ${Number(mined?.data?.stats?.harvested_videos || 0) || 0} videos`,
      meta: {
        run_id: runId || null,
        resolved_videos: Number(mined?.data?.stats?.resolved_videos || 0) || 0,
        harvested_videos: Number(mined?.data?.stats?.harvested_videos || 0) || 0,
        total_comments_raw: Number(mined?.data?.stats?.total_comments_raw || 0) || 0,
        total_comments_filtered: Number(mined?.data?.stats?.total_comments_filtered || 0) || 0,
      },
    });

    return sendOk(res, 200, { run_id: runId, result: mined.data }, { run_id: runId, result: mined.data }), true;
  }

  // POST /api/acquire/youtube-reply-offers — generate 3 tailored reply offers for one comment
  if (pathname === '/api/acquire/youtube-reply-offers' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;
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

  // POST /api/acquire/youtube-research — build targets from messaging + phrases, then mine/distill
  if (pathname === '/api/acquire/youtube-research' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;

    const body = await parseJsonBody(req);
    const apiKey = resolveYoutubeApiKey();
    if (!apiKey) {
      return sendErr(res, 400, 'YouTube API key is not configured. Go to Settings > APIs > YouTube and add your key.'), true;
    }

    const rawManualPhrases = splitPhraseList(body?.manual_phrases_text || body?.manual_phrases || '');
    const includeMessaging = body?.include_messaging !== false;
    const messagingCategory = safeText(body?.messaging_category || '').toLowerCase();
    const messagingHashtag = safeText(body?.messaging_hashtag || '').toLowerCase();
    const maxPhrases = Math.max(1, Math.min(Number(body?.max_phrases || 25) || 25, 120));
    const videosPerPhrase = Math.max(1, Math.min(Number(body?.videos_per_phrase || 3) || 3, 10));
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

    const dedupedVideos = [];
    const seenVideoIds = new Set();
    for (const hit of discovered) {
      const videoId = safeText(hit.video_id);
      if (!videoId || seenVideoIds.has(videoId)) continue;
      seenVideoIds.add(videoId);
      dedupedVideos.push(hit);
      if (dedupedVideos.length >= distilledTargetLimit) break;
    }

    if (!dedupedVideos.length) {
      return sendErr(res, 400, 'No YouTube targets discovered from research phrases.', { details: warnings }), true;
    }

    const minerPayload = {
      targets: dedupedVideos.map((item) => item.video_url),
      videos_per_channel: Number(body?.videos_per_channel || 5) || 5,
      max_comments_per_video: Number(body?.max_comments_per_video || 100) || 100,
      include_replies: body?.include_replies === true,
      sort_by: String(body?.sort_by || 'relevance'),
      min_score: Number(body?.min_score || 3) || 3,
      exclude_noise: body?.exclude_noise !== false,
      include_phrases_text: String(body?.include_phrases_text || '').trim(),
      exclude_phrases_text: String(body?.exclude_phrases_text || '').trim(),
      category_config: body?.category_config || [],
      attribute_config: body?.attribute_config || [],
      approach_config: body?.approach_config || [],
      response_context: String(body?.response_context || '').trim(),
      response_guidelines: String(body?.response_guidelines || '').trim(),
      training_feedback: Array.isArray(body?.training_feedback) ? body.training_feedback : [],
    };

    const mined = await runYoutubeCommentMiner(minerPayload);
    if (!mined.ok) {
      return sendErr(res, mined.status || 500, mined.error || 'YouTube research miner failed', {
        details: Array.isArray(mined?.data?.warnings) ? mined.data.warnings : warnings,
      }), true;
    }

    const researchInput = {
      phrase_count: phrases.length,
      discovered_target_count: discovered.length,
      distilled_target_count: dedupedVideos.length,
      phrases,
      discovered_targets: discovered.map((item) => item.video_url).filter(Boolean),
      distilled_targets: dedupedVideos.map((item) => item.video_url).filter(Boolean),
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
    const saveRes = await createResearchRun(researchInput, mined.data || {});
    const runId = saveRes?.ok ? safeText(saveRes?.data?.run_id) : '';

    const resultPayload = {
      ...(mined.data || {}),
      research: {
        run_id: runId,
        phrase_sources: phraseSources,
        phrases,
        discovered_count: discovered.length,
        distilled_count: dedupedVideos.length,
        discovered: discovered.slice(0, 500),
        distilled_targets: dedupedVideos.map((item) => item.video_url).filter(Boolean),
      },
      warnings: [...toArray(mined.data?.warnings), ...warnings].slice(0, 300),
    };

    logActivity({
      action: 'acquire.youtube_research',
      entityType: 'acquire',
      entityId: runId || null,
      summary: `YouTube Research: ${phrases.length} phrases, ${dedupedVideos.length} distilled targets`,
      meta: {
        run_id: runId || null,
        phrase_count: phrases.length,
        discovered_target_count: discovered.length,
        distilled_target_count: dedupedVideos.length,
        filtered_comments: Number(resultPayload?.stats?.total_comments_filtered || 0) || 0,
      },
    });

    return sendOk(res, 200, { run_id: runId, result: resultPayload }, { run_id: runId, result: resultPayload }), true;
  }

  // GET /api/acquire/youtube-research-runs
  if (pathname === '/api/acquire/youtube-research-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 20);
    const result = await listResearchRuns(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data || [], { runs: result.data || [] }, { total: Array.isArray(result.data) ? result.data.length : 0 }), true;
  }

  // GET /api/acquire/youtube-research-runs/:id
  const youtubeResearchRunMatch = pathname.match(/^\/api\/acquire\/youtube-research-runs\/([^/]+)$/);
  if (youtubeResearchRunMatch && method === 'GET') {
    const id = decodeURIComponent(youtubeResearchRunMatch[1]);
    const result = await getResearchRun(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // GET /api/acquire/youtube-miner-runs
  if (pathname === '/api/acquire/youtube-miner-runs' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 30);
    const result = await listMinerRuns(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data || [], { runs: result.data || [] }, { total: Array.isArray(result.data) ? result.data.length : 0 }), true;
  }

  // GET /api/acquire/youtube-miner-runs/:id
  const youtubeMinerRunMatch = pathname.match(/^\/api\/acquire\/youtube-miner-runs\/([^/]+)$/);
  if (youtubeMinerRunMatch && method === 'GET') {
    const id = decodeURIComponent(youtubeMinerRunMatch[1]);
    const result = await getMinerRun(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // GET /api/acquire/youtube-target-history
  if (pathname === '/api/acquire/youtube-target-history' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 400);
    const result = await listTargetHistory(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data || [], { targets: result.data || [] }, { total: Array.isArray(result.data) ? result.data.length : 0 }), true;
  }

  // POST /api/acquire/youtube-comment — ⚡ RATE LIMITED (writes to YouTube)
  if (pathname === '/api/acquire/youtube-comment' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;

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
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;

    const body = await parseJsonBody(req);
    const input = {
      video_url: body?.video_url,
      title: body?.title,
      channel_name: body?.channel_name,
      description: body?.description,
      transcript: body?.transcript,
    };
    const genRes = await generateYoutubeCommentSuggestions(input);
    if (!genRes.ok) return sendErr(res, genRes.status || 500, genRes.error), true;

    const comments = Array.isArray(genRes.data) ? genRes.data : [];
    return sendOk(res, 200, comments, { comments }, { total: comments.length }), true;
  }

  // GET /api/acquire/youtube-comment-runs — list persisted comment runs
  if (pathname === '/api/acquire/youtube-comment-runs' && method === 'GET') {
    const limit  = Number(urlObj.searchParams.get('limit') || 20);
    const result = await listCommentRuns(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = result.data || [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // GET /api/acquire/youtube-videos — canonical video repository
  if (pathname === '/api/acquire/youtube-videos' && method === 'GET') {
    const limit = Number(urlObj.searchParams.get('limit') || 200);
    const result = await listYoutubeVideos(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const videos = result.data || [];
    return sendOk(res, 200, videos, { videos }, { total: videos.length }), true;
  }

  // POST /api/acquire/youtube-videos/backfill-details
  if (pathname === '/api/acquire/youtube-videos/backfill-details' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.youtube')) return true;

    const body = await parseJsonBody(req);
    const limit = Math.max(1, Math.min(Number(body?.limit || 25) || 25, 200));
    const delayMs = Math.max(0, Math.min(Number(body?.delay_ms || 0) || 0, 5000));
    const force = body?.force === true;
    const requestedUrls = uniqueYoutubeUrls(body?.video_urls);

    let targets = requestedUrls;
    if (!targets.length) {
      const videosRes = await listYoutubeVideos(1000);
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

    const existingVideosRes = await listYoutubeVideos(1000);
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
        const harvestInput = {
          video_url: videoUrl,
          category: safeText(existing?.category),
          tags: safeText(existing?.tags),
        };
        const result = await runYoutubeHarvest(harvestInput);
        const createRes = await createYoutubeHarvestRun(harvestInput, result);
        if (!createRes.ok) {
          items.push({
            video_url: videoUrl,
            status: 'failed',
            error: safeText(createRes.error) || 'Failed to save harvested details',
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
          error: safeText(err?.message) || 'YouTube detail harvest failed',
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
    const targets = uniqueYoutubeUrls(body?.video_urls).slice(0, 25);
    if (!targets.length) {
      return sendErr(res, 400, 'video_urls is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const diagnostics = [];
    for (const videoUrl of targets) {
      diagnostics.push(await listYoutubeDiagnosticsForUrl(videoUrl));
    }

    return sendOk(res, 200, diagnostics, { diagnostics }, { total: diagnostics.length }), true;
  }

  // GET /api/acquire/youtube-videos/:id
  const youtubeVideoMatch = pathname.match(/^\/api\/acquire\/youtube-videos\/([^/]+)$/);
  if (youtubeVideoMatch && method === 'GET') {
    const id = decodeURIComponent(youtubeVideoMatch[1]);
    const result = await getYoutubeVideo(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { video: result.data }), true;
  }

  // PATCH /api/acquire/youtube-videos/:id
  if (youtubeVideoMatch && method === 'PATCH') {
    const id = decodeURIComponent(youtubeVideoMatch[1]);
    const body = await parseJsonBody(req);
    const patch = {};
    if (body?.category != null) patch.category = safeText(body.category);
    if (body?.tags != null) patch.tags = safeText(body.tags);
    if (!Object.keys(patch).length) {
      return sendErr(res, 400, 'No fields to update', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateYoutubeVideo(id, patch);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;

    // Keep the detail run in sync for flows that still read from the original harvest table.
    if (safeText(result.data?.detail_run_id)) {
      await updateYoutubeHarvestRun(result.data.detail_run_id, patch).catch(() => null);
    }

    return sendOk(res, 200, result.data, { video: result.data }), true;
  }

  // GET /api/acquire/youtube-comment-runs/:id
  const commentRunMatch = pathname.match(/^\/api\/acquire\/youtube-comment-runs\/([^/]+)$/);
  if (commentRunMatch && method === 'GET') {
    const id     = decodeURIComponent(commentRunMatch[1]);
    const result = await getCommentRun(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // DELETE /api/acquire/youtube-comment-runs/:id
  if (commentRunMatch && method === 'DELETE') {
    const id     = decodeURIComponent(commentRunMatch[1]);
    const result = await deleteCommentRun(id);
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
    const result = await listYoutubeHarvestRuns(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const runs = result.data || [];
    return sendOk(res, 200, runs, { runs }, { total: runs.length }), true;
  }

  // POST /api/acquire/youtube-runs/:id/rerun — ⚡ RATE LIMITED
  const youtubeRerunMatch = pathname.match(/^\/api\/acquire\/youtube-runs\/([^/]+)\/rerun$/);
  if (youtubeRerunMatch && method === 'POST') {
    if (checkEndpointLimit(req, res, 'harvest.youtube.rerun')) return true;

    await parseJsonBody(req);
    const priorRes = await getYoutubeHarvestRun(decodeURIComponent(youtubeRerunMatch[1]));
    if (!priorRes.ok) return sendErr(res, priorRes.status || 500, priorRes.error), true;
    const prior     = priorRes.data;
    const rerunInput = { video_url: prior.video_url, category: String(prior.category || '').trim() };
    const result    = await runYoutubeHarvest(rerunInput);
    const createRes = await createYoutubeHarvestRun(rerunInput, result);
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
    const result = await getYoutubeHarvestRun(decodeURIComponent(youtubeRunMatch[1]));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  if (youtubeRunMatch && method === 'PATCH') {
    const id = decodeURIComponent(youtubeRunMatch[1]);
    const existingRes = await getYoutubeHarvestRun(id);
    if (!existingRes.ok) return sendErr(res, existingRes.status || 500, existingRes.error), true;

    const body = await parseJsonBody(req);
    const patch = {};
    if (body?.category != null) patch.category = String(body.category || '').trim();
    if (body?.tags != null) patch.tags = String(body.tags || '').trim();
    if (!Object.keys(patch).length) {
      return sendErr(res, 400, 'No fields to update', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateYoutubeHarvestRun(id, patch);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: runSummary(result.data) }), true;
  }

  // DELETE /api/acquire/youtube-runs/:id
  if (youtubeRunMatch && method === 'DELETE') {
    const id     = decodeURIComponent(youtubeRunMatch[1]);
    const result = await deleteYoutubeHarvestRun(id);
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
    const runRes = await getYoutubeHarvestRun(runId);
    if (!runRes.ok) return sendErr(res, runRes.status || 500, runRes.error), true;

    const captureRes = await captureYoutubeContact(runRes.data?.result || {}, runRes.data?.video_url || '');
    if (!captureRes.ok) {
      return sendErr(res, captureRes.status || 500, captureRes.error || 'Contact capture failed'), true;
    }

    const run = runRes.data || {};
    const nextRequest = { ...(run.request_json || {}), capture_contact: true };
    const nextResult = { ...(run.result_json || {}), contact_captured: true };
    await updateYoutubeHarvestRun(runId, {
      request_json: nextRequest,
      result_json: nextResult,
    });

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
    if (checkEndpointLimit(req, res, 'harvest.youtube.rerun')) return true;

    await parseJsonBody(req);
    const id = decodeURIComponent(youtubeRefreshTranscriptMatch[1]);
    const existingRes = await getYoutubeHarvestRun(id);
    if (!existingRes.ok) return sendErr(res, existingRes.status || 500, existingRes.error), true;
    const existing = existingRes.data;

    const result = await runYoutubeHarvest({
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

    const updateRes = await updateYoutubeHarvestRun(id, patch);
    if (!updateRes.ok) return sendErr(res, updateRes.status || 500, updateRes.error), true;
    return sendOk(res, 200, updateRes.data, { run: runSummary(updateRes.data) }), true;
  }

  return false;
}

const manifest = {
  id:       'acquire',
  label:    'Acquire',
  prefixes: ['/api/acquire', '/api/harvest']
};

module.exports = { handle, manifest };
