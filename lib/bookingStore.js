'use strict';

/**
 * booking_calendars + bookings — the booking calendar's rows. Booking
 * calendar, slice 1 of 6 (SC-909). Table: docs/SQL/booking_setup.sql.
 *
 * Which times are free is NOT decided here: that is lib/bookingAvailability.js,
 * one pure function every caller shares. This file stores and reads.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10),
 * every list read takes its limit FIRST (CLAUDE.md landmine 12), and every
 * read and write is filtered to the caller's project through lib/projectScope.js,
 * so another project's calendar or booking is a 404 exactly like one that does
 * not exist.
 *
 * A saved calendar is READ BACK before it is returned: the answer is what the
 * database now holds, never the caller's own input echoed (landmine 15).
 */

const crypto = require('crypto');
const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { safeText, firstRow, limitOrError } = require('./reelSpinnerInput');
const { isValidIanaTimeZone } = require('./wallTimeUtc');
const { DAY_KEYS, minutesOf } = require('./bookingAvailability');

const DEFAULTS = Object.freeze({
  name: 'Book a meeting',
  timeZone: 'America/Denver',
  weeklyHours: Object.freeze({
    sun: [], mon: [{ start: '09:00', end: '17:00' }], tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }], thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }], sat: [],
  }),
  blockedDates: Object.freeze([]),
  meetingMinutes: 30,
  gapMinutes: 0,
  minNoticeMinutes: 240,
  daysAhead: 60,
  messaging: Object.freeze({
    heading: '', intro: '', confirmation: '',
    confirmationEmailSubject: '', confirmationEmailBody: '',
    reminderEmailSubject: '', reminderEmailBody: '',
  }),
});

/** Each whole-minute setting: its column and the range it must sit in. */
const MINUTE_SETTINGS = {
  meetingMinutes: { column: 'meeting_minutes', min: 5, max: 480 },
  gapMinutes: { column: 'gap_minutes', min: 0, max: 240 },
  minNoticeMinutes: { column: 'min_notice_minutes', min: 0, max: 60 * 24 * 60 },
  daysAhead: { column: 'days_ahead', min: 1, max: 365 },
};

const SETTING_FIELDS = ['name', 'timeZone', 'weeklyHours', 'blockedDates', 'messaging', ...Object.keys(MINUTE_SETTINGS)];
/**
 * What visitors read. The email wording (SC-910) is stored now so the Booking
 * Manager can edit it; slice 4 (SC-912) sends the confirmation and slice 6
 * (SC-914) the reminder. A save REPLACES the whole messaging object, so a
 * caller sends every key it means to keep.
 */
const MESSAGING_KEYS = [
  'heading', 'intro', 'confirmation',
  'confirmationEmailSubject', 'confirmationEmailBody',
  'reminderEmailSubject', 'reminderEmailBody',
];
/** Subjects are one line; everything else may be a paragraph or two. */
const MESSAGING_MAX = { confirmationEmailSubject: 200, reminderEmailSubject: 200 };
const BOOKING_FIELDS = ['startsAt', 'endsAt', 'visitorName', 'visitorEmail', 'visitorPhone', 'visitorNote', 'visitorTimeZone', 'crmContactId'];
const NOTIFY_STATUSES = ['sent', 'failed'];
/** A manage token as newManageToken() makes it: 32 url-safe characters. */
const MANAGE_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const BOOKING_STATUSES = ['booked', 'cancelled'];

const CALENDAR_COLUMNS = [
  'id', 'project_id', 'owner_user_id', 'name', 'time_zone', 'weekly_hours', 'blocked_dates',
  'meeting_minutes', 'gap_minutes', 'min_notice_minutes', 'days_ahead', 'messaging',
  'created_at', 'updated_at',
].join(',');

