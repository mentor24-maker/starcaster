'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Booking calendar, slice 5 of 6 (SC-913): Google Calendar and Google Meet.
 *
 * The REAL routes (visitor booking, visitor manage link, operator API), the
 * REAL booking store, connection vault (with real encryption) and Google sync,
 * over the fake database that reads its schema from the SQL files in the order
 * they run. Swapped: the database client, the host check, the CRM stores, the
 * project-name and alert-address lookups, the mailer (records instead of
 * sending), and Google itself: `global.fetch` answers every Google address
 * from the `google` object below, and can be told Google is down.
 */

const SQL_TEXT = ['booking_setup.sql', 'booking_notifications.sql', 'booking_google_calendar.sql', 'project_connections_setup.sql']
  .map((file) => fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SQL', file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const resolve = (p) => require.resolve(`../../${p}`);
const SWAPPED = {
  supabase: resolve('lib/supabase.js'),
  hostBinding: resolve('lib/publicSiteHostBinding.js'),
  crmConfig: resolve('lib/crmConfigStore.js'),
  crmContacts: resolve('lib/crmContactsStore.js'),
  mailer: resolve('lib/mailer.js'),
  projects: resolve('lib/projectsStore.js'),
  siteSettings: resolve('lib/projectSiteSettingsStore.js'),
};
const RELOADED = [
  'lib/rateLimiter.js', 'lib/projectScope.js', 'lib/bookingStore.js', 'lib/bookingEmails.js',
  'lib/projectConnectionsStore.js', 'lib/connections/verifySweep.js', 'lib/bookingGoogleSync.js',
  'routes/bookingPublic.js', 'routes/bookingManage.js', 'routes/booking.js',
].map(resolve);

const PROJECT = 'proj_a';
const SCOPE = { projectId: PROJECT, userId: 'owner_1' };
const OPEN_ALL_DAY = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ start: '00:00', end: '24:00' }]])
);
const VISITOR = { name: 'Pat van Visitor', email: 'pat@example.com', phone: '555-0100', note: 'About the summer camp' };
const ACCESS = 'ya29.SECRET-ACCESS-TOKEN';
const REFRESH = '1//SECRET-REFRESH-TOKEN';
const MEET = 'https://meet.google.com/abc-defg-hij';
const ENV = {
  CHANNELS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  GOOGLE_CALENDAR_CLIENT_ID: 'cal-client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'cal-client-secret',
};

/** A pretend Google: one events list, a busy list, a switch to be unreachable. */
function fakeGoogle() {
  const g = {
    down: false, hang: false, tokenRefuses: false, failCreate: false, failPatch: false, failDelete: false,
    // Makes the event, then never answers: the time limit fires with the event made.
    createThenHang: false,
    busy: [], events: new Map(), deletedIds: new Set(), calls: [], nextId: 1, meetPending: false, meetLink: MEET,
  };
  /** Delete an event on Google's side. Like Google, its id stays reserved. */
  g.remove = (id) => { g.events.delete(id); g.deletedIds.add(id); };
  g.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    g.calls.push({ url: String(url), method, body: options.body ? String(options.body) : '', auth: options.headers?.Authorization || '' });
    if (g.down) throw new Error('getaddrinfo ENOTFOUND www.googleapis.com');
    // Hangs, ignoring the abort signal: the bound must hold anyway.
    if (g.hang) return new Promise(() => {});
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: '', json: async () => body });
    const u = new URL(String(url));
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
      if (g.tokenRefuses) return reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return reply(200, { access_token: 'ya29.RENEWED-TOKEN', expires_in: 3599, token_type: 'Bearer' });
    }
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') return reply(200, {});
    if (u.pathname === '/calendar/v3/freeBusy') {
      // Like Google: blocks are clipped to the window asked about.
      const asked = JSON.parse(options.body);
      const lo = Date.parse(asked.timeMin);
      const hi = Date.parse(asked.timeMax);
      const busy = g.busy
        .map((b) => [Math.max(lo, Date.parse(b.startsAt)), Math.min(hi, Date.parse(b.endsAt))])
        .filter(([a, b]) => b > a)
        .map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() }));
      return reply(200, { calendars: { primary: { busy } } });
    }
    const m = /^\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/.exec(u.pathname);
    if (m) {
      const id = m[1] ? decodeURIComponent(m[1]) : '';
      const withMeet = (ev, body) => (body?.conferenceData?.createRequest && !g.meetPending ? { ...ev, hangoutLink: g.meetLink } : ev);
      if (method === 'POST') {
        if (g.failCreate) return reply(500, { error: { code: 500, message: 'Backend Error' } });
        const body = JSON.parse(options.body);
        // Like Google: a caller-chosen id is used, and an id taken (or once
        // taken by an event since deleted) is refused with 409.
        if (body.id && (g.events.has(body.id) || g.deletedIds.has(body.id))) {
          return reply(409, { error: { code: 409, message: 'The requested identifier already exists.' } });
        }
        const ev = withMeet({ id: `evt_${g.nextId++}`, ...body }, body);
        g.events.set(ev.id, ev);
        if (g.createThenHang) return new Promise(() => {});
        return reply(200, ev);
      }
      if (!g.events.has(id)) return reply(404, { error: { code: 404, message: 'Not Found' } });
      if (method === 'GET') return reply(200, g.events.get(id));
      if (method === 'PATCH') {
        if (g.failPatch) return reply(500, { error: { code: 500, message: 'Backend Error' } });
        const body = JSON.parse(options.body);
        const ev = withMeet({ ...g.events.get(id), ...body }, body);
        g.events.set(id, ev);
        return reply(200, ev);
      }
      if (method === 'DELETE') {
        if (g.failDelete) return reply(500, { error: { code: 500, message: 'Backend Error' } });
        g.remove(id);
        return { ok: true, status: 204, statusText: '', json: async () => null };
      }
    }
    return reply(404, { error: { message: `fake Google has no ${method} ${u.pathname}` } });
  };
  return g;
}

