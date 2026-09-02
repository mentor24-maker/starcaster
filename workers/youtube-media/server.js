'use strict';

/**
 * StarCaster YouTube media worker.
 *
 * A small always-on service that does the one job Vercel cannot: run yt-dlp to
 * download a video, transcode an .mp3 with ffmpeg, and push both files to
 * Vercel Blob. StarCaster only ever exchanges small JSON messages with it.
 *
 * This runs on infrastructure you control, so it holds its own
 * BLOB_READ_WRITE_TOKEN and uploads directly — the files never pass through a
 * serverless function, which is the whole point.
 *
 *   POST /jobs        { video_url, video_id, title, formats } -> { job_id, status }
 *   GET  /jobs/:id                                            -> { status, mp4, mp3, error }
 *   GET  /health                                              -> { ok, ytdlp, ffmpeg }
 *
 * Deploy notes and required environment variables: see README.md.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { put } = require('@vercel/blob');

const PORT = Number(process.env.PORT || 8080);
const SHARED_SECRET = String(process.env.WORKER_SHARED_SECRET || '').trim();
const BLOB_TOKEN = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
const BLOB_ROOT = String(process.env.BLOB_MEDIA_ROOT || 'APP/YouTube').trim();
const YTDLP_BIN = String(process.env.YTDLP_PATH || 'yt-dlp').trim();
const FFMPEG_BIN = String(process.env.FFMPEG_PATH || 'ffmpeg').trim();
const COOKIES_FILE = String(process.env.YTDLP_COOKIES_FILE || '').trim();
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 2) || 2);
const MAX_DURATION_SECONDS = Math.max(0, Number(process.env.MAX_VIDEO_SECONDS || 5400) || 5400);
const JOB_TTL_MS = Math.max(60_000, Number(process.env.JOB_TTL_MS || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000);
const AUDIO_BITRATE = String(process.env.AUDIO_BITRATE || '192k').trim();
/** Cap the video track so a 4K source doesn't produce a multi-gigabyte upload. */
const MAX_HEIGHT = Math.max(240, Number(process.env.MAX_VIDEO_HEIGHT || 1080) || 1080);

if (!SHARED_SECRET) {
  console.error('WORKER_SHARED_SECRET is required — refusing to start an unauthenticated worker.');
  process.exit(1);
}
if (!BLOB_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is required — the worker has nowhere to upload finished files.');
  process.exit(1);
}

/** job_id -> { status, progress, mp4, mp3, error, createdAt } */
const jobs = new Map();
const queue = [];
let running = 0;

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * Constant-time compare so a wrong token can't be guessed byte-by-byte from
 * response timing.
 */
