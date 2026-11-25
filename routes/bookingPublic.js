'use strict';

/**
 * Booking calendar — the VISITOR's door. Slice 3 of 6 (SC-911).
 *
 *   GET  /api/public/booking/calendar?projectId=&calendarId=
 *        the calendar's visitor-facing wording and every free time from now
 *        to the end of its booking window (at most 92 days)
 *   POST /api/public/booking/book
 *        { projectId, calendarId, startsAt, name, email, phone?, note?, _trap }
 *        book one free time; the visitor is filed in the project's CRM
 *
 * SECURITY. These answer a visitor on a client's public site, who has no
 * login. They sit under /api/public/, which routes/index.js already lets
 * through without a session (`isPublicSiteRoute`); no new exemption was added.
 * What keeps them narrow:
 *   - the project is RESOLVED, never believed: on a client's domain the domain
 *     names the project, and on a system host the claimed id must be a real
 *     project (lib/publicSiteHostBinding.js resolvePublicProjectForRequest,
 *     the same check the CRM form's public submit uses)
 *   - the calendar read sends the visitor's wording and the free times only;
 *     never another visitor's booking, name or email, and never the email
 *     wording the Booking Manager stores for later slices
 *   - a honeypot field, and per-client rate limits (lib/rateLimiter.js
 *     booking.public.*), like POST /api/crm/contact-submit
 *
 * NO DOUBLE BOOKING. The time is checked against the free-time calculator
 * first (lib/bookingAvailability.js), and the database then refuses a second
 * live booking at the same start (docs/SQL/booking_setup.sql,
 * idx_bookings_calendar_start_booked), which is what decides a true race: two
 * visitors pressing Book at the same moment both pass the first check, and
 * exactly one insert wins. The loser is told "That time was just taken".
 *
 * ORDER: book first, then the CRM. Creating the contact before the booking
 * would add a visitor who LOST the race to the CRM for a meeting they never
 * got. A CRM that cannot be written never costs the visitor their meeting:
 * the booking stands, and the failure is logged.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { resolvePublicProjectForRequest } = require('../lib/publicSiteHostBinding');
const store = require('../lib/bookingStore');
const { freeSlots, isSlotFree, MAX_RANGE_DAYS } = require('../lib/bookingAvailability');
const { listConfigs } = require('../lib/crmConfigStore');
const { createContact, findContactByEmail } = require('../lib/crmContactsStore');
const { sendBookingEmails, requestSiteOrigin } = require('../lib/bookingEmails');

const DAY = 86400000;
const MINUTE = 60000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the visitor is told when a time went between choosing and pressing Book. */
const TAKEN_MESSAGE = 'That time was just taken, please pick another.';
const DEFAULT_CONFIRMATION = 'You are booked. We look forward to meeting you.';

/** How many days, from today, a visitor may see: the calendar's own window. */
function windowDays(calendar) {
  const ahead = Number.isInteger(calendar.daysAhead) ? calendar.daysAhead : 60;
  return Math.max(1, Math.min(MAX_RANGE_DAYS, ahead + 1));
}

/** Only what a visitor needs to read. Never the email wording or another visitor. */
function visitorCalendar(calendar) {
  const messaging = calendar.messaging || {};
  return {
    id: calendar.id,
    name: calendar.name,
    timeZone: calendar.timeZone,
    meetingMinutes: calendar.meetingMinutes,
    heading: messaging.heading || '',
    intro: messaging.intro || '',
  };
}

/**
 * The calendar a module shows: the one it names, or the project's first when
 * it names none (the Booking Manager opens on the first too). `data: null`
 * means this project has no such calendar.
 */
async function findCalendar(calendarId, scope) {
  const id = String(calendarId || '').trim();
  if (id) return store.getCalendarById(id, scope);
  const list = await store.listCalendars(1, scope);
  if (!list.ok) return list;
  return { ok: true, status: 200, data: list.data[0] || null };
}

async function bookedAround(calendar, from, to, scope) {
  // A meeting that starts the day before the range can still run into it.
  return store.listBookings(500, calendar.id, {
    from: new Date(from - DAY).toISOString(),
    to: new Date(to).toISOString(),
    status: 'booked',
  }, scope);
}