const BOOKING_COLUMNS = [
  'id', 'project_id', 'owner_user_id', 'calendar_id', 'starts_at', 'ends_at', 'visitor_name',
  'visitor_email', 'visitor_phone', 'visitor_note', 'crm_contact_id', 'status', 'cancelled_at',
  'created_at', 'updated_at',
  // SC-912, docs/SQL/booking_notifications.sql
  'visitor_time_zone', 'notify_status', 'notify_error', 'notified_at', 'rescheduled_at',
].join(',');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function calendarsTable() {
  return tableConfig().bookingCalendars;
}

function bookingsTable() {
  return tableConfig().bookings;
}

function bad(error) {
  return { ok: false, status: 400, error };
}

/**
 * Refuse any field not in `keys`, by its exact spelling. lib/storeInput.js's
 * unknownKeyError also lets the snake_case spelling through, but this store
 * reads camelCase only, so `time_zone` would pass that check and then be
 * dropped in silence under a 200.
 */
function unknownKeyError(input, keys) {
  const unknown = Object.keys(input || {}).filter((key) => !keys.includes(key));
  if (!unknown.length) return null;
  return bad(`Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Known fields are ${keys.join(', ')}`);
}

// ── Reading settings a caller sent ──────────────────────────────────────────

function textOrError(value, field, max, { required = false } = {}) {
  if (typeof value !== 'string') return bad(`${field} must be text`);
  const text = value.trim();
  if (required && !text) return bad(`${field} cannot be empty`);
  if (text.length > max) return bad(`${field} must be ${max} characters or fewer (got ${text.length})`);
  return { ok: true, value: text };
}

/** { mon: [{ start, end }], ... } — every day present, windows in order, none overlapping. */
function weeklyHoursOrError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return bad('weeklyHours must be { mon: [{ start: "09:00", end: "17:00" }], ... }');
  }
  const unknownDay = Object.keys(value).find((key) => !DAY_KEYS.includes(key));
  if (unknownDay) return bad(`weeklyHours has an unknown day "${unknownDay}" (use ${DAY_KEYS.join(', ')})`);
  const out = {};
  for (const day of DAY_KEYS) {
    const windows = value[day] === undefined ? [] : value[day];
    if (!Array.isArray(windows)) return bad(`weeklyHours.${day} must be a list of { start, end }`);
    if (windows.length > 6) return bad(`weeklyHours.${day} has more than 6 windows`);
    const parsed = [];
    for (let i = 0; i < windows.length; i += 1) {
      const w = windows[i];
      const where = `weeklyHours.${day}[${i}]`;
      if (!w || typeof w !== 'object') return bad(`${where} must be { start, end }`);
      const start = minutesOf(w.start);
      const end = minutesOf(w.end);
      if (start === null || end === null) return bad(`${where}: start and end must be times like "09:00" (got ${JSON.stringify(w.start)} to ${JSON.stringify(w.end)})`);
      if (start >= 1440) return bad(`${where}: start must be before midnight`);
      if (end <= start) return bad(`${where}: ${w.start} to ${w.end} ends before it starts`);
      parsed.push({ start, end, value: { start: w.start, end: w.end } });
    }
    parsed.sort((a, b) => a.start - b.start);
    for (let i = 1; i < parsed.length; i += 1) {
      if (parsed[i].start < parsed[i - 1].end) {
        return bad(`weeklyHours.${day}: ${parsed[i].value.start} starts before the window before it ends (${parsed[i - 1].value.end})`);
      }
    }
    out[day] = parsed.map((p) => p.value);
  }
  return { ok: true, value: out };
}

function blockedDatesOrError(value) {
  if (!Array.isArray(value)) return bad('blockedDates must be a list of dates like "2026-12-25"');
  if (value.length > 366) return bad('blockedDates can hold at most 366 dates');
  const out = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !DATE_RE.test(item) || Number.isNaN(Date.parse(`${item}T00:00:00Z`))) {
      return bad(`blockedDates: ${JSON.stringify(item)} is not a date like "2026-12-25"`);
    }
    out.add(item);
  }
  return { ok: true, value: [...out].sort() };
}

