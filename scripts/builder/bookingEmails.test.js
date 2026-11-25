'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Booking calendar, slice 4 of 6 (SC-912): the booking emails, the "add to
 * calendar" file, and the visitor's private cancel/reschedule link.
 *
 * The REAL routes (routes/bookingPublic.js, routes/bookingManage.js), the REAL
 * store and email builder, over the fake database that reads its schema from
 * BOTH booking SQL files, in the order they run. Swapped: the database client,
 * the host check, the CRM stores, the project-name and alert-address lookups,
 * and the mailer, which records every message instead of sending it (and can
 * be told to refuse, which is how "a forced email failure" is forced).
 */

const SQL_TEXT = ['booking_setup.sql', 'booking_notifications.sql']
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
  'routes/bookingPublic.js', 'routes/bookingManage.js',
].map(resolve);

const PROJECT = 'proj_a';
const OTHER_PROJECT = 'proj_b';
const OPEN_ALL_DAY = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ start: '00:00', end: '24:00' }]])
);
const VISITOR = { name: 'Pat van Visitor', email: 'pat@example.com', phone: '555-0100', note: 'About the summer camp' };

function setup({ alertEmails = ['owner@client.example'], mailFails = () => null } = {}) {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const sent = [];
  const contacts = [];
  const saved = new Map();
  const swap = (file, exports) => {
    saved.set(file, require.cache[file]);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  swap(SWAPPED.supabase, {
    isConfigured: () => true,
    tableConfig: () => ({ bookingCalendars: 'booking_calendars', bookings: 'bookings' }),
    sbQuery: (req) => db.sbQuery(req),
  });
  swap(SWAPPED.hostBinding, {
    resolvePublicProjectForRequest: async (_req, claimed) => (
      claimed && claimed !== PROJECT
        ? { ok: false, status: 403, error: 'Project not available on this domain', code: 'PROJECT_HOST_MISMATCH' }
        : { ok: true, projectId: PROJECT }
    ),
  });
  swap(SWAPPED.crmConfig, { listConfigs: async () => [{ id: 'crm_1' }], getLastConfigStoreError: () => '' });
  swap(SWAPPED.crmContacts, {
    createContact: async (input) => { const c = { id: `crmct_${contacts.length + 1}`, ...input }; contacts.push(c); return c; },
    findContactByEmail: async () => null,
  });
  swap(SWAPPED.mailer, {
    sendEmail: async (message) => {
      const refusal = mailFails(message);
      sent.push({ ...message, refused: Boolean(refusal) });
      return refusal ? { ok: false, status: 422, error: refusal } : { ok: true, status: 200, data: { id: `email_${sent.length}` } };
    },
  });
  swap(SWAPPED.projects, { getPublicProjectById: async () => ({ ok: true, data: { name: 'Delray Tennis' } }) });
  swap(SWAPPED.siteSettings, { getContactAlertEmails: async () => alertEmails });
  for (const p of RELOADED) delete require.cache[p];
  const publicRoute = require(resolve('routes/bookingPublic.js'));
  const manageRoute = require(resolve('routes/bookingManage.js'));
  const store = require(resolve('lib/bookingStore.js'));
  function restore() {
    for (const [file, previous] of saved.entries()) {
      if (previous) require.cache[file] = previous;
      else delete require.cache[file];
    }
    for (const p of RELOADED) delete require.cache[p];
  }
  return { db, sent, contacts, publicRoute, manageRoute, store, restore };
}

let nextIp = 1;
async function call(route, method, url, body) {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers || {}); };
  res.end = (chunk) => { res.body = chunk || ''; };
  const req = {
    method,
    url,
    headers: { host: 'client.example.com', 'user-agent': 'test' },
    socket: { remoteAddress: `203.0.113.${nextIp++ % 250}` },
    ...(body === undefined ? {} : { body }),
  };
  const handled = await route.handle(req, res, url.split('?')[0], method);
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload, body: res.body, headers: res.headers };
}

