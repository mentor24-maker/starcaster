'use strict';

/**
 * Booking calendar — the visitor's private cancel/reschedule link. Slice 4 of
 * 6 (SC-912).
 *
 *   GET  /api/public/booking/manage?projectId=&token=
 *        the page the visitor's email links to (HTML)
 *   GET  /api/public/booking/manage/details?projectId=&token=
 *        their meeting, and the free times they could move it to
 *   POST /api/public/booking/manage/cancel       { projectId, token }
 *   POST /api/public/booking/manage/reschedule   { projectId, token, startsAt }
 *
 * SECURITY. Like the rest of /api/public/ these need no login
 * (routes/index.js `isPublicSiteRoute`; no new exemption). What they act on is
 * decided by the TOKEN: 32 random characters made when the meeting was booked
 * (lib/bookingStore.js newManageToken), sent only in the visitor's own email,
 * and never in any list the operator's screen reads. The project is still
 * RESOLVED, never believed (lib/publicSiteHostBinding.js), and the lookup is
 * scoped to it, so a token only ever opens its own project's booking. A token
 * that matches nothing answers exactly like a malformed one. Rate limited per
 * client (booking.public.manage).
 *
 * Cancelling twice is not an error: the second answer says the meeting is
 * already cancelled. Moving is ONE write (bookingStore.rescheduleBooking), so
 * the old time is freed and the new one taken at the same instant; the
 * database's one-live-booking-per-start index still decides a race. Each
 * change emails both sides (lib/bookingEmails.js), awaited before answering
 * because Vercel freezes the function once the response is sent.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const store = require('../lib/bookingStore');
const { freeSlots, isSlotFree } = require('../lib/bookingAvailability');
const { sendBookingEmails, requestSiteOrigin } = require('../lib/bookingEmails');
const shared = require('./bookingPublic');

const DAY = 86400000;
const MINUTE = 60000;
const NO_BOOKING = 'This link does not match a meeting. It may have been copied incompletely; please use the link in your email.';
const PREFIX = '/api/public/booking/manage';

/** The booking the token names, its calendar and the scope; or null, having answered. */
async function findByToken(req, res, projectId, token) {
  const scope = await shared.resolveScope(req, res, projectId);
  if (!scope) return null;
  const found = await store.getBookingByManageToken(token, scope);
  if (!found.ok) {
    sendErr(res, found.status || 500, `Could not read the meeting: ${found.error}`);
    return null;
  }
  if (!found.data) {
    sendErr(res, 404, NO_BOOKING, { code: 'NO_BOOKING' });
    return null;
  }
  const calendar = await store.getCalendarById(found.data.calendarId, scope);
  if (!calendar.ok || !calendar.data) {
    sendErr(res, calendar.status || 500, `Could not read the booking calendar: ${calendar.error || 'it no longer exists'}`);
    return null;
  }
  return { scope, booking: found.data, calendar: calendar.data, token: String(token).trim() };
}

function visitorBooking(booking) {
  return {
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    status: booking.status,
    visitorName: booking.visitorName,
  };
}

