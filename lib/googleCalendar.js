'use strict';

/**
 * Google Calendar, the HTTP calls. Booking calendar, slice 5 of 6 (SC-913).
 *
 * Every call a project's own Google Calendar connection makes lives here, and
 * nothing here stores or reads anything: the token handed in is the one used,
 * and the answer is always the `{ ok, status, data, error }` envelope
 * (lib/connections/contract.js), never a throw. Two callers:
 *
 *   lib/connections/adapters/googleCalendar.js   sign-in, renewal, revoke
 *   lib/bookingGoogleSync.js                     events with a Meet link, busy times
 *
 * THE APP. A project signs in to ITS Google account through Starcaster's own
 * Google Cloud OAuth app, whose id and secret are GOOGLE_CALENDAR_CLIENT_ID and
 * GOOGLE_CALENDAR_CLIENT_SECRET. Deliberately not the Drive app's variables
 * (GOOGLE_DRIVE_*): those belong to Starcaster's own Drive, and borrowing them
 * would make a calendar sign-in fail with a Google error about a redirect
 * address that names none of this. No platform-wide token is used for a
 * calendar, ever: each project's refresh token is its own.
 *
 * `fetchImpl` is injectable on every call so the tests can answer for Google
 * without a network.
 */

const contract = require('./connections/contract');

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const API = 'https://www.googleapis.com/calendar/v3';

/** Make and change events (with Meet links), and read free/busy. Nothing else. */
const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
const SCOPES = Object.freeze(['openid', 'email', EVENTS_SCOPE, FREEBUSY_SCOPE]);
/** Google access tokens last an hour; used when Google does not say. */
const TYPICAL_TOKEN_LIFETIME_SECONDS = 3600;
/** A free/busy question spanning more than this is asked in pieces. */
const FREEBUSY_CHUNK_DAYS = 30;
const DAY = 86400000;

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

function appCredentials() {
  return {
    clientId: safeText(process.env.GOOGLE_CALENDAR_CLIENT_ID),
    clientSecret: safeText(process.env.GOOGLE_CALENDAR_CLIENT_SECRET),
  };
}

function isConfigured(creds = appCredentials()) {
  return Boolean(creds.clientId && creds.clientSecret);
}

function notConfigured() {
  return contract.fail(
    503,
    'Google Calendar is not set up on this Starcaster server yet: it needs GOOGLE_CALENDAR_CLIENT_ID and '
      + 'GOOGLE_CALENDAR_CLIENT_SECRET from a Google Cloud OAuth app with the Google Calendar API turned on.',
    { code: 'GOOGLE_NOT_CONFIGURED' }
  );
}

/** Google's own words for a failure, from whichever of its shapes arrived. */
function describeGoogleError(payload, response) {
  const err = payload?.error;
  if (err && typeof err === 'object') {
    return safeText(err.message) || safeText(err.status) || 'Google refused the request';
  }
  const oauth = [safeText(err), safeText(payload?.error_description)].filter(Boolean).join(': ');
  return oauth || safeText(response?.statusText) || 'Google refused the request';
}

/**
 * How long any one Google call may take before it counts as Google being
 * unreachable. Every Google call sits on a visitor's or operator's request (the
 * public calendar load, Book, reschedule, cancel), so a Google that HANGS
 * rather than refusing must not hang the client's booking page until the
 * platform kills the function, leaving a saved booking with no emails and no
 * answer. Review, SC-913 round 1.
 */
const GOOGLE_TIMEOUT_MS = 5000;

/** The bound in force: GOOGLE_CALENDAR_TIMEOUT_MS when set (tests), 0.05-30 s. */
function timeoutMs() {
  const set = Number(process.env.GOOGLE_CALENDAR_TIMEOUT_MS);
  return Number.isFinite(set) && set > 0 ? Math.min(30000, Math.max(50, set)) : GOOGLE_TIMEOUT_MS;
}

/**
 * One Google call, bounded by `timeoutMs` from the first byte asked to the
 * last byte read. The signal aborts the request itself; the race is what holds
 * the bound when a fetch (or its body) does not honour the signal.
 */