async function openCalendar(ctx, messaging = {}) {
  const made = await ctx.store.createCalendar({
    name: 'Tennis lesson',
    timeZone: 'America/Denver',
    weeklyHours: OPEN_ALL_DAY, minNoticeMinutes: 0, daysAhead: 30, meetingMinutes: 30,
    messaging: {
      heading: '', intro: '', confirmation: '',
      confirmationEmailSubject: 'See you on the court', confirmationEmailBody: 'Bring water and a racquet.',
      reminderEmailSubject: '', reminderEmailBody: '',
      ...messaging,
    },
  }, { projectId: PROJECT, userId: 'owner_1' });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.data;
}

async function slots(ctx, calendarId) {
  const read = await call(ctx.publicRoute, 'GET', `/api/public/booking/calendar?calendarId=${calendarId}`);
  assert.equal(read.status, 200, JSON.stringify(read.payload));
  return read.payload.data.slots;
}

async function book(ctx, cal, slot, visitor = VISITOR) {
  const res = await call(ctx.publicRoute, 'POST', '/api/public/booking/book', {
    calendarId: cal.id, startsAt: slot.startsAt, timeZone: 'Europe/London', ...visitor,
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  return res.payload.data.booking;
}

function tokenFrom(message) {
  const m = /[?&]token=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(m, `the email carries the manage link: ${message.text}`);
  return m[1];
}

function icsOf(message) {
  assert.equal(message.attachments.length, 1, 'one calendar file');
  const [file] = message.attachments;
  assert.equal(file.filename, 'meeting.ics');
  assert.match(file.contentType, /^text\/calendar/);
  return Buffer.from(file.content, 'base64').toString('utf8');
}

function rowOf(ctx, id) {
  return ctx.db.data.get('bookings').find((r) => r.id === id);
}

// ── The calendar file ───────────────────────────────────────────────────────

test('the .ics is a valid single event in UTC, escaped and folded the way RFC 5545 says', () => {
  const { buildIcs } = require('../../lib/bookingEmails.js');
  const ics = buildIcs({
    uid: 'b1@booking.starcaster',
    startsAt: '2026-12-01T17:00:00.000Z',
    endsAt: '2026-12-01T17:30:00.000Z',
    summary: 'Lesson, with Pat; court 2',
    description: `Line one\nLine two ${'é'.repeat(60)}`,
    sequence: 0,
    now: Date.parse('2026-11-24T12:00:00Z'),
  });
  assert.ok(ics.endsWith('\r\n'));
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /\n/, 'every line ends CRLF, no bare newline');
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.includes('DTSTART:20261201T170000Z'));
  assert.ok(lines.includes('DTEND:20261201T173000Z'));
  assert.ok(lines.includes('DTSTAMP:20261124T120000Z'));
  assert.ok(lines.includes('SUMMARY:Lesson\\, with Pat\\; court 2'));
  for (const line of lines) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
  // Unfold and the accented description comes back whole.
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, new RegExp(`DESCRIPTION:Line one\\\\nLine two ${'é'.repeat(60)}`));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('a moved meeting\'s file has a higher SEQUENCE, so calendar apps replace the old entry', () => {
  const { icsSequence } = require('../../lib/bookingEmails.js');
  assert.equal(icsSequence({ createdAt: '2026-11-24T10:00:00Z', rescheduledAt: null }), 0);
  const once = icsSequence({ createdAt: '2026-11-24T10:00:00Z', rescheduledAt: '2026-11-24T10:00:00.400Z' });
  const twice = icsSequence({ createdAt: '2026-11-24T10:00:00Z', rescheduledAt: '2026-11-25T09:00:00Z' });
  assert.ok(once >= 1, 'a move within the first second still counts');
  assert.ok(twice > once);
});

// ── Booking ─────────────────────────────────────────────────────────────────

test('booking sends exactly two emails, each with the right .ics, and records them as sent', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const slot = (await slots(ctx, cal.id))[3];
    const booking = await book(ctx, cal, slot);
    assert.equal(ctx.sent.length, 2, 'one to the visitor, one to the site owner');
    const [visitor, owner] = ctx.sent;

    assert.equal(visitor.to, 'pat@example.com');
    assert.equal(visitor.subject, 'See you on the court', 'the Booking Manager\'s subject');
    assert.match(visitor.text, /Bring water and a racquet\./, 'the Booking Manager\'s wording');
    assert.match(visitor.text, /GMT|BST/, 'the visitor reads their own time zone (London)');
    assert.deepEqual(visitor.replyTo, ['owner@client.example'], 'Reply reaches the team');
    assert.match(visitor.text, new RegExp(`https://client\\.example\\.com/api/public/booking/manage\\?projectId=${PROJECT}&token=`));

    assert.deepEqual(owner.to, ['owner@client.example']);
    assert.equal(owner.replyTo, 'pat@example.com', 'Reply reaches the visitor');
    assert.match(owner.subject, /^New booking: Pat van Visitor, /);
    assert.match(owner.text, /About the summer camp/);
    assert.match(owner.text, /MST|MDT/, 'the owner reads the calendar\'s zone (Denver)');
    assert.match(owner.text, /https:\/\/client\.example\.com\/admin-contact-manager\?contact=crmct_1/, 'the CRM contact, by id');
    assert.doesNotMatch(owner.text, /token=/, 'the visitor\'s private link stays in the visitor\'s email');

    const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    for (const message of [visitor, owner]) {
      const ics = icsOf(message);
      assert.match(ics, new RegExp(`DTSTART:${stamp(slot.startsAt)}\r\n`));
      assert.match(ics, new RegExp(`DTEND:${stamp(slot.endsAt)}\r\n`));
      assert.match(ics, new RegExp(`UID:${booking.id}@booking\\.starcaster\r\n`));
    }
    const row = rowOf(ctx, booking.id);
    assert.equal(row.notify_status, 'sent');
    assert.equal(row.notify_error, null);
    assert.equal(row.visitor_time_zone, 'Europe/London');
    assert.equal(tokenFrom(visitor), row.manage_token, 'the link carries THIS booking\'s token');
    assert.match(row.manage_token, /^[A-Za-z0-9_-]{32}$/);
  } finally {
    ctx.restore();
  }
});