function setup() {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const sent = [];
  const saved = new Map();
  const savedEnv = {};
  for (const [k, v] of Object.entries(ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  const google = fakeGoogle();
  const realFetch = global.fetch;
  global.fetch = google.fetch;
  const logged = [];
  const realLog = { warn: console.warn, error: console.error };
  console.warn = (...a) => logged.push(a.join(' '));
  console.error = (...a) => logged.push(a.join(' '));
  const swap = (file, exports) => {
    saved.set(file, require.cache[file]);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  swap(SWAPPED.supabase, {
    isConfigured: () => true,
    tableConfig: () => ({ bookingCalendars: 'booking_calendars', bookings: 'bookings', projectConnections: 'project_connections' }),
    sbQuery: (req) => db.sbQuery(req),
  });
  swap(SWAPPED.hostBinding, { resolvePublicProjectForRequest: async () => ({ ok: true, projectId: PROJECT }) });
  swap(SWAPPED.crmConfig, { listConfigs: async () => [{ id: 'crm_1' }], getLastConfigStoreError: () => '' });
  swap(SWAPPED.crmContacts, { createContact: async (input) => ({ id: 'crmct_1', ...input }), findContactByEmail: async () => null });
  swap(SWAPPED.mailer, { sendEmail: async (message) => { sent.push(message); return { ok: true, status: 200, data: { id: `email_${sent.length}` } }; } });
  swap(SWAPPED.projects, { getPublicProjectById: async () => ({ ok: true, data: { name: 'Delray Tennis' } }) });
  swap(SWAPPED.siteSettings, { getContactAlertEmails: async () => ['owner@client.example'] });
  for (const p of RELOADED) delete require.cache[p];
  const ctx = {
    db,
    sent,
    google,
    logged,
    publicRoute: require(resolve('routes/bookingPublic.js')),
    manageRoute: require(resolve('routes/bookingManage.js')),
    adminRoute: require(resolve('routes/booking.js')),
    store: require(resolve('lib/bookingStore.js')),
    connections: require(resolve('lib/projectConnectionsStore.js')),
    sync: require(resolve('lib/bookingGoogleSync.js')),
  };
  ctx.restore = () => {
    global.fetch = realFetch;
    console.warn = realLog.warn;
    console.error = realLog.error;
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const [file, previous] of saved.entries()) {
      if (previous) require.cache[file] = previous;
      else delete require.cache[file];
    }
    for (const p of RELOADED) delete require.cache[p];
  };
  return ctx;
}

async function connectGoogle(ctx, { expiresAt = new Date(Date.now() + 3600e3).toISOString() } = {}) {
  const saved = await ctx.connections.saveConnection({
    provider: 'google_calendar',
    accountId: 'google-sub-1',
    accountLabel: 'owner@gmail.example',
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt,
    status: 'connected',
    connectedByUserId: SCOPE.userId,
  }, SCOPE);
  assert.equal(saved.ok, true, JSON.stringify(saved));
}

let nextIp = 1;
async function call(route, method, url, body, extra = {}) {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers || {}); };
  res.end = (chunk) => { res.body = chunk || ''; };
  const req = {
    method,
    url,
    headers: { host: 'client.example.com', 'user-agent': 'test' },
    socket: { remoteAddress: `198.18.0.${nextIp++ % 250}` },
    ...(body === undefined ? {} : { body }),
    ...extra,
  };
  const handled = await route.handle(req, res, url.split('?')[0], method);
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload, body: res.body };
}

const asOperator = { projectContext: { project: { id: PROJECT } }, authUser: { id: SCOPE.userId } };

async function openCalendar(ctx) {
  const made = await ctx.store.createCalendar({
    name: 'Tennis lesson', timeZone: 'America/Denver', weeklyHours: OPEN_ALL_DAY,
    minNoticeMinutes: 0, daysAhead: 30, meetingMinutes: 30,
  }, SCOPE);
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.data;
}

async function slots(ctx, calendarId) {
  const read = await call(ctx.publicRoute, 'GET', `/api/public/booking/calendar?calendarId=${calendarId}`);
  assert.equal(read.status, 200, JSON.stringify(read.payload));
  return read.payload.data.slots;
}

async function book(ctx, cal, slot) {
  const res = await call(ctx.publicRoute, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  return res.payload.data.booking;
}

function rowOf(ctx, id) {
  return ctx.db.data.get('bookings').find((r) => r.id === id);
}

function assertNoTokenLeaked(ctx, ...bodies) {
  for (const text of [...bodies, ...ctx.logged, ...ctx.sent.map((m) => JSON.stringify(m))]) {
    assert.doesNotMatch(String(text), /SECRET-ACCESS|SECRET-REFRESH|RENEWED-TOKEN/, `a token reached: ${String(text).slice(0, 200)}`);
  }
}

// ── No Google connected ─────────────────────────────────────────────────────

test('with no Google Calendar connected, booking never calls Google and records nothing about it', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, slot);
    assert.deepEqual(ctx.google.calls, []);
    const row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status ?? null, null);
    assert.equal(row.meet_link ?? null, null);
    assert.doesNotMatch(ctx.sent[0].text, /Google Meet|Video call/);
  } finally {
    ctx.restore();
  }
});

// ── Busy times ──────────────────────────────────────────────────────────────

