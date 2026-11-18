#!/usr/bin/env node
'use strict';

/**
 * Read-only: can the Mac Mini upload to the Dane of Earth YouTube channel?
 * Reel Spinner 6b (SC-841).
 *
 *   npm run studio:youtube-check
 *
 * Prints which setting the sign-in came from (its NAME, never its value), the
 * channel it belongs to, and whether it carries upload permission. Exit 0
 * ready, 1 not ready (Google answered, and the answer is no), 2 could not tell.
 *
 * Writes nothing and uploads nothing. The token is exchanged for a short-lived
 * access token in memory and neither is ever printed.
 */

const {
  EXPECTED_CHANNEL, TOKEN_SOURCES, pickTokenSource, judgeUploadAccess, exitCodeFor,
} = require('../lib/youtubeUploadAccess');

const TIMEOUT_MS = 15000;

async function refreshAccessToken(refreshToken) {
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET is not set' };
  }
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
  });
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      return { ok: false, error: `Google refused the sign-in (${res.status}): ${json.error_description || json.error || 'no reason given'}` };
    }
    return { ok: true, accessToken: json.access_token };
  } catch (err) {
    return { ok: false, error: `could not reach Google: ${err.message}` };
  }
}

async function readScopes(accessToken) {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Google said ${res.status}: ${json.error_description || json.error || 'no reason given'}` };
    return { ok: true, scopes: String(json.scope || '').split(/\s+/).filter(Boolean) };
  } catch (err) {
    return { ok: false, error: `could not reach Google: ${err.message}` };
  }
}

async function readChannels(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50', {
      headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = (json.error && (json.error.message || (json.error.errors && json.error.errors[0] && json.error.errors[0].message))) || 'no reason given';
      return { ok: false, error: `YouTube said ${res.status}: ${why}` };
    }
    const items = Array.isArray(json.items) ? json.items : [];
    return { ok: true, titles: items.map((item) => (item && item.snippet && item.snippet.title) || '') };
  } catch (err) {
    return { ok: false, error: `could not reach YouTube: ${err.message}` };
  }
}

async function main() {
  const source = pickTokenSource(process.env);
  if (!source) {
    console.log(`token:   none — neither ${TOKEN_SOURCES.map((s) => s.name).join(' nor ')} is set`);
    console.log('verdict: CANNOT TELL');
    return 2;
  }
  console.log(`token:   ${source.name} (${source.why})`);

  const access = await refreshAccessToken(String(process.env[source.name]).trim());
  const judged = access.ok
    ? judgeUploadAccess({ scopes: await readScopes(access.accessToken), channels: await readChannels(access.accessToken) })
    : judgeUploadAccess({ scopes: { ok: false, error: access.error }, channels: { ok: false, error: access.error } });

  console.log(`channel: ${judged.channel || '(unknown)'}`);
  console.log(`upload:  ${judged.upload}`);
  for (const reason of judged.reasons) console.log(`  - ${reason}`);
  console.log(`verdict: ${judged.verdict}${judged.verdict === 'READY' ? ` — the Mini can upload to ${EXPECTED_CHANNEL}` : ''}`);
  return exitCodeFor(judged.verdict);
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(`studio:youtube-check could not run: ${err.message}`);
  process.exitCode = 2;
});
