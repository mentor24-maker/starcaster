
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
} = require('../lib/harvest/YoutubeCommentsStore');
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

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return '';
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
    const harvest = await runRedditHarvestViaOpenClaw(inputPayload);
    if (!harvest.ok) {
      return sendErr(res, harvest.status || 500, harvest.error || 'Reddit harvest failed', {
        details: [
          String(harvest.data?.hint || ''),
          String(harvest.data?.type || ''),
          String(harvest.data?.job_id || ''),
        ].filter(Boolean),
      }), true;
    }
    const saved = createRedditHarvestRun(inputPayload, harvest.data || {});
    const run = saved.data || null;
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
