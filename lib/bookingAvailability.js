'use strict';

/**
 * Which times can a visitor book? Booking calendar, slice 1 of 6 (SC-909).
 *
 * One pure function, freeSlots(), so the Booking Manager preview (SC-910), the
 * visitor's booking module (SC-911) and the booking write itself all answer
 * the question the same way. It reads nothing and writes nothing: the caller
 * hands it the calendar's settings, the meetings already booked, and a range.
 *
 * THE RULES, in the order a slot has to pass them:
 *   1. its day is not a blocked date, and the calendar is open that weekday
 *   2. it fits inside one of that day's opening windows. Slots start at the
 *      window's opening time and step by the meeting length plus the gap, so
 *      an empty day offers a clean grid (9:00, 9:45, 10:30 for a 30-minute
 *      meeting with a 15-minute gap)
 *   3. it is at least the minimum notice away from now
 *   4. its day is no further ahead than `daysAhead` days from today
 *   5. it, widened by the gap on both sides, does not touch a booked meeting
 *      (or any `busy` interval — slice 5 passes the operator's Google busy times)
 *   6. it starts inside the range asked for
 *
 * TIME ZONES. Opening hours are wall-clock times in the CALENDAR's zone, and
 * every slot comes back as a UTC instant, so the visitor's browser can show it
 * in the visitor's own zone. Daylight-saving days follow lib/wallTimeUtc.js: a
 * wall time the clocks skip offers no slot, and a repeated one is offered once.
 */

const { wallTimeToUtcMillis, partsInTimeZone, isValidIanaTimeZone } = require('./wallTimeUtc');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MINUTE = 60000;
const DAY = 86400000;
/** The widest range one call may ask about, so a bad request cannot spin. */
const MAX_RANGE_DAYS = 92;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' for a calendar date given as { y, mo, d }. */
function dateKey(date) {
  return `${date.y}-${pad(date.mo)}-${pad(date.d)}`;
}

