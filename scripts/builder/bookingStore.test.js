'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Booking calendar, slice 1 of 6 (SC-909) — where calendars and bookings live.
 *
 * Same harness as videoReelSpinnerStores.test.js: the fake database reads its
 * schema FROM docs/SQL/booking_setup.sql, so a tenant column deleted from the
 * SQL fails here (landmine 12). Tenant columns are checked on the stored ROW,
 * never trusted from the insert's answer.
 */

const SQL_FILE = path.join(__dirname, '..', '..', 'docs', 'SQL', 'booking_setup.sql');
// booking_notifications.sql (SC-912) runs after it and adds the email and
// manage-link columns the store now writes.
const SQL_TEXT = [SQL_FILE, path.join(__dirname, '..', '..', 'docs', 'SQL', 'booking_notifications.sql')]
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const STORE_PATHS = ['../../lib/projectScope.js', '../../lib/bookingStore.js'].map((p) => require.resolve(p));

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withDb() {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ bookingCalendars: 'booking_calendars', bookings: 'bookings' }),
    sbQuery: (req) => db.sbQuery(req),
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of STORE_PATHS) delete require.cache[p];
  const store = require(STORE_PATHS[1]);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  }
  return { db, store, restore };
}

function storedRows(db, table) {
  return db.data.get(table);
}

const MEETING = {
  startsAt: '2026-11-23T16:00:00.000Z',
  endsAt: '2026-11-23T16:30:00.000Z',
  visitorName: 'Pat Visitor',
  visitorEmail: 'pat@example.com',
};

// ── The tables ──────────────────────────────────────────────────────────────

test('both tables carry BOTH tenant columns and RLS', () => {
  const schema = parseSchemaText(SQL_TEXT);
  for (const name of ['booking_calendars', 'bookings']) {
    const table = schema.tables.get(name);
    assert.ok(table, `${name} is created`);
    for (const column of ['project_id', 'owner_user_id']) {
      assert.ok(table.columns.has(column), `${name}.${column} must exist (CLAUDE.md landmine 12)`);
    }
    assert.ok(schema.rlsEnabled.has(name), `${name} must have RLS on`);
  }
});

test('the SQL file says what breaks without it, and is safe to run twice', () => {
  // Each file carries its own FEATURE line; the second also says what it runs after.
  assert.equal((SQL_TEXT.match(/^-- FEATURE: \S.+$/gm) || []).length, 2);
  assert.match(SQL_TEXT, /^-- RUN AFTER docs\/SQL\/booking_setup\.sql$/m);
  const statements = SQL_TEXT
    .replace(/--.*$/gm, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '$$$$')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(statements.length >= 10, `read ${statements.length} statements`);
  for (const statement of statements) {
    assert.match(
      statement,
      /^(create table if not exists|create (unique )?index if not exists|create or replace function|drop trigger if exists|create trigger|alter table \S+ enable row level security|alter table \S+ add column if not exists)/i,
      `not safe to run twice: ${statement.slice(0, 80)}`
    );
  }
});

test('the booking statuses in the SQL are exactly the ones the store uses', () => {
  const { BOOKING_STATUSES } = require('../../lib/bookingStore.js');
  const schema = parseSchemaText(SQL_TEXT);
  assert.deepEqual(schema.tables.get('bookings').columns.get('status').allowed, BOOKING_STATUSES);
});

// ── Calendars ───────────────────────────────────────────────────────────────

test('a new calendar starts from the defaults and lands with this project on the row', async () => {
  const ctx = withDb();
  try {
    const made = await ctx.store.createCalendar({}, SCOPE_A);
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(made.data.meetingMinutes, 30);
    assert.equal(made.data.timeZone, 'America/Denver');
    assert.deepEqual(made.data.weeklyHours.mon, [{ start: '09:00', end: '17:00' }]);
    assert.deepEqual(made.data.weeklyHours.sat, []);
    const row = storedRows(ctx.db, 'booking_calendars')[0];
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.owner_user_id, 'user_1');
  } finally {
    ctx.restore();
  }
});