test('a busy block on Google hides that time from visitors, and booking it anyway is refused', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const before = await slots(ctx, cal.id);
    const target = before[3];
    ctx.google.busy = [{ startsAt: target.startsAt, endsAt: target.endsAt }];
    const after = await slots(ctx, cal.id);
    assert.equal(after.length, before.length - 1, 'exactly the busy half hour is gone');
    assert.ok(!after.some((s) => s.startsAt === target.startsAt), 'the busy time is not offered');
    assert.ok(after.some((s) => s.startsAt === before[2].startsAt), 'the times beside it still are');

    const res = await call(ctx.publicRoute, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: target.startsAt, ...VISITOR });
    assert.equal(res.status, 409, 'Google busy is re-checked at booking, not trusted from the page');
    assert.equal(res.payload.error.code, 'TAKEN');
    assert.equal(ctx.db.data.get('bookings').length, 0);
    assertNoTokenLeaked(ctx, res.body);
  } finally {
    ctx.restore();
  }
});

test('when Google cannot be asked for busy times, visitors still see times and the preview says why', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    ctx.google.down = true;
    assert.ok((await slots(ctx, cal.id)).length > 0, 'a Google outage does not take the booking page down');
    const preview = await call(ctx.adminRoute, 'GET', `/api/booking/calendars/${cal.id}/availability`, undefined, asOperator);
    assert.equal(preview.status, 200, JSON.stringify(preview.payload));
    assert.equal(preview.payload.data.googleBusy, 'unavailable');
    assert.match(preview.payload.data.googleBusyError, /could not be reached|did not answer/);
    ctx.google.down = false;
    const ok = await call(ctx.adminRoute, 'GET', `/api/booking/calendars/${cal.id}/availability`, undefined, asOperator);
    assert.equal(ok.payload.data.googleBusy, 'used');
  } finally {
    ctx.restore();
  }
});

// ── The event and its Meet link ─────────────────────────────────────────────

test('a booking becomes a Google event with a Meet link, stored on the booking and in both emails', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, slot);

    const create = ctx.google.calls.find((c) => c.method === 'POST' && /\/events\?/.test(c.url));
    assert.ok(create, 'an event was made');
    assert.match(create.url, /conferenceDataVersion=1/);
    assert.match(create.url, /sendUpdates=none/, 'Google sends no second invitation; ours carries the link');
    assert.equal(create.auth, `Bearer ${ACCESS}`, 'with the project\'s own token');
    const body = JSON.parse(create.body);
    assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    assert.deepEqual(body.attendees, [{ email: 'pat@example.com', displayName: 'Pat van Visitor' }]);
    assert.equal(body.start.dateTime, slot.startsAt);
    assert.equal(body.summary, 'Tennis lesson with Pat van Visitor');

    const row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, 'synced');
    assert.equal(row.meet_link, MEET);
    assert.equal(row.google_event_id, ctx.sync.googleEventIdFor(booking), 'the id Starcaster chose, so a repeat lands on the same event');
    assert.match(row.google_event_id, /^[0-9a-v]{5,1024}$/, 'inside Google\'s rule for an event id');

    assert.equal(ctx.sent.length, 2, 'visitor and owner');
    for (const message of ctx.sent) {
      assert.match(message.text, new RegExp(`Video call: ${MEET}`));
      assert.match(message.html, new RegExp(`href="${MEET}"`));
      const ics = Buffer.from(message.attachments[0].content, 'base64').toString('utf8');
      assert.match(ics, new RegExp(`LOCATION:${MEET}`));
    }

    const list = await call(ctx.adminRoute, 'GET', `/api/booking/calendars/${cal.id}/bookings`, undefined, asOperator);
    assert.equal(list.payload.data[0].meetLink, MEET, 'the Booking Manager reads the link');
    assertNoTokenLeaked(ctx, list.body);
  } finally {
    ctx.restore();
  }
});

test('Google down at booking time: the booking still stands, says "no Meet link yet", and Retry fixes it', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    ctx.google.down = true;
    const booking = await book(ctx, cal, slot);
    const row = rowOf(ctx, booking.id);
    assert.equal(row.status, 'booked', 'the meeting is saved');
    assert.equal(row.google_sync_status, 'failed');
    assert.match(row.google_sync_error, /could not be made: Google could not be reached/);
    assert.equal(ctx.sent.length, 2, 'the emails still go, without a link');
    assert.doesNotMatch(ctx.sent[0].text, /Video call/);

    const list = await call(ctx.adminRoute, 'GET', `/api/booking/calendars/${cal.id}/bookings`, undefined, asOperator);
    assert.equal(list.payload.data[0].googleSyncStatus, 'failed');

    const stillDown = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(stillDown.status, 502);
    assert.match(stillDown.payload.error.message, /^Still no Meet link/);

    ctx.google.down = false;
    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(retried.payload.data.meetLink, MEET);
    assert.equal(rowOf(ctx, booking.id).google_sync_status, 'synced');
    assert.equal(rowOf(ctx, booking.id).google_sync_error, null);
    assertNoTokenLeaked(ctx, retried.body);
  } finally {
    ctx.restore();
  }
});

test('an event made without its Meet link keeps the event, and Retry adds the link to THAT event', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    ctx.google.meetPending = true;
    const booking = await book(ctx, cal, slot);
    const row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, 'failed');
    assert.equal(row.google_event_id, ctx.sync.googleEventIdFor(booking), 'the event is remembered, so a retry does not make a second one');
    ctx.google.meetPending = false;
    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(ctx.google.events.size, 1, 'still one event');
    assert.equal(rowOf(ctx, booking.id).meet_link, MEET);
  } finally {
    ctx.restore();
  }
});