function messagingOrError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return bad(`messaging must be { ${MESSAGING_KEYS.join(', ')} }`);
  }
  const unknown = Object.keys(value).find((key) => !MESSAGING_KEYS.includes(key));
  if (unknown) return bad(`messaging has an unknown field "${unknown}" (use ${MESSAGING_KEYS.join(', ')})`);
  const out = {};
  for (const key of MESSAGING_KEYS) {
    const parsed = textOrError(value[key] === undefined ? '' : value[key], `messaging.${key}`, MESSAGING_MAX[key] || 2000);
    if (!parsed.ok) return parsed;
    out[key] = parsed.value;
  }
  return { ok: true, value: out };
}

/**
 * Caller settings → the columns to write. Only the fields supplied are
 * written; an unknown field is refused, never dropped in silence.
 */
function settingsToColumns(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('settings must be an object');
  const unknown = unknownKeyError(input, SETTING_FIELDS);
  if (unknown) return unknown;
  const row = {};
  if (input.name !== undefined) {
    const parsed = textOrError(input.name, 'name', 200, { required: true });
    if (!parsed.ok) return parsed;
    row.name = parsed.value;
  }
  if (input.timeZone !== undefined) {
    const tz = typeof input.timeZone === 'string' ? input.timeZone.trim() : '';
    if (!isValidIanaTimeZone(tz)) return bad(`timeZone must be a time zone like "America/Denver" (got ${JSON.stringify(input.timeZone)})`);
    row.time_zone = tz;
  }
  if (input.weeklyHours !== undefined) {
    const parsed = weeklyHoursOrError(input.weeklyHours);
    if (!parsed.ok) return parsed;
    row.weekly_hours = parsed.value;
  }
  if (input.blockedDates !== undefined) {
    const parsed = blockedDatesOrError(input.blockedDates);
    if (!parsed.ok) return parsed;
    row.blocked_dates = parsed.value;
  }
  if (input.messaging !== undefined) {
    const parsed = messagingOrError(input.messaging);
    if (!parsed.ok) return parsed;
    row.messaging = parsed.value;
  }
  for (const [key, { column, min, max }] of Object.entries(MINUTE_SETTINGS)) {
    if (input[key] === undefined) continue;
    const n = input[key];
    if (!Number.isInteger(n) || n < min || n > max) return bad(`${key} must be a whole number from ${min} to ${max} (got ${JSON.stringify(n)})`);
    row[column] = n;
  }
  return { ok: true, value: row };
}

