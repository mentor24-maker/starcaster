'use strict';

/**
 * Reading what a CALLER handed a store — the parts videoSessionsStore and
 * videoSourcesStore both need, in one place so they cannot drift apart.
 *
 * They already drifted once: `timestampOrError` was copied into both files and
 * only one copy got hardened, so the same bad date was a 400 on one table and a
 * silent wrong value on the other. Same shape as the three content_hash lengths
 * that disagreed depending on which path wrote them. One declaration is the fix
 * for that whole class, so this module is where a rule about caller input goes.
 */

/** `durationS` → `duration_s`. The one conversion both stores use. */
function snakeCase(key) {
  return key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

/** Are two supplied-twice values the same answer? Dates by instant, not identity. */
function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

/**
 * One field from caller input, under EITHER casing.
 *
 * `createSource` read both (`input?.[key] ?? input?.[snake]`); `updateSource`
 * read camelCase only. So `updateSource(id, { state: 'probed', duration_s: 99.5 })`
 * answered ok:true/200, applied the state, and left the duration at its old
 * value — correct data, correct column, dropped in silence because of its
 * spelling. Slices 4/8-6/8 are the only callers this table will ever have, and
 * a probe reports its numbers under the COLUMN names. Review reproduced it.
 *
 * Supplying both spellings with different values is refused rather than
 * resolved: `??` quietly preferred camelCase, which is a coin-toss dressed as
 * a rule, and one of the two values was going to be discarded under a 200.
 *
 * @returns {{ ok: true, present: boolean, value: any } | { ok: false, status, error }}
 */
function readField(input, key) {
  const snake = snakeCase(key);
  const hasCamel = input?.[key] !== undefined;
  const hasSnake = snake !== key && input?.[snake] !== undefined;
  if (hasCamel && hasSnake && !sameValue(input[key], input[snake])) {
    return {
      ok: false,
      status: 400,
      error: `${key} was supplied twice, as ${key} and ${snake}, with different values`,
    };
  }
  if (hasCamel) return { ok: true, present: true, value: input[key] };
  if (hasSnake) return { ok: true, present: true, value: input[snake] };
  return { ok: true, present: false, value: undefined };
}

/**
 * A 400 naming any key the store does not recognise, or null if all are known.
 *
 * The casing fix above stops the common spelling from vanishing; this stops the
 * uncommon one. A typo'd `durationSec` mixed in with one good key still lands a
 * 200 otherwise, because the patch is not empty and nothing looks at the rest —
 * the same "reports success, stored something else" shape this ticket has spent
 * five rounds removing.
 */
function unknownKeyError(input, keys) {
  const allowed = new Set();
  for (const key of keys) {
    allowed.add(key);
    allowed.add(snakeCase(key));
  }
  const unknown = Object.keys(input || {}).filter((key) => !allowed.has(key));
  if (!unknown.length) return null;
  return {
    ok: false,
    status: 400,
    error: `Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. `
      + `Known fields are ${[...keys].join(', ')}`,
  };
}

/** `2026-08-26`, with no time at all — parsed as UTC by the language itself. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** `2026-08-26T12:34:56.789Z`, `... +02:00`, or the same with no zone at all. */
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|z|[+-]\d{2}:?\d{2})?$/;

const TIMESTAMP_SHAPE =
  'must be a Date or an ISO 8601 date string (2026-08-26 or 2026-08-26T12:34:56Z)';

/** Days in a month, Gregorian — so 29 February is right in 2028 and wrong in 2026. */
function daysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Why a date that MATCHES the ISO shape is still not a date, or '' if it is one.
 * `new Date` rolls these over instead of refusing them; see the caller.
 */
function calendarError(text, dateOnly) {
  const [year, month, day] = text.slice(0, 10).split('-').map(Number);
  if (month < 1 || month > 12) return `has month ${month}, which does not exist`;
  if (day < 1 || day > daysInMonth(year, month)) {
    return `is ${text.slice(0, 10)}, a day that does not exist`;
  }
  if (dateOnly) return '';
  const [hour, minute, second = 0] = text.slice(11).split(/[:+\-Zz]/).map(Number);
  if (hour > 23) return `has hour ${hour}, which does not exist`;
  if (minute > 59) return `has minute ${minute}, which does not exist`;
  if (second > 59) return `has second ${second}, which does not exist`;
  return '';
}

/**
 * A timestamp, or a 400 saying so — the same bargain numberOrError and
 * textOrError make, which this function did not make until now.
 *
 * It ran everything through `String(value)` and handed the result to
 * `new Date(string)`, which has an implementation-defined fallback parser for
 * anything that is not ISO 8601. So `createSource({ recordedAt: 0 })` stored
 * 2000-01-01T07:00:00Z under ok:true — a real instant, from a number that is
 * not a date at all, and one nobody would ever notice was invented. Review
 * reproduced it on both stores.
 *
 * Two decisions worth stating, because both are visible in what is stored:
 *
 * - Only ISO 8601 is accepted. Not because other formats are unreadable, but
 *   because the fallback parser's answers vary by engine, and a stored instant
 *   that depends on WHO parsed it is exactly the class of bug this ticket is
 *   about. A caller with an odd format can parse it themselves and pass a Date.
 * - A date-time with NO zone (`2026-08-26T12:34:56`) is read as UTC, not as
 *   local time. `new Date()` reads that shape in the machine's own zone, so the
 *   same string written from the Mac Mini and from the MacBook stored two
 *   different instants. UTC is the one reading that does not depend on which
 *   machine ran the ingest. (A date with no time at all is already UTC per the
 *   language spec, so this makes the two agree.)
 *
 * @returns {{ ok: true, value: string|null } | { ok: false, status, error }}
 */
function timestampOrError(value, field) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { ok: false, status: 400, error: `${field} is not a valid date` }
      : { ok: true, value: value.toISOString() };
  }
  if (typeof value !== 'string') {
    return { ok: false, status: 400, error: `${field} ${TIMESTAMP_SHAPE}` };
  }

  const text = value.trim();
  if (!text) return { ok: true, value: null };

  const dateOnly = ISO_DATE_RE.test(text);
  if (!dateOnly && !ISO_DATETIME_RE.test(text)) {
    return { ok: false, status: 400, error: `${field} ${TIMESTAMP_SHAPE}` };
  }

  // A space instead of the T is legal SQL and common in ffprobe output; a
  // missing zone becomes Z rather than the local one. See the note above.
  let normalized = text.replace(' ', 'T');
  if (!dateOnly && !/(Z|z|[+-]\d{2}:?\d{2})$/.test(normalized)) normalized += 'Z';

  // The shape can be right and the date still not exist. `new Date` does NOT
  // reject those: it rolls them over, so '2026-02-30' came back as 2 March and
  // '...T25:00:00' as the next morning — a real instant, silently not the one
  // that was asked for, under ok:true. That is the same failure as the invented
  // 2000-01-01 above arriving through the check meant to catch it, so the
  // calendar is checked directly rather than inferred from a non-NaN result.
  const outOfRange = calendarError(text, dateOnly);
  if (outOfRange) return { ok: false, status: 400, error: `${field} ${outOfRange}` };

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, status: 400, error: `${field} is not a valid date` };
  }
  return { ok: true, value: parsed.toISOString() };
}

module.exports = { snakeCase, readField, unknownKeyError, timestampOrError };