test('blank Messaging wording falls back to a plain default, never an empty email', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx, { confirmationEmailSubject: '', confirmationEmailBody: '' });
    await book(ctx, cal, (await slots(ctx, cal.id))[0]);
    const [visitor] = ctx.sent;
    assert.equal(visitor.subject, 'Your Tennis lesson with Delray Tennis is booked');
    assert.match(visitor.text, /Thank you for booking a time with Delray Tennis/);
  } finally {
    ctx.restore();
  }
});

test('a forced email failure leaves the booking saved and marked "email not sent", with the reason', async () => {
  const ctx = setup({ mailFails: (m) => (m.to === 'pat@example.com' ? 'The domain is not verified' : null) });
  try {
    const cal = await openCalendar(ctx);
    const slot = (await slots(ctx, cal.id))[0];
    const booking = await book(ctx, cal, slot);
    const row = rowOf(ctx, booking.id);
    assert.equal(row.status, 'booked', 'the meeting stands');
    assert.equal(row.notify_status, 'failed');
    assert.match(row.notify_error, /visitor was not emailed: The domain is not verified/);

    // And the operator's list carries it, which is what the Booking Manager shows.
    const listed = await ctx.store.listBookings(10, cal.id, {}, { projectId: PROJECT, userId: '' });
    assert.equal(listed.data[0].notifyStatus, 'failed');
    assert.match(listed.data[0].notifyError, /not verified/);
    assert.equal('manageToken' in listed.data[0], false, 'the operator\'s list never carries the visitor\'s secret');
  } finally {
    ctx.restore();
  }
});