async function fetchJson(url, options = {}, fetchImpl = fetch, limitMs = timeoutMs()) {
  const controller = new AbortController();
  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(contract.fail(504, `Google did not answer within ${Math.round(limitMs / 100) / 10} seconds`, { code: 'GOOGLE_UNREACHABLE' }));
    }, limitMs);
  });
  const call = (async () => {
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (err) {
      return contract.fail(502, `Google could not be reached: ${safeText(err?.message) || err}`, { code: 'GOOGLE_UNREACHABLE' });
    }
    let payload = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      return contract.fail(response.status || 502, describeGoogleError(payload, response), {
        data: payload,
        ...(response.status === 401 ? { code: 'GOOGLE_TOKEN_REFUSED' } : {}),
      });
    }
    return contract.ok(response.status || 200, payload);
  })();
  try {
    return await Promise.race([call, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function bearer(accessToken) {
  return { Authorization: `Bearer ${safeText(accessToken)}`, Accept: 'application/json' };
}

/** When a token Google just issued expires, as an ISO instant. */
function expiryFrom(payload, nowMs = Date.now()) {
  const seconds = Number(payload?.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : TYPICAL_TOKEN_LIFETIME_SECONDS;
  return new Date(nowMs + lifetime * 1000).toISOString();
}

// ── Sign-in ─────────────────────────────────────────────────────────────────

/**
 * Where to send the browser. `access_type=offline` and `prompt=consent` are
 * both needed for Google to hand over a refresh token every time, including
 * for an account that connected before; without one the connection dies an
 * hour later.
 */
function authorizeUrl({ state, redirectUri, creds = appCredentials() } = {}) {
  if (!isConfigured(creds)) return notConfigured();
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: safeText(redirectUri),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: safeText(state),
  });
  return contract.ok(200, { authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}` });
}

async function tokenRequest(form, { fetchImpl = fetch, creds = appCredentials() } = {}) {
  if (!isConfigured(creds)) return notConfigured();
  return fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...form }).toString(),
  }, fetchImpl);
}

function exchangeCode({ code, redirectUri }, options = {}) {
  return tokenRequest({ grant_type: 'authorization_code', code: safeText(code), redirect_uri: safeText(redirectUri) }, options);
}

function refreshAccessToken(refreshToken, options = {}) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: safeText(refreshToken) }, options);
}

/** Which Google account a token belongs to: `{ sub, email, picture }`. */
function userInfo(accessToken, { fetchImpl = fetch } = {}) {
  return fetchJson(USERINFO_URL, { method: 'GET', headers: bearer(accessToken) }, fetchImpl);
}

/** Withdraw the permission at Google. Revoking the refresh token ends the whole grant. */
function revokeToken(token, { fetchImpl = fetch } = {}) {
  return fetchJson(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: safeText(token) }).toString(),
  }, fetchImpl);
}

/** The scopes Google says it granted, as a list. A user can untick boxes. */
function grantedScopes(tokenPayload) {
  return safeText(tokenPayload?.scope).split(/\s+/).filter(Boolean);
}

/** The calendar permissions this feature needs that were NOT granted. */
function missingScopes(tokenPayload) {
  const granted = grantedScopes(tokenPayload);
  return [EVENTS_SCOPE, FREEBUSY_SCOPE].filter((scope) => !granted.includes(scope));
}

// ── Events ──────────────────────────────────────────────────────────────────

/** The Meet link on an event Google returned, or ''. */
function meetLinkOf(event) {
  const direct = safeText(event?.hangoutLink);
  if (direct) return direct;
  const points = Array.isArray(event?.conferenceData?.entryPoints) ? event.conferenceData.entryPoints : [];
  return safeText(points.find((p) => p?.entryPointType === 'video')?.uri);
}

/**
 * The event body for one booking. `sendUpdates=none` on every write: the
 * visitor already gets Starcaster's own confirmation (with the Meet link and
 * an add-to-calendar file), and a second invitation from Google for the same
 * meeting would read as a duplicate booking.
 */
function eventBody({ id = '', summary, description = '', startsAt, endsAt, attendee = null, requestId = '' }) {
  const body = {
    ...(safeText(id) ? { id: safeText(id) } : {}),
    summary: safeText(summary) || 'Meeting',
    description: safeText(description),
    start: { dateTime: new Date(startsAt).toISOString() },
    end: { dateTime: new Date(endsAt).toISOString() },
  };
  if (attendee && safeText(attendee.email)) {
    body.attendees = [{ email: safeText(attendee.email), ...(safeText(attendee.name) ? { displayName: safeText(attendee.name) } : {}) }];
  }
  if (requestId) {
    body.conferenceData = { createRequest: { requestId: safeText(requestId), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return body;
}

function eventsUrl(eventId = '', query = '') {
  const id = eventId ? `/${encodeURIComponent(eventId)}` : '';
  return `${API}/calendars/primary/events${id}${query ? `?${query}` : ''}`;
}

/** Make an event on the account's main calendar, asking Google for a Meet link. */
function createEvent(accessToken, fields, { fetchImpl = fetch } = {}) {
  return fetchJson(eventsUrl('', 'conferenceDataVersion=1&sendUpdates=none'), {
    method: 'POST',
    headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody(fields)),
  }, fetchImpl);
}

/** Change an event: new times, and/or a fresh Meet request when it has none. */
function patchEvent(accessToken, eventId, fields, { fetchImpl = fetch } = {}) {
  return fetchJson(eventsUrl(eventId, 'conferenceDataVersion=1&sendUpdates=none'), {
    method: 'PATCH',
    headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, fetchImpl);
}

function getEvent(accessToken, eventId, { fetchImpl = fetch } = {}) {
  return fetchJson(eventsUrl(eventId), { method: 'GET', headers: bearer(accessToken) }, fetchImpl);
}

/** Remove an event. One already gone (404, 410) counts as removed. */
async function deleteEvent(accessToken, eventId, { fetchImpl = fetch } = {}) {
  const res = await fetchJson(eventsUrl(eventId, 'sendUpdates=none'), { method: 'DELETE', headers: bearer(accessToken) }, fetchImpl);
  if (!res.ok && (res.status === 404 || res.status === 410)) return contract.ok(200, { alreadyGone: true });
  return res;
}

// ── Busy times ──────────────────────────────────────────────────────────────

/**
 * The busy blocks on the account's main calendar between two instants, as
 * `[{ startsAt, endsAt }]`. A long range is asked in 30-day pieces. Any piece
 * Google refuses fails the whole answer, because half a busy list reads as
 * free time that is not free.
 */
async function freeBusy(accessToken, fromMs, toMs, { fetchImpl = fetch } = {}) {
  // The pieces are asked at the same time, not one after another: each has
  // its own time limit, so asking in turn would let a slow Google hold a
  // visitor's calendar for several limits end to end (review, SC-913 round 2).
  const pieces = [];
  for (let start = fromMs; start < toMs; start += FREEBUSY_CHUNK_DAYS * DAY) {
    pieces.push([start, Math.min(toMs, start + FREEBUSY_CHUNK_DAYS * DAY)]);
  }
  const answers = await Promise.all(pieces.map(([start, end]) => fetchJson(`${API}/freeBusy`, {
    method: 'POST',
    headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      items: [{ id: 'primary' }],
    }),
  }, fetchImpl)));
  const busy = [];
  for (const res of answers) {
    if (!res.ok) return res;
    const cal = res.data?.calendars?.primary || {};
    if (Array.isArray(cal.errors) && cal.errors.length) {
      return contract.fail(502, `Google could not read the calendar's busy times: ${safeText(cal.errors[0]?.reason) || 'unknown reason'}`);
    }
    for (const block of Array.isArray(cal.busy) ? cal.busy : []) {
      const s = Date.parse(block?.start);
      const e = Date.parse(block?.end);
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
        busy.push({ startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() });
      }
    }
  }
  return contract.ok(200, { busy });
}

module.exports = {
  GOOGLE_TIMEOUT_MS,
  fetchJson,
  SCOPES,
  EVENTS_SCOPE,
  FREEBUSY_SCOPE,
  TYPICAL_TOKEN_LIFETIME_SECONDS,
  appCredentials,
  isConfigured,
  notConfigured,
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  userInfo,
  revokeToken,
  grantedScopes,
  missingScopes,
  expiryFrom,
  meetLinkOf,
  eventBody,
  createEvent,
  patchEvent,
  getEvent,
  deleteEvent,
  freeBusy,
};
