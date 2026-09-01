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
