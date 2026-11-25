'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Booking calendar, slice 3 of 6 (SC-911) — the visitor's door,
 * routes/bookingPublic.js, driven end to end.
 *
 * The REAL route, the REAL booking store and the real free-time calculator,
 * over the fake database that reads its schema from docs/SQL/booking_setup.sql
 * — so the unique index that decides a booking race is the one the SQL file
 * declares, not one this test invents. Only three things are swapped: the
 * database client, the host check (this test is not about domains;
 * publicHostBinding.test.js is), and the two CRM stores, as an in-memory CRM
 * that refuses a second contact with the same email the way the real one does.
 */

const SQL_TEXT = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SQL', 'booking_setup.sql'), 'utf8');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const resolve = (p) => require.resolve(`../../${p}`);
const SWAPPED = {
  supabase: resolve('lib/supabase.js'),
  hostBinding: resolve('lib/publicSiteHostBinding.js'),
  crmConfig: resolve('lib/crmConfigStore.js'),
  crmContacts: resolve('lib/crmContactsStore.js'),
};
const RELOADED = ['lib/projectScope.js', 'lib/bookingStore.js', 'routes/bookingPublic.js'].map(resolve);

const PROJECT = 'proj_a';
const OTHER_PROJECT = 'proj_b';
const OPEN_ALL_DAY = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ start: '00:00', end: '24:00' }]])
);

function fakeCrm({ configs = [{ id: 'crm_1', name: 'CRM' }] } = {}) {
  const contacts = [];
  let n = 0;
  return {
    contacts,
    config: { listConfigs: async () => configs, getLastConfigStoreError: () => '' },
    contactsStore: {
      createContact: async (input, scope) => {
        if (contacts.some((c) => c.crmConfigId === input.crmConfigId && c.email === input.email)) {
          const err = new Error('A contact with this email already exists in this CRM.');
          err.code = 'DUPLICATE_EMAIL';
          throw err;
        }
        const contact = { id: `crmct_${(n += 1)}`, projectId: scope.projectId, ...input };
        contacts.push(contact);
        return contact;
      },
      findContactByEmail: async (configId, email) =>
        contacts.find((c) => c.crmConfigId === configId && c.email === email) || null,
    },
  };
}

function setup(crmOptions) {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const crm = fakeCrm(crmOptions);
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
  // Every request in this file arrives on the client's own domain for PROJECT.
  swap(SWAPPED.hostBinding, {
    resolvePublicProjectForRequest: async (_req, claimed) => (
      claimed && claimed !== PROJECT
        ? { ok: false, status: 403, error: 'Project not available on this domain', code: 'PROJECT_HOST_MISMATCH' }
        : { ok: true, projectId: PROJECT }
    ),
  });
  swap(SWAPPED.crmConfig, crm.config);
  swap(SWAPPED.crmContacts, crm.contactsStore);
  for (const p of RELOADED) delete require.cache[p];
  const route = require(resolve('routes/bookingPublic.js'));
  const store = require(resolve('lib/bookingStore.js'));
  function restore() {
    for (const [file, previous] of saved.entries()) {
      if (previous) require.cache[file] = previous;
      else delete require.cache[file];
    }
    for (const p of RELOADED) delete require.cache[p];
  }
  return { db, crm, route, store, restore };
}

let nextIp = 1;
async function call(route, method, url, body) {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (status) => { res.statusCode = status; };
  res.end = (chunk) => { res.body = chunk || ''; };
  const req = {
    method,
    url,
    headers: { host: 'client.example.com', 'user-agent': 'test' },
    socket: { remoteAddress: `198.51.100.${nextIp++}` },
    ...(body === undefined ? {} : { body }),
  };
  const pathname = url.split('?')[0];
  const handled = await route.handle(req, res, pathname, method);
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload };
}

async function openCalendar(ctx, settings = {}) {
  const made = await ctx.store.createCalendar({
    weeklyHours: OPEN_ALL_DAY, minNoticeMinutes: 0, daysAhead: 30, meetingMinutes: 30,
    messaging: { heading: 'Book a call', intro: 'Pick a time', confirmation: 'See you soon!', confirmationEmailSubject: 'PRIVATE subject', confirmationEmailBody: 'PRIVATE body', reminderEmailSubject: '', reminderEmailBody: '' },
    ...settings,
  }, { projectId: PROJECT, userId: 'owner_1' });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.data;
}

