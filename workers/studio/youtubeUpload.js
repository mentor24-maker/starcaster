'use strict';

/**
 * Talking to YouTube for the upload step (Reel Spinner 6c, SC-842). The pass
 * that decides WHEN and WHAT is uploadPass.js; this file only makes the calls
 * and says, for each answer, whose problem it is.
 *
 *   createYoutubeClient   the five calls: a fresh sign-in, which channel it is,
 *                         start an upload, send a piece / ask how far it got,
 *                         read a video back.
 *   uploadResumable       one file, in 8 MB pieces, through YouTube's
 *                         RESUMABLE upload. The session address is saved
 *                         before the first byte goes, so a dropped connection,
 *                         a crash or a restart carries on from the byte
 *                         YouTube says it has — never from the start of a
 *                         multi-gigabyte file.
 *
 * EVERY FAILURE CARRIES A `kind`, and the pass acts on the kind alone:
 *
 *   auth      the sign-in was refused (an expired or withdrawn token, the
 *             wrong channel). Nothing will change until Dane signs in again.
 *   quota     the day's upload allowance is used up. It resets at midnight
 *             Pacific; nothing is wrong with the video.
 *   refused   YouTube looked at THIS upload and said no (a 4xx about the
 *             video or its text). The video's problem.
 *   expired   the saved upload session is gone (YouTube keeps one about a
 *             week). Start a new one.
 *   machine   no answer, or a 5xx: the network or YouTube having a moment.
 *
 * The sign-in is YOUTUBE_UPLOAD_REFRESH_TOKEN only — never the Drive sign-in,
 * which carries no YouTube permission (docs/STUDIO.md, "Which sign-in"). No
 * token is ever printed or put in a reason.
 */

const fs = require('node:fs');

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3/videos';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALL_TIMEOUT_MS = 60 * 1000;
/** A piece must be a whole number of 256 KB blocks (YouTube's rule), except the last. */
const CHUNK_BYTES = 8 * 1024 * 1024;
const BLOCK = 256 * 1024;
/** The reasons YouTube gives when the day's allowance is spent. */
const QUOTA_REASONS = ['quotaExceeded', 'uploadLimitExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'];
const FIX_SIGN_IN = 'Fix: run npm run studio:youtube-login on the Mac Mini and sign in as the account that owns Dane of Earth';

function text(value) {
  return String(value == null ? '' : value).trim();
}

async function call(fetchImpl, url, options = {}) {
  let res;
  try {
    res = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || CALL_TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, status: 0, json: {}, headers: { get: () => null }, error: err && err.message ? err.message : String(err) };
  }
  const raw = await res.text().catch(() => '');
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw: raw.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, json, headers: res.headers };
}

/** YouTube's own reason code (`quotaExceeded`), or ''. */
function reasonCode(res) {
  const err = res && res.json && res.json.error;
  if (!err || typeof err !== 'object') return '';
  return text(err.errors && err.errors[0] && err.errors[0].reason) || text(err.status);
}

/** The sentence YouTube gave, for a reason line. Never a token. */
function said(res) {
  if (res && res.status === 0) return `no answer (${text(res.error) || 'network error'})`;
  const err = res && res.json && res.json.error;
  const message = err && typeof err === 'object'
    ? text(err.message) || reasonCode(res)
    : text(res && res.json && (res.json.error_description || res.json.error)) || text(res && res.json && res.json.raw);
  const code = reasonCode(res);
  return `${res && res.status}: ${message || 'no reason given'}${code && !message.includes(code) ? ` (${code})` : ''}`;
}

/**
 * Whose problem one answer is. `session` is true for calls on an upload
 * session, where a 404 or 410 means the session is gone rather than a refusal.
 */
function classify(res, { session = false } = {}) {
  const status = Number(res && res.status) || 0;
  const code = reasonCode(res);
  if (!status || status >= 500 || status === 429) {
    return QUOTA_REASONS.includes(code) && status === 429 ? 'quota' : 'machine';
  }
  if (status === 401) return 'auth';
  if (status === 403) {
    if (QUOTA_REASONS.includes(code)) return 'quota';
    if (/insufficient|forbidden|authError|youtubeSignupRequired/i.test(code)) return 'auth';
    return 'refused';
  }
  if (session && (status === 404 || status === 410)) return 'expired';
  return 'refused';
}

function failure(res, kind, what) {
  const reason = `${what}: YouTube answered ${said(res)}`;
  return { ok: false, kind, status: Number(res && res.status) || 0, code: reasonCode(res), why: kind === 'auth' ? `${reason}. ${FIX_SIGN_IN}` : reason };
}

