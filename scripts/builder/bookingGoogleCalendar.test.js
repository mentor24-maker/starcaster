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
  const g = { down: false, busy: [], events: new Map(), calls: [], nextId: 1, meetPending: false };
  g.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    g.calls.push({ url: String(url), method, body: options.body ? String(options.body) : '', auth: options.headers?.Authorization || '' });
    if (g.down) throw new Error('getaddrinfo ENOTFOUND www.googleapis.com');
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: '', json: async () => body });
    const u = new URL(String(url));
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
      return reply(200, { access_token: 'ya29.RENEWED-TOKEN', expires_in: 3599, token_type: 'Bearer' });
    }
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') return reply(200, {});
    if (u.pathname === '/calendar/v3/freeBusy') {
      return reply(200, { calendars: { primary: { busy: g.busy.map((b) => ({ start: b.startsAt, end: b.endsAt })) } } });
    }
    const m = /^\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/.exec(u.pathname);
    if (m) {
      const id = m[1] ? decodeURIComponent(m[1]) : '';
      const withMeet = (ev, body) => (body?.conferenceData?.createRequest && !g.meetPending ? { ...ev, hangoutLink: MEET } : ev);
      if (method === 'POST') {
        const body = JSON.parse(options.body);
        const ev = withMeet({ id: `evt_${g.nextId++}`, ...body }, body);
        g.events.set(ev.id, ev);
        return reply(200, ev);
      }
      if (!g.events.has(id)) return reply(404, { error: { code: 404, message: 'Not Found' } });
      if (method === 'GET') return reply(200, g.events.get(id));
      if (method === 'PATCH') {
        const body = JSON.parse(options.body);
        const ev = withMeet({ ...g.events.get(id), ...body }, body);
        g.events.set(id, ev);
        return reply(200, ev);
      }
      if (method === 'DELETE') { g.events.delete(id); return { ok: true, status: 204, statusText: '', json: async () => null }; }
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
    assert.equal(row.google_event_id, 'evt_1');

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
    assert.equal(row.google_event_id, 'evt_1', 'the event is remembered, so a retry does not make a second one');
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
    assert.equal(ctx.google.events.get('evt_1').start.dateTime, free[4].startsAt, 'the event moved with it');
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