async function resolveScope(req, res, claimedProjectId) {
  const bind = await resolvePublicProjectForRequest(req, claimedProjectId);
  if (!bind.ok) {
    sendErr(res, bind.status || 403, bind.error, { code: bind.code });
    return null;
  }
  return { projectId: bind.projectId, userId: '' };
}

function sendNoCalendar(res) {
  return sendErr(res, 404, 'This project has no booking calendar to show', { code: 'NO_CALENDAR' });
}

async function handleCalendar(req, res) {
  if (checkEndpointLimit(req, res, 'booking.public.read')) return;
  const params = getUrlObj(req).searchParams;
  const scope = await resolveScope(req, res, params.get('projectId'));
  if (!scope) return;
  const calendar = await findCalendar(params.get('calendarId'), scope);
  if (!calendar.ok) return sendErr(res, calendar.status || 500, `Could not read the booking calendar: ${calendar.error}`);
  if (!calendar.data) return sendNoCalendar(res);

  const now = Date.now();
  const days = windowDays(calendar.data);
  const to = now + days * DAY;
  const booked = await bookedAround(calendar.data, now, to, scope);
  // "Could not read the bookings" must never read as "everything is free".
  if (!booked.ok) return sendErr(res, booked.status || 500, `Could not read the bookings: ${booked.error}`);
  try {
    const slots = freeSlots({ calendar: calendar.data, bookings: booked.data, from: now, to, now });
    return sendOk(res, 200, {
      calendar: visitorCalendar(calendar.data),
      from: new Date(now).toISOString(),
      to: new Date(to).toISOString(),
      days,
      slots,
    });
  } catch (error) {
    return sendErr(res, 500, `The booking calendar's settings could not be read: ${error.message}`);
  }
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/** Split "Pat van Visitor" into the CRM's first and last name fields. */
function nameParts(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') };
}

/**
 * The visitor's contact in the project's CRM: an existing one with this email,
 * or a new one. Returns the contact id, or '' when there is no CRM to file
 * them in or it could not be written (the caller logs which).
 */
async function fileInCrm({ name, email, phone }, scope) {
  const configs = await listConfigs(scope);
  const config = Array.isArray(configs) ? configs[0] : null;
  if (!config) return { id: '', why: 'this project has no CRM' };
  try {
    const created = await createContact({
      crmConfigId: config.id,
      email,
      data: { ...nameParts(name), ...(phone ? { phone } : {}) },
      source: 'booking calendar',
      tags: [],
    }, scope);
    if (created?.id) return { id: String(created.id), why: '' };
    return { id: '', why: 'the CRM did not accept the contact' };
  } catch (error) {
    if (error.code !== 'DUPLICATE_EMAIL') return { id: '', why: error.message };
    const existing = await findContactByEmail(config.id, email, scope).catch(() => null);
    return existing?.id ? { id: String(existing.id), why: '' } : { id: '', why: 'the existing contact could not be read' };
  }
}

async function handleBook(req, res) {
  if (checkEndpointLimit(req, res, 'booking.public.book')) return;
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (_) {
    return sendErr(res, 400, 'The booking could not be read', { code: 'INVALID' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendErr(res, 400, 'The booking could not be read', { code: 'INVALID' });
  }
  // Honeypot first: a bot that fills the hidden field gets a cheerful answer
  // and costs no database work, exactly like the CRM form.
  if (text(body._trap, 200)) return sendOk(res, 200, { confirmation: DEFAULT_CONFIRMATION });

  const name = text(body.name, 200);
  const email = text(body.email, 320).toLowerCase();
  const phone = text(body.phone, 60);
  const note = text(body.note, 4000);
  // The visitor's own zone, from their browser, so their emails show their time.
  const visitorTimeZone = text(body.timeZone, 100);
  if (!name) return sendErr(res, 400, 'Please enter your name.', { code: 'INVALID' });
  if (!EMAIL_RE.test(email)) return sendErr(res, 400, 'Please enter a valid email address.', { code: 'INVALID' });
  const start = Date.parse(String(body.startsAt || ''));
  if (!Number.isFinite(start)) return sendErr(res, 400, 'Please pick a time.', { code: 'INVALID' });

  const scope = await resolveScope(req, res, body.projectId);
  if (!scope) return;
  const calendar = await findCalendar(body.calendarId, scope);
  if (!calendar.ok) return sendErr(res, calendar.status || 500, `Could not read the booking calendar: ${calendar.error}`);
  if (!calendar.data) return sendNoCalendar(res);

  const end = start + calendar.data.meetingMinutes * MINUTE;
  const now = Date.now();
  const booked = await bookedAround(calendar.data, start, end, scope);
  if (!booked.ok) return sendErr(res, booked.status || 500, `Could not read the bookings: ${booked.error}`);
  let offered;
  let free;
  try {
    offered = isSlotFree({ calendar: calendar.data, bookings: [], now }, start, end);
    free = offered && isSlotFree({ calendar: calendar.data, bookings: booked.data, now }, start, end);
  } catch (error) {
    return sendErr(res, 500, `The booking calendar's settings could not be read: ${error.message}`);
  }
  if (!offered) return sendErr(res, 400, 'That time is not available, please pick another.', { code: 'NOT_OFFERED' });
  if (!free) return sendErr(res, 409, TAKEN_MESSAGE, { code: 'TAKEN' });

  const made = await store.createBooking(calendar.data.id, {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    visitorName: name,
    visitorEmail: email,
    visitorPhone: phone,
    visitorNote: note,
    visitorTimeZone,
  }, scope);
  if (!made.ok) {
    if (made.status === 409) return sendErr(res, 409, TAKEN_MESSAGE, { code: 'TAKEN' });
    return sendErr(res, made.status || 500, made.error || 'The booking could not be saved');
  }

  let booking = made.data;
  const contact = await fileInCrm({ name, email, phone }, scope);
  if (contact.id) {
    const attached = await store.attachBookingContact(made.data.id, contact.id, scope);
    if (attached.ok) booking = { ...attached.data, manageToken: made.data.manageToken };
    else console.warn(`[booking] booking ${made.data.id} saved, but could not be linked to CRM contact ${contact.id}: ${attached.error}`);
  } else {
    console.warn(`[booking] booking ${made.data.id} saved with no CRM contact: ${contact.why}`);
  }

  // Both emails (SC-912), AWAITED: Vercel freezes the function once the answer
  // is sent, which would kill a send still in flight. A failed send never
  // costs the visitor their meeting; it is recorded on the booking instead and
  // shows on the Booking Manager.
  await sendBookingEmails({
    kind: 'booked',
    booking,
    calendar: calendar.data,
    projectId: scope.projectId,
    origin: requestSiteOrigin(req),
    manageToken: made.data.manageToken,
    scope,
  });

  return sendOk(res, 200, {
    booking: { id: made.data.id, startsAt: made.data.startsAt, endsAt: made.data.endsAt },
    confirmation: (calendar.data.messaging && calendar.data.messaging.confirmation) || DEFAULT_CONFIRMATION,
  });
}

/** true when this module answered the request. */
async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/public/booking/')) return false;
  if (pathname === '/api/public/booking/calendar') {
    if (method !== 'GET') sendErr(res, 405, 'Use GET', { code: 'METHOD_NOT_ALLOWED' });
    else await handleCalendar(req, res);
    return true;
  }
  if (pathname === '/api/public/booking/book') {
    if (method !== 'POST') sendErr(res, 405, 'Book with POST', { code: 'METHOD_NOT_ALLOWED' });
    else await handleBook(req, res);
    return true;
  }
  sendErr(res, 404, 'No such booking endpoint', { code: 'NOT_FOUND' });
  return true;
}

module.exports = {
  handle,
  TAKEN_MESSAGE,
  // Shared with routes/bookingManage.js, the visitor's cancel/reschedule link.
  resolveScope,
  visitorCalendar,
  windowDays,
  bookedAround,
  manifest: {
    id: 'booking-public',
    label: 'Booking calendar, visitor side (unauthenticated)',
    prefixes: ['/api/public/booking'],
  },
};
