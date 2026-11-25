'use strict';

/**
 * Booking calendar — the operator's API. Slice 1 of 6 (SC-909).
 *
 *   GET   /api/booking/calendars                      this project's calendars
 *   POST  /api/booking/calendars                      add one (defaults + any settings sent)
 *   GET   /api/booking/calendars/:id                  one calendar's settings
 *   PATCH /api/booking/calendars/:id                  save some of its settings; answers
 *                                                     with what the database now holds
 *   GET   /api/booking/calendars/:id/bookings         its bookings (?from=&to=&status=&limit=)
 *   GET   /api/booking/calendars/:id/availability     its free times (?from=&to=), the same
 *                                                     answer the visitor module will get
 *   POST  /api/booking/bookings/:id/cancel            cancel a booking, freeing its time
 *                                                     (and removing its Google event)
 *   POST  /api/booking/bookings/:id/google-sync       Retry: give a booking its Google
 *                                                     event and Meet link (SC-913)
 *   GET   /api/booking/google                         is Google Calendar connected, as whom
 *   POST  /api/booking/google/connect                 where to send the browser to connect
 *   DELETE /api/booking/google                        disconnect: revoke at Google, forget it
 *
 * WHY NOT /api/admin/booking. On the server, every /api/admin path skips the
 * step that resolves the request's project (routes/index.js, `isAdminRoute`),
 * so a route there would have no tenant to filter by. The Builder's admin
 * panels call /api/admin/booking/..., and lib/builder-client/adapters/
 * builder-admin-fetch.ts rewrites that to here, adding the project headers.
 *
 * Every call is scoped to the active project; another project's calendar or
 * booking is a 404 exactly like one that does not exist. No public access:
 * visitors read free times and book through routes/bookingPublic.js
 * (/api/public/booking, SC-911), a separate narrow door.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const store = require('../lib/bookingStore');
const { freeSlots, MAX_RANGE_DAYS } = require('../lib/bookingAvailability');
const googleSync = require('../lib/bookingGoogleSync');

const DAY = 86400000;

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
}

/** Send a store envelope: the data on success, its error otherwise. */
function sendResult(res, result, { notFound } = {}) {
  if (!result.ok) {
    const status = result.status || 500;
    return sendErr(res, status, result.error || 'The booking calendar could not be read', {
      code: status === 404 ? 'NOT_FOUND' : status === 400 ? 'INVALID' : status === 409 ? 'CONFLICT' : undefined,
    });
  }
  if (result.data === null && notFound) return sendErr(res, 404, notFound, { code: 'NOT_FOUND' });
  return sendOk(res, 200, result.data);
}

async function readBody(req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendErr(res, 400, 'Send the settings as a JSON object', { code: 'INVALID' });
      return null;
    }
    return body;
  } catch (error) {
    sendErr(res, 400, error.message || 'The request body could not be read', { code: 'INVALID' });
    return null;
  }
}

function listLimit(params) {
  const raw = params.get('limit');
  return raw === null || raw === '' ? 200 : Number(raw);
}

async function sendAvailability(req, res, calendarId, params, scope) {
  const now = Date.now();
  const from = params.get('from') ? Date.parse(params.get('from')) : now;
  const to = params.get('to') ? Date.parse(params.get('to')) : from + 14 * DAY;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return sendErr(res, 400, 'from and to must be dates and times', { code: 'INVALID' });
  }
  if (to - from > MAX_RANGE_DAYS * DAY) {
    return sendErr(res, 400, `Ask for at most ${MAX_RANGE_DAYS} days at a time`, { code: 'INVALID' });
  }
  const calendar = await store.getCalendarById(calendarId, scope);
  if (!calendar.ok || !calendar.data) {
    return sendResult(res, calendar, { notFound: 'That booking calendar does not exist in this project' });
  }
  // A meeting that starts the day before the range can still run into it.
  const booked = await store.listBookings(500, calendar.data.id, {
    from: new Date(from - DAY).toISOString(),
    to: new Date(to).toISOString(),
    status: 'booked',
  }, scope);
  // "Could not read the bookings" must never read as "everything is free".
  if (!booked.ok) return sendErr(res, booked.status || 500, `Could not read the bookings: ${booked.error}`);
  const google = await googleSync.busyTimes(scope, from, to);
  try {
    const slots = freeSlots({ calendar: calendar.data, bookings: booked.data, busy: google.busy, from, to, now });
    return sendOk(res, 200, {
      calendarId: calendar.data.id,
      timeZone: calendar.data.timeZone,
      // 'used': Google busy times are hidden; 'unavailable': Google could not
      // be asked, so they are not; 'none': no Google Calendar connected.
      googleBusy: !google.connected ? 'none' : google.unavailable ? 'unavailable' : 'used',
      ...(google.unavailable ? { googleBusyError: google.unavailable } : {}),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      slots,
    });
  } catch (error) {
    return sendErr(res, 400, error.message, { code: 'INVALID' });
  }
}

/** The Booking Manager's Google Calendar card (SC-913). Never sends a token. */
async function handleGoogle(req, res, pathname, method, scope) {
  if (pathname === '/api/booking/google/connect') {
    if (method !== 'POST') return sendErr(res, 405, 'Connect with POST', { code: 'METHOD_NOT_ALLOWED' });
    if (checkEndpointLimit(req, res, 'booking.write')) return undefined;
    let body = {};
    try { body = (await parseJsonBody(req)) || {}; } catch { body = {}; }
    const started = googleSync.startConnect(scope, {
      returnTo: typeof body.returnTo === 'string' ? body.returnTo : '',
      requestOrigin: req.headers?.origin || '',
    });
    if (!started.ok) return sendErr(res, started.status || 400, started.error, { code: started.code || 'CONNECT_START_FAILED' });
    return sendOk(res, 200, started.data);
  }
  if (method === 'GET') return sendResult(res, await googleSync.googleStatus(scope));
  if (method === 'DELETE') {
    if (checkEndpointLimit(req, res, 'booking.write')) return undefined;
    return sendResult(res, await googleSync.disconnect(scope));
  }
  return sendErr(res, 405, 'Use GET or DELETE', { code: 'METHOD_NOT_ALLOWED' });
}