test('moving the meeting moves the Google event; cancelling removes it', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const free = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, free[0]);
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(ctx.sent[0].text)[1];

    // Its own event is busy on Google, and must not stop the visitor moving it.
    ctx.google.busy = [{ startsAt: free[0].startsAt, endsAt: free[0].endsAt }];
    const details = await call(ctx.manageRoute, 'GET', `/api/public/booking/manage/details?token=${token}`);
    assert.equal(details.status, 200, JSON.stringify(details.payload));

    const moved = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: free[4].startsAt });
    assert.equal(moved.status, 200, JSON.stringify(moved.payload));
    assert.equal(ctx.google.events.get(rowOf(ctx, booking.id).google_event_id).start.dateTime, free[4].startsAt, 'the event moved with it');
    assert.equal(ctx.google.events.size, 1, 'moved, not duplicated');
    assert.match(ctx.sent[ctx.sent.length - 1].text, /Video call: https:\/\/meet\.google\.com/);

    const cancelled = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/cancel', { token });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.payload));
    assert.equal(ctx.google.events.size, 0, 'the event is gone from Google');
    assert.equal(rowOf(ctx, booking.id).google_sync_status, 'synced');
    assert.doesNotMatch(ctx.sent[ctx.sent.length - 1].text, /Video call/, 'a cancelled meeting has no call to join');
  } finally {
    ctx.restore();
  }
});

