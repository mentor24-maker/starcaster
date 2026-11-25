'use strict';

/**
 * Booking reminders' rows (SC-914, slice 6 of 6). Table and column:
 * docs/SQL/booking_reminders.sql.
 *
 * Two kinds of caller, kept apart on purpose:
 *
 *   THE OPERATOR (routes/bookingReminders.js), always scoped to the active
 *   project: read and save a calendar's reminder settings, and list the
 *   reminders that failed three times so the Booking Manager can show them.
 *
 *   THE SCHEDULED PASS (lib/bookingRemindersRunDue.js), cross-project by
 *   design: find upcoming meetings, claim a reminder, record how it went.
 *   Every reminder row it writes carries the project of the booking it is
 *   for, stamped explicitly from that booking (landmine 12).
 *
 * The reminder settings live in their own column, read only here, so a
 * database that has not run booking_reminders.sql breaks reminders and
 * nothing else: the calendar's ordinary reads never ask for the column.
 *
 * Every function returns the `{ ok, status, data }` envelope.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedIdQuery } = require('./projectScope');
const { safeText, firstRow, limitOrError } = require('./reelSpinnerInput');
const rules = require('./bookingReminders');

const MINUTE = 60000;
/** A reminder claimed and never finished (the pass died mid-send) is retried after this long. */
const STALE_SENDING_MS = 15 * MINUTE;
const RECIPIENTS = ['visitor', 'owner'];

function calendarsTable() {
  return tableConfig().bookingCalendars;
}

function bookingsTable() {
  return tableConfig().bookings;
}

function remindersTable() {
  return tableConfig().bookingReminders || 'booking_reminders';
}

function bad(error) {
  return { ok: false, status: 400, error };
}

function notFound() {
  return { ok: false, status: 404, error: 'That booking calendar does not exist in this project' };
}

function needProject(scope) {
  const projectId = safeText(scope?.projectId, 120);
  return projectId || null;
}

// ── The operator: settings ──────────────────────────────────────────────────