function tokenMatches(candidate) {
  const a = Buffer.from(safeText(candidate));
  const b = Buffer.from(SHARED_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAuthorized(req) {
  const header = safeText(req.headers.authorization);
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  return tokenMatches(header.slice(7));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('Body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Only real YouTube watch/short URLs are accepted. Without this the worker is
 * a general-purpose downloader that anyone holding the token could point at
 * arbitrary hosts.
 */
function normalizeYoutubeUrl(value) {
  const raw = safeText(value);
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const isYoutube = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host);
  if (!isYoutube) return '';

  let videoId = '';
  if (host === 'youtu.be') {
    videoId = safeText(url.pathname.split('/').filter(Boolean)[0]);
  } else if (url.pathname === '/watch') {
    videoId = safeText(url.searchParams.get('v'));
  } else {
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = parts.findIndex((part) => ['embed', 'shorts', 'v', 'live'].includes(part));
    if (marker >= 0) videoId = safeText(parts[marker + 1]);
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return '';
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function slugify(value, fallback) {
  const slug = safeText(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function run(command, args, { timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 1_000_000) stdout = stdout.slice(-500_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const detail = safeText(stderr).split('\n').filter(Boolean).slice(-3).join(' | ');
      reject(new Error(detail || `${command} exited with code ${code}`));
    });
  });
}

function ytdlpBaseArgs() {
  const args = ['--no-playlist', '--no-progress', '--no-warnings'];
  // YouTube blocks datacenter IPs aggressively. A cookies file exported from a
  // signed-in browser is what gets a hosted worker past that.
  if (COOKIES_FILE) args.push('--cookies', COOKIES_FILE);
  return args;
}

async function probeDuration(videoUrl) {
  try {
    const { stdout } = await run(YTDLP_BIN, [...ytdlpBaseArgs(), '--print', '%(duration)s', videoUrl], {
      timeoutMs: 60_000,
    });
    return Number(safeText(stdout)) || 0;
  } catch (_) {
    return 0;
  }
}

async function uploadFile(localPath, blobPath, contentType) {
  const body = await fsp.readFile(localPath);
  const result = await put(blobPath, body, {
    access: 'public',
    contentType,
    token: BLOB_TOKEN,
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  });
  return {
    url: safeText(result.url),
    pathname: safeText(result.pathname),
    bytes: body.length,
    content_type: contentType,
  };
}

async function processJob(job) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ytmedia-'));
  job.status = 'running';
  job.progress = 5;

  try {
    if (MAX_DURATION_SECONDS > 0) {
      const duration = await probeDuration(job.videoUrl);
      if (duration > MAX_DURATION_SECONDS) {
        throw new Error(
          `Video is ${Math.round(duration / 60)} minutes, over the ${Math.round(
            MAX_DURATION_SECONDS / 60
          )}-minute limit.`
        );
      }
      job.durationSeconds = duration;
    }

    const base = slugify(job.title || job.videoId, job.videoId || 'video');
    const videoPath = path.join(workDir, 'source.mp4');

    job.progress = 10;
    await run(YTDLP_BIN, [
      ...ytdlpBaseArgs(),
      '-f',
      `bestvideo[height<=${MAX_HEIGHT}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${MAX_HEIGHT}][ext=mp4]/best`,
      '--merge-output-format',
      'mp4',
      '-o',
      videoPath,
      job.videoUrl,
    ]);
    job.progress = 55;

    const stamp = `${Date.now()}_${base}`;
    const wantsMp4 = job.formats.includes('mp4');
    const wantsMp3 = job.formats.includes('mp3');

    if (wantsMp3) {
      const audioPath = path.join(workDir, 'audio.mp3');
      // Reuse the file already on disk instead of asking YouTube for the audio
      // stream a second time — half the bandwidth and half the block risk.
      await run(FFMPEG_BIN, [
        '-nostdin',
        '-loglevel',
        'error',
        '-i',
        videoPath,
        '-vn',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        AUDIO_BITRATE,
        audioPath,
      ]);
      job.progress = 70;
      job.mp3 = await uploadFile(audioPath, `${BLOB_ROOT}/${stamp}.mp3`, 'audio/mpeg');
      if (job.durationSeconds) job.mp3.duration_seconds = job.durationSeconds;
    }

    job.progress = 85;
    if (wantsMp4) {
      job.mp4 = await uploadFile(videoPath, `${BLOB_ROOT}/${stamp}.mp4`, 'video/mp4');
      if (job.durationSeconds) job.mp4.duration_seconds = job.durationSeconds;
    }

    job.status = 'done';
    job.progress = 100;
  } catch (err) {
    job.status = 'failed';
    job.error = safeText(err?.message) || 'Download failed';
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (!job || job.status !== 'queued') continue;
    running += 1;
    processJob(job)
      .catch((err) => {
        job.status = 'failed';
        job.error = safeText(err?.message) || 'Download failed';
      })
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/** Drop finished jobs so a long-lived worker doesn't grow without bound. */
function sweepJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}
setInterval(sweepJobs, 10 * 60 * 1000).unref();

function publicJob(job) {
  return {
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    mp4: job.mp4,
    mp3: job.mp3,
    error: job.error,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/health' && req.method === 'GET') {
    const ytdlp = await run(YTDLP_BIN, ['--version'], { timeoutMs: 10_000 })
      .then((r) => safeText(r.stdout))
      .catch(() => '');
    const ffmpeg = await run(FFMPEG_BIN, ['-version'], { timeoutMs: 10_000 })
      .then((r) => safeText(r.stdout).split('\n')[0])
      .catch(() => '');
    return sendJson(res, ytdlp && ffmpeg ? 200 : 503, {
      ok: Boolean(ytdlp && ffmpeg),
      ytdlp,
      ffmpeg,
      queued: queue.length,
      running,
    });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  if (pathname === '/jobs' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: safeText(err?.message) || 'Invalid body' });
    }

    const videoUrl = normalizeYoutubeUrl(body?.video_url);
    if (!videoUrl) {
      return sendJson(res, 400, { error: 'A valid YouTube video URL is required.' });
    }

    const formats = (Array.isArray(body?.formats) ? body.formats : ['mp4', 'mp3'])
      .map((item) => safeText(item).toLowerCase())
      .filter((item) => item === 'mp4' || item === 'mp3');
    if (!formats.length) {
      return sendJson(res, 400, { error: 'formats must include mp4 and/or mp3.' });
    }

    const job = {
      id: crypto.randomUUID(),
      videoUrl,
      videoId: safeText(body?.video_id) || safeText(new URL(videoUrl).searchParams.get('v')),
      title: safeText(body?.title),
      formats,
      status: 'queued',
      progress: 0,
      mp4: null,
      mp3: null,
      error: '',
      durationSeconds: 0,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    queue.push(job);
    pump();
    return sendJson(res, 202, { job_id: job.id, status: job.status });
  }

  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === 'GET') {
    const job = jobs.get(decodeURIComponent(jobMatch[1]));
    if (!job) return sendJson(res, 404, { error: 'Job not found or expired.' });
    return sendJson(res, 200, publicJob(job));
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`youtube-media worker listening on :${PORT} (max ${MAX_CONCURRENT} concurrent)`);
});
