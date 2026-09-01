/**
 * Event dates: the conversions the Event Manager form and every calendar
 * module need, in one tested place.
 *
 * These live here rather than beside the module because they are the part of
 * the feature that can be got quietly wrong. A date rendered an hour out, or
 * an all-day event showing "12:00 AM", is not a crash — it is a page that
 * looks fine and tells the visitor the wrong time.
 */

/** A stored event, as much of one as formatting needs. */
export type EventTimes = {
  startsAt?: string | null;
  endsAt?: string | null;
  allDay?: boolean;
};

/**
 * An ISO timestamp as `<input type="datetime-local">` (or `type="date"`)
 * wants it.
 *
 * The input has NO concept of a time zone: it reads whatever string it is
 * given as local wall-clock time. So slicing an ISO string — `iso.slice(0, 16)`
 * — puts a UTC time in a box labelled local, which is silently wrong by the
 * viewer's offset and looks perfectly reasonable in a code review. The
 * conversion has to go through Date to pick up the offset.
 */
export function isoToLocalInput(iso: string | null | undefined, dateOnly = false): string {
  const text = String(iso || "");
  if (!text) return "";
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dateOnly ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The reverse: a local-time input value as an ISO timestamp.
 *
 * A bare `YYYY-MM-DD` is deliberately read as local midnight, not UTC
 * midnight — `Date.parse("2026-04-19")` is UTC by specification, which would
 * file an all-day event on the previous day for everyone west of Greenwich.
 */
export function localInputToIso(value: string): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text.length === 10 ? `${text}T00:00` : text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * When an event happens, in one line.
 *
 * Four shapes, because they read differently:
 *   - an all-day event has no clock to show;
 *   - a same-day event says its date once;
 *   - a multi-day event needs both ends;
 *   - an event with no start says so, rather than rendering an empty cell
 *     that looks exactly like a module that failed to load.
 */
export function formatEventWhen(event: EventTimes, locale?: string): string {
  const start = event.startsAt ? new Date(event.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return "Not scheduled";

  const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startDate = start.toLocaleDateString(locale, dateOpts);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  const hasEnd = Boolean(end) && !Number.isNaN((end as Date).getTime());

  if (event.allDay) {
    if (hasEnd && (end as Date).toDateString() !== start.toDateString()) {
      return `${startDate} – ${(end as Date).toLocaleDateString(locale, dateOpts)}`;
    }
    return `${startDate} (all day)`;
  }

  const startTime = start.toLocaleTimeString(locale, timeOpts);
  if (!hasEnd) return `${startDate}, ${startTime}`;
  if ((end as Date).toDateString() === start.toDateString()) {
    return `${startDate}, ${startTime} – ${(end as Date).toLocaleTimeString(locale, timeOpts)}`;
  }
  return `${startDate}, ${startTime} – ${(end as Date).toLocaleDateString(locale, dateOpts)}, ${(end as Date).toLocaleTimeString(locale, timeOpts)}`;
}

/** The three states an event can be in. Anything else is a draft. */
export const EVENT_STATUSES = ["draft", "published", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export function normalizeEventStatus(value: string | null | undefined): EventStatus {
  const text = String(value || "").trim().toLowerCase();
  return (EVENT_STATUSES as readonly string[]).includes(text) ? (text as EventStatus) : "draft";
}

/* ── Calendar geometry ─────────────────────────────────────────────────────
 *
 * A month grid is arithmetic, and arithmetic is the one part of a calendar a
 * test can hold still. It lives here, beside the formatting, so the public
 * calendar module can be a renderer rather than a renderer with a date
 * library inside it.
 */

/** Midnight local on the day `value` falls in — the unit a calendar counts in. */
export function startOfDay(value: Date | string | number): Date {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * The weeks a month grid draws: whole weeks, so the first row starts on the
 * grid's first weekday and the last row ends on its last.
 *
 * `weekStartsOn` is 0 for Sunday (the US default this platform's tenants use)
 * or 1 for Monday. The leading and trailing days belong to the neighbouring
 * months and are marked, because a calendar that hides them leaves ragged
 * holes and a calendar that draws them unmarked lies about the month.
 */
export type CalendarCell = { date: Date; inMonth: boolean };

export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1 = 0): CalendarCell[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);

  const weeks: CalendarCell[][] = [];
  const cursor = new Date(year, month, 1 - lead);
  for (let week = 0; week < weekCount; week += 1) {
    const row: CalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      row.push({ date: new Date(cursor.getTime()), inMonth: cursor.getMonth() === month && cursor.getFullYear() === year });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/**
 * Does this event touch this day?
 *
 * Compared by DAY, not by instant: an event running 6pm–9pm is on that day
 * even though most of the day is not inside it, and a three-day festival is
 * on all three of its days. An event with no start is on no day at all — it
 * is unscheduled, and a calendar has nowhere to put it.
 */
export function eventOccursOn(event: EventTimes, day: Date): boolean {
  if (!event.startsAt) return false;
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return false;
  const target = startOfDay(day).getTime();
  const from = startOfDay(start).getTime();
  if (target < from) return false;
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (!end || Number.isNaN(end.getTime())) return target === from;
  return target <= startOfDay(end).getTime();
}

/**
 * Is this event still worth showing as "coming up"?
 *
 * An event is upcoming until it has FINISHED, not until it has started — a
 * three-day festival on its second day, or a party half way through its
 * evening, is exactly the thing a visitor is looking for. Judging by start
 * time would drop it from the list at the moment it becomes most relevant.
 */
export function isUpcomingEvent(event: EventTimes, now: Date = new Date()): boolean {
  if (!event.startsAt) return false;
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return false;
  const end = event.endsAt ? new Date(event.endsAt) : null;
  const finish = end && !Number.isNaN(end.getTime())
    ? end
    : (event.allDay ? new Date(startOfDay(start).getTime() + 86400000 - 1) : start);
  return finish.getTime() >= now.getTime();
}
