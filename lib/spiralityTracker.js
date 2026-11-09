'use strict';

/**
 * StarCaster's server talking to a Spirality tracker on a visitor's behalf
 * (routes/spirality.js, for the Spirality Tasks module).
 *
 * The browser never calls the tracker: the tracker has no CORS on purpose,
 * and its session token must never reach page script. So the token travels
 * only between this file and the tracker — forwarded as
 * `cookie: tracker_session=…`, the same way the tracker's own page sends it.
 *
 * Shapes are the tracker's own (spirality `tracker/server.mjs`, the API table
 * in `docs/TRACKER_MVP.md`; `docs/OUTSIDE_SITE_API.md` once SP-151 ships).
 * Every answer is `{ ok, status, data }` or `{ ok:false, status, code, message }`,
 * and a refusal carries the tracker's own sentence, so the module can show
 * "Too many tries for that email…" exactly as the tracker wrote it.
 */

const TRACKER_COOKIE = 'tracker_session';
const TIMEOUT_MS = 10_000;

const UNREACHABLE = "Spirality can't be reached right now. Try again in a few minutes.";
const NOT_CONNECTED = 'Spirality is not connected to this site yet.';

/** The `tracker_session` value off a tracker answer's set-cookie lines, or ''. */
function sessionFromSetCookie(lines) {
  for (const line of lines || []) {
    const first = String(line).split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq > 0 && first.slice(0, eq) === TRACKER_COOKIE) return first.slice(eq + 1);
  }
  return '';
}

function setCookieLines(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const one = headers.get('set-cookie');
  return one ? [one] : [];
}

/**
 * A client for one tracker. `baseUrl` empty means no tracker is configured,
 * and every call answers NOT_CONNECTED without a request. `siteToken` is
 * StarCaster's own site actor's token, sent as a bearer only on forgot-password
 * (so the reset link opens the site's page), and only when it is set.
 */
function createTrackerClient({ baseUrl, siteToken = '', fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const token = String(siteToken || '').trim();

  async function call(method, path, { session = '', body, site = false } = {}) {
    if (!base) return { ok: false, status: 503, code: 'NOT_CONNECTED', message: NOT_CONNECTED };
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    if (session) headers.cookie = `${TRACKER_COOKIE}=${session}`;
    if (site && token) headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, status: 502, code: 'UNREACHABLE', message: UNREACHABLE };
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const message = json && typeof json.message === 'string' && json.message.trim()
        ? json.message.trim()
        : `Spirality refused that (${res.status}).`;
      return { ok: false, status: res.status, code: (json && json.error) || 'TRACKER_ERROR', message };
    }
    if (!json || typeof json !== 'object') {
      return { ok: false, status: 502, code: 'BAD_ANSWER', message: 'Spirality answered with something unexpected. Try again in a few minutes.' };
    }
    return { ok: true, status: res.status, data: json, session: sessionFromSetCookie(setCookieLines(res.headers)) };
  }

  return { call, hasSiteToken: Boolean(token), configured: Boolean(base) };
}

module.exports = {
  createTrackerClient,
  sessionFromSetCookie,
  TRACKER_COOKIE,
  UNREACHABLE,
  NOT_CONNECTED,
};