/** Retry the Google step for one booked meeting: its event and Meet link. */
async function handleRetry(res, bookingId, scope) {
  const found = await store.getBookingById(bookingId, scope);
  if (!found.ok || !found.data) return sendResult(res, found, { notFound: 'That booking does not exist in this project' });
  // A cancelled booking is retried only to remove its event from Google, when
  // that removal failed: otherwise its time stays busy for every visitor and
  // nothing could ever clear it (review, SC-913 round 2).
  const cancelled = found.data.status !== 'booked';
  if (cancelled && found.data.googleSyncStatus !== 'failed') {
    return sendErr(res, 409, 'That booking is cancelled, so it gets no Meet link', { code: 'CONFLICT' });
  }
  const calendar = await store.getCalendarById(found.data.calendarId, scope);
  const synced = await googleSync.syncBooking({
    kind: 'retry',
    booking: found.data,
    calendar: calendar.ok ? calendar.data : null,
    scope,
  });
  if (synced.status === 'skipped') {
    return sendErr(res, 409, 'Google Calendar is not connected, so there is nothing to retry. Connect it first.', { code: 'NOT_CONNECTED' });
  }
  if (synced.status === 'failed') {
    const lead = cancelled ? 'Still on Google Calendar' : synced.meetLink ? 'Google Calendar still not updated' : 'Still no Meet link';
    return sendErr(res, 502, `${lead}: ${synced.error}`, { code: 'GOOGLE_SYNC_FAILED' });
  }
  return sendOk(res, 200, synced.booking);
}

/** true when this module answered the request. */
async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/booking/')) return false;
  const scope = requestScope(req);
  if (!scope.projectId) {
    sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' });
    return true;
  }
  const params = getUrlObj(req).searchParams;

  if (pathname === '/api/booking/calendars') {
    if (method === 'GET') {
      sendResult(res, await store.listCalendars(listLimit(params), scope));
      return true;
    }
    if (method === 'POST') {
      if (checkEndpointLimit(req, res, 'booking.write')) return true;
      const body = await readBody(req, res);
      if (!body) return true;
      sendResult(res, await store.createCalendar(body, scope));
      return true;
    }
    sendErr(res, 405, 'Use GET or POST', { code: 'METHOD_NOT_ALLOWED' });
    return true;
  }

  const calendarMatch = pathname.match(/^\/api\/booking\/calendars\/([^/]+)(?:\/(bookings|availability))?$/);
  if (calendarMatch) {
    const calendarId = decodeURIComponent(calendarMatch[1]);
    const sub = calendarMatch[2] || '';
    if (sub === 'bookings' && method === 'GET') {
      sendResult(res, await store.listBookings(listLimit(params), calendarId, {
        from: params.get('from') || undefined,
        to: params.get('to') || undefined,
        status: params.get('status') || undefined,
      }, scope));
      return true;
    }
    if (sub === 'availability' && method === 'GET') {
      if (checkEndpointLimit(req, res, 'booking.availability')) return true;
      await sendAvailability(req, res, calendarId, params, scope);
      return true;
    }
    if (!sub && method === 'GET') {
      sendResult(res, await store.getCalendarById(calendarId, scope), {
        notFound: 'That booking calendar does not exist in this project',
      });
      return true;
    }
    if (!sub && (method === 'PATCH' || method === 'PUT')) {
      if (checkEndpointLimit(req, res, 'booking.write')) return true;
      const body = await readBody(req, res);
      if (!body) return true;
      sendResult(res, await store.saveCalendarSettings(calendarId, body, scope));
      return true;
    }
    sendErr(res, 405, sub ? `Use GET for ${sub}` : 'Use GET or PATCH', { code: 'METHOD_NOT_ALLOWED' });
    return true;
  }

  if (pathname === '/api/booking/google' || pathname === '/api/booking/google/connect') {
    await handleGoogle(req, res, pathname, method, scope);
    return true;
  }

  const cancelMatch = pathname.match(/^\/api\/booking\/bookings\/([^/]+)\/cancel$/);
  if (cancelMatch) {
    if (method !== 'POST') {
      sendErr(res, 405, 'Cancel with POST', { code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    if (checkEndpointLimit(req, res, 'booking.write')) return true;
    const cancelled = await store.cancelBooking(decodeURIComponent(cancelMatch[1]), scope);
    if (!cancelled.ok) {
      sendResult(res, cancelled);
      return true;
    }
    // Remove its Google event too (SC-913); a failure is marked on the booking.
    const synced = await googleSync.syncBooking({ kind: 'cancelled', booking: cancelled.data, calendar: null, scope });
    sendOk(res, 200, synced.booking || cancelled.data);
    return true;
  }

  const syncMatch = pathname.match(/^\/api\/booking\/bookings\/([^/]+)\/google-sync$/);
  if (syncMatch) {
    if (method !== 'POST') {
      sendErr(res, 405, 'Retry with POST', { code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    if (checkEndpointLimit(req, res, 'booking.write')) return true;
    await handleRetry(res, decodeURIComponent(syncMatch[1]), scope);
    return true;
  }

  sendErr(res, 404, 'No such booking calendar endpoint', { code: 'NOT_FOUND' });
  return true;
}

module.exports = {
  handle,
  manifest: {
    id: 'booking',
    label: 'Booking calendar',
    prefixes: ['/api/booking'],
  },
};
