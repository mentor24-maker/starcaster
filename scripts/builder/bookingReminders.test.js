'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Booking calendar, slice 6 of 6 (SC-914): reminder emails before each
 * meeting.
 *
 * The REAL scheduled pass (lib/bookingRemindersRunDue.js), store, rules and
 * route, over the fake database that reads its schema from ALL THREE booking
 * SQL files in the order they run. Swapped: the database client, the project
 * and alert-address lookups, and the mailer, which records every message
 * instead of sending it and can be told to refuse.
 */

const SQL_TEXT = ['booking_setup.sql', 'booking_notifications.sql', 'booking_reminders.sql', 'booking_google_calendar.sql']
  .map((file) => fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SQL', file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const resolve = (p) => require.resolve(`../../${p}`);
const SWAPPED = {
  supabase: resolve('lib/supabase.js'),
  mailer: resolve('lib/mailer.js'),
  projects: resolve('lib/projectsStore.js'),
  siteSettings: resolve('lib/projectSiteSettingsStore.js'),
};
const RELOADED = [
  'lib/rateLimiter.js', 'lib/projectScope.js', 'lib/bookingStore.js', 'lib/bookingEmails.js',
  'lib/bookingReminders.js', 'lib/bookingRemindersStore.js', 'lib/bookingRemindersRunDue.js',
  'routes/bookingReminders.js',
].map(resolve);

const PROJECT = 'proj_a';
const OTHER_PROJECT = 'proj_b';
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-12-01T12:00:00.000Z');

function setup({ alertEmails = ['owner@client.example'], mailFails = () => null } = {}) {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const sent = [];
  const saved = new Map();
  const swap = (file, exports) => {
    saved.set(file, require.cache[file]);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  swap(SWAPPED.supabase, {
    isConfigured: () => true,
    tableConfig: () => ({ bookingCalendars: 'booking_calendars', bookings: 'bookings', bookingReminders: 'booking_reminders' }),
    sbQuery: (req) => db.sbQuery(req),
  });
  swap(SWAPPED.mailer, {
    sendEmail: async (message) => {
      const refusal = mailFails(message);
      sent.push({ ...message, refused: Boolean(refusal) });
      return refusal ? { ok: false, status: 422, error: refusal } : { ok: true, status: 200, data: { id: `email_${sent.length}` } };
    },
  });
  swap(SWAPPED.projects, {
    getPublicProjectById: async (id) => ({ ok: true, data: { name: id === PROJECT ? 'Delray Tennis' : 'Other', domain: id === PROJECT ? 'delraytennis.example' : '' } }),
  });
  swap(SWAPPED.siteSettings, { getContactAlertEmails: async () => alertEmails });
  for (const p of RELOADED) delete require.cache[p];
  const ctx = {
    db,
    sent,
    store: require(resolve('lib/bookingStore.js')),
    reminders: require(resolve('lib/bookingRemindersStore.js')),
    runDue: require(resolve('lib/bookingRemindersRunDue.js')),
    route: require(resolve('routes/bookingReminders.js')),
    restore() {
      for (const [file, previous] of saved.entries()) {
        if (previous) require.cache[file] = previous;
        else delete require.cache[file];
      }
      for (const p of RELOADED) delete require.cache[p];
    },
  };
  return ctx;
}

async function calendar(ctx, projectId = PROJECT, messaging = {}) {
  const made = await ctx.store.createCalendar({
    name: 'Tennis lesson',
    timeZone: 'America/Denver',
    messaging: {
      heading: '', intro: '', confirmation: '', confirmationEmailSubject: '', confirmationEmailBody: '',
      reminderEmailSubject: '', reminderEmailBody: '', ...messaging,
    },
  }, { projectId, userId: 'owner_1' });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.data;
}

/** A booking written straight into the table, so its created_at can be chosen. */
async function booking(ctx, cal, { startsAt, createdAt = T0, projectId = PROJECT, email = 'pat@example.com', status = 'booked' }) {
  const res = await ctx.db.sbQuery({
    method: 'POST',
    table: 'bookings',
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [{
      project_id: projectId,
      owner_user_id: 'owner_1',
      calendar_id: cal.id,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(startsAt + 30 * MINUTE).toISOString(),
      visitor_name: 'Pat Visitor',
      visitor_email: email,
      visitor_time_zone: 'Europe/London',
      manage_token: `tok_${Math.random().toString(36).slice(2)}_abcdefghijklmnopqrstuvwxyz`.slice(0, 40),
      status,
      created_at: new Date(createdAt).toISOString(),
    }],
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.data[0];
}

function remindersFor(ctx, bookingId) {
  return (ctx.db.data.get('booking_reminders') || []).filter((r) => r.booking_id === bookingId);
}

async function pass(ctx, now) {
  const result = await ctx.runDue.runDue({ now });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function call(route, method, url, { body, cron = false, projectId = PROJECT } = {}) {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers || {}); };
  res.end = (chunk) => { res.body = chunk || ''; };
  const req = {
    method,
    url,
    headers: { host: 'app.example.com' },
    socket: { remoteAddress: '203.0.113.9' },
    cronPublish: cron,
    projectContext: projectId ? { project: { id: projectId } } : null,
    authUser: { id: 'owner_1' },
    ...(body === undefined ? {} : { body }),
  };
  const handled = await route.handle(req, res, url.split('?')[0], method);
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload };
}

// ── The rules ───────────────────────────────────────────────────────────────

test('which reminder is due: the nearest open one, never one whose time passed before booking', () => {
  const { dueOffset } = require('../../lib/bookingReminders.js');
  const start = T0 + 3 * DAY;
  const offsets = [1440, 60];
  const made = T0;
  assert.equal(dueOffset({ startsAt: start, madeAt: made, offsetsMinutes: offsets, now: start - 25 * HOUR }), null, 'nothing open yet');
  assert.equal(dueOffset({ startsAt: start, madeAt: made, offsetsMinutes: offsets, now: start - 23 * HOUR }), 1440);
  assert.equal(dueOffset({ startsAt: start, madeAt: made, offsetsMinutes: offsets, now: start - 30 * MINUTE }), 60, 'both open: only the nearer one');
  assert.equal(dueOffset({ startsAt: start, madeAt: made, offsetsMinutes: offsets, now: start }), null, 'the meeting has started');
  // Booked two hours ahead: the day-before reminder never applies.
  assert.equal(dueOffset({ startsAt: start, madeAt: start - 2 * HOUR, offsetsMinutes: offsets, now: start - 90 * MINUTE }), null);
  assert.equal(dueOffset({ startsAt: start, madeAt: start - 2 * HOUR, offsetsMinutes: offsets, now: start - 59 * MINUTE }), 60);
});

test('reminder settings: NULL is the defaults; a save is checked and refused with the reason', () => {
  const { normalizeReminderSettings, reminderSettingsOrError } = require('../../lib/bookingReminders.js');
  assert.deepEqual(normalizeReminderSettings(null), { enabled: true, offsetsMinutes: [1440, 60], notifyOwner: false });
  assert.deepEqual(
    reminderSettingsOrError({ enabled: true, offsetsMinutes: [60, 1440, 60], notifyOwner: true }).value,
    { enabled: true, offsetsMinutes: [1440, 60], notifyOwner: true },
  );
  assert.match(reminderSettingsOrError({ enabled: true, offsetsMinutes: [], notifyOwner: false }).error, /at least one/);
  assert.match(reminderSettingsOrError({ enabled: true, offsetsMinutes: [2], notifyOwner: false }).error, /from 5/);
  assert.match(reminderSettingsOrError({ enabled: true, offsetsMinutes: [60, 120, 240, 480], notifyOwner: false }).error, /at most 3/);
  assert.match(reminderSettingsOrError({ enabled: 'yes', offsetsMinutes: [60], notifyOwner: false }).error, /enabled/);
  assert.match(reminderSettingsOrError({ enabled: true, offsetsMinutes: [60], notifyOwner: false, sms: true }).error, /Unknown field: sms/);
  assert.equal(reminderSettingsOrError({ enabled: false, offsetsMinutes: [], notifyOwner: false }).ok, true, 'switched off needs no times');
});

// ── The pass ────────────────────────────────────────────────────────────────

test('run twice, sends once: a due reminder goes out on the first pass and never again', async () => {
  const ctx = setup();
  try {
    const cal = await calendar(ctx, PROJECT, { reminderEmailSubject: 'See you tomorrow', reminderEmailBody: 'Bring water.' });
    const b = await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    const now = T0 + 3 * DAY - 23 * HOUR;

    const first = await pass(ctx, now);
    assert.equal(first.sent.length, 1);
    assert.equal(ctx.sent.length, 1);
    const [mail] = ctx.sent;
    assert.equal(mail.to, 'pat@example.com');
    assert.equal(mail.subject, 'See you tomorrow');
    assert.match(mail.text, /Bring water\./);
    assert.match(mail.text, /GMT|London|Thursday/, 'in the visitor\'s own time zone');
    assert.match(mail.text, /https:\/\/delraytennis\.example\/api\/public\/booking\/manage\?projectId=proj_a&token=tok_/, 'the cancel or move link, on the client\'s own site');

    const second = await pass(ctx, now + MINUTE);
    assert.equal(second.sent.length, 0);
    assert.equal(ctx.sent.length, 1, 'still one email');

    const rows = remindersFor(ctx, b.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'sent');
    assert.equal(rows[0].project_id, PROJECT, 'the reminder row carries its tenant');
    assert.equal(rows[0].owner_user_id, 'owner_1');

    // Later the hour-before reminder opens: that is a different reminder, sent once.
    await pass(ctx, T0 + 3 * DAY - 50 * MINUTE);
    await pass(ctx, T0 + 3 * DAY - 45 * MINUTE);
    assert.equal(ctx.sent.length, 2);
  } finally {
    ctx.restore();
  }
});

test('two passes at once still send a reminder once', async () => {
  const ctx = setup();
  try {
    const cal = await calendar(ctx);
    await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    const now = T0 + 3 * DAY - 23 * HOUR;
    await Promise.all([ctx.runDue.runDue({ now }), ctx.runDue.runDue({ now })]);
    assert.equal(ctx.sent.length, 1);
  } finally {
    ctx.restore();
  }
});

test('cancelled gets none: a meeting cancelled before its reminder time is never reminded', async () => {
  const ctx = setup();
  try {
    const cal = await calendar(ctx);
    const b = await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    const cancelled = await ctx.store.cancelBooking(b.id, { projectId: PROJECT, userId: 'owner_1' });
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    const report = await pass(ctx, T0 + 3 * DAY - 23 * HOUR);
    assert.equal(report.looked, 0);
    await pass(ctx, T0 + 3 * DAY - 30 * MINUTE);
    assert.equal(ctx.sent.length, 0);
    assert.equal(remindersFor(ctx, b.id).length, 0);
  } finally {
    ctx.restore();
  }
});

test('a meeting cancelled between the read and the send is skipped, not reminded', async () => {
  const ctx = setup();
  try {
    const cal = await calendar(ctx);
    const b = await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    // Cancel it the moment the reminder is claimed, before the send.
    const realClaim = ctx.reminders.claimReminder;
    ctx.reminders.claimReminder = async (args) => {
      const claimed = await realClaim(args);
      await ctx.store.cancelBooking(b.id, { projectId: PROJECT, userId: 'owner_1' });
      return claimed;
    };
    const report = await pass(ctx, T0 + 3 * DAY - 23 * HOUR);
    ctx.reminders.claimReminder = realClaim;
    assert.equal(ctx.sent.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.equal(remindersFor(ctx, b.id)[0].status, 'skipped');
  } finally {
    ctx.restore();
  }
});

test('a failed send is retried on the next pass, and after three failures shows on the Booking Manager', async () => {
  let refuse = true;
  const ctx = setup({ mailFails: () => (refuse ? 'Resend refused the address' : null) });
  try {
    const cal = await calendar(ctx);
    const b = await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    const now = T0 + 3 * DAY - 23 * HOUR;

    let report = await pass(ctx, now);
    assert.equal(report.failed.length, 1);
    assert.equal(remindersFor(ctx, b.id)[0].attempts, 1);

    // Not yet given up: nothing shows on the Booking Manager.
    let shown = await call(ctx.route, 'GET', `/api/booking/calendars/${cal.id}/reminders`);
    assert.equal(shown.status, 200, JSON.stringify(shown.payload));
    assert.deepEqual(shown.payload.data.problems, []);

    await pass(ctx, now + 5 * MINUTE);
    report = await pass(ctx, now + 10 * MINUTE);
    assert.equal(report.failed.length, 1);
    assert.equal(remindersFor(ctx, b.id)[0].attempts, 3);
    assert.equal(ctx.sent.length, 3, 'three tries in all');

    // A fourth pass does not try again, even once the mail service would accept it.
    refuse = false;
    await pass(ctx, now + 15 * MINUTE);
    assert.equal(ctx.sent.length, 3);

    shown = await call(ctx.route, 'GET', `/api/booking/calendars/${cal.id}/reminders`);
    assert.equal(shown.payload.data.problems.length, 1);
    const [problem] = shown.payload.data.problems;
    assert.equal(problem.visitorEmail, 'pat@example.com');
    assert.equal(problem.recipient, 'visitor');
    assert.equal(problem.offsetMinutes, 1440);
    assert.match(problem.error, /Resend refused the address/);

    // Another project cannot see them.
    const other = await call(ctx.route, 'GET', `/api/booking/calendars/${cal.id}/reminders`, { projectId: OTHER_PROJECT });
    assert.equal(other.status, 404);
  } finally {
    ctx.restore();
  }
});

test('a failure on one side never re-sends the other: the owner\'s reminder is its own', async () => {
  const ctx = setup({ alertEmails: [] });
  try {
    const cal = await calendar(ctx);
    const saved = await ctx.reminders.saveReminderSettings(cal.id, { enabled: true, offsetsMinutes: [1440], notifyOwner: true }, { projectId: PROJECT, userId: 'owner_1' });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const b = await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    const now = T0 + 3 * DAY - 23 * HOUR;
    for (let i = 0; i < 4; i += 1) await pass(ctx, now + i * 5 * MINUTE); // eslint-disable-line no-await-in-loop
    assert.equal(ctx.sent.filter((m) => m.to === 'pat@example.com').length, 1, 'the visitor is emailed once');
    const owner = remindersFor(ctx, b.id).find((r) => r.recipient === 'owner');
    assert.equal(owner.status, 'failed');
    assert.equal(owner.attempts, 3);
    assert.match(owner.last_error, /no Contact Alert Email/);
  } finally {
    ctx.restore();
  }
});

test('the owner\'s reminder goes to the Contact Alert Email when asked for', async () => {
  const ctx = setup();
  try {
    const cal = await calendar(ctx);
    await ctx.reminders.saveReminderSettings(cal.id, { enabled: true, offsetsMinutes: [60], notifyOwner: true }, { projectId: PROJECT, userId: 'owner_1' });
    await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    await pass(ctx, T0 + 3 * DAY - 30 * MINUTE);
    assert.equal(ctx.sent.length, 2);
    const owner = ctx.sent.find((m) => Array.isArray(m.to));
    assert.deepEqual(owner.to, ['owner@client.example']);
    assert.equal(owner.replyTo, 'pat@example.com');
    assert.match(owner.subject, /^Reminder: Pat Visitor/);
  } finally {
    ctx.restore();
  }
});

test('switched off sends nothing; a moved meeting is reminded again for its new time', async () => {
  const ctx = setup();
  try {
    const cal = await calendar(ctx);
    const b = await booking(ctx, cal, { startsAt: T0 + 3 * DAY });
    await pass(ctx, T0 + 3 * DAY - 23 * HOUR);
    assert.equal(ctx.sent.length, 1);

    // Moved a day later, made well before its new reminder opens.
    const moved = await ctx.store.rescheduleBooking(b.id, {
      startsAt: new Date(T0 + 4 * DAY).toISOString(),
      endsAt: new Date(T0 + 4 * DAY + 30 * MINUTE).toISOString(),
    }, { projectId: PROJECT, userId: 'owner_1' });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    // rescheduled_at is the real clock (before T0), so the new day-before reminder applies.
    await pass(ctx, T0 + 4 * DAY - 23 * HOUR);
    assert.equal(ctx.sent.length, 2);

    await ctx.reminders.saveReminderSettings(cal.id, { enabled: false, offsetsMinutes: [60], notifyOwner: false }, { projectId: PROJECT, userId: 'owner_1' });
    await pass(ctx, T0 + 4 * DAY - 30 * MINUTE);
    assert.equal(ctx.sent.length, 2);
  } finally {
    ctx.restore();
  }
});

test('the Meet link rides in the reminder when slice 5 has stored one', () => {
  const { buildReminderEmails } = require('../../lib/bookingReminders.js');
  const base = {
    startsAt: '2026-12-01T17:00:00.000Z', endsAt: '2026-12-01T17:30:00.000Z',
    visitorName: 'Pat', visitorEmail: 'pat@example.com', visitorTimeZone: 'America/Denver',
  };
  const calendarShape = { name: 'Tennis lesson', timeZone: 'America/Denver', messaging: {} };
  const withLink = buildReminderEmails({ booking: { ...base, meetLink: 'https://meet.google.com/abc-defg-hij' }, calendar: calendarShape, siteName: 'Delray' });
  assert.match(withLink.visitor.text, /Video call: https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(withLink.visitor.html, /href="https:\/\/meet\.google\.com\/abc-defg-hij"/);
  assert.match(withLink.operator.text, /Video call/);
  const without = buildReminderEmails({ booking: base, calendar: calendarShape, siteName: 'Delray' });
  assert.doesNotMatch(without.visitor.text, /Video call/);
  assert.equal(without.visitor.subject, 'Reminder: your Tennis lesson with Delray');
  const hostile = buildReminderEmails({ booking: { ...base, visitorName: '<script>x</script>' }, calendar: calendarShape });
  assert.doesNotMatch(hostile.operator.html, /<script>/);
});

test('more than one page of meetings: every one is read, none twice, and a cut-off says so', async () => {
  const ctx = setup();
  try {
    const cals = [await calendar(ctx), await calendar(ctx), await calendar(ctx)];
    // 520 meetings, three to a start time (one per calendar), so the 500-row page
    // boundary falls INSIDE a tie: two of a start on page one, the third on page two.
    for (let i = 0; i < 520; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await booking(ctx, cals[i % 3], { startsAt: T0 + DAY + Math.floor(i / 3) * 30 * MINUTE, email: `v${i}@example.com` });
    }
    const all = await ctx.reminders.listUpcomingBookings({ now: T0, horizonMs: 7 * DAY });
    assert.equal(all.ok, true, JSON.stringify(all));
    assert.equal(all.data.bookings.length, 520);
    assert.equal(new Set(all.data.bookings.map((b) => b.id)).size, 520);
    assert.equal(all.data.truncated, false);
    const cut = await ctx.reminders.listUpcomingBookings({ now: T0, horizonMs: 7 * DAY, maxPages: 1 });
    assert.equal(cut.data.bookings.length, 500);
    assert.equal(cut.data.truncated, true);
  } finally {
    ctx.restore();
  }
});

// ── The route ───────────────────────────────────────────────────────────────

test('run-due answers only the scheduler; settings save, read back and refuse bad input', async () => {
  const ctx = setup();
  try {
    const cal = await calendar(ctx);
    const refused = await call(ctx.route, 'GET', '/api/booking/reminders/run-due');
    assert.equal(refused.status, 403);
    assert.equal(refused.payload.error.code, 'CRON_ONLY');
    const ran = await call(ctx.route, 'GET', '/api/booking/reminders/run-due', { cron: true, projectId: '' });
    assert.equal(ran.status, 200, JSON.stringify(ran.payload));

    const read = await call(ctx.route, 'GET', `/api/booking/calendars/${cal.id}/reminders`);
    assert.deepEqual(read.payload.data.settings, { enabled: true, offsetsMinutes: [1440, 60], notifyOwner: false });

    const savedRes = await call(ctx.route, 'PATCH', `/api/booking/calendars/${cal.id}/reminders`, {
      body: { enabled: true, offsetsMinutes: [120], notifyOwner: true },
    });
    assert.equal(savedRes.status, 200, JSON.stringify(savedRes.payload));
    assert.deepEqual(savedRes.payload.data, { enabled: true, offsetsMinutes: [120], notifyOwner: true });

    const bad = await call(ctx.route, 'PATCH', `/api/booking/calendars/${cal.id}/reminders`, {
      body: { enabled: true, offsetsMinutes: [1], notifyOwner: false },
    });
    assert.equal(bad.status, 400);

    const otherProject = await call(ctx.route, 'PATCH', `/api/booking/calendars/${cal.id}/reminders`, {
      body: { enabled: false, offsetsMinutes: [], notifyOwner: false }, projectId: OTHER_PROJECT,
    });
    assert.equal(otherProject.status, 404, 'another project\'s calendar is not found');
    const still = await ctx.reminders.getReminderSettings(cal.id, { projectId: PROJECT });
    assert.equal(still.data.enabled, true);

    const notMine = await call(ctx.route, 'GET', '/api/booking/calendars');
    assert.equal(notMine.handled, false, 'every other booking path is left to routes/booking.js');
  } finally {
    ctx.restore();
  }
});

test('the scheduled job is registered: Vercel runs it every five minutes and the dispatcher lets it in', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  const cron = vercel.crons.find((c) => c.path === '/api/booking/reminders/run-due');
  assert.ok(cron, 'vercel.json schedules it');
  assert.equal(cron.schedule, '*/5 * * * *');
  const index = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  assert.match(index, /'\/api\/booking\/reminders\/run-due',/, 'a CRON_PATHS entry, or the scheduler is refused');
  assert.ok(index.indexOf('  bookingReminders,') < index.indexOf('  booking,\n'), 'registered ahead of routes/booking.js');
});
