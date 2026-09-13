/**
 * Repeating events: turning one stored rule into the dates it happens on.
 *
 * A repeating event is ONE row with a rule (see lib/eventRecurrence.js for the
 * server's validation and the reason it is not a row per date). Everything
 * that shows dates — the admin's "Upcoming dates" list, the public calendar —
 * asks this file, so there is one answer to "is Drills & Games on the 14th?".
 *
 * THE TIME ZONE IS THE EVENT'S, NOT THE VIEWER'S. A program at 8:30am in
 * Delray is at 8:30am every week, including the week the clocks change. Adding
 * seven days of milliseconds to the first start would put it at 7:30am from
 * November 1 — a calendar that is confidently wrong for half the year. So
 * each date's time is worked out as wall-clock time in the event's zone and
 * converted to an instant for THAT date.
 */

export type RecurrenceRule = {
  freq: "weekly";
  interval: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** Last date it may happen on, inclusive, in the event's zone. */
  until: string | null;
};

export type RecurrenceOverride = {
  date: string;
  cancelled?: boolean;
  startTime?: string;
  endTime?: string;
  /** A substitute instructor for this date only. */
  instructor?: string;
  note?: string;
};

export type RepeatableEvent = {
  id?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  allDay?: boolean;
  timezone?: string;
  recurrence?: RecurrenceRule | null;
  recurrenceOverrides?: RecurrenceOverride[] | null;
};

export type Occurrence = {
  /** `<eventId>:<YYYY-MM-DD>` — stable across renders, usable as a React key. */
  key: string;
  /** The date in the event's zone. */
  date: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  cancelled: boolean;
  note: string;
  /** This date's substitute instructor, or '' when the event's own applies. */
  instructor: string;
  /** True when a single-date change altered this date. */
  changed: boolean;
  recurring: boolean;
};

const DAY_MS = 86400000;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/* ── Time zones ─────────────────────────────────────────────────────────── */

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(name: string | null | undefined): boolean {
  const text = String(name || "").trim();
  if (!text) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: text });
    return true;
  } catch {
    return false;
  }
}

/** The event's zone when it names a real one, otherwise the viewer's. */
export function eventTimeZone(event: { timezone?: string | null }): string {
  return isValidTimeZone(event.timezone) ? String(event.timezone).trim() : browserTimeZone();
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** What a clock on the wall in `timeZone` reads at instant `ms`. */
export function wallClock(ms: number, timeZone: string): WallClock {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", weekday: "short",
    });
    partsFormatters.set(timeZone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAY_SHORT.indexOf(parts.weekday as (typeof WEEKDAY_SHORT)[number]),
  };
}

function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return asUtc - Math.floor(ms / 60000) * 60000;
}

/**
 * The instant a wall clock in `timeZone` shows this date and time.
 *
 * Two passes, because the offset depends on the instant being looked for. In
 * the hour that does not exist (2:30am on the spring-forward night) this
 * lands an hour later, which is what every calendar application does.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  const reads = (ms: number) => {
    const w = wallClock(ms, timeZone);
    return w.hour === (hh || 0) && w.minute === (mm || 0);
  };
  if (reads(second)) return second;
  if (reads(first)) return first;
  // No instant reads that time — it fell in the gap. The later candidate is
  // the one after the jump.
  return Math.max(first, second);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function zonedDate(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function zonedTime(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * An ISO instant as a form input shows it — in the EVENT'S zone. The form
 * used to show the admin's browser zone, which is right only while the admin
 * happens to be in the same zone as the club.
 */
export function isoToZonedInput(iso: string | null | undefined, timeZone: string, dateOnly = false): string {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "";
  const day = zonedDate(ms, timeZone);
  return dateOnly ? day : `${day}T${zonedTime(ms, timeZone)}`;
}