async function readBody(req, res) {
  try {
    const body = await parseJsonBody(req);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch (_) { /* answered below */ }
  sendErr(res, 400, 'The request could not be read', { code: 'INVALID' });
  return null;
}

function hasHappened(booking, now) {
  return Date.parse(booking.startsAt) <= now;
}

async function handleDetails(req, res) {
  const params = getUrlObj(req).searchParams;
  const ctx = await findByToken(req, res, params.get('projectId'), params.get('token'));
  if (!ctx) return;
  const { booking, calendar, scope } = ctx;
  const now = Date.now();
  let slots = [];
  if (booking.status === 'booked' && !hasHappened(booking, now)) {
    const to = now + shared.windowDays(calendar) * DAY;
    const booked = await shared.bookedAround(calendar, now, to, scope);
    // "Could not read the bookings" must never read as "everything is free".
    if (!booked.ok) return sendErr(res, booked.status || 500, `Could not read the bookings: ${booked.error}`);
    try {
      // Their own meeting does not block them: they may move it by a quarter hour.
      const others = booked.data.filter((b) => b.id !== booking.id);
      slots = freeSlots({ calendar, bookings: others, from: now, to, now })
        .filter((slot) => slot.startsAt !== booking.startsAt);
    } catch (error) {
      return sendErr(res, 500, `The booking calendar's settings could not be read: ${error.message}`);
    }
  }
  return sendOk(res, 200, {
    booking: visitorBooking(booking),
    calendar: shared.visitorCalendar(calendar),
    happened: hasHappened(booking, now),
    slots,
  });
}

async function handleCancel(req, res) {
  const body = await readBody(req, res);
  if (!body) return;
  const ctx = await findByToken(req, res, body.projectId, body.token);
  if (!ctx) return;
  const { booking, calendar, scope, token } = ctx;
  const already = () => sendOk(res, 200, {
    booking: visitorBooking({ ...booking, status: 'cancelled' }),
    alreadyCancelled: true,
    message: 'This meeting is already cancelled.',
  });
  if (booking.status === 'cancelled') return already();
  if (hasHappened(booking, Date.now())) {
    return sendErr(res, 400, 'This meeting has already started, so it can no longer be cancelled here.', { code: 'PAST' });
  }
  const cancelled = await store.cancelBooking(booking.id, scope);
  if (!cancelled.ok) {
    // Cancelled by another click between our read and our write.
    if (cancelled.status === 409) return already();
    return sendErr(res, cancelled.status || 500, cancelled.error || 'The meeting could not be cancelled');
  }
  const emails = await sendBookingEmails({
    kind: 'cancelled',
    booking: cancelled.data,
    calendar,
    projectId: scope.projectId,
    origin: requestSiteOrigin(req),
    manageToken: token,
    scope,
  });
  return sendOk(res, 200, {
    booking: visitorBooking(cancelled.data),
    alreadyCancelled: false,
    emailed: emails.sent.visitor,
    message: 'Your meeting is cancelled.',
  });
}

async function handleReschedule(req, res) {
  const body = await readBody(req, res);
  if (!body) return;
  const start = Date.parse(String(body.startsAt || ''));
  if (!Number.isFinite(start)) return sendErr(res, 400, 'Please pick a new time.', { code: 'INVALID' });
  const ctx = await findByToken(req, res, body.projectId, body.token);
  if (!ctx) return;
  const { booking, calendar, scope, token } = ctx;
  if (booking.status !== 'booked') {
    return sendErr(res, 409, 'This meeting is cancelled, so it cannot be moved. Please book a new time instead.', { code: 'CANCELLED' });
  }
  const now = Date.now();
  if (hasHappened(booking, now)) {
    return sendErr(res, 400, 'This meeting has already started, so it can no longer be moved here.', { code: 'PAST' });
  }
  if (new Date(start).toISOString() === booking.startsAt) {
    return sendErr(res, 400, 'That is already your meeting\'s time. Please pick a different one.', { code: 'SAME_TIME' });
  }
  const end = start + calendar.meetingMinutes * MINUTE;
  const booked = await shared.bookedAround(calendar, start, end, scope);
  if (!booked.ok) return sendErr(res, booked.status || 500, `Could not read the bookings: ${booked.error}`);
  const others = booked.data.filter((b) => b.id !== booking.id);
  let offered;
  let free;
  try {
    offered = isSlotFree({ calendar, bookings: [], now }, start, end);
    free = offered && isSlotFree({ calendar, bookings: others, now }, start, end);
  } catch (error) {
    return sendErr(res, 500, `The booking calendar's settings could not be read: ${error.message}`);
  }
  if (!offered) return sendErr(res, 400, 'That time is not available, please pick another.', { code: 'NOT_OFFERED' });
  if (!free) return sendErr(res, 409, shared.TAKEN_MESSAGE, { code: 'TAKEN' });

  const moved = await store.rescheduleBooking(booking.id, {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
  }, scope);
  if (!moved.ok) {
    if (moved.status === 409 && /just been booked/.test(String(moved.error))) {
      return sendErr(res, 409, shared.TAKEN_MESSAGE, { code: 'TAKEN' });
    }
    return sendErr(res, moved.status || 500, moved.error || 'The meeting could not be moved');
  }
  const emails = await sendBookingEmails({
    kind: 'rescheduled',
    booking: moved.data,
    previous: { startsAt: booking.startsAt, endsAt: booking.endsAt },
    calendar,
    projectId: scope.projectId,
    origin: requestSiteOrigin(req),
    manageToken: token,
    scope,
  });
  return sendOk(res, 200, {
    booking: visitorBooking(moved.data),
    emailed: emails.sent.visitor,
    message: 'Your meeting has moved to the new time.',
  });
}

// ── The page ────────────────────────────────────────────────────────────────

/** JSON safe to place inside a <script>: no "</script>" can close it early. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function managePageHtml({ projectId, token }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Your meeting</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #18324a; background: #f5f7fa; margin: 0; padding: 24px 16px; }
  main { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 24px; box-shadow: 0 1px 4px rgba(24,50,74,.12); }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h2 { font-size: 17px; margin: 24px 0 8px; }
  p { line-height: 1.5; margin: 0 0 12px; }
  .when { font-size: 17px; font-weight: bold; }
  .muted { color: #587592; font-size: 14px; }
  .error { color: #a3271f; }
  .ok { color: #1d6b3a; }
  button { font: inherit; padding: 9px 16px; border-radius: 6px; border: 1px solid #18324a; background: #fff; color: #18324a; cursor: pointer; margin: 4px 6px 4px 0; }
  button.primary { background: #18324a; color: #fff; }
  button.danger { border-color: #a3271f; color: #a3271f; }
  button:disabled { opacity: .55; cursor: default; }
  .day { margin: 14px 0 4px; font-weight: bold; font-size: 14px; }
  .slots button { padding: 6px 10px; font-size: 14px; }
  .slots button[aria-pressed="true"] { background: #18324a; color: #fff; }
</style>
</head>
<body>
<main>
  <h1 id="title">Your meeting</h1>
  <div id="app"><p class="muted">Loading your meeting…</p></div>
  <noscript><p class="error">This page needs JavaScript to show your meeting. Please reply to your confirmation email instead.</p></noscript>
</main>
<script>
(function () {
  var PROJECT = ${scriptJson(String(projectId || ''))};
  var TOKEN = ${scriptJson(String(token || ''))};
  var app = document.getElementById('app');
  var state = { data: null, picked: '', busy: false, note: '', error: '', confirmCancel: false };
  var zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { zone = ''; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      if (k === 'onclick') node.addEventListener('click', attrs[k]);
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function fmt(iso, opts) {
    var o = Object.assign({}, opts);
    if (zone) o.timeZone = zone;
    return new Intl.DateTimeFormat(undefined, o).format(new Date(iso));
  }
  function when(b) {
    return fmt(b.startsAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ', ' +
      fmt(b.startsAt, { hour: 'numeric', minute: '2-digit' }) + ' – ' +
      fmt(b.endsAt, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  function errorOf(body, fallback) {
    return (body && body.error && body.error.message) || fallback;
  }
  function call(method, path, payload) {
    var url = '${PREFIX}' + path;
    var init = { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (method === 'GET') url += '?projectId=' + encodeURIComponent(PROJECT) + '&token=' + encodeURIComponent(TOKEN);
    else init.body = JSON.stringify(Object.assign({ projectId: PROJECT, token: TOKEN }, payload || {}));
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
    });
  }
  function load() {
    call('GET', '/details').then(function (r) {
      if (!r.ok) { state.error = errorOf(r.body, 'Your meeting could not be loaded. Please try again.'); state.data = null; }
      else { state.data = r.body.data; state.error = ''; }
      render();
    }).catch(function () { state.error = 'Your meeting could not be loaded. Please check your connection and try again.'; render(); });
  }
  function act(path, payload, after) {
    state.busy = true; state.error = ''; render();
    call('POST', path, payload).then(function (r) {
      state.busy = false;
      if (!r.ok) {
        state.error = errorOf(r.body, 'That did not work. Please try again.');
        if (r.status === 409) { state.picked = ''; load(); return; }
        render();
        return;
      }
      state.note = (r.body && r.body.data && r.body.data.message) || 'Done.';
      after && after();
      state.picked = ''; state.confirmCancel = false;
      load();
    }).catch(function () { state.busy = false; state.error = 'That did not reach us. Please check your connection and try again.'; render(); });
  }
  function slotList(slots) {
    var wrap = el('div', { class: 'slots' });
    var lastDay = '';
    slots.forEach(function (s) {
      var day = fmt(s.startsAt, { weekday: 'long', month: 'long', day: 'numeric' });
      if (day !== lastDay) { wrap.appendChild(el('div', { class: 'day', text: day })); lastDay = day; }
      wrap.appendChild(el('button', {
        type: 'button', 'aria-pressed': state.picked === s.startsAt ? 'true' : 'false',
        text: fmt(s.startsAt, { hour: 'numeric', minute: '2-digit' }),
        onclick: function () { state.picked = s.startsAt; state.note = ''; render(); }
      }));
    });
    return wrap;
  }
  function render() {
    app.innerHTML = '';
    if (state.error && !state.data) { app.appendChild(el('p', { class: 'error', text: state.error })); return; }
    if (!state.data) { app.appendChild(el('p', { class: 'muted', text: 'Loading your meeting…' })); return; }
    var d = state.data, b = d.booking, cal = d.calendar || {};
    if (cal.name) document.getElementById('title').textContent = cal.name;
    var cancelled = b.status === 'cancelled';
    app.appendChild(el('p', { class: 'when', text: when(b) }));
    if (state.note) app.appendChild(el('p', { class: 'ok', role: 'status', text: state.note }));
    if (state.error) app.appendChild(el('p', { class: 'error', role: 'alert', text: state.error }));
    if (cancelled) { if (!state.note) app.appendChild(el('p', { text: 'This meeting is cancelled.' })); return; }
    if (d.happened) { app.appendChild(el('p', { class: 'muted', text: 'This meeting has already started, so it can no longer be changed here.' })); return; }

    app.appendChild(el('h2', { text: 'Pick a new time' }));
    if (!d.slots.length) {
      app.appendChild(el('p', { class: 'muted', text: 'There are no other free times right now. You can still cancel below.' }));
    } else {
      app.appendChild(el('p', { class: 'muted', text: 'Times are shown in your time zone' + (zone ? ' (' + zone + ')' : '') + '.' }));
      app.appendChild(slotList(d.slots));
      if (state.picked) {
        app.appendChild(el('p', {}, [el('button', {
          type: 'button', class: 'primary', disabled: state.busy ? 'disabled' : null,
          text: state.busy ? 'Moving…' : 'Move my meeting to ' + fmt(state.picked, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
          onclick: function () { act('/reschedule', { startsAt: state.picked }); }
        })]));
      }
    }

    app.appendChild(el('h2', { text: 'Cancel' }));
    if (!state.confirmCancel) {
      app.appendChild(el('button', { type: 'button', class: 'danger', text: 'Cancel my meeting', onclick: function () { state.confirmCancel = true; state.note = ''; render(); } }));
    } else {
      app.appendChild(el('p', { text: 'Cancel this meeting? The time will be offered to other visitors.' }));
      app.appendChild(el('button', { type: 'button', class: 'danger', text: state.busy ? 'Cancelling…' : 'Yes, cancel it', onclick: function () { act('/cancel'); } }));
      app.appendChild(el('button', { type: 'button', text: 'Keep it', onclick: function () { state.confirmCancel = false; render(); } }));
    }
    if (state.busy) Array.prototype.forEach.call(app.querySelectorAll('button'), function (btn) { btn.disabled = true; });
  }
  load();
})();
</script>
</body>
</html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(html);
}

/** true when this module answered the request. */
async function handle(req, res, pathname, method) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
  if (checkEndpointLimit(req, res, 'booking.public.manage')) return true;
  if (pathname === PREFIX) {
    if (method !== 'GET') sendErr(res, 405, 'Use GET', { code: 'METHOD_NOT_ALLOWED' });
    else {
      const params = getUrlObj(req).searchParams;
      sendHtml(res, 200, managePageHtml({ projectId: params.get('projectId'), token: params.get('token') }));
    }
    return true;
  }
  const routes = {
    '/details': ['GET', handleDetails],
    '/cancel': ['POST', handleCancel],
    '/reschedule': ['POST', handleReschedule],
  };
  const entry = routes[pathname.slice(PREFIX.length)];
  if (!entry) {
    sendErr(res, 404, 'No such booking endpoint', { code: 'NOT_FOUND' });
    return true;
  }
  if (method !== entry[0]) {
    sendErr(res, 405, `Use ${entry[0]}`, { code: 'METHOD_NOT_ALLOWED' });
    return true;
  }
  await entry[1](req, res);
  return true;
}

module.exports = {
  handle,
  managePageHtml,
  manifest: {
    id: 'booking-manage',
    label: 'Booking calendar, the visitor\'s cancel/reschedule link (unauthenticated, token-keyed)',
    prefixes: [PREFIX],
  },
};
