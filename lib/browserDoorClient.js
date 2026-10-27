'use strict';

/**
 * Starcaster's half of the signed "open" request to the door keeper on the Mac
 * Mini (Outreach wizard 4/19 · sign-in window slice 2, task 86bcrmbc9).
 *
 * The door keeper (workers/browser-door/, slice 1) answers exactly one thing
 * from the internet between sign-ins: a POST /open signed with a secret only
 * the Mini and Vercel hold — HMAC-SHA256 of `<timestamp>.<body>`, sent as
 * `x-door-timestamp` and `x-door-signature`, accepted within 60 seconds. The
 * signing is three lines and is written again here rather than required from
 * workers/, because the worker folder is not part of the Vercel bundle; a test
 * (scripts/builder/browserView.test.js) holds this copy byte-equal to
 * door.signOpen so the two cannot drift.
 *
 * Environment:
 *   BROWSER_DOOR_URL     the door keeper's public base address (its Funnel path,
 *                        slice 3) — `/open` and `/live` are added to it
 *   BROWSER_DOOR_SECRET  the shared secret; never sent anywhere but the header
 *                        signature, never logged
 */

const crypto = require('node:crypto');

const OPEN_TIMEOUT_MS = 8000;

function doorConfig(env = process.env) {
  const baseUrl = String(env.BROWSER_DOOR_URL || '').trim().replace(/\/+$/, '');
  const secret = String(env.BROWSER_DOOR_SECRET || '').trim();
  const missing = [];
  if (!baseUrl) missing.push('BROWSER_DOOR_URL');
  if (!secret) missing.push('BROWSER_DOOR_SECRET');
  return { baseUrl, secret, missing };
}

function signOpen(secret, timestamp, body) {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex');
}

/** Where the viewer's WebSocket goes: the same address, ws(s) scheme, `/live`. */
function viewerUrl(baseUrl) {
  return `${String(baseUrl).replace(/^http/i, 'ws')}/live`;
}

/**
 * Tell the door keeper "this pass may open this project's profile on this site".
 * -> { ok: true } | { ok: false, reason: 'not-configured'|'door-unreachable'|'door-refused', error }
 *
 * `reason` is the close reason the route records when the window could not open.
 */
async function sendOpen({ pass, projectId, site }, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const config = doorConfig(env);
  if (config.missing.length) {
    return {
      ok: false,
      reason: 'not-configured',
      error: `The sign-in window is not set up on this server yet: ${config.missing.join(' and ')} `
        + `${config.missing.length === 1 ? 'is' : 'are'} not set.`,
    };
  }
  const body = JSON.stringify({ pass, project_id: projectId, site });
  const timestamp = String(now());
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-door-timestamp': timestamp,
        'x-door-signature': signOpen(config.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      reason: 'door-unreachable',
      error: timedOut
        ? `The Mac Mini did not answer within ${OPEN_TIMEOUT_MS / 1000} seconds.`
        : `The Mac Mini could not be reached (${String(err && err.message || err).slice(0, 200)}).`,
    };
  }
  if (response.ok) return { ok: true };

  let detail = '';
  try {
    const parsed = await response.json();
    detail = String(parsed?.error?.message || '').slice(0, 200);
  } catch { /* the door keeper's refusals carry no body worth reading */ }
  // 401 is the signature: the two secrets differ, or a clock is more than a minute out.
  const why = response.status === 401
    ? 'it did not accept Starcaster\'s signature (the shared secret differs, or a clock is out by more than a minute)'
    : `it answered ${response.status}${detail ? `: ${detail}` : ''}`;
  return { ok: false, reason: 'door-refused', error: `The Mac Mini refused to open the window: ${why}.` };
}

module.exports = { OPEN_TIMEOUT_MS, doorConfig, signOpen, viewerUrl, sendOpen };
