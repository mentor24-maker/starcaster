/**
 * The public calendar's view of time: which dates to draw, and which program
 * sits on each one (task 86bbzt25j).
 *
 * Every public layout — month grid, list, cards, weekly schedule, the event
 * page — asks this file, and this file asks `expandOccurrences`, so a
 * repeating program is on the same dates in every view. The arithmetic lives
 * here rather than in the renderer because a calendar that puts Tuesday's
 * program under Wednesday is confidently wrong, and only a test can hold that
 * still.
 */

import {
  addDays,
  browserTimeZone,
  eventTimeZone,
  expandOccurrences,
  isValidTimeZone,
  weekdayOf,
  zonedDate,
  zonedTimeToUtc,
  type Occurrence,
  type RepeatableEvent,
} from "./event-recurrence";

export type SchedulableEvent = RepeatableEvent & {
  id: string;
  title: string;
  slug?: string;
  instructor?: string;
  categoryId?: string;
};

export type ScheduleItem<E extends SchedulableEvent = SchedulableEvent> = {
  event: E;
  occurrence: Occurrence;
  /** The zone this item's dates and times are read in. */
  timeZone: string;
};

const DAY_MS = 86400000;

/**
 * The zone a whole calendar is drawn in: the first event that names a real
 * one. A club's events share a zone, and drawing the week in the VISITOR's
 * zone would move a 7pm Tuesday program onto Wednesday for anyone travelling.
 */
export function calendarTimeZone(events: Array<{ timezone?: string | null }>): string {
  const named = events.find((e) => isValidTimeZone(e.timezone));
  return named ? String(named.timezone).trim() : browserTimeZone();
}

/** Every date of every event between two instants, soonest first. */
export function scheduleBetween<E extends SchedulableEvent>(
  events: E[],
  from: number,
  to: number,
): ScheduleItem<E>[] {
  const items: ScheduleItem<E>[] = [];
  for (const event of events) {
    const timeZone = eventTimeZone(event);
    for (const occurrence of expandOccurrences(event, from, to)) {
      items.push({ event, occurrence, timeZone });
    }
  }
  return items.sort((a, b) =>
    Date.parse(a.occurrence.startsAt) - Date.parse(b.occurrence.startsAt)
    || String(a.event.title || "").localeCompare(String(b.event.title || "")));
}

/**
 * The plain dates one occurrence covers, in its own zone. A 6–9pm program is
 * on one date; a three-day tournament is on three. Capped, so a mistyped end
 * date a year out cannot paint a whole year.
 */
export function occurrenceDates(item: ScheduleItem): string[] {
  const first = item.occurrence.date;
  const endMs = Date.parse(String(item.occurrence.endsAt || ""));
  if (!Number.isFinite(endMs)) return [first];
  let last = zonedDate(endMs, item.timeZone);
  // An end at exactly midnight belongs to the day before, unless it is an
  // all-day event (whose stored end IS the last day's midnight).
  if (!item.occurrence.allDay && last > first && zonedDate(endMs - 1, item.timeZone) < last) {
    last = zonedDate(endMs - 1, item.timeZone);
  }
  const dates = [first];
  for (let d = first; d < last && dates.length < 62; ) {
    d = addDays(d, 1);
    dates.push(d);
  }
  return dates;
}

/** Items grouped under each date they touch. Dates with nothing map to []. */
export function groupByDate<E extends SchedulableEvent>(items: ScheduleItem<E>[], dates: string[]): Map<string, ScheduleItem<E>[]> {
  const byDate = new Map<string, ScheduleItem<E>[]>(dates.map((d) => [d, []]));
  for (const item of items) {
    for (const d of occurrenceDates(item)) byDate.get(d)?.push(item);
  }
  return byDate;
}

/** Today's date as a wall calendar in `timeZone` shows it. */
export function todayIn(timeZone: string, now: number = Date.now()): string {
  return zonedDate(now, timeZone);
}

/** The seven dates of the week containing `date`. weekStartsOn: 0 = Sunday, 1 = Monday. */
export function weekDates(date: string, weekStartsOn: 0 | 1 = 1): string[] {
  const lead = (weekdayOf(date) - weekStartsOn + 7) % 7;
  const first = addDays(date, -lead);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** The instants a run of dates spans in `timeZone`: first midnight to last midnight. */
export function datesRange(dates: string[], timeZone: string): [number, number] {
  const from = zonedTimeToUtc(dates[0], "00:00", timeZone);
  const to = zonedTimeToUtc(addDays(dates[dates.length - 1], 1), "00:00", timeZone) - 1;
  return [from, to];
}

/** "Sep 14 – 20, 2026", "Sep 28 – Oct 4, 2026", "Dec 28, 2026 – Jan 3, 2027". */
export function formatWeekLabel(dates: string[], locale?: string): string {
  const parse = (d: string) => { const [y, m, day] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day)); };
  const a = parse(dates[0]);
  const b = parse(dates[dates.length - 1]);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(locale, { ...o, timeZone: "UTC" });
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    return `${fmt(a, { month: "short", day: "numeric", year: "numeric" })} – ${fmt(b, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (a.getUTCMonth() !== b.getUTCMonth()) {
    return `${fmt(a, { month: "short", day: "numeric" })} – ${fmt(b, { month: "short", day: "numeric" })}, ${b.getUTCFullYear()}`;
  }
  return `${fmt(a, { month: "short", day: "numeric" })} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
}

/**
 * The link to one event, and for a repeating one, to one DATE of it — so the
 * event page can say "Tuesday's session is cancelled" rather than describing
 * the series in general.
 */
export function eventPageHref(base: string, slug: string | undefined, item?: ScheduleItem | null): string | undefined {
  if (!base || !slug) return undefined;
  const sep = base.includes("?") ? "&" : "?";
  const date = item?.occurrence.recurring ? `&date=${encodeURIComponent(item.occurrence.date)}` : "";
  return `${base}${sep}event=${encodeURIComponent(slug)}${date}`;
}

/** The occurrence of `event` on `date`, or null when the rule skips that date. */
export function occurrenceOn(event: RepeatableEvent, date: string): Occurrence | null {
  const tz = eventTimeZone(event);
  const from = zonedTimeToUtc(date, "00:00", tz);
  return expandOccurrences(event, from, from + DAY_MS - 1).find((o) => o.date === date) || null;
}
