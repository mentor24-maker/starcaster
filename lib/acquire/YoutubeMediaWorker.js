'use strict';

/**
 * Client for the self-hosted YouTube media worker (yt-dlp + ffmpeg).
 *
 * Why a worker at all: Vercel cannot do this job. The filesystem is read-only,
 * functions time out long before a video finishes downloading, and YouTube
 * blocks datacenter IPs. So a small always-on box runs yt-dlp, transcodes an
 * .mp3 with ffmpeg, uploads both files straight to Vercel Blob, and this module
 * only ever exchanges small JSON messages with it.
 *
 * The exchange is a job, not a request/response, for the same timeout reason:
 *   startMediaJob()  -> { job_id, status: 'queued' }   (returns immediately)
 *   getMediaJob(id)  -> { status, mp4, mp3, error }    (polled by the browser)
 *
 * See workers/youtube-media/README.md for deploying the worker itself.
 */

const { getProviderValues } = require('../apiSettings');

const MEDIA_PROVIDER = 'youtube_media_worker';

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = safeText(value).toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function clampTimeout(value, fallback) {
  const parsed = Number(value) || fallback;
  return Math.max(5000, Math.min(parsed, 60000));
}

/**
 * Worker connection settings. Env wins over the Settings > APIs record so a
 * deployment can point at a different worker without a database edit.
 */
function mediaWorkerConfig() {
  let saved = {};
  try {
    saved = getProviderValues(MEDIA_PROVIDER) || {};
  } catch (_) {
    saved = {};
  }
  const baseUrl = safeText(process.env.YOUTUBE_MEDIA_WORKER_URL || saved.base_url).replace(/\/+$/, '');
  const token = safeText(process.env.YOUTUBE_MEDIA_WORKER_TOKEN || saved.api_key);
  const timeoutMs = clampTimeout(process.env.YOUTUBE_MEDIA_WORKER_TIMEOUT_MS || saved.timeout_ms, 20000);
  const enabled = parseBoolean(process.env.YOUTUBE_MEDIA_WORKER_ENABLED, true);
  return { baseUrl, token, timeoutMs, enabled };
}

function isConfigured() {
  const cfg = mediaWorkerConfig();
  return Boolean(cfg.enabled && cfg.baseUrl && cfg.token);
}

/**
 * Why this shape: every caller gets a status string it can render, never an
 * exception. Media is the one optional half of an acquisition — a worker that
 * is down or unconfigured must not fail the title/transcript half that works.
 */
function unavailable(status, error) {
  return { ok: false, status, error: safeText(error), mp4: null, mp3: null, job_id: '' };
}

async function callWorker(path, { method = 'GET', body = null } = {}) {
  const cfg = mediaWorkerConfig();
  if (!cfg.enabled) return { ok: false, status: 'worker-disabled', error: '' };
  if (!cfg.baseUrl || !cfg.token) return { ok: false, status: 'worker-unconfigured', error: '' };

  let response;
  try {
    response = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    return { ok: false, status: 'worker-unreachable', error: safeText(err?.message) || 'Request failed' };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const message = safeText(payload?.error) || `Worker responded ${response.status}`;
    return { ok: false, status: 'worker-error', error: message };
  }
  return { ok: true, status: 'ok', data: payload || {} };
}

function normalizeMediaFile(raw) {
  const url = safeText(raw?.url);
  if (!url) return null;
  return {
    url,
    bytes: Number(raw?.bytes) || 0,
    content_type: safeText(raw?.content_type),
    pathname: safeText(raw?.pathname),
    duration_seconds: Number(raw?.duration_seconds) || 0,
  };
}

/**
 * Ask the worker to start downloading. Returns as soon as the job is queued —
 * the files are not ready yet.
 */
async function startMediaJob({ videoUrl, videoId, title, formats } = {}) {
  const url = safeText(videoUrl);
  if (!url) return unavailable('invalid-input', 'A YouTube video URL is required.');

  const wanted = Array.isArray(formats) && formats.length ? formats : ['mp4', 'mp3'];
  const res = await callWorker('/jobs', {
    method: 'POST',
    body: {
      video_url: url,
      video_id: safeText(videoId),
      title: safeText(title),
      formats: wanted.filter((item) => ['mp4', 'mp3'].includes(safeText(item).toLowerCase())),
    },
  });
  if (!res.ok) return unavailable(res.status, res.error);

  const jobId = safeText(res.data?.job_id);
  if (!jobId) return unavailable('worker-error', 'Worker did not return a job id.');
  return {
    ok: true,
    status: safeText(res.data?.status) || 'queued',
    job_id: jobId,
    mp4: null,
    mp3: null,
    error: '',
  };
}

/**
 * Poll one job. `status` is queued | running | done | failed; mp4/mp3 are
 * populated only on 'done'.
 */
async function getMediaJob(jobId) {
  const id = safeText(jobId);
  if (!id) return unavailable('invalid-input', 'A job id is required.');

  const res = await callWorker(`/jobs/${encodeURIComponent(id)}`);
  if (!res.ok) return unavailable(res.status, res.error);

  const data = res.data || {};
  return {
    ok: true,
    status: safeText(data.status) || 'queued',
    job_id: id,
    mp4: normalizeMediaFile(data.mp4),
    mp3: normalizeMediaFile(data.mp3),
    progress: Number(data.progress) || 0,
    error: safeText(data.error),
  };
}

module.exports = {
  MEDIA_PROVIDER,
  mediaWorkerConfig,
  isConfigured,
  startMediaJob,
  getMediaJob,
};