test('the operator cancelling a booking removes its Google event too', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, slot);
    const res = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/cancel`, {}, asOperator);
    assert.equal(res.status, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.data.status, 'cancelled');
    assert.equal(ctx.google.events.size, 0);
  } finally {
    ctx.restore();
  }
});

// ── The token ───────────────────────────────────────────────────────────────

test('an access token near expiry is renewed before use, stored encrypted, and never shown', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx, { expiresAt: new Date(Date.now() + 60e3).toISOString() });
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    await book(ctx, cal, slot);
    assert.ok(ctx.google.calls.some((c) => /oauth2\.googleapis\.com\/token/.test(c.url)), 'renewed');
    const create = ctx.google.calls.find((c) => c.method === 'POST' && /\/events\?/.test(c.url));
    assert.equal(create.auth, 'Bearer ya29.RENEWED-TOKEN', 'the event is made with the renewed token');
    const [row] = ctx.db.data.get('project_connections');
    assert.doesNotMatch(JSON.stringify(row), /RENEWED-TOKEN|SECRET-REFRESH/, 'stored encrypted, never as text');
    const stored = await ctx.connections.getConnection({ provider: 'google_calendar', accountId: 'google-sub-1' }, SCOPE);
    assert.equal(stored.data.accessToken, 'ya29.RENEWED-TOKEN');
    assert.equal(stored.data.refreshToken, REFRESH, 'Google keeps the same refresh token');
    assertNoTokenLeaked(ctx);
  } finally {
    ctx.restore();
  }
});

test('the Booking Manager status names the account and carries no token; Disconnect revokes and removes it', async () => {
  const ctx = setup();
  try {
    const none = await call(ctx.adminRoute, 'GET', '/api/booking/google', undefined, asOperator);
    assert.equal(none.status, 200);
    assert.deepEqual(
      { connected: none.payload.data.connected, configured: none.payload.data.configured },
      { connected: false, configured: true }
    );

    await connectGoogle(ctx);
    const status = await call(ctx.adminRoute, 'GET', '/api/booking/google', undefined, asOperator);
    assert.equal(status.payload.data.connected, true);
    assert.equal(status.payload.data.accountLabel, 'owner@gmail.example');
    assertNoTokenLeaked(ctx, status.body);

    const gone = await call(ctx.adminRoute, 'DELETE', '/api/booking/google', undefined, asOperator);
    assert.equal(gone.status, 200, JSON.stringify(gone.payload));
    assert.equal(gone.payload.data.revokedAtProvider, true);
    const revoke = ctx.google.calls.find((c) => /\/revoke$/.test(c.url));
    assert.ok(revoke, 'Google was asked to withdraw the permission');
    assert.match(revoke.body, /token=1%2F%2FSECRET-REFRESH-TOKEN/, 'the refresh token, which ends the whole grant');
    assert.equal(ctx.db.data.get('project_connections').length, 0, 'the stored token is deleted');
    const after = await call(ctx.adminRoute, 'GET', '/api/booking/google', undefined, asOperator);
    assert.equal(after.payload.data.connected, false);
  } finally {
    ctx.restore();
  }
});

test('Connect answers with a Google sign-in address carrying a signed state for this project', async () => {
  const ctx = setup();
  try {
    const res = await call(ctx.adminRoute, 'POST', '/api/booking/google/connect', {}, asOperator);
    assert.equal(res.status, 200, JSON.stringify(res.payload));
    const url = new URL(res.payload.data.authorizeUrl);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.match(url.searchParams.get('scope'), /calendar\.events/);
    assert.match(url.searchParams.get('scope'), /calendar\.freebusy/);
    assert.match(url.searchParams.get('redirect_uri'), /\/api\/connections\/google_calendar\/callback$/);
    const { verifyOAuthState } = require('../../lib/metaOAuthState');
    const state = verifyOAuthState(url.searchParams.get('state'));
    assert.equal(state.ok, true);
    assert.deepEqual([state.data.projectId, state.data.provider], [PROJECT, 'google_calendar']);
    assert.doesNotMatch(res.body, /cal-client-secret/, 'the app secret never reaches the browser');
  } finally {
    ctx.restore();
  }
});

// ── Review round 1 (SC-913) ─────────────────────────────────────────────────

test('moving a meeting: its own time is cut out of a clipped or joined Google block, nothing else is', () => {
  const sync = require('../../lib/bookingGoogleSync');
  const own = { googleEventId: 'evt_1', startsAt: '2030-01-07T17:00:00.000Z', endsAt: '2030-01-07T17:30:00.000Z' };
  // Asked about 17:15-17:45: Google clips the meeting's own event to 17:15-17:30.
  assert.deepEqual(sync.busyWithoutBooking([{ startsAt: '2030-01-07T17:15:00.000Z', endsAt: '2030-01-07T17:30:00.000Z' }], own), []);
  // Its own event joined with the next one (17:30-18:00) into one block: the next one stays busy.
  assert.deepEqual(
    sync.busyWithoutBooking([{ startsAt: '2030-01-07T17:00:00.000Z', endsAt: '2030-01-07T18:00:00.000Z' }], own),
    [{ startsAt: '2030-01-07T17:30:00.000Z', endsAt: '2030-01-07T18:00:00.000Z' }]
  );
  // Joined on both sides.
  assert.deepEqual(
    sync.busyWithoutBooking([{ startsAt: '2030-01-07T16:00:00.000Z', endsAt: '2030-01-07T18:00:00.000Z' }], own),
    [
      { startsAt: '2030-01-07T16:00:00.000Z', endsAt: '2030-01-07T17:00:00.000Z' },
      { startsAt: '2030-01-07T17:30:00.000Z', endsAt: '2030-01-07T18:00:00.000Z' },
    ]
  );
  const elsewhere = { startsAt: '2030-01-07T19:00:00.000Z', endsAt: '2030-01-07T20:00:00.000Z' };
  assert.deepEqual(sync.busyWithoutBooking([elsewhere], own), [elsewhere]);
  // A booking with no Google event owns nothing there: the block is someone else's.
  const exact = { startsAt: own.startsAt, endsAt: own.endsAt };
  assert.deepEqual(sync.busyWithoutBooking([exact], { ...own, googleEventId: '' }), [exact]);
});

test('a Google that hangs is given up on within the bound, and the booking still stands with its emails', async () => {
  const before = process.env.GOOGLE_CALENDAR_TIMEOUT_MS;
  process.env.GOOGLE_CALENDAR_TIMEOUT_MS = '80';
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    ctx.google.hang = true;
    const started = Date.now();
    const booking = await book(ctx, cal, slot);
    assert.ok(Date.now() - started < 3000, `answered in ${Date.now() - started} ms`);
    const row = rowOf(ctx, booking.id);
    assert.equal(row.status, 'booked');
    assert.equal(row.google_sync_status, 'failed');
    assert.match(row.google_sync_error, /did not answer within/);
    assert.equal(ctx.sent.length, 2, 'the emails still went');
  } finally {
    ctx.restore();
    if (before === undefined) delete process.env.GOOGLE_CALENDAR_TIMEOUT_MS; else process.env.GOOGLE_CALENDAR_TIMEOUT_MS = before;
  }
});

test('the Google call bound holds even when the request ignores its abort signal', async () => {
  const google = require('../../lib/googleCalendar');
  const started = Date.now();
  const res = await google.fetchJson('https://www.googleapis.com/x', {}, () => new Promise(() => {}), 60);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'GOOGLE_UNREACHABLE');
  assert.ok(Date.now() - started < 1000);
});

test('only the Video call row is a link: an address in a visitor\'s note or name stays text', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const res = await call(ctx.publicRoute, 'POST', '/api/public/booking/book', {
      calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR,
      name: 'https://evil.example/name', note: 'https://evil.example/login',
    });
    assert.equal(res.status, 200, JSON.stringify(res.payload));
    for (const message of ctx.sent) {
      assert.doesNotMatch(message.html, /href="https:\/\/evil\.example/, 'no visitor text becomes a link');
      assert.match(message.html, new RegExp(`href="${MEET}"`), 'the Meet link still is one');
    }
  } finally {
    ctx.restore();
  }
});

test('a lapsed token Google refuses to renew says "connect again", not Google\'s vague refusal', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx, { expiresAt: new Date(Date.now() - 60e3).toISOString() });
    const cal = await openCalendar(ctx);
    ctx.google.tokenRefuses = true;
    const [slot] = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, slot);
    const row = rowOf(ctx, booking.id);
    assert.equal(row.status, 'booked');
    assert.equal(row.google_sync_status, 'failed');
    assert.match(row.google_sync_error, /connect Google Calendar again/);
    assert.ok(!ctx.google.calls.some((c) => /\/events/.test(c.url)), 'the dead token is not used on an event');
    assertNoTokenLeaked(ctx);
  } finally {
    ctx.restore();
  }
});

test('moving a meeting whose event was deleted on Google makes a new one, and the email carries the NEW link', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const free = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, free[0]);
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(ctx.sent[0].text)[1];
    const first = rowOf(ctx, booking.id).google_event_id;
    ctx.google.remove(first);
    const NEW = 'https://meet.google.com/new-link-xyz';
    ctx.google.meetLink = NEW;
    const moved = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: free[4].startsAt });
    assert.equal(moved.status, 200, JSON.stringify(moved.payload));
    assert.equal(ctx.google.events.size, 1);
    const row = rowOf(ctx, booking.id);
    assert.ok(row.google_event_id && row.google_event_id !== first, 'a new event, under a new id');
    assert.match(row.google_event_id, /^[0-9a-v]{5,1024}$/);
    assert.equal(row.meet_link, NEW);
    assert.equal(row.google_sync_status, 'synced');
    const last = ctx.sent.slice(-2);
    for (const message of last) {
      assert.match(message.text, new RegExp(`Video call: ${NEW}`));
      assert.doesNotMatch(message.text, new RegExp(MEET), 'never the dead link');
    }
  } finally {
    ctx.restore();
  }
});

test('deleted on Google and a new event cannot be made: the move stands and the email has no dead link', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const free = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, free[0]);
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(ctx.sent[0].text)[1];
    ctx.google.remove(rowOf(ctx, booking.id).google_event_id);
    ctx.google.failCreate = true;
    const moved = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: free[4].startsAt });
    assert.equal(moved.status, 200, JSON.stringify(moved.payload));
    const row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, 'failed');
    assert.equal(row.meet_link ?? null, null, 'the dead link is forgotten');
    assert.equal(row.google_event_id ?? null, null);
    assert.doesNotMatch(ctx.sent[ctx.sent.length - 1].text, /Video call/);
  } finally {
    ctx.restore();
  }
});

test('Connect keeps the page it started from only when that page is on the request\'s own site', async () => {
  const ctx = setup();
  try {
    const { verifyOAuthState } = require('../../lib/metaOAuthState');
    const stateOf = (res) => verifyOAuthState(new URL(res.payload.data.authorizeUrl).searchParams.get('state')).data;
    const page = 'https://client.example.com/admin/bookings#tab=google';
    const same = await call(ctx.adminRoute, 'POST', '/api/booking/google/connect', { returnTo: page }, {
      ...asOperator, headers: { host: 'client.example.com', origin: 'https://client.example.com' },
    });
    assert.equal(same.status, 200, JSON.stringify(same.payload));
    assert.equal(stateOf(same).returnTo, page);
    const foreign = await call(ctx.adminRoute, 'POST', '/api/booking/google/connect', { returnTo: 'https://evil.example/' }, {
      ...asOperator, headers: { host: 'client.example.com', origin: 'https://client.example.com' },
    });
    assert.equal(stateOf(foreign).returnTo, '', 'another site is never a place to send the browser');
    const noOrigin = await call(ctx.adminRoute, 'POST', '/api/booking/google/connect', { returnTo: page }, asOperator);
    assert.equal(stateOf(noOrigin).returnTo, '');
  } finally {
    ctx.restore();
  }
});

test('a renewal that fails on a token past its expiry is reported as that, never used', async () => {
  const sync = require('../../lib/bookingGoogleSync');
  const row = { provider: 'google_calendar', accountId: 'g1', status: 'connected' };
  const store = {
    listConnections: async () => ({ ok: true, data: [row] }),
    getConnection: async () => ({ ok: true, data: { ...row, accessToken: 'tok', expiresAt: new Date(Date.now() - 1000).toISOString() } }),
  };
  const refused = async ({ connection }) => ({ ok: false, connection, note: 'invalid_grant', judged: true });
  const lapsed = await sync.usableConnection({ projectId: 'p', userId: 'u' }, { store, refreshBeforeUse: refused });
  assert.equal(lapsed.ok, false);
  assert.match(lapsed.error, /connect Google Calendar again.*/);
  assert.match(lapsed.error, /invalid_grant/);
  const unreachable = async ({ connection }) => ({ ok: false, connection, note: 'timeout', judged: false });
  const later = await sync.usableConnection({ projectId: 'p', userId: 'u' }, { store, refreshBeforeUse: unreachable });
  assert.match(later.error, /could not be reached to renew/);
  // Still inside its hour: the token works, so it is used.
  const fresh = { ...store, getConnection: async () => ({ ok: true, data: { ...row, accessToken: 'tok', expiresAt: new Date(Date.now() + 600e3).toISOString() } }) };
  const ok = await sync.usableConnection({ projectId: 'p', userId: 'u' }, { store: fresh, refreshBeforeUse: refused });
  assert.equal(ok.ok, true);
  assert.equal(ok.connection.accessToken, 'tok');
});

// ── Review round 2: a failed move or cancel is visible and Retry repairs it ──

test('a MOVE Google refused leaves the booking marked failed, and Retry moves the event to the new time', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const free = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, free[0]);
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(ctx.sent[0].text)[1];
    const eventId = rowOf(ctx, booking.id).google_event_id;

    ctx.google.failPatch = true;
    const moved = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: free[4].startsAt });
    assert.equal(moved.status, 200, 'the move itself stands');
    let row = rowOf(ctx, booking.id);
    assert.equal(row.starts_at instanceof Date ? row.starts_at.toISOString() : new Date(row.starts_at).toISOString(), free[4].startsAt);
    assert.equal(row.google_sync_status, 'failed');
    assert.match(row.google_sync_error, /could not be moved/);
    assert.equal(ctx.google.events.get(eventId).start.dateTime, free[0].startsAt, 'Google still has it at the old time');

    ctx.google.failPatch = false;
    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(ctx.google.events.size, 1, 'moved, not duplicated');
    assert.equal(ctx.google.events.get(eventId).start.dateTime, free[4].startsAt, 'Retry moved the event');
    assert.equal(ctx.google.events.get(eventId).end.dateTime, free[4].endsAt);
    row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, 'synced');
    assert.equal(row.meet_link, MEET, 'the same event, so the same link');
  } finally {
    ctx.restore();
  }
});

test('a CANCEL whose Google event could not be removed is marked, and Retry removes it', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, slot);

    ctx.google.failDelete = true;
    const res = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/cancel`, {}, asOperator);
    assert.equal(res.status, 200, JSON.stringify(res.payload));
    let row = rowOf(ctx, booking.id);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.google_sync_status, 'failed');
    assert.match(row.google_sync_error, /could not be removed/);
    assert.equal(ctx.google.events.size, 1, 'the event is still on Google');

    const stillFailing = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(stillFailing.status, 502);
    assert.match(stillFailing.payload.error.message, /^Still on Google Calendar/);

    ctx.google.failDelete = false;
    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(ctx.google.events.size, 0, 'Retry removed the event');
    row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, 'synced');

    const again = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(again.status, 409, 'nothing left to retry on a cancelled booking Google already let go');
  } finally {
    ctx.restore();
  }
});