test('no Contact Alert Email is a failure that says so, not a silent skip', async () => {
  const ctx = setup({ alertEmails: [] });
  try {
    const cal = await openCalendar(ctx);
    const booking = await book(ctx, cal, (await slots(ctx, cal.id))[0]);
    assert.equal(ctx.sent.length, 1, 'the visitor is still emailed');
    const row = rowOf(ctx, booking.id);
    assert.equal(row.notify_status, 'failed');
    assert.match(row.notify_error, /no Contact Alert Email is set on the Settings page/);
  } finally {
    ctx.restore();
  }
});

// ── Cancel ──────────────────────────────────────────────────────────────────

test('the cancel link cancels once; a second click says "already cancelled" and sends nothing', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const slot = (await slots(ctx, cal.id))[2];
    const booking = await book(ctx, cal, slot);
    const token = tokenFrom(ctx.sent[0]);

    const first = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/cancel', { token });
    assert.equal(first.status, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.data.alreadyCancelled, false);
    assert.equal(rowOf(ctx, booking.id).status, 'cancelled');
    assert.equal(ctx.sent.length, 4, 'a fresh email to each side');
    const [visitor, owner] = ctx.sent.slice(2);
    assert.match(visitor.subject, /is cancelled/);
    assert.match(owner.subject, /^Booking cancelled: Pat van Visitor/);
    assert.deepEqual(visitor.attachments, [], 'no calendar file for a cancellation');

    const second = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/cancel', { token });
    assert.equal(second.status, 200, 'not an error');
    assert.equal(second.payload.data.alreadyCancelled, true);
    assert.equal(second.payload.data.message, 'This meeting is already cancelled.');
    assert.equal(ctx.sent.length, 4, 'no second round of emails');

    // The time is free again.
    assert.ok((await slots(ctx, cal.id)).some((s) => s.startsAt === slot.startsAt));
  } finally {
    ctx.restore();
  }
});

test('a token that matches nothing, or is malformed, opens nothing', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    await book(ctx, cal, (await slots(ctx, cal.id))[0]);
    for (const token of ['', 'short', 'A'.repeat(32), `${tokenFrom(ctx.sent[0])}x`]) {
      const res = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/cancel', { token });
      assert.equal(res.status, 404, `token ${JSON.stringify(token)}`);
      assert.equal(res.payload.error.code, 'NO_BOOKING');
    }
    // Claiming another project on this site is refused before any lookup.
    const other = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/cancel', { projectId: OTHER_PROJECT, token: tokenFrom(ctx.sent[0]) });
    assert.equal(other.status, 403);
    assert.equal(ctx.db.data.get('bookings').filter((r) => r.status === 'cancelled').length, 0);
  } finally {
    ctx.restore();
  }
});

// ── Reschedule ──────────────────────────────────────────────────────────────