test('saving settings then reading them back returns the saved values', async () => {
  const ctx = withDb();
  try {
    const made = await ctx.store.createCalendar({ name: 'Strategy call' }, SCOPE_A);
    const settings = {
      timeZone: 'America/New_York',
      weeklyHours: { tue: [{ start: '13:00', end: '17:00' }, { start: '08:00', end: '10:00' }] },
      blockedDates: ['2026-12-25', '2026-12-24', '2026-12-25'],
      meetingMinutes: 45,
      gapMinutes: 15,
      minNoticeMinutes: 1440,
      daysAhead: 30,
      messaging: {
        heading: 'Book a call', intro: 'Pick a time that suits you.', confirmation: 'See you then!',
        confirmationEmailSubject: 'Your call is booked', confirmationEmailBody: 'See you on {date}.',
        reminderEmailSubject: 'Tomorrow: your call', reminderEmailBody: 'A reminder that we meet soon.',
      },
    };
    const saved = await ctx.store.saveCalendarSettings(made.data.id, settings, SCOPE_A);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const read = await ctx.store.getCalendarById(made.data.id, SCOPE_A);
    assert.equal(read.ok, true);
    for (const value of [saved.data, read.data]) {
      assert.equal(value.name, 'Strategy call');
      assert.equal(value.timeZone, 'America/New_York');
      assert.deepEqual(value.weeklyHours.tue, [{ start: '08:00', end: '10:00' }, { start: '13:00', end: '17:00' }]);
      assert.deepEqual(value.weeklyHours.mon, [], 'a day not sent is a day off');
      assert.deepEqual(value.blockedDates, ['2026-12-24', '2026-12-25']);
      assert.equal(value.meetingMinutes, 45);
      assert.equal(value.gapMinutes, 15);
      assert.equal(value.minNoticeMinutes, 1440);
      assert.equal(value.daysAhead, 30);
      assert.deepEqual(value.messaging, settings.messaging);
    }
    // The row itself, not the store's answer.
    const row = storedRows(ctx.db, 'booking_calendars')[0];
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.meeting_minutes, 45);
    assert.equal(row.time_zone, 'America/New_York');
  } finally {
    ctx.restore();
  }
});

test('bad settings are refused naming the field, and nothing is written', async () => {
  const ctx = withDb();
  try {
    const made = await ctx.store.createCalendar({}, SCOPE_A);
    const cases = [
      [{ timeZone: 'Mars/Olympus' }, /timeZone/],
      [{ meetingMinutes: 0 }, /meetingMinutes/],
      [{ meetingMinutes: '30' }, /meetingMinutes/],
      [{ weeklyHours: { mon: [{ start: '17:00', end: '09:00' }] } }, /ends before it starts/],
      [{ weeklyHours: { mon: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] } }, /before the window before it ends/],
      [{ weeklyHours: { funday: [] } }, /unknown day/],
      [{ blockedDates: ['Christmas'] }, /blockedDates/],
      [{ messaging: { footer: 'x' } }, /unknown field "footer"/],
      [{ messaging: { reminderEmailSubject: 'x'.repeat(201) } }, /reminderEmailSubject must be 200 characters/],
      [{ time_zone: 'UTC' }, /Unknown field: time_zone/],
      [{ name: '   ' }, /name cannot be empty/],
      [{}, /nothing to save/],
    ];
    for (const [input, message] of cases) {
      const result = await ctx.store.saveCalendarSettings(made.data.id, input, SCOPE_A);
      assert.equal(result.ok, false, JSON.stringify(input));
      assert.equal(result.status, 400, JSON.stringify(input));
      assert.match(result.error, message);
    }
    const row = storedRows(ctx.db, 'booking_calendars')[0];
    assert.equal(row.meeting_minutes, 30);
    assert.equal(row.time_zone, 'America/Denver');
  } finally {
    ctx.restore();
  }
});

test('list reads take the limit first', async () => {
  const ctx = withDb();
  try {
    const wrong = await ctx.store.listCalendars(SCOPE_A);
    assert.equal(wrong.ok, false);
    assert.match(wrong.error, /takes the limit first/);
  } finally {
    ctx.restore();
  }
});

// ── Another project ─────────────────────────────────────────────────────────