async function firstFreeSlot(ctx, calendarId) {
  const read = await call(ctx.route, 'GET', `/api/public/booking/calendar?calendarId=${calendarId}`);
  assert.equal(read.status, 200, JSON.stringify(read.payload));
  assert.ok(read.payload.data.slots.length > 0, 'an open calendar offers times');
  return read.payload.data.slots[1];
}

const VISITOR = { name: 'Pat van Visitor', email: 'Pat@Example.com', phone: '555-0100', note: 'About the summer camp' };

test('the visitor reads the wording and free times, and nothing private', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const read = await call(ctx.route, 'GET', `/api/public/booking/calendar?calendarId=${cal.id}`);
    assert.equal(read.status, 200);
    const data = read.payload.data;
    assert.equal(data.calendar.heading, 'Book a call');
    assert.equal(data.calendar.timeZone, 'America/Denver');
    assert.equal(data.days, 31, 'today plus 30 days ahead');
    assert.ok(data.slots.length > 100);
    assert.doesNotMatch(JSON.stringify(read.payload), /PRIVATE/, 'the email wording stays with the operator');
  } finally {
    ctx.restore();
  }
});

test('with no calendar named, the project\'s first calendar is shown; with none at all, NO_CALENDAR', async () => {
  const ctx = setup();
  try {
    const none = await call(ctx.route, 'GET', '/api/public/booking/calendar');
    assert.equal(none.status, 404);
    assert.equal(none.payload.error.code, 'NO_CALENDAR');
    const cal = await openCalendar(ctx);
    const read = await call(ctx.route, 'GET', '/api/public/booking/calendar');
    assert.equal(read.status, 200);
    assert.equal(read.payload.data.calendar.id, cal.id);
  } finally {
    ctx.restore();
  }
});

test('another project\'s calendar is not reachable from this site', async () => {
  const ctx = setup();
  try {
    const theirs = await ctx.store.createCalendar({}, { projectId: OTHER_PROJECT, userId: 'u2' });
    const read = await call(ctx.route, 'GET', `/api/public/booking/calendar?calendarId=${theirs.data.id}`);
    assert.equal(read.status, 404);
    const claimed = await call(ctx.route, 'GET', `/api/public/booking/calendar?projectId=${OTHER_PROJECT}`);
    assert.equal(claimed.status, 403);
  } finally {
    ctx.restore();
  }
});

test('booking a time creates one CRM contact and one booking linked to it by id', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const slot = await firstFreeSlot(ctx, cal.id);
    const booked = await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR });
    assert.equal(booked.status, 200, JSON.stringify(booked.payload));
    assert.equal(booked.payload.data.confirmation, 'See you soon!');
    assert.equal(booked.payload.data.booking.startsAt, slot.startsAt);
    assert.equal(booked.payload.data.booking.endsAt, slot.endsAt);

    assert.equal(ctx.crm.contacts.length, 1);
    const contact = ctx.crm.contacts[0];
    assert.equal(contact.email, 'pat@example.com');
    assert.deepEqual(contact.data, { first_name: 'Pat', last_name: 'van Visitor', phone: '555-0100' });
    assert.equal(contact.projectId, PROJECT);

    const rows = ctx.db.data.get('bookings');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].crm_contact_id, contact.id, 'filed under the contact by its id');
    assert.equal(rows[0].project_id, PROJECT, 'the booking carries its tenant');
    assert.equal(rows[0].visitor_note, 'About the summer camp');

    const after = await call(ctx.route, 'GET', `/api/public/booking/calendar?calendarId=${cal.id}`);
    assert.ok(!after.payload.data.slots.some((s) => s.startsAt === slot.startsAt), 'the booked time is no longer offered');
  } finally {
    ctx.restore();
  }
});

test('a returning visitor is matched to their existing CRM contact, not added twice', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const read = await call(ctx.route, 'GET', `/api/public/booking/calendar?calendarId=${cal.id}`);
    const [a, , b] = read.payload.data.slots;
    assert.equal((await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: a.startsAt, ...VISITOR })).status, 200);
    assert.equal((await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: b.startsAt, ...VISITOR, email: 'pat@example.com' })).status, 200);
    assert.equal(ctx.crm.contacts.length, 1);
    const rows = ctx.db.data.get('bookings');
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.crm_contact_id === ctx.crm.contacts[0].id));
  } finally {
    ctx.restore();
  }
});