test('an event Google made whose answer was lost to the time limit is found by Retry, never made twice', async () => {
  const before = process.env.GOOGLE_CALENDAR_TIMEOUT_MS;
  process.env.GOOGLE_CALENDAR_TIMEOUT_MS = '80';
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    ctx.google.createThenHang = true;
    const booking = await book(ctx, cal, slot);
    let row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, 'failed');
    assert.equal(ctx.google.events.size, 1, 'Google made it; we never heard');

    ctx.google.createThenHang = false;
    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(ctx.google.events.size, 1, 'still one event, one Meet link');
    row = rowOf(ctx, booking.id);
    assert.equal(row.google_event_id, ctx.sync.googleEventIdFor(booking));
    assert.equal(row.meet_link, MEET);
    assert.equal(row.google_sync_status, 'synced');
  } finally {
    ctx.restore();
    if (before === undefined) delete process.env.GOOGLE_CALENDAR_TIMEOUT_MS; else process.env.GOOGLE_CALENDAR_TIMEOUT_MS = before;
  }
});

test('busy times from a connection Google has refused read as "unavailable", never as "not connected"', async () => {
  const sync = require('../../lib/bookingGoogleSync');
  const store = {
    listConnections: async () => ({ ok: true, data: [{ provider: 'google_calendar', accountId: 'g1', status: 'expired', lastError: 'invalid_grant' }] }),
  };
  const realWarn = console.warn;
  console.warn = () => {};
  const savedEnv = { id: process.env.GOOGLE_CALENDAR_CLIENT_ID, secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET };
  process.env.GOOGLE_CALENDAR_CLIENT_ID = ENV.GOOGLE_CALENDAR_CLIENT_ID;
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = ENV.GOOGLE_CALENDAR_CLIENT_SECRET;
  try {
    const answer = await sync.busyTimes({ projectId: 'p', userId: 'u' }, Date.now(), Date.now() + 86400e3, { store });
    assert.equal(answer.connected, true, 'the preview must warn, not say "no Google"');
    assert.match(answer.unavailable, /connect it again.*invalid_grant/);
    const none = await sync.busyTimes({ projectId: 'p', userId: 'u' }, Date.now(), Date.now() + 86400e3, {
      store: { listConnections: async () => ({ ok: true, data: [] }) },
    });
    assert.deepEqual(none, { connected: false, busy: [] });
  } finally {
    console.warn = realWarn;
    for (const [key, value] of [['GOOGLE_CALENDAR_CLIENT_ID', savedEnv.id], ['GOOGLE_CALENDAR_CLIENT_SECRET', savedEnv.secret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a long free/busy range is asked in pieces at the same time, not one after another', async () => {
  const google = require('../../lib/googleCalendar');
  let inFlight = 0;
  let most = 0;
  const fetchImpl = async (url, options) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 40));
    inFlight -= 1;
    const asked = JSON.parse(options.body);
    const start = Date.parse(asked.timeMin);
    return {
      ok: true, status: 200, statusText: '',
      json: async () => ({ calendars: { primary: { busy: [{ start: new Date(start).toISOString(), end: new Date(start + 3600e3).toISOString() }] } } }),
    };
  };
  const from = Date.parse('2030-01-01T00:00:00Z');
  const res = await google.freeBusy('tok', from, from + 90 * 86400e3, { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(most, 3, 'all three 30-day pieces were asked at once');
  assert.equal(res.data.busy.length, 3);
  assert.equal(res.data.busy[0].startsAt, '2030-01-01T00:00:00.000Z', 'kept in order');
});

// ── Review round 3 (SC-913) ────────────────────────────────────────────────

test('Book with Google down, then Retry: the visitor and the owner are emailed the new Meet link', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    ctx.google.down = true;
    const booking = await book(ctx, cal, slot);
    assert.equal(ctx.sent.length, 2, 'the booking emails went, with no link');
    ctx.google.down = false;

    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(ctx.sent.length, 4, 'Retry emailed both sides');
    const [visitor, owner] = ctx.sent.slice(2);
    assert.equal(visitor.to, VISITOR.email);
    assert.match(visitor.subject, /video call link/i);
    assert.match(visitor.text, new RegExp(MEET.replace(/[.]/g, '\\.')));
    assert.match(visitor.text, /To cancel or pick a new time: .*token=/, 'the visitor keeps their manage link');
    assert.equal(visitor.attachments.length, 1, 'the calendar file carries the link');
    assert.match(Buffer.from(visitor.attachments[0].content, 'base64').toString('utf8'), /LOCATION:https:\/\/meet\.google\.com/);
    assert.deepEqual(owner.to, ['owner@client.example']);
    assert.match(owner.subject, /^Meet link sent:/);
    assert.equal(retried.payload.data.notifyStatus, 'sent', 'the row says how the emails went');

    const again = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(again.status, 200);
    assert.equal(ctx.sent.length, 4, 'a Retry that changes no link sends nothing');
    assertNoTokenLeaked(ctx, retried.body);
  } finally {
    ctx.restore();
  }
});

test('Retry on a booking whose event was deleted on Google emails the NEW link, with a fresh Meet request each time', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, slot);
    const first = rowOf(ctx, booking.id);
    assert.equal(first.meet_link, MEET);
    ctx.google.remove(first.google_event_id);
    const NEW_MEET = 'https://meet.google.com/new-link-xyz';
    ctx.google.meetLink = NEW_MEET;
    ctx.google.calls.length = 0;
    const sentBefore = ctx.sent.length;

    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(rowOf(ctx, booking.id).meet_link, NEW_MEET);
    const visitor = ctx.sent.slice(sentBefore).find((m) => m.to === VISITOR.email);
    assert.ok(visitor, 'the visitor was emailed');
    assert.match(visitor.text, /new-link-xyz/);
    assert.doesNotMatch(visitor.text, /abc-defg-hij/, 'never the dead link');

    // The first create hit the reserved id (409) and a second was made: each
    // asked for its own Meet link, since Google ignores a repeated request id.
    const creates = ctx.google.calls.filter((c) => c.method === 'POST' && /\/events$/.test(new URL(c.url).pathname));
    assert.equal(creates.length, 2);
    const ids = creates.map((c) => JSON.parse(c.body).conferenceData.createRequest.requestId);
    assert.notEqual(ids[0], ids[1]);
  } finally {
    ctx.restore();
  }
});