/** "bytes=0-8388607" → 8388608; no header means YouTube has nothing yet. */
function nextByteFrom(rangeHeader) {
  const m = /bytes=(\d+)-(\d+)/.exec(text(rangeHeader));
  return m ? Number(m[2]) + 1 : 0;
}

function createYoutubeClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  /** A fresh access token from the upload sign-in. */
  async function accessToken() {
    const refresh = text(env.YOUTUBE_UPLOAD_REFRESH_TOKEN);
    if (!refresh) {
      return { ok: false, kind: 'auth', why: `YOUTUBE_UPLOAD_REFRESH_TOKEN is not set, so there is no sign-in to upload with. ${FIX_SIGN_IN}` };
    }
    if (!text(env.GOOGLE_DRIVE_CLIENT_ID) || !text(env.GOOGLE_DRIVE_CLIENT_SECRET)) {
      return { ok: false, kind: 'auth', why: 'GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET is not set, and the upload sign-in uses that Google Cloud client' };
    }
    const res = await call(fetchImpl, TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: text(env.GOOGLE_DRIVE_CLIENT_ID),
        client_secret: text(env.GOOGLE_DRIVE_CLIENT_SECRET),
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (res.ok && text(res.json.access_token)) return { ok: true, token: text(res.json.access_token) };
    if (res.status === 400 || res.status === 401) return failure(res, 'auth', 'Google refused the upload sign-in');
    return failure(res, 'machine', 'Google could not be asked for a fresh sign-in');
  }

  /** The channel titles this sign-in belongs to. */
  async function channelTitles(token) {
    const res = await call(fetchImpl, `${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return failure(res, classify(res), 'YouTube could not say which channel the sign-in belongs to');
    return { ok: true, titles: (Array.isArray(res.json.items) ? res.json.items : []).map((i) => text(i && i.snippet && i.snippet.title)).filter(Boolean) };
  }

  /** Open a resumable upload. `{ ok, sessionUrl }`. */
  async function startSession({ token, metadata, bytes, mimeType = 'video/mp4' }) {
    const res = await call(fetchImpl, `${UPLOAD_API}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(bytes),
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    });
    const location = res.ok && res.headers && typeof res.headers.get === 'function' ? text(res.headers.get('location')) : '';
    if (res.ok && location) return { ok: true, sessionUrl: location };
    if (res.ok) return { ok: false, kind: 'machine', status: res.status, why: 'YouTube opened an upload but gave no address to send it to' };
    return failure(res, classify(res), 'YouTube would not start the upload');
  }

  /** What one answer on a session means: done (with the video), partial (from which byte), or a failure. */
  function sessionAnswer(res, what) {
    if (res.status === 200 || res.status === 201) {
      const id = text(res.json && res.json.id);
      if (!id) return { ok: false, kind: 'machine', status: res.status, why: `${what}: YouTube said the upload is complete but named no video` };
      return { ok: true, state: 'done', video: res.json };
    }
    if (res.status === 308) {
      const range = res.headers && typeof res.headers.get === 'function' ? res.headers.get('range') : '';
      return { ok: true, state: 'partial', nextByte: nextByteFrom(range) };
    }
    return failure(res, classify(res, { session: true }), what);
  }

  /** How far a saved session got. */
  async function querySession({ token, sessionUrl, bytes }) {
    const res = await call(fetchImpl, sessionUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${bytes}`, 'Content-Length': '0' },
    });
    return sessionAnswer(res, 'YouTube could not say how much of the upload it has');
  }

  /** Send bytes [start, start + buffer.length) of `total`. */
  async function putChunk({ token, sessionUrl, buffer, start, total }) {
    const end = start + buffer.length - 1;
    const res = await call(fetchImpl, sessionUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Length': String(buffer.length), 'Content-Range': `bytes ${start}-${end}/${total}` },
      body: buffer,
      timeoutMs: 10 * 60 * 1000,
    });
    return sessionAnswer(res, `YouTube did not take bytes ${start}-${end}`);
  }

  /** One video, read back. `{ ok, video }` with `video: null` when YouTube has no such video. */
  async function getVideo({ token, videoId }) {
    const res = await call(fetchImpl, `${API}/videos?part=status,snippet,processingDetails&id=${encodeURIComponent(videoId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return failure(res, classify(res), `YouTube could not read video ${videoId} back`);
    const items = Array.isArray(res.json.items) ? res.json.items : [];
    return { ok: true, video: items[0] || null };
  }

  return { accessToken, channelTitles, startSession, querySession, putChunk, getVideo };
}

/** Read bytes [start, start + length) of a file, without holding the whole file. */
function readSlice(file, start, length, io = fs) {
  const fd = io.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = io.readSync(fd, buffer, got, length - got, start + got);
      if (!n) break;
      got += n;
    }
    return got === length ? buffer : buffer.subarray(0, got);
  } finally {
    io.closeSync(fd);
  }
}