export function zonedInputToIso(value: string, timeZone: string): string | null {
  const text = String(value || "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(text);
  if (!match) return null;
  const ms = zonedTimeToUtc(match[1], match[2] || "00:00", timeZone);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/* ── Plain calendar dates (no zone: a date is a date) ───────────────────── */

function dateToDayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dayNumberToDate(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  return dayNumberToDate(dateToDayNumber(date) + days);
}

/** 0 = Sunday, for a plain date. */
export function weekdayOf(date: string): number {
  return ((dateToDayNumber(date) + 4) % 7 + 7) % 7;
}

/* ── Expansion ──────────────────────────────────────────────────────────── */

/** Hard stop on one expansion, so a rule with no end cannot hang a page. */
const MAX_DAYS_SCANNED = 800;

/**
 * The dates an event happens on between two instants.
 *
 * A one-off event is returned as one occurrence when it overlaps the range,
 * so callers can treat every event the same way. Cancelled dates ARE
 * returned, marked — the admin list shows them with a Restore button, and a
 * public view decides for itself whether to hide or strike them through.
 *
 * Which dates a weekly rule produces: every chosen weekday on or after the
 * first start date, in weeks counted from the start date's week (Sunday
 * start), up to and including `until`. The start date itself only counts if
 * its weekday is one of the chosen ones — the form says "starting", not "on".
 */
export function expandOccurrences(event: RepeatableEvent, from: Date | number, to: Date | number): Occurrence[] {
  const fromMs = typeof from === "number" ? from : from.getTime();
  const toMs = typeof to === "number" ? to : to.getTime();
  const startMs = Date.parse(String(event.startsAt || ""));
  if (!Number.isFinite(startMs) || !(toMs >= fromMs)) return [];
  const endMsRaw = Date.parse(String(event.endsAt || ""));
  const endMs = Number.isFinite(endMsRaw) && endMsRaw >= startMs ? endMsRaw : null;
  const allDay = Boolean(event.allDay);
  const id = String(event.id || "");
  const rule = event.recurrence && event.recurrence.freq === "weekly" && event.recurrence.weekdays?.length
    ? event.recurrence
    : null;
  const tz = eventTimeZone(event);

  const overlaps = (s: number, e: number | null) => {
    const finish = e ?? (allDay ? s + DAY_MS - 1 : s);
    return finish >= fromMs && s <= toMs;
  };

  if (!rule) {
    if (!overlaps(startMs, endMs)) return [];
    return [{
      key: `${id}:${zonedDate(startMs, tz)}`,
      date: zonedDate(startMs, tz),
      startsAt: new Date(startMs).toISOString(),
      endsAt: endMs === null ? null : new Date(endMs).toISOString(),
      allDay, cancelled: false, note: "", instructor: "", changed: false, recurring: false,
    }];
  }

  const firstDate = zonedDate(startMs, tz);
  const startTime = allDay ? "00:00" : zonedTime(startMs, tz);
  // The end is kept as "so many days after, at this clock time" rather than a
  // duration, so a 5:30–7:00pm program ends at 7:00pm on both sides of a
  // clock change.
  const endDayOffset = endMs === null ? 0 : dateToDayNumber(zonedDate(endMs, tz)) - dateToDayNumber(firstDate);
  const endTime = endMs === null ? "" : (allDay ? "00:00" : zonedTime(endMs, tz));
  const spanDays = Math.max(0, endDayOffset) + 1;

  const overrides = new Map<string, RecurrenceOverride>();
  for (const o of event.recurrenceOverrides || []) if (o && o.date) overrides.set(o.date, o);

  const interval = Math.max(1, Math.floor(Number(rule.interval) || 1));
  const weekdays = new Set(rule.weekdays.map(Number));
  const firstDay = dateToDayNumber(firstDate);
  const anchorWeekStart = firstDay - weekdayOf(firstDate);

  // Scan local dates from a little before the range (a long event that began
  // earlier may still be running) to a little after (zones ahead of UTC).
  let scanFrom = Math.max(firstDay, dateToDayNumber(zonedDate(fromMs, tz)) - spanDays);
  let scanTo = dateToDayNumber(zonedDate(toMs, tz)) + 1;
  if (rule.until) scanTo = Math.min(scanTo, dateToDayNumber(rule.until));
  if (scanTo - scanFrom > MAX_DAYS_SCANNED) scanTo = scanFrom + MAX_DAYS_SCANNED;

  const out: Occurrence[] = [];
  for (let day = scanFrom; day <= scanTo; day += 1) {
    const date = dayNumberToDate(day);
    if (!weekdays.has(weekdayOf(date))) continue;
    if (Math.floor((day - anchorWeekStart) / 7) % interval !== 0) continue;

    const o = overrides.get(date);
    const sTime = !allDay && o?.startTime ? o.startTime : startTime;
    const eTime = !allDay && o?.endTime ? o.endTime : endTime;
    const s = zonedTimeToUtc(date, sTime, tz);
    let e: number | null = null;
    if (endMs !== null || (o?.endTime && !allDay)) {
      e = zonedTimeToUtc(addDays(date, endMs === null ? 0 : endDayOffset), eTime, tz);
      if (e < s) e = null;
    }
    if (!overlaps(s, e)) continue;
    out.push({
      key: `${id}:${date}`,
      date,
      startsAt: new Date(s).toISOString(),
      endsAt: e === null ? null : new Date(e).toISOString(),
      allDay,
      cancelled: Boolean(o?.cancelled),
      note: String(o?.note || ""),
      instructor: String(o?.instructor || ""),
      changed: Boolean(o && (o.cancelled || o.startTime || o.endTime || o.instructor || o.note)),
      recurring: true,
    });
  }
  return out;
}

/* ── Words ──────────────────────────────────────────────────────────────── */

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatPlainDate(date: string, locale?: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The rule in words, for the manager table and the event page:
 * "Weekly on Mon, Wed until Dec 19, 2026", "Every 2 weeks on Tuesday",
 * "Every weekday", "Daily" (all seven days).
 */
export function describeRecurrence(rule: RecurrenceRule | null | undefined, locale?: string): string {
  if (!rule || rule.freq !== "weekly" || !rule.weekdays?.length) return "";
  const days = Array.from(new Set(rule.weekdays.map(Number))).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const interval = Math.max(1, Math.floor(Number(rule.interval) || 1));
  let dayText: string;
  if (days.length === 7) dayText = "every day";
  else if (days.join(",") === "1,2,3,4,5") dayText = "weekdays";
  else if (days.length === 1) dayText = WEEKDAY_LONG[days[0]];
  else dayText = days.map((d) => WEEKDAY_SHORT[d]).join(", ");

  let text: string;
  if (interval === 1) text = days.length === 7 ? "Daily" : `Weekly on ${dayText}`;
  else text = `Every ${interval} weeks on ${dayText}`;
  if (rule.until) text += ` until ${formatPlainDate(rule.until, locale)}`;
  return text;
}

/** "8:30 AM – 10:00 AM", read in the event's zone. All day says so. */
export function formatTimeRange(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  timeZone: string,
  allDay = false,
  locale?: string,
): string {
  if (allDay) return "All day";
  const s = Date.parse(String(startsAt || ""));
  if (!Number.isFinite(s)) return "";
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone };
  const start = new Date(s).toLocaleTimeString(locale, opts);
  const e = Date.parse(String(endsAt || ""));
  return Number.isFinite(e) && e > s ? `${start} – ${new Date(e).toLocaleTimeString(locale, opts)}` : start;
}

/** "Mon, Sep 14" for a plain YYYY-MM-DD, with no zone to shift it. */
export function formatOccurrenceDate(date: string, locale?: string, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}