test('a failed read of the connection marks the booking, and Retry with nothing connected clears the mark', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const realQuery = ctx.db.sbQuery;
    ctx.db.sbQuery = (req) => (req.table === 'project_connections'
      ? Promise.resolve({ ok: false, status: 503, error: 'service unavailable' })
      : realQuery.call(ctx.db, req));
    const booking = await book(ctx, cal, slot);
    ctx.db.sbQuery = realQuery;
    let row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, 'failed', 'could not tell, so it says so');

    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, null, 'the mark is gone');
    assert.equal(row.google_sync_error, null);
    assert.equal(retried.payload.data.googleSyncStatus, null);
    assert.equal(ctx.sent.length, 2, 'no link, so no extra email');
  } finally {
    ctx.restore();
  }
});

test('Disconnect lets every booking go of its Google event; a later cancel or move is not marked failed', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [a, b] = await slots(ctx, cal.id);
    const first = await book(ctx, cal, a);
    const second = await book(ctx, cal, b);
    assert.equal(ctx.google.events.size, 2);

    const gone = await call(ctx.adminRoute, 'DELETE', '/api/booking/google', undefined, asOperator);
    assert.equal(gone.status, 200, JSON.stringify(gone.payload));
    assert.equal(gone.payload.data.released, 2);
    for (const id of [first.id, second.id]) {
      const row = rowOf(ctx, id);
      assert.equal(row.google_event_id, null);
      assert.equal(row.google_sync_status, null);
      assert.equal(row.meet_link, MEET, 'the visitor still has the link; it is kept');
    }

    const cancelled = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${first.id}/cancel`, {}, asOperator);
    assert.equal(cancelled.status, 200);
    assert.equal(rowOf(ctx, first.id).google_sync_status, null, 'no Retry that could never succeed');
    assert.equal(ctx.google.events.size, 2, 'the events stay on the old calendar');

    // Reconnect (could be another account): a Retry makes a fresh event there.
    await connectGoogle(ctx);
    const retried = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${second.id}/google-sync`, {}, asOperator);
    assert.equal(retried.status, 200, JSON.stringify(retried.payload));
    assert.equal(rowOf(ctx, second.id).google_sync_status, 'synced');
  } finally {
    ctx.restore();
  }
});