test('double-booking guard: two bookings for one time sent at once, exactly one wins', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const slot = await firstFreeSlot(ctx, cal.id);
    const [one, two] = await Promise.all([
      call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR }),
      call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, name: 'Sam Second', email: 'sam@example.com' }),
    ]);
    const statuses = [one.status, two.status].sort();
    assert.deepEqual(statuses, [200, 409], `one wins, one is refused (got ${one.status} and ${two.status})`);
    const loser = one.status === 409 ? one : two;
    assert.equal(loser.payload.error.message, 'That time was just taken, please pick another.');

    const rows = ctx.db.data.get('bookings').filter((r) => r.starts_at && Date.parse(r.starts_at) === Date.parse(slot.startsAt));
    assert.equal(rows.length, 1, 'no second booking row exists');
    assert.equal(ctx.crm.contacts.length, 1, 'the visitor who lost the race was not added to the CRM');

    const late = await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, name: 'Late', email: 'late@example.com' });
    assert.equal(late.status, 409, 'a booking for a time already taken is refused before it reaches the database');
    assert.equal(late.payload.error.message, 'That time was just taken, please pick another.');
  } finally {
    ctx.restore();
  }
});

test('a time the calendar never offered is refused, and nothing is written', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx, { weeklyHours: { ...OPEN_ALL_DAY, sun: [], sat: [] } });
    const slot = await firstFreeSlot(ctx, cal.id);
    const offGrid = new Date(Date.parse(slot.startsAt) + 7 * 60000).toISOString();
    const refused = await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: offGrid, ...VISITOR });
    assert.equal(refused.status, 400);
    assert.equal(refused.payload.error.code, 'NOT_OFFERED');
    assert.equal((ctx.db.data.get('bookings') || []).length, 0);
    assert.equal(ctx.crm.contacts.length, 0);
  } finally {
    ctx.restore();
  }
});

test('missing name or bad email is refused in plain words before anything is read', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const slot = await firstFreeSlot(ctx, cal.id);
    const noName = await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR, name: ' ' });
    assert.equal(noName.payload.error.message, 'Please enter your name.');
    const badEmail = await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR, email: 'pat' });
    assert.equal(badEmail.payload.error.message, 'Please enter a valid email address.');
    assert.equal((ctx.db.data.get('bookings') || []).length, 0);
  } finally {
    ctx.restore();
  }
});

test('the honeypot answers cheerfully and writes nothing', async () => {
  const ctx = setup();
  try {
    const cal = await openCalendar(ctx);
    const slot = await firstFreeSlot(ctx, cal.id);
    const bot = await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR, _trap: 'http://spam' });
    assert.equal(bot.status, 200);
    assert.equal((ctx.db.data.get('bookings') || []).length, 0);
    assert.equal(ctx.crm.contacts.length, 0);
  } finally {
    ctx.restore();
  }
});

test('a project with no CRM still books the meeting, unlinked', async () => {
  const ctx = setup({ configs: [] });
  try {
    const cal = await openCalendar(ctx);
    const slot = await firstFreeSlot(ctx, cal.id);
    const warn = console.warn;
    const warned = [];
    console.warn = (line) => warned.push(String(line));
    let booked;
    try {
      booked = await call(ctx.route, 'POST', '/api/public/booking/book', { calendarId: cal.id, startsAt: slot.startsAt, ...VISITOR });
    } finally {
      console.warn = warn;
    }
    assert.equal(booked.status, 200);
    assert.equal(ctx.db.data.get('bookings')[0].crm_contact_id, null);
    assert.match(warned.join('\n'), /no CRM contact: this project has no CRM/, 'the missing link is said, not swallowed');
  } finally {
    ctx.restore();
  }
});

test('the dispatcher runs this door ahead of the rest of /api/public', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  const list = src.slice(src.indexOf('const ROUTE_MODULES = ['));
  const at = (name) => list.indexOf(`\n  ${name},\n`);
  assert.ok(at('bookingPublic') > 0, 'bookingPublic is registered');
  assert.ok(at('publicSite') > 0, 'publicSite is registered');
  assert.ok(at('bookingPublic') < at('publicSite'), 'and ahead of publicSite, which 404s unknown /api/public paths');
});