/** A calendar's reminder settings, in this project. */
async function getReminderSettings(calendarId, scope) {
  const projectId = needProject(scope);
  if (!projectId) return bad('an active project is required');
  const id = safeText(calendarId, 120);
  if (!id) return bad('calendar id is required');
  const query = await scopedIdQuery(
    calendarsTable(),
    `id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(projectId)}&select=id,reminder_settings&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: calendarsTable(), query });
  if (!res.ok) return res;
  const row = firstRow(res.data);
  if (!row) return notFound();
  return { ok: true, status: 200, data: rules.normalizeReminderSettings(row.reminder_settings) };
}

/** Save a calendar's reminder settings, then answer with what the database now holds. */
async function saveReminderSettings(calendarId, input, scope) {
  const checked = rules.reminderSettingsOrError(input);
  if (!checked.ok) return checked;
  const current = await getReminderSettings(calendarId, scope);
  if (!current.ok) return current;
  const projectId = needProject(scope);
  const query = await scopedIdQuery(
    calendarsTable(),
    `id=eq.${encodeURIComponent(safeText(calendarId, 120))}&project_id=eq.${encodeURIComponent(projectId)}&select=id`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: calendarsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body: { reminder_settings: checked.value },
  });
  if (!res.ok) return res;
  if (!firstRow(res.data)) return notFound();
  return getReminderSettings(calendarId, scope);
}

// ── The operator: what went wrong ───────────────────────────────────────────

/**
 * The reminders that failed every attempt, for one calendar in this project,
 * newest meeting first, with who and when, so the Booking Manager can say
 * "the reminder to pat@… was not sent: <reason>". Meetings that started more
 * than a week ago are left out: nothing can be done about those.
 */
async function listReminderProblems(limit, calendarId, scope, { now = Date.now() } = {}) {
  const checked = limitOrError(limit, 'listReminderProblems');
  if (!checked.ok) return checked;
  const settings = await getReminderSettings(calendarId, scope);
  if (!settings.ok) return settings;
  const projectId = needProject(scope);
  const since = new Date(now - 7 * 24 * 60 * MINUTE).toISOString();
  const res = await sbQuery({
    method: 'GET',
    table: remindersTable(),
    query: [
      `project_id=eq.${encodeURIComponent(projectId)}`,
      `calendar_id=eq.${encodeURIComponent(safeText(calendarId, 120))}`,
      'status=eq.failed',
      `attempts=gte.${rules.MAX_ATTEMPTS}`,
      `starts_at=gte.${encodeURIComponent(since)}`,
      'select=id,booking_id,offset_minutes,starts_at,recipient,attempts,last_error,updated_at',
      'order=starts_at.desc',
      `limit=${checked.value}`,
    ].join('&'),
  });
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data : [];
  if (!rows.length) return { ok: true, status: 200, data: [] };

  const ids = [...new Set(rows.map((r) => safeText(r.booking_id, 120)).filter(Boolean))];
  const people = await sbQuery({
    method: 'GET',
    table: bookingsTable(),
    query: `project_id=eq.${encodeURIComponent(projectId)}&id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,visitor_name,visitor_email,status`,
  });
  if (!people.ok) return people;
  const byId = new Map((Array.isArray(people.data) ? people.data : []).map((b) => [String(b.id), b]));
  return {
    ok: true,
    status: 200,
    data: rows.map((r) => {
      const booking = byId.get(String(r.booking_id)) || {};
      return {
        id: safeText(r.id, 120),
        bookingId: safeText(r.booking_id, 120),
        offsetMinutes: Number(r.offset_minutes),
        startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : '',
        recipient: safeText(r.recipient, 20),
        attempts: Number(r.attempts),
        error: safeText(r.last_error, 1000),
        visitorName: safeText(booking.visitor_name, 200),
        visitorEmail: safeText(booking.visitor_email, 320),
        bookingStatus: safeText(booking.status, 40),
      };
    }),
  };
}

// ── The scheduled pass (cross-project) ──────────────────────────────────────

/**
 * Every booked meeting, in any project, starting in (now, now + horizon],
 * soonest first, read in pages of 500 (the store-wide read ceiling) up to
 * `maxPages`. `data.truncated` is true when there were more than that, so a
 * pass can say so rather than quietly missing the rest.
 *
 * `select=*` on purpose: the Meet link column arrives with slice 5's SQL
 * (SC-913), and asking for it by name would fail every pass on a database
 * that has not run that file yet. The manage token is read here because the
 * reminder carries the visitor's cancel/reschedule link.
 */
async function listUpcomingBookings({ now, horizonMs, maxPages = 4 }) {
  const PAGE = 500;
  const until = new Date(now + horizonMs).toISOString();
  const seen = new Map();
  let from = { op: 'gt', at: new Date(now).toISOString() };
  for (let page = 0; page < maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await sbQuery({
      method: 'GET',
      table: bookingsTable(),
      query: [
        'status=eq.booked',
        `starts_at=${from.op}.${encodeURIComponent(from.at)}`,
        `starts_at=lte.${encodeURIComponent(until)}`,
        'select=*',
        'order=starts_at.asc,id.asc',
        `limit=${PAGE}`,
      ].join('&'),
    });
    if (!res.ok) return res;
    const rows = Array.isArray(res.data) ? res.data : [];
    for (const row of rows) seen.set(String(row.id), rowToRunBooking(row));
    if (rows.length < PAGE) {
      return { ok: true, status: 200, data: { bookings: [...seen.values()], truncated: false } };
    }
    // Next page from the last start time, inclusive (two meetings can share
    // a start on different calendars); the ids already seen are dropped.
    from = { op: 'gte', at: new Date(rows[rows.length - 1].starts_at).toISOString() };
  }
  return { ok: true, status: 200, data: { bookings: [...seen.values()], truncated: true } };
}

function rowToRunBooking(row) {
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    calendarId: safeText(row.calendar_id, 120),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : '',
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : '',
    visitorName: safeText(row.visitor_name, 200),
    visitorEmail: safeText(row.visitor_email, 320),
    visitorPhone: safeText(row.visitor_phone, 60),
    visitorNote: safeText(row.visitor_note, 4000),
    visitorTimeZone: safeText(row.visitor_time_zone, 100),
    crmContactId: safeText(row.crm_contact_id, 120) || null,
    status: safeText(row.status, 40),
    manageToken: safeText(row.manage_token, 64),
    meetLink: safeText(row.meet_link, 2000),
    createdAt: row.created_at || '',
    rescheduledAt: row.rescheduled_at || null,
  };
}

/** The calendars these bookings belong to, keyed by id, with their reminder settings. */
async function readCalendarsForRun(ids) {
  const list = [...new Set(ids.map((id) => safeText(id, 120)).filter(Boolean))];
  if (!list.length) return { ok: true, status: 200, data: new Map() };
  const res = await sbQuery({
    method: 'GET',
    table: calendarsTable(),
    query: `id=in.(${list.map(encodeURIComponent).join(',')})&select=id,project_id,name,time_zone,messaging,reminder_settings&limit=${list.length}`,
  });
  if (!res.ok) return res;
  const out = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    out.set(String(row.id), {
      id: safeText(row.id, 120),
      projectId: safeText(row.project_id, 120),
      name: safeText(row.name, 200),
      timeZone: safeText(row.time_zone, 100),
      messaging: row.messaging && typeof row.messaging === 'object' ? row.messaging : {},
      reminders: rules.normalizeReminderSettings(row.reminder_settings),
    });
  }
  return { ok: true, status: 200, data: out };
}

/** One booking's status and start as the database holds them NOW, checked again just before sending. */
async function readBookingNow(booking) {
  const res = await sbQuery({
    method: 'GET',
    table: bookingsTable(),
    query: `id=eq.${encodeURIComponent(booking.id)}&project_id=eq.${encodeURIComponent(booking.projectId)}&select=id,status,starts_at&limit=1`,
  });
  if (!res.ok) return res;
  const row = firstRow(res.data);
  return {
    ok: true,
    status: 200,
    data: row ? { status: safeText(row.status, 40), startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : '' } : null,
  };
}

function reminderRow(row) {
  return {
    id: safeText(row.id, 120),
    status: safeText(row.status, 20),
    attempts: Number(row.attempts) || 0,
    updatedAt: row.updated_at || '',
  };
}

/**
 * Take one reminder for this pass, so no other pass sends it. Answers
 * `data: { id, attempt }` when claimed, `data: null` when there is nothing to
 * do (already sent, gave up after three tries, skipped, or another pass holds
 * it). The guards are in the WRITES, not in a read before them: the insert
 * relies on the unique index, and every retry is a PATCH guarded on the
 * status and attempt count it read, so two passes racing cannot both win.
 */
async function claimReminder({ booking, offsetMinutes, recipient, now = Date.now() }) {
  if (!RECIPIENTS.includes(recipient)) return bad(`recipient must be one of ${RECIPIENTS.join(', ')}`);
  const key = [
    `booking_id=eq.${encodeURIComponent(booking.id)}`,
    `offset_minutes=eq.${offsetMinutes}`,
    `starts_at=eq.${encodeURIComponent(booking.startsAt)}`,
    `recipient=eq.${recipient}`,
  ].join('&');
  const found = await sbQuery({ method: 'GET', table: remindersTable(), query: `${key}&select=id,status,attempts,updated_at&limit=1` });
  if (!found.ok) return found;
  const existing = firstRow(found.data);

  if (!existing) {
    const res = await sbQuery({
      method: 'POST',
      table: remindersTable(),
      query: 'select=id,status,attempts,updated_at',
      headers: { Prefer: 'return=representation' },
      body: [{
        project_id: booking.projectId,
        owner_user_id: booking.ownerUserId || null,
        calendar_id: booking.calendarId,
        booking_id: booking.id,
        offset_minutes: offsetMinutes,
        starts_at: booking.startsAt,
        recipient,
        status: 'sending',
        attempts: 1,
      }],
    });
    if (!res.ok) {
      // Another pass inserted it first: theirs to send.
      if (res.status === 409) return { ok: true, status: 200, data: null };
      return res;
    }
    const row = firstRow(res.data);
    if (!row) return { ok: false, status: 502, error: 'The database accepted the reminder claim but returned no row' };
    return { ok: true, status: 200, data: { id: safeText(row.id, 120), attempt: 1 } };
  }

  const current = reminderRow(existing);
  const stale = current.status === 'sending' && Date.parse(current.updatedAt) < now - STALE_SENDING_MS;
  const retry = current.status === 'failed' && current.attempts < rules.MAX_ATTEMPTS;
  if (!retry && !stale) return { ok: true, status: 200, data: null };
  if (stale && current.attempts >= rules.MAX_ATTEMPTS) {
    // The last allowed try died part-way: record it as failed so the Booking
    // Manager shows it, rather than leaving it "sending" forever.
    await finishReminder(current.id, { status: 'failed', error: 'The reminder was being sent when the job stopped, and it was not confirmed as sent' }, { guardStatus: 'sending', guardAttempts: current.attempts });
    return { ok: true, status: 200, data: null };
  }
  const guard = `id=eq.${encodeURIComponent(current.id)}&status=eq.${current.status}&attempts=eq.${current.attempts}`
    + (stale ? `&updated_at=lt.${encodeURIComponent(new Date(now - STALE_SENDING_MS).toISOString())}` : '');
  const res = await sbQuery({
    method: 'PATCH',
    table: remindersTable(),
    query: `${guard}&select=id,attempts`,
    headers: { Prefer: 'return=representation' },
    body: { status: 'sending', attempts: current.attempts + 1 },
  });
  if (!res.ok) return res;
  const row = firstRow(res.data);
  if (!row) return { ok: true, status: 200, data: null };
  return { ok: true, status: 200, data: { id: current.id, attempt: current.attempts + 1 } };
}

/**
 * Record how a claimed reminder went: 'sent', 'failed' (with the reason), or
 * 'skipped' (the meeting was cancelled or moved after the claim).
 */
async function finishReminder(id, { status, error = '' }, { guardStatus = 'sending', guardAttempts } = {}) {
  if (!['sent', 'failed', 'skipped'].includes(status)) return bad('status must be sent, failed or skipped');
  const body = {
    status,
    last_error: status === 'sent' ? null : safeText(error, 1000) || (status === 'failed' ? 'The reminder was not sent' : null),
    ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
  };
  const guard = `id=eq.${encodeURIComponent(id)}&status=eq.${guardStatus}`
    + (Number.isInteger(guardAttempts) ? `&attempts=eq.${guardAttempts}` : '');
  const res = await sbQuery({
    method: 'PATCH',
    table: remindersTable(),
    query: `${guard}&select=id,status`,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) return res;
  if (!firstRow(res.data)) return { ok: false, status: 409, error: 'The reminder changed while it was being recorded' };
  return { ok: true, status: 200, data: { id, status } };
}

module.exports = {
  STALE_SENDING_MS,
  getReminderSettings,
  saveReminderSettings,
  listReminderProblems,
  listUpcomingBookings,
  readCalendarsForRun,
  readBookingNow,
  claimReminder,
  finishReminder,
};