/**
 * Upload one file, carrying on from a saved session when there is one.
 *
 *   session       `{ sessionUrl }` from an earlier try, or null
 *   saveSession   called with `{ sessionUrl, bytes }` BEFORE the first byte is
 *                 sent, so the next try can resume it
 *   onProgress    called after each piece with the bytes YouTube has; return
 *                 false to stop (the job's lease was lost)
 *
 * Returns `{ ok, video, resumedFrom, sentBytes }` or a failure with `kind`
 * (plus `leaseLost`). A session YouTube no longer knows (`expired`) is
 * started again once.
 */
async function uploadResumable({
  client, token, file, bytes, metadata, session = null, saveSession = () => {}, onProgress = async () => true,
  chunkBytes = CHUNK_BYTES, io = fs,
}) {
  const size = Number(bytes);
  if (!(size > 0)) return { ok: false, kind: 'refused', why: `the file to upload is empty (${file})` };
  const piece = Math.max(BLOCK, Math.floor(Number(chunkBytes) / BLOCK) * BLOCK || CHUNK_BYTES);
  let sessionUrl = text(session && session.sessionUrl);
  let offset = 0;
  let resumedFrom = null;
  let restarted = false;

  if (sessionUrl) {
    const asked = await client.querySession({ token, sessionUrl, bytes: size });
    if (asked.ok && asked.state === 'done') return { ok: true, video: asked.video, resumedFrom: size, sentBytes: 0 };
    if (asked.ok) {
      offset = asked.nextByte;
      resumedFrom = offset;
    } else if (asked.kind === 'expired') {
      sessionUrl = '';
      restarted = true;
    } else {
      return asked;
    }
  }
  if (!sessionUrl) {
    const opened = await client.startSession({ token, metadata, bytes: size });
    if (!opened.ok) return opened;
    sessionUrl = opened.sessionUrl;
    saveSession({ sessionUrl, bytes: size });
    offset = 0;
  }

  let sentBytes = 0;
  while (offset < size) {
    const length = Math.min(piece, size - offset);
    const buffer = readSlice(file, offset, length, io);
    if (buffer.length !== length) return { ok: false, kind: 'refused', why: `the file ended at ${offset + buffer.length} bytes, before the ${size} it was measured at` };
    const sent = await client.putChunk({ token, sessionUrl, buffer, start: offset, total: size });
    if (!sent.ok) {
      if (sent.kind === 'expired' && !restarted) {
        // Gone mid-way (rare: it lives about a week). Start once more from the top.
        restarted = true;
        const opened = await client.startSession({ token, metadata, bytes: size });
        if (!opened.ok) return opened;
        sessionUrl = opened.sessionUrl;
        saveSession({ sessionUrl, bytes: size });
        offset = 0;
        continue;
      }
      return { ...sent, resumedFrom, sentBytes };
    }
    sentBytes += length;
    if (sent.state === 'done') return { ok: true, video: sent.video, resumedFrom, sentBytes, restarted };
    // YouTube may keep less than it was sent; carry on from where IT says.
    offset = sent.nextByte;
    if ((await onProgress(offset)) === false) return { ok: false, kind: 'machine', leaseLost: true, why: 'the job\'s lease was lost mid-upload', resumedFrom, sentBytes };
  }
  // Every byte was sent and the last answer was still "partial": ask once.
  const asked = await client.querySession({ token, sessionUrl, bytes: size });
  if (asked.ok && asked.state === 'done') return { ok: true, video: asked.video, resumedFrom, sentBytes, restarted };
  if (asked.ok) return { ok: false, kind: 'machine', why: `every byte was sent but YouTube has only ${asked.nextByte} of ${size}`, resumedFrom, sentBytes };
  return { ...asked, resumedFrom, sentBytes };
}

/**
 * How long until the day's YouTube allowance resets: midnight Pacific time
 * (Google's quota page), plus five minutes so the retry lands after it.
 */
function msUntilQuotaReset(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (type) => Number((parts.find((p) => p.type === type) || {}).value) || 0;
  const sinceMidnightMs = (((get('hour') % 24) * 60 + get('minute')) * 60 + get('second')) * 1000;
  return Math.max(60 * 1000, 24 * 60 * 60 * 1000 - sinceMidnightMs) + 5 * 60 * 1000;
}

module.exports = {
  createYoutubeClient,
  uploadResumable,
  classify,
  nextByteFrom,
  msUntilQuotaReset,
  readSlice,
  CHUNK_BYTES,
  QUOTA_REASONS,
  FIX_SIGN_IN,
};
