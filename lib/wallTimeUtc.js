'use strict';

/**
 * Parse datetime-local style string "YYYY-MM-DDTHH:mm" (no timezone).
 * @param {string} wallLocal
 * @returns {{ y: number, mo: number, d: number, h: number, mi: number } | null}
 */
function parseWallLocal(wallLocal) {
  const m = String(wallLocal || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
  };
}

function partsInTimeZone(utcMillis, timeZone) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    const o = {};
    for (const p of f.formatToParts(new Date(utcMillis))) {
      if (p.type !== 'literal') o[p.type] = Number(p.value);
    }
    return {
      y: o.year,
      mo: o.month,
      d: o.day,
      h: o.hour,
      mi: o.minute,
    };
  } catch {
    return null;
  }
}

function wallClockEqual(a, b) {
  return a && b && a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;
}

function isValidIanaTimeZone(timeZone) {
  const tz = String(timeZone || '').trim();
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Interpret wall-local "YYYY-MM-DDTHH:mm" in the given IANA zone and return UTC ISO (Z).
 * Uses minute stepping within ±48h of noon UTC on that calendar day (handles DST).
 * @param {string} wallLocal
 * @param {string} timeZone IANA e.g. America/Los_Angeles; empty uses runtime local parsing (legacy).
 * @returns {string | null} ISO string or null if invalid / nonexistent local time
 */
function wallLocalToUtcIso(wallLocal, timeZone) {
  const want = parseWallLocal(wallLocal);
  if (!want) return null;
  const tz = String(timeZone || '').trim();
  if (!tz || tz.toUpperCase() === 'UTC' || tz === 'Etc/UTC') {
    const d = new Date(Date.UTC(want.y, want.mo - 1, want.d, want.h, want.mi, 0));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (!isValidIanaTimeZone(tz)) return null;

  const center = Date.UTC(want.y, want.mo - 1, want.d, 12, 0, 0);
  const start = center - 48 * 3600000;
  const end = center + 48 * 3600000;
  for (let t = start; t <= end; t += 60000) {
    const p = partsInTimeZone(t, tz);
    if (wallClockEqual(p, want)) {
      return new Date(t).toISOString();
    }
  }
  return null;
}

module.exports = {
  wallLocalToUtcIso,
  parseWallLocal,
  isValidIanaTimeZone,
};