function rowToCalendar(row) {
  if (!row) return null;
  const messaging = row.messaging && typeof row.messaging === 'object' ? row.messaging : {};
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    name: safeText(row.name, 200),
    timeZone: safeText(row.time_zone, 100),
    weeklyHours: row.weekly_hours && typeof row.weekly_hours === 'object' ? row.weekly_hours : {},
    blockedDates: Array.isArray(row.blocked_dates) ? row.blocked_dates : [],
    meetingMinutes: Number(row.meeting_minutes),
    gapMinutes: Number(row.gap_minutes),
    minNoticeMinutes: Number(row.min_notice_minutes),
    daysAhead: Number(row.days_ahead),
    messaging: Object.fromEntries(MESSAGING_KEYS.map((key) => [key, safeText(messaging[key], 2000)])),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function rowToBooking(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    calendarId: safeText(row.calendar_id, 120),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : '',
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : '',
    visitorName: safeText(row.visitor_name, 200),
    visitorEmail: safeText(row.visitor_email, 320),
    visitorPhone: safeText(row.visitor_phone, 60),
    visitorNote: safeText(row.visitor_note, 4000),
    crmContactId: safeText(row.crm_contact_id, 120) || null,
    status: safeText(row.status, 40),
    cancelledAt: row.cancelled_at || null,
    visitorTimeZone: safeText(row.visitor_time_zone, 100),
    // How the latest round of booking emails went (SC-912). null: none tried.
    notifyStatus: safeText(row.notify_status, 20) || null,
    notifyError: safeText(row.notify_error, 1000),
    notifiedAt: row.notified_at || null,
    rescheduledAt: row.rescheduled_at || null,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/**
 * The visitor's private cancel/reschedule secret (SC-912). 24 random bytes,
 * url-safe: 32 characters nobody can guess. The manage token is deliberately
 * NOT in rowToBooking, so no list the operator's screen reads carries it; only
 * createBooking's answer (for the confirmation email) and a lookup BY the token
 * ever hold it.
 */
function newManageToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// ── Calendars ───────────────────────────────────────────────────────────────

/** This project's calendars, oldest first. */
async function listCalendars(limit, scope = null) {
  const checked = limitOrError(limit, 'listCalendars');
  if (!checked.ok) return checked;
  const query = await scopedListQuery(
    calendarsTable(),
    `select=${CALENDAR_COLUMNS}&order=created_at.asc&limit=${checked.value}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: calendarsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToCalendar) };
}

/** One calendar in this project, or `data: null`. */
async function getCalendarById(id, scope = null) {
  const calendarId = safeText(id, 120);
  if (!calendarId) return bad('id is required');
  const query = await scopedIdQuery(
    calendarsTable(),
    `id=eq.${encodeURIComponent(calendarId)}&select=${CALENDAR_COLUMNS}&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: calendarsTable(), query });
  if (!res.ok) return res;
  const found = firstRow(res.data);
  return { ok: true, status: 200, data: found ? rowToCalendar(found) : null };
}

/** A calendar in this project, or the 404 envelope. */
async function calendarInProject(id, scope) {
  const found = await getCalendarById(id, scope);
  if (!found.ok) return found;
  if (!found.data) return { ok: false, status: 404, error: 'That booking calendar does not exist in this project' };
  return found;
}

/** A new calendar: the defaults, with any settings supplied laid over them. */
async function createCalendar(input = {}, scope = null) {
  const defaults = settingsToColumns({
    name: DEFAULTS.name,
    timeZone: DEFAULTS.timeZone,
    weeklyHours: DEFAULTS.weeklyHours,
    blockedDates: [...DEFAULTS.blockedDates],
    messaging: { ...DEFAULTS.messaging },
    meetingMinutes: DEFAULTS.meetingMinutes,
    gapMinutes: DEFAULTS.gapMinutes,
    minNoticeMinutes: DEFAULTS.minNoticeMinutes,
    daysAhead: DEFAULTS.daysAhead,
  });
  const supplied = settingsToColumns(input || {});
  if (!supplied.ok) return supplied;
  const row = await scopedInsertRow(calendarsTable(), { ...defaults.value, ...supplied.value }, scope);
  if (!row.project_id) return bad('a booking calendar needs a project');
  const res = await sbQuery({
    method: 'POST',
    table: calendarsTable(),
    query: `select=${CALENDAR_COLUMNS}`,
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const saved = firstRow(res.data);
  if (!saved) return { ok: false, status: 502, error: 'The database accepted the calendar but returned no row' };
  return readBack(saved.id, scope, 'calendar');
}

async function readBack(id, scope, what) {
  const now = await getCalendarById(id, scope);
  if (!now.ok) return now;
  if (!now.data) return { ok: false, status: 502, error: `The ${what} was written but could not be read back in this project` };
  return now;
}

/** Save some of a calendar's settings, then answer with what the database now holds. */
async function saveCalendarSettings(id, input, scope = null) {
  const columns = settingsToColumns(input);
  if (!columns.ok) return columns;
  if (!Object.keys(columns.value).length) return bad('nothing to save: send at least one setting');
  const current = await calendarInProject(id, scope);
  if (!current.ok) return current;
  const patch = await scopedPatchRow(calendarsTable(), columns.value, scope);
  const query = await scopedIdQuery(
    calendarsTable(),
    `id=eq.${encodeURIComponent(current.data.id)}&select=id`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: calendarsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!res.ok) return res;
  if (!firstRow(res.data)) return { ok: false, status: 404, error: 'That booking calendar does not exist in this project' };
  return readBack(current.data.id, scope, 'calendar');
}

// ── Bookings ────────────────────────────────────────────────────────────────

/**
 * A calendar's bookings, earliest first. `range.from`/`range.to` limit them to
 * meetings starting in [from, to); `range.status` to one status.
 */
async function listBookings(limit, calendarId, range = {}, scope = null) {
  const checked = limitOrError(limit, 'listBookings');
  if (!checked.ok) return checked;
  const calendar = await calendarInProject(calendarId, scope);
  if (!calendar.ok) return calendar;
  const filters = [`calendar_id=eq.${encodeURIComponent(calendar.data.id)}`];
  for (const [key, op] of [['from', 'gte'], ['to', 'lt']]) {
    if (range[key] === undefined || range[key] === null || range[key] === '') continue;
    const t = Date.parse(String(range[key]));
    if (!Number.isFinite(t)) return bad(`${key} must be a date and time (got ${JSON.stringify(range[key])})`);
    filters.push(`starts_at=${op}.${encodeURIComponent(new Date(t).toISOString())}`);
  }
  if (range.status !== undefined && range.status !== null && range.status !== '') {
    if (!BOOKING_STATUSES.includes(range.status)) return bad(`status must be one of ${BOOKING_STATUSES.join(', ')}`);
    filters.push(`status=eq.${encodeURIComponent(range.status)}`);
  }
  const query = await scopedListQuery(
    bookingsTable(),
    `${filters.join('&')}&select=${BOOKING_COLUMNS}&order=starts_at.asc&limit=${checked.value}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: bookingsTable(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToBooking) };
}

/** One booking in this project, or `data: null`. */
async function getBookingById(id, scope = null) {
  const bookingId = safeText(id, 120);
  if (!bookingId) return bad('id is required');
  const query = await scopedIdQuery(
    bookingsTable(),
    `id=eq.${encodeURIComponent(bookingId)}&select=${BOOKING_COLUMNS}&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: bookingsTable(), query });
  if (!res.ok) return res;
  const found = firstRow(res.data);
  return { ok: true, status: 200, data: found ? rowToBooking(found) : null };
}

/**
 * Store a booking. This checks the booking is well formed and its calendar is
 * in this project; whether the time is FREE is the caller's question
 * (lib/bookingAvailability.js isSlotFree), asked first. The database still
 * refuses two live bookings at the same start, which this answers as a 409.
 */
async function createBooking(calendarId, input, scope = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('booking must be an object');
  const unknown = unknownKeyError(input, BOOKING_FIELDS);
  if (unknown) return unknown;
  const startsAt = Date.parse(String(input.startsAt || ''));
  const endsAt = Date.parse(String(input.endsAt || ''));
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return bad('startsAt and endsAt must be dates and times');
  if (endsAt <= startsAt) return bad('endsAt must be after startsAt');
  const name = textOrError(input.visitorName ?? '', 'visitorName', 200, { required: true });
  if (!name.ok) return name;
  const email = textOrError(input.visitorEmail ?? '', 'visitorEmail', 320, { required: true });
  if (!email.ok) return email;
  if (!EMAIL_RE.test(email.value)) return bad(`visitorEmail ${JSON.stringify(email.value)} is not an email address`);
  const phone = textOrError(input.visitorPhone ?? '', 'visitorPhone', 60);
  if (!phone.ok) return phone;
  const note = textOrError(input.visitorNote ?? '', 'visitorNote', 4000);
  if (!note.ok) return note;
  const zone = typeof input.visitorTimeZone === 'string' ? input.visitorTimeZone.trim() : '';
  // The visitor's browser says this; an unreadable zone is dropped, never
  // refused, because the booking matters more than which clock the email uses.
  const visitorTimeZone = zone && isValidIanaTimeZone(zone) ? zone : null;
  const contact = textOrError(input.crmContactId ?? '', 'crmContactId', 120);
  if (!contact.ok) return contact;

  const calendar = await calendarInProject(calendarId, scope);
  if (!calendar.ok) return calendar;

  const row = await scopedInsertRow(bookingsTable(), {
    calendar_id: calendar.data.id,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    visitor_name: name.value,
    visitor_email: email.value,
    visitor_phone: phone.value || null,
    visitor_note: note.value || null,
    crm_contact_id: contact.value || null,
    visitor_time_zone: visitorTimeZone,
    manage_token: newManageToken(),
    status: 'booked',
  }, scope);
  if (!row.project_id) return bad('a booking needs a project');
  const res = await sbQuery({
    method: 'POST',
    table: bookingsTable(),
    query: `select=${BOOKING_COLUMNS}`,
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) {
    if (res.status === 409 && /idx_bookings_calendar_start_booked|duplicate key/i.test(String(res.error || ''))) {
      return { ok: false, status: 409, error: 'That time has just been booked by someone else' };
    }
    return res;
  }
  const saved = firstRow(res.data);
  if (!saved) return { ok: false, status: 502, error: 'The database accepted the booking but returned no row' };
  // The token travels with this one answer, for the visitor's confirmation email.
  return { ok: true, status: 200, data: { ...rowToBooking(saved), manageToken: row.manage_token } };
}

/**
 * The booking a visitor's manage link names, in this project, or `data: null`.
 * A token that is not shaped like one is `data: null` too, without a query.
 */
async function getBookingByManageToken(token, scope = null) {
  const value = String(token || '').trim();
  if (!MANAGE_TOKEN_RE.test(value)) return { ok: true, status: 200, data: null };
  const query = await scopedListQuery(
    bookingsTable(),
    `manage_token=eq.${encodeURIComponent(value)}&select=${BOOKING_COLUMNS}&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: bookingsTable(), query });
  if (!res.ok) return res;
  const found = firstRow(res.data);
  return { ok: true, status: 200, data: found ? rowToBooking(found) : null };
}

/**
 * Move a booked meeting to a new time IN ONE WRITE (SC-912): the same row gets
 * the new start and end, so the old time is free and the new one taken at the
 * same instant, with no moment where the visitor holds both or neither. Whether
 * the new time is FREE is the caller's question, asked first; the database
 * still refuses a time somebody else holds (idx_bookings_calendar_start_booked),
 * which this answers as a 409. A cancelled booking cannot be moved (409).
 */
async function rescheduleBooking(id, { startsAt, endsAt } = {}, scope = null) {
  const start = Date.parse(String(startsAt || ''));
  const end = Date.parse(String(endsAt || ''));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return bad('startsAt and endsAt must be dates and times');
  if (end <= start) return bad('endsAt must be after startsAt');
  const current = await getBookingById(id, scope);
  if (!current.ok) return current;
  if (!current.data) return { ok: false, status: 404, error: 'That booking does not exist in this project' };
  if (current.data.status !== 'booked') return { ok: false, status: 409, error: 'That booking is cancelled, so it cannot be moved' };
  const patch = await scopedPatchRow(bookingsTable(), {
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    rescheduled_at: new Date().toISOString(),
  }, scope);
  const query = await scopedIdQuery(
    bookingsTable(),
    `id=eq.${encodeURIComponent(current.data.id)}&status=eq.booked&select=${BOOKING_COLUMNS}`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: bookingsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!res.ok) {
    if (res.status === 409 && /idx_bookings_calendar_start_booked|duplicate key/i.test(String(res.error || ''))) {
      return { ok: false, status: 409, error: 'That time has just been booked by someone else' };
    }
    return res;
  }
  const updated = firstRow(res.data);
  if (!updated) return { ok: false, status: 409, error: 'That booking changed while it was being moved; nothing was changed' };
  return { ok: true, status: 200, data: rowToBooking(updated) };
}

/**
 * Record how a round of booking emails went (SC-912), so a send that failed
 * shows on the Booking Manager instead of vanishing. `error` is the plain
 * reason, kept only on a failure.
 */
async function recordNotification(id, { status, error = '' } = {}, scope = null) {
  if (!NOTIFY_STATUSES.includes(status)) return bad(`notify status must be one of ${NOTIFY_STATUSES.join(', ')}`);
  const bookingId = safeText(id, 120);
  if (!bookingId) return bad('id is required');
  const patch = await scopedPatchRow(bookingsTable(), {
    notify_status: status,
    notify_error: status === 'failed' ? safeText(error, 1000) || 'An email was not sent' : null,
    notified_at: new Date().toISOString(),
  }, scope);
  const query = await scopedIdQuery(
    bookingsTable(),
    `id=eq.${encodeURIComponent(bookingId)}&select=${BOOKING_COLUMNS}`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: bookingsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!res.ok) return res;
  const updated = firstRow(res.data);
  if (!updated) return { ok: false, status: 404, error: 'That booking does not exist in this project' };
  return { ok: true, status: 200, data: rowToBooking(updated) };
}

/**
 * File a booking under its CRM contact, by the contact's id (landmine 19).
 *
 * The visitor's booking route (SC-911) books the time FIRST and only then
 * creates or finds the contact, so a visitor who loses a race for a slot is
 * never added to the CRM for a meeting they did not get. This is the second
 * half of that: answer with the row as the database now holds it.
 */
async function attachBookingContact(id, crmContactId, scope = null) {
  const contact = textOrError(crmContactId ?? '', 'crmContactId', 120, { required: true });
  if (!contact.ok) return contact;
  const current = await getBookingById(id, scope);
  if (!current.ok) return current;
  if (!current.data) return { ok: false, status: 404, error: 'That booking does not exist in this project' };
  const patch = await scopedPatchRow(bookingsTable(), { crm_contact_id: contact.value }, scope);
  const query = await scopedIdQuery(
    bookingsTable(),
    `id=eq.${encodeURIComponent(current.data.id)}&select=${BOOKING_COLUMNS}`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: bookingsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!res.ok) return res;
  const updated = firstRow(res.data);
  if (!updated) return { ok: false, status: 404, error: 'That booking does not exist in this project' };
  return { ok: true, status: 200, data: rowToBooking(updated) };
}

/** Cancel a booked meeting, which frees its time. Cancelling twice is a 409. */
async function cancelBooking(id, scope = null) {
  const current = await getBookingById(id, scope);
  if (!current.ok) return current;
  if (!current.data) return { ok: false, status: 404, error: 'That booking does not exist in this project' };
  if (current.data.status !== 'booked') return { ok: false, status: 409, error: 'That booking is already cancelled' };
  const patch = await scopedPatchRow(bookingsTable(), { status: 'cancelled', cancelled_at: new Date().toISOString() }, scope);
  const query = await scopedIdQuery(
    bookingsTable(),
    `id=eq.${encodeURIComponent(current.data.id)}&status=eq.booked&select=${BOOKING_COLUMNS}`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: bookingsTable(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!res.ok) return res;
  const updated = firstRow(res.data);
  if (!updated) return { ok: false, status: 409, error: 'That booking changed while it was being cancelled; nothing was changed' };
  return { ok: true, status: 200, data: rowToBooking(updated) };
}

module.exports = {
  DEFAULTS,
  BOOKING_STATUSES,
  MESSAGING_KEYS,
  listCalendars,
  getCalendarById,
  createCalendar,
  saveCalendarSettings,
  listBookings,
  getBookingById,
  createBooking,
  attachBookingContact,
  cancelBooking,
  getBookingByManageToken,
  rescheduleBooking,
  recordNotification,
  newManageToken,
  MANAGE_TOKEN_RE,
};