test('one project cannot read or change another project\'s calendar or bookings', async () => {
  const ctx = withDb();
  try {
    const mine = await ctx.store.createCalendar({ name: 'Mine' }, SCOPE_A);
    const booked = await ctx.store.createBooking(mine.data.id, MEETING, SCOPE_A);
    assert.equal(booked.ok, true, JSON.stringify(booked));

    const list = await ctx.store.listCalendars(50, SCOPE_B);
    assert.deepEqual(list.data, []);
    const read = await ctx.store.getCalendarById(mine.data.id, SCOPE_B);
    assert.equal(read.data, null);
    const save = await ctx.store.saveCalendarSettings(mine.data.id, { meetingMinutes: 90 }, SCOPE_B);
    assert.equal(save.status, 404);
    const bookings = await ctx.store.listBookings(50, mine.data.id, {}, SCOPE_B);
    assert.equal(bookings.status, 404);
    const intoTheirs = await ctx.store.createBooking(mine.data.id, MEETING, SCOPE_B);
    assert.equal(intoTheirs.status, 404);
    const cancel = await ctx.store.cancelBooking(booked.data.id, SCOPE_B);
    assert.equal(cancel.status, 404);

    // And nothing moved.
    assert.equal(storedRows(ctx.db, 'booking_calendars')[0].meeting_minutes, 30);
    assert.equal(storedRows(ctx.db, 'bookings').length, 1);
    assert.equal(storedRows(ctx.db, 'bookings')[0].status, 'booked');
  } finally {
    ctx.restore();
  }
});

// ── Bookings ────────────────────────────────────────────────────────────────

test('a booking lands with this project on the row, and lists by time range', async () => {
  const ctx = withDb();
  try {
    const cal = await ctx.store.createCalendar({}, SCOPE_A);
    const later = { ...MEETING, startsAt: '2026-11-24T16:00:00.000Z', endsAt: '2026-11-24T16:30:00.000Z', crmContactId: 'contact_9' };
    assert.equal((await ctx.store.createBooking(cal.data.id, later, SCOPE_A)).ok, true);
    assert.equal((await ctx.store.createBooking(cal.data.id, MEETING, SCOPE_A)).ok, true);
    for (const row of storedRows(ctx.db, 'bookings')) {
      assert.equal(row.project_id, 'proj_a');
      assert.equal(row.owner_user_id, 'user_1');
    }
    const all = await ctx.store.listBookings(50, cal.data.id, {}, SCOPE_A);
    assert.deepEqual(all.data.map((b) => b.startsAt), [MEETING.startsAt, later.startsAt], 'earliest first');
    assert.equal(all.data[1].crmContactId, 'contact_9');
    const monday = await ctx.store.listBookings(50, cal.data.id, {
      from: '2026-11-23T00:00:00Z', to: '2026-11-24T00:00:00Z',
    }, SCOPE_A);
    assert.deepEqual(monday.data.map((b) => b.startsAt), [MEETING.startsAt]);
  } finally {
    ctx.restore();
  }
});

test('the same start time cannot be booked twice until the first is cancelled', async () => {
  const ctx = withDb();
  try {
    const cal = await ctx.store.createCalendar({}, SCOPE_A);
    const first = await ctx.store.createBooking(cal.data.id, MEETING, SCOPE_A);
    const second = await ctx.store.createBooking(cal.data.id, { ...MEETING, visitorEmail: 'sam@example.com' }, SCOPE_A);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.match(second.error, /just been booked/);

    const cancelled = await ctx.store.cancelBooking(first.data.id, SCOPE_A);
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    assert.equal(cancelled.data.status, 'cancelled');
    assert.ok(cancelled.data.cancelledAt);
    assert.equal(storedRows(ctx.db, 'bookings')[0].status, 'cancelled');

    const again = await ctx.store.cancelBooking(first.data.id, SCOPE_A);
    assert.equal(again.status, 409);
    const rebooked = await ctx.store.createBooking(cal.data.id, MEETING, SCOPE_A);
    assert.equal(rebooked.ok, true, JSON.stringify(rebooked));
  } finally {
    ctx.restore();
  }
});

test('a malformed booking is refused naming the field', async () => {
  const ctx = withDb();
  try {
    const cal = await ctx.store.createCalendar({}, SCOPE_A);
    const cases = [
      [{ ...MEETING, endsAt: MEETING.startsAt }, /endsAt must be after/],
      [{ ...MEETING, visitorEmail: 'not-an-email' }, /not an email/],
      [{ ...MEETING, visitorName: '' }, /visitorName cannot be empty/],
      [{ ...MEETING, visitor_email: 'x@example.com' }, /Unknown field/],
    ];
    for (const [input, message] of cases) {
      const result = await ctx.store.createBooking(cal.data.id, input, SCOPE_A);
      assert.equal(result.status, 400, JSON.stringify(input));
      assert.match(result.error, message);
    }
    assert.equal(storedRows(ctx.db, 'bookings').length, 0);
  } finally {
    ctx.restore();
  }
});