test('rescheduling frees the old time and takes the new one in one step, and emails both sides', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const free = await slots(ctx, cal.id);
    const oldSlot = free[1];
    const newSlot = free[6];
    const booking = await book(ctx, cal, oldSlot);
    const token = tokenFrom(ctx.sent[0]);

    const details = await call(ctx.manageRoute, 'GET', `/api/public/booking/manage/details?token=${token}`);
    assert.equal(details.status, 200, JSON.stringify(details.payload));
    assert.equal(details.payload.data.booking.startsAt, oldSlot.startsAt);
    assert.ok(details.payload.data.slots.some((s) => s.startsAt === newSlot.startsAt));
    assert.ok(!details.payload.data.slots.some((s) => s.startsAt === oldSlot.startsAt), 'their own time is not offered back');

    const moved = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: newSlot.startsAt });
    assert.equal(moved.status, 200, JSON.stringify(moved.payload));
    const rows = ctx.db.data.get('bookings');
    assert.equal(rows.length, 1, 'the same booking moved: no second row');
    assert.equal(rows[0].id, booking.id);
    assert.equal(new Date(rows[0].starts_at).toISOString(), newSlot.startsAt);
    assert.ok(rows[0].rescheduled_at);

    const now = await slots(ctx, cal.id);
    assert.ok(now.some((s) => s.startsAt === oldSlot.startsAt), 'the old time is free');
    assert.ok(!now.some((s) => s.startsAt === newSlot.startsAt), 'the new time is taken');

    assert.equal(ctx.sent.length, 4);
    const [visitor, owner] = ctx.sent.slice(2);
    assert.match(visitor.subject, /has moved/);
    assert.match(visitor.text, /Was: /);
    assert.match(owner.subject, /^Booking moved: Pat van Visitor/);
    const ics = icsOf(visitor);
    assert.match(ics, /SEQUENCE:[1-9]\d*\r\n/, 'replaces the entry already in their calendar');
    assert.match(ics, new RegExp(`UID:${booking.id}@booking\\.starcaster`), 'same UID as the first file');
  } finally {
    ctx.restore();
  }
});

test('rescheduling onto a time another visitor holds is refused and changes nothing', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const free = await slots(ctx, cal.id);
    await book(ctx, cal, free[1]);
    const token = tokenFrom(ctx.sent[0]);
    await book(ctx, cal, free[4], { ...VISITOR, email: 'sam@example.com', name: 'Sam' });

    const clash = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: free[4].startsAt });
    assert.equal(clash.status, 409);
    assert.equal(clash.payload.error.code, 'TAKEN');
    const mine = ctx.db.data.get('bookings').find((r) => r.manage_token === token);
    assert.equal(new Date(mine.starts_at).toISOString(), free[1].startsAt, 'still at the old time');
    assert.equal(ctx.sent.length, 4, 'no emails for a move that did not happen');

    const same = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: free[1].startsAt });
    assert.equal(same.status, 400);
    assert.equal(same.payload.error.code, 'SAME_TIME');
  } finally {
    ctx.restore();
  }
});

test('a cancelled meeting cannot be moved', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const free = await slots(ctx, cal.id);
    await book(ctx, cal, free[0]);
    const token = tokenFrom(ctx.sent[0]);
    await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/cancel', { token });
    const moved = await call(ctx.manageRoute, 'POST', '/api/public/booking/manage/reschedule', { token, startsAt: free[5].startsAt });
    assert.equal(moved.status, 409);
    assert.equal(moved.payload.error.code, 'CANCELLED');
  } finally {
    ctx.restore();
  }
});

// ── The page ────────────────────────────────────────────────────────────────

test('the manage page is not indexed, not cached, and cannot be broken out of by its link', async () => {
  const ctx = setup();
  try {
    const page = await call(ctx.manageRoute, 'GET', '/api/public/booking/manage?projectId=proj_a&token=%3C%2Fscript%3E%3Cscript%3Ealert(1)');
    assert.equal(page.status, 200);
    assert.match(page.headers['Content-Type'], /^text\/html/);
    assert.equal(page.headers['Cache-Control'], 'no-store');
    assert.match(page.body, /<meta name="robots" content="noindex, nofollow">/);
    assert.equal((page.body.match(/<\/script>/g) || []).length, 1, 'only the page\'s own closing tag');
    assert.match(page.body, /\\u003c\/script\\u003e/);
  } finally {
    ctx.restore();
  }
});

test('the dispatcher sends /api/public/booking/manage to the manage door, not the booking door', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  const manage = src.indexOf('  bookingManage,');
  const pub = src.indexOf('  bookingPublic,');
  assert.ok(manage > 0 && pub > 0 && manage < pub, 'bookingManage is registered ahead of bookingPublic');
});
