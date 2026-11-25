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
  try {
    const slots = freeSlots({ calendar: calendar.data, bookings: booked.data, from, to, now });
    return sendOk(res, 200, {
      calendarId: calendar.data.id,
      timeZone: calendar.data.timeZone,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      slots,
    });
  } catch (error) {
    return sendErr(res, 400, error.message, { code: 'INVALID' });
  }
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

  const cancelMatch = pathname.match(/^\/api\/booking\/bookings\/([^/]+)\/cancel$/);
  if (cancelMatch) {
    if (method !== 'POST') {
      sendErr(res, 405, 'Cancel with POST', { code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    if (checkEndpointLimit(req, res, 'booking.write')) return true;
    sendResult(res, await store.cancelBooking(decodeURIComponent(cancelMatch[1]), scope));
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