/** The calendar date `days` after `date` (plain date arithmetic, no zone). */
function addDays(date, days) {
  const t = new Date(Date.UTC(date.y, date.mo - 1, date.d + days));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function weekdayKey(date) {
  return DAY_KEYS[new Date(Date.UTC(date.y, date.mo - 1, date.d)).getUTCDay()];
}

/** "09:30" → 570. "24:00" is allowed as the end of a day. */
function minutesOf(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

/** The UTC instant of `minutes` past midnight on `date`, in `timeZone`. */
function instantOf(date, minutes, timeZone) {
  const day = minutes >= 1440 ? addDays(date, 1) : date;
  const m = minutes % 1440;
  return wallTimeToUtcMillis({ ...day, h: Math.floor(m / 60), mi: m % 60 }, timeZone);
}

/** An instant given as a Date, milliseconds, or ISO text (the route sends milliseconds). */
function toMillis(value, what) {
  const t = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
      : Date.parse(String(value));
  if (!Number.isFinite(t)) throw new TypeError(`${what} must be a date and time (got ${JSON.stringify(value)})`);
  return t;
}

function wholeMinutes(value, what, min) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new TypeError(`${what} must be a whole number of minutes, ${min} or more`);
  return n;
}

/**
 * The bookable slots in [from, to).
 *
 * @param {object}   args
 * @param {object}   args.calendar  settings as lib/bookingStore.js returns them:
 *                                  timeZone, weeklyHours, blockedDates,
 *                                  meetingMinutes, gapMinutes, minNoticeMinutes, daysAhead
 * @param {Array}    [args.bookings] [{ startsAt, endsAt, status }]; only status
 *                                  'booked' (or no status) blocks time
 * @param {Array}    [args.busy]    [{ startsAt, endsAt }] other busy time
 * @param {string|Date|number} args.from   start of the range (inclusive)
 * @param {string|Date|number} args.to     end of the range (exclusive)
 * @param {string|Date|number} [args.now] defaults to the current time
 * @returns {Array<{ startsAt: string, endsAt: string }>} earliest first
 */
function freeSlots({ calendar, bookings = [], busy = [], from, to, now = Date.now() } = {}) {
  if (!calendar || typeof calendar !== 'object') throw new TypeError('calendar is required');
  const timeZone = String(calendar.timeZone || '').trim();
  if (!isValidIanaTimeZone(timeZone)) throw new TypeError(`timeZone must be an IANA time zone (got ${JSON.stringify(calendar.timeZone)})`);
  const meeting = wholeMinutes(calendar.meetingMinutes, 'meetingMinutes', 1);
  const gap = wholeMinutes(calendar.gapMinutes ?? 0, 'gapMinutes', 0);
  const notice = wholeMinutes(calendar.minNoticeMinutes ?? 0, 'minNoticeMinutes', 0);
  const daysAhead = wholeMinutes(calendar.daysAhead ?? 0, 'daysAhead', 0);

  const fromMs = toMillis(from, 'from');
  const toMs = toMillis(to, 'to');
  const nowMs = toMillis(now, 'now');
  if (toMs <= fromMs) return [];
  if (toMs - fromMs > MAX_RANGE_DAYS * DAY) {
    throw new RangeError(`ask for at most ${MAX_RANGE_DAYS} days at a time`);
  }

  const blocked = new Set(Array.isArray(calendar.blockedDates) ? calendar.blockedDates : []);
  const hours = calendar.weeklyHours && typeof calendar.weeklyHours === 'object' ? calendar.weeklyHours : {};

  // Time that is taken, each interval widened by the gap on both sides.
  const taken = [];
  for (const b of bookings) {
    if (!b || (b.status && b.status !== 'booked')) continue;
    taken.push([toMillis(b.startsAt, 'booking startsAt') - gap * MINUTE, toMillis(b.endsAt, 'booking endsAt') + gap * MINUTE]);
  }
  for (const b of busy) {
    if (!b) continue;
    taken.push([toMillis(b.startsAt, 'busy startsAt') - gap * MINUTE, toMillis(b.endsAt, 'busy endsAt') + gap * MINUTE]);
  }

  const earliest = Math.max(fromMs, nowMs + notice * MINUTE);
  const todayParts = partsInTimeZone(nowMs, timeZone);
  const lastDay = dateKey(addDays(todayParts, daysAhead));

  // Walk the calendar's own dates, one either side of the range, because the
  // range is in UTC and a day in the calendar's zone straddles two UTC days.
  const firstDate = addDays(partsInTimeZone(fromMs, timeZone), -1);
  const lastDate = addDays(partsInTimeZone(toMs, timeZone), 1);
  const out = [];
  const seen = new Set();
  for (let date = firstDate; dateKey(date) <= dateKey(lastDate); date = addDays(date, 1)) {
    const key = dateKey(date);
    if (key > lastDay) break;
    if (blocked.has(key)) continue;
    const windows = Array.isArray(hours[weekdayKey(date)]) ? hours[weekdayKey(date)] : [];
    for (const window of windows) {
      const open = minutesOf(window?.start);
      const close = minutesOf(window?.end);
      if (open === null || close === null || close <= open) continue;
      const closeAt = instantOf(date, close, timeZone);
      for (let m = open; m + meeting <= close; m += meeting + gap) {
        const start = instantOf(date, m, timeZone);
        if (start === null) continue; // the clocks skip this time today
        const end = start + meeting * MINUTE;
        if (closeAt !== null && end > closeAt) continue;
        if (start < earliest || start >= toMs) continue;
        if (taken.some(([busyStart, busyEnd]) => start < busyEnd && end > busyStart)) continue;
        if (seen.has(start)) continue;
        seen.add(start);
        out.push({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
      }
    }
  }
  out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return out;
}

/** Is [startsAt, endsAt) exactly one of the free slots? The booking write asks this. */
function isSlotFree(args, startsAt, endsAt) {
  const start = toMillis(startsAt, 'startsAt');
  const slots = freeSlots({ ...args, from: new Date(start), to: new Date(start + MINUTE) });
  return slots.some((slot) => Date.parse(slot.startsAt) === start && Date.parse(slot.endsAt) === toMillis(endsAt, 'endsAt'));
}

module.exports = {
  DAY_KEYS,
  MAX_RANGE_DAYS,
  freeSlots,
  isSlotFree,
  minutesOf,
};
