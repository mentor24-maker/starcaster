'use strict';

/**
 * Repeating events — the server's rule for what a stored rule may be.
 *
 * A repeating event is ONE row carrying a rule, not a row per date: the
 * Delray program guide is ~35 weekly programs, and a row per date would be
 * ~1,800 rows a year to keep in step every time a coach changes. The dates
 * are worked out when they are shown (lib/builder-client/event-recurrence.ts).
 *
 * The shapes (docs/SQL/events_programs_setup.sql):
 *   recurrence:  { freq: 'weekly', interval: 1, weekdays: [1, 3], until: 'YYYY-MM-DD' | null }
 *   overrides:   [{ date: 'YYYY-MM-DD', cancelled?, startTime?, endTime?, instructor?, note? }]
 *
 * Two entry points, deliberately different:
 *   - `parseRecurrence` / `parseOverrides` are for REQUEST bodies and throw a
 *     RecurrenceError with a sentence the admin can act on. A bad rule that
 *     was quietly dropped would save as a one-off event and report success.
 *   - `readRecurrence` / `readOverrides` are for rows READ BACK, and never
 *     throw: a hand-edited row must not take the whole calendar down, so the
 *     unreadable part is dropped and the rest still renders.
 */

const FREQS = new Set(['weekly']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_INTERVAL = 12;
const MAX_OVERRIDES = 1000;
const MAX_NOTE = 500;

class RecurrenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecurrenceError';
    this.code = 'VALIDATION_ERROR';
  }
}

function isCalendarDate(text) {
  const match = DATE_RE.exec(String(text || ''));
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function isValidTimeZone(name) {
  const text = String(name || '').trim();
  if (!text) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: text });
    return true;
  } catch {
    return false;
  }
}

function parseJsonish(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return undefined; }
}

function parseRecurrence(value) {
  const input = parseJsonish(value);
  if (input === null || input === undefined || input === false) {
    if (input === undefined && typeof value === 'string') throw new RecurrenceError('Repeat rule is not valid JSON.');
    return null;
  }
  if (typeof input !== 'object' || Array.isArray(input)) throw new RecurrenceError('Repeat rule must be an object.');

  const freq = String(input.freq || '').trim().toLowerCase();
  if (!FREQS.has(freq)) throw new RecurrenceError(`Repeat "${input.freq || ''}" is not supported — only weekly repeats are.`);

  const interval = input.interval === undefined || input.interval === null || input.interval === '' ? 1 : Number(input.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    throw new RecurrenceError(`Repeat every ${input.interval} weeks is not allowed — use a whole number from 1 to ${MAX_INTERVAL}.`);
  }

  if (!Array.isArray(input.weekdays) || !input.weekdays.length) {
    throw new RecurrenceError('Pick at least one day of the week for the event to repeat on.');
  }
  const weekdays = [];
  for (const day of input.weekdays) {
    const n = Number(day);
    if (!Number.isInteger(n) || n < 0 || n > 6) throw new RecurrenceError(`"${day}" is not a day of the week (0 = Sunday … 6 = Saturday).`);
    if (!weekdays.includes(n)) weekdays.push(n);
  }
  weekdays.sort((a, b) => a - b);

  let until = null;
  if (input.until !== undefined && input.until !== null && input.until !== '') {
    until = String(input.until).trim();
    if (!isCalendarDate(until)) throw new RecurrenceError(`Repeat end date "${input.until}" is not a date (expected YYYY-MM-DD).`);
  }

  return { freq, interval, weekdays, until };
}

function parseOverrides(value) {
  const input = parseJsonish(value);
  if (input === null || input === undefined) {
    if (input === undefined && typeof value === 'string') throw new RecurrenceError('Date changes are not valid JSON.');
    return [];
  }
  if (!Array.isArray(input)) throw new RecurrenceError('Date changes must be a list.');
  if (input.length > MAX_OVERRIDES) throw new RecurrenceError(`At most ${MAX_OVERRIDES} single-date changes can be saved on one event.`);

  const byDate = new Map();
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') throw new RecurrenceError('Each date change must be an object.');
    const date = String(entry.date || '').trim();
    if (!isCalendarDate(date)) throw new RecurrenceError(`Date change "${entry.date || ''}" is not a date (expected YYYY-MM-DD).`);
    const next = { date };
    if (entry.cancelled === true || entry.cancelled === 'true') next.cancelled = true;
    for (const key of ['startTime', 'endTime']) {
      const raw = entry[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const text = String(raw).trim();
      if (!TIME_RE.test(text)) throw new RecurrenceError(`${key === 'startTime' ? 'Start' : 'End'} time "${raw}" on ${date} is not a time (expected HH:MM, 24-hour).`);
      next[key] = text;
    }
    if (next.startTime && next.endTime && next.endTime <= next.startTime) {
      throw new RecurrenceError(`On ${date} the end time ${next.endTime} is not after the start time ${next.startTime}.`);
    }
    // A substitute coach for one date: Delray's guide changes the instructor
    // week to week far more often than it changes the time.
    const instructor = String(entry.instructor || '').trim();
    if (instructor) next.instructor = instructor.slice(0, 120);
    const note = String(entry.note || '').trim();
    if (note) next.note = note.slice(0, MAX_NOTE);
    // An entry that changes nothing is noise that would outlive its purpose.
    if (Object.keys(next).length > 1) byDate.set(date, next);
    else byDate.delete(date);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function readRecurrence(value) {
  try { return parseRecurrence(value); } catch { return null; }
}

function readOverrides(value) {
  const input = parseJsonish(value);
  if (!Array.isArray(input)) return [];
  const kept = [];
  for (const entry of input) {
    try { kept.push(...parseOverrides([entry])); } catch { /* drop the one unreadable entry */ }
  }
  return parseOverrides(kept);
}

module.exports = {
  RecurrenceError,
  parseRecurrence,
  parseOverrides,
  readRecurrence,
  readOverrides,
  isCalendarDate,
  isValidTimeZone,
};
