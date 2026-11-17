#!/usr/bin/env node
'use strict';

/**
 * The one test upload Reel Spinner 6b (SC-841) asks for: can a video the Mini
 * uploads as Private later be made visible, or does YouTube lock it?
 *
 *   npm run studio:youtube-test-upload
 *
 * 1. Makes a 5-second test-pattern video with ffmpeg, in a temporary folder.
 * 2. Uploads it to the sign-in's channel as PRIVATE.
 * 3. Asks YouTube to change it to UNLISTED and reads the answer back.
 *    Unlisted, not public: the lock this tests (videos from an unaudited
 *    Google Cloud project held at Private) blocks every visibility but Private,
 *    so unlisted answers the same question without the test video ever being
 *    findable by the public.
 * 4. Deletes the video and confirms YouTube no longer has it.
 *
 * Exit 0: it could be made visible (not locked). 1: YouTube kept it Private
 * (locked). 2: could not tell — and if a video was left behind, its id is
 * printed so it can be deleted by hand.
 *
 * Uses YOUTUBE_UPLOAD_REFRESH_TOKEN only, never the Drive sign-in. No token is
 * printed. Quota: one upload, two updates/deletes, a few reads.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EXPECTED_CHANNEL } = require('../lib/youtubeUploadAccess');

const API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 60000;

async function call(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, json };
}

function why(res) {
  const err = res.json && res.json.error;
  return `${res.status}: ${(err && (err.message || (err.errors && err.errors[0] && err.errors[0].reason))) || res.json.raw || 'no reason given'}`;
}

async function accessToken() {
  const refresh = String(process.env.YOUTUBE_UPLOAD_REFRESH_TOKEN || '').trim();
  if (!refresh) throw new Error('YOUTUBE_UPLOAD_REFRESH_TOKEN is not set (run studio:youtube-login first)');
  const res = await call('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok || !res.json.access_token) throw new Error(`Google refused the sign-in (${why(res)})`);
  return res.json.access_token;
}

function makeTestVideo(dir) {
  const file = path.join(dir, 'reel-spinner-upload-test.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  return file;
}

async function upload(token, file) {
  const boundary = `reelspinner${Date.now()}`;
  const metadata = {
    snippet: {
      title: 'Reel Spinner upload test — delete me',
      description: 'A 5-second test pattern uploaded by StarCaster (SC-841). It is deleted straight away.',
      categoryId: '22',
    },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
  };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`),
    fs.readFileSync(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return call('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

async function readStatus(token, id) {
  return call(`${API}/videos?part=status&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function main() {
  const token = await accessToken();
  const mine = await call(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${token}` } });
  const titles = mine.ok ? (mine.json.items || []).map((i) => i.snippet && i.snippet.title) : [];
  if (!titles.includes(EXPECTED_CHANNEL)) {
    console.log(`refused: this sign-in is for ${mine.ok ? `"${titles.join('", "')}"` : `an unknown channel (${why(mine)})`}, not "${EXPECTED_CHANNEL}"; nothing uploaded`);
    return 2;
  }
  console.log(`channel:  ${EXPECTED_CHANNEL}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-spinner-yt-'));
  let videoId = '';
  let verdict = 2;
  try {
    const up = await upload(token, makeTestVideo(dir));
    if (!up.ok || !up.json.id) {
      console.log(`upload:   FAILED (${why(up)})`);
      return 2;
    }
    videoId = up.json.id;
    console.log(`upload:   ok, video ${videoId}, YouTube says privacy "${up.json.status && up.json.status.privacyStatus}", upload "${up.json.status && up.json.status.uploadStatus}"`);

    const change = await call(`${API}/videos?part=status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: videoId, status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false } }),
    });
    console.log(`change:   asked for unlisted — ${change.ok ? `YouTube answered privacy "${change.json.status && change.json.status.privacyStatus}"` : `refused (${why(change)})`}`);

    const after = await readStatus(token, videoId);
    const status = after.ok && after.json.items && after.json.items[0] && after.json.items[0].status;
    if (!status) {
      console.log(`readback: could not read the video's status (${after.ok ? 'no such video' : why(after)})`);
    } else {
      console.log(`readback: privacy "${status.privacyStatus}", upload "${status.uploadStatus}"${status.rejectionReason ? `, rejection "${status.rejectionReason}"` : ''}${status.failureReason ? `, failure "${status.failureReason}"` : ''}`);
      if (status.privacyStatus === 'unlisted') verdict = 0;
      else if (status.privacyStatus === 'private') verdict = 1;
    }
  } finally {
    if (videoId) {
      const del = await call(`${API}/videos?id=${encodeURIComponent(videoId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const gone = await readStatus(token, videoId);
      const stillThere = !gone.ok || (gone.json.items || []).length > 0;
      console.log(`delete:   ${del.ok ? 'ok' : `FAILED (${why(del)})`}; ${stillThere ? `STILL THERE — delete video ${videoId} by hand in YouTube Studio` : 'confirmed gone'}`);
      if (stillThere) verdict = 2;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`verdict:  ${verdict === 0 ? 'NOT LOCKED — an upload can be made visible' : verdict === 1 ? 'LOCKED — YouTube kept it Private; the API audit is needed' : 'CANNOT TELL'}`);
  return verdict;
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(`studio:youtube-test-upload could not run: ${err.message}`);
  process.exitCode = 2;
});
