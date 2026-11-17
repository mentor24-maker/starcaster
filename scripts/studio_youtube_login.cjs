#!/usr/bin/env node
'use strict';

/**
 * One-time: sign in to the Google account that owns the Dane of Earth YouTube
 * channel, and store the resulting refresh token in Doppler production as
 * YOUTUBE_UPLOAD_REFRESH_TOKEN. Reel Spinner 6b (SC-841).
 *
 * This is the browser-login step, so it is Dane's to run (CLAUDE.md names a
 * browser login as one of the four hand-offs). Everything after it — the probe,
 * the test upload — an agent session runs.
 *
 * Deliberately self-contained (Node built-ins only, nothing required from the
 * repo), so it can run straight from git without a checkout of its branch:
 *
 *   git -C ~/WebApps/starcaster fetch -q origin <branch> && \
 *     git -C ~/WebApps/starcaster show origin/<branch>:scripts/studio_youtube_login.cjs \
 *     | doppler run --project starcaster --config prd -- node -
 *
 * or, once merged:  npm run studio:youtube-login
 *
 * What it does:
 *   1. Opens Google's sign-in page in the browser on THIS machine.
 *   2. Waits for Google to hand back a one-time code on localhost:53682.
 *   3. Swaps the code for a refresh token, in memory.
 *   4. Asks YouTube which channel that sign-in belongs to, and REFUSES to store
 *      it unless it is "Dane of Earth" — a sign-in for the wrong channel is the
 *      likeliest mistake, and it would upload to the wrong place.
 *   5. Pipes the token into `doppler secrets set` on stdin. It is never printed,
 *      never written to a file, never passed on a command line.
 *
 * The OAuth client is the existing one (GOOGLE_DRIVE_CLIENT_ID / _SECRET, the
 * starcaster-498505 Google Cloud project) — the same client the Drive sign-in
 * and comment posting use. Only the permission asked for is different.
 */

const http = require('http');
const { spawn } = require('child_process');

const EXPECTED_CHANNEL = 'Dane of Earth';
const SETTING = 'YOUTUBE_UPLOAD_REFRESH_TOKEN';
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
// `youtube` (manage the channel) rather than `youtube.upload` alone: the Mini
// also has to read which channel it is, change a video from Private to public
// after Dane approves it (6c), and delete the 6b test video. `youtube.upload`
// permits none of those.
const SCOPES = ['https://www.googleapis.com/auth/youtube'];
const WAIT_MS = 10 * 60 * 1000;

function fail(message) {
  console.error(`\nstudio:youtube-login: ${message}`);
  process.exit(1);
}

const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
if (!clientId || !clientSecret) {
  fail('GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET are not set. Run this inside `doppler run --project starcaster --config prd --`.');
}

const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES.join(' '),
  access_type: 'offline',
  prompt: 'consent select_account',
  state,
}).toString();

async function exchange(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google refused the code (${res.status}): ${json.error_description || json.error || 'no reason given'}`);
  if (!json.refresh_token) throw new Error('Google returned no refresh token. Remove the app at https://myaccount.google.com/permissions and run this again.');
  return json;
}

async function channelTitles(accessToken) {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50', {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube said ${res.status}: ${(json.error && json.error.message) || 'no reason given'}`);
  return (json.items || []).map((item) => (item.snippet && item.snippet.title) || '');
}

function storeInDoppler(token) {
  return new Promise((resolve, reject) => {
    // Value on stdin, never argv: argv is visible to every process on the machine.
    const child = spawn('doppler', ['secrets', 'set', SETTING, '--project', 'starcaster', '--config', 'prd', '--silent'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => reject(new Error(`could not start doppler: ${err.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`doppler refused the write (exit ${code}): ${stderr.trim().slice(0, 300)}`))));
    child.stdin.end(token);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return; }
  const reply = (text) => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
  try {
    if (url.searchParams.get('state') !== state) throw new Error('the sign-in came back with the wrong state; run this again');
    if (url.searchParams.get('error')) throw new Error(`Google said: ${url.searchParams.get('error')}`);
    const tokens = await exchange(url.searchParams.get('code') || '');
    const titles = await channelTitles(tokens.access_token);
    if (!titles.includes(EXPECTED_CHANNEL)) {
      throw new Error(`that sign-in belongs to ${titles.length ? `"${titles.join('", "')}"` : 'no YouTube channel'}, not "${EXPECTED_CHANNEL}". Nothing was stored. Run it again and pick ${EXPECTED_CHANNEL} when Google asks which account or channel.`);
    }
    await storeInDoppler(tokens.refresh_token);
    reply(`Done. Reel Spinner can now reach ${EXPECTED_CHANNEL}. You can close this tab.`);
    console.log(`\nStored ${SETTING} in Doppler (starcaster / prd) for the channel "${EXPECTED_CHANNEL}". The token was not printed.`);
    console.log('Reply "done" on the ticket; an agent session runs the check and the test upload from here.');
    server.close();
    process.exit(0);
  } catch (err) {
    reply(`Not stored: ${err.message}`);
    server.close();
    fail(err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Opening Google sign-in in your browser. Sign in as the account that owns "${EXPECTED_CHANNEL}",`);
  console.log(`and if Google asks which channel, pick "${EXPECTED_CHANNEL}".`);
  console.log('If Google warns the app is not verified: click Advanced, then Go to (the app name).');
  console.log(`\nIf no browser opens, paste this address into one on this same computer:\n${authUrl}\n`);
  spawn('open', [authUrl], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
setTimeout(() => fail('no sign-in arrived within 10 minutes; nothing was stored'), WAIT_MS).unref();