test('a booking still pointing at an event after its calendar went away clears on cancel rather than failing', async () => {
  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const cal = await openCalendar(ctx);
    const [slot] = await slots(ctx, cal.id);
    const booking = await book(ctx, cal, slot);
    // The connection vanishes without Disconnect's release (e.g. removed elsewhere).
    ctx.db.data.set('project_connections', []);
    const cancelled = await call(ctx.adminRoute, 'POST', `/api/booking/bookings/${booking.id}/cancel`, {}, asOperator);
    assert.equal(cancelled.status, 200);
    const row = rowOf(ctx, booking.id);
    assert.equal(row.google_sync_status, null);
    assert.equal(row.google_event_id, null);
  } finally {
    ctx.restore();
  }
});

test('the Google connection is found by provider in the query, however many other connections are newer', async () => {
  const sync = require('../../lib/bookingGoogleSync');
  const asked = [];
  const store = {
    listConnections: async (limit, scope, options) => {
      asked.push(options);
      return { ok: true, data: [{ provider: 'google_calendar', accountId: 'g1', status: 'connected', accountLabel: 'x@y' }] };
    },
  };
  const found = await sync.findConnectionRow({ projectId: 'p', userId: 'u' }, store);
  assert.equal(found.connected, true);
  assert.deepEqual(asked, [{ provider: 'google_calendar' }]);

  const ctx = setup();
  try {
    await connectGoogle(ctx);
    const rows = ctx.db.data.get('project_connections');
    for (let i = 0; i < 60; i += 1) {
      rows.push({ ...rows[0], id: `fb_${i}`, provider: 'facebook', account_id: `page_${i}`, updated_at: new Date(Date.now() + 60e3 + i).toISOString() });
    }
    const status = await call(ctx.adminRoute, 'GET', '/api/booking/google', undefined, asOperator);
    assert.equal(status.payload.data.connected, true, '60 newer Facebook rows do not hide it');
  } finally {
    ctx.restore();
  }
});

test('with no Google app configured, a visitor calendar load never reads the connections', async () => {
  const ctx = setup();
  try {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const cal = await openCalendar(ctx);
    const realQuery = ctx.db.sbQuery;
    let reads = 0;
    ctx.db.sbQuery = (req) => { if (req.table === 'project_connections') reads += 1; return realQuery.call(ctx.db, req); };
    const list = await slots(ctx, cal.id);
    ctx.db.sbQuery = realQuery;
    assert.ok(list.length > 0);
    assert.equal(reads, 0);
  } finally {
    ctx.restore();
  }
});
