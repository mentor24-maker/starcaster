/**
 * Schedule harvest, the review half (task 86bbztj0e): what the server read
 * from a flyer, as rows Dane can correct, and the event each kept row becomes.
 *
 * Pure, so the arithmetic that decides WHICH DATE a program starts on and at
 * WHAT TIME — in the club's zone, not the reviewer's — is tested rather than
 * trusted. A wrong answer here is a whole season of programs an hour out.
 */

import { addDays, weekdayOf, zonedInputToIso } from "./event-recurrence";

export type HarvestSeries = {
  key: string;
  title: string;
  instructor: string;
  startTime: string;
  endTime: string;
  venue: string;
  weekdays: number[];
  dates: string[];
  existingEventId: string;
  existingTitle?: string;
};

export type HarvestVenue = { name: string; color: string; categoryId: string };

export type HarvestResult = {
  weekStart: string;
  venues: HarvestVenue[];
  series: HarvestSeries[];
  lineCount: number;
  dropped: number;
};

export type ReviewRow = {
  key: string;
  include: boolean;
  title: string;
  instructor: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  venue: string;
  existingEventId: string;
};

/** Monday-first, as a club's weekly guide is printed. */
export const HARVEST_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Rows start ticked unless the calendar already has the program — so pressing
 * Create straight away never duplicates what is there.
 */
export function rowsFromHarvest(result: HarvestResult): ReviewRow[] {
  return result.series.map((s) => ({
    key: s.key,
    include: !s.existingEventId,
    title: s.title,
    instructor: s.instructor,
    weekdays: [...s.weekdays],
    startTime: s.startTime,
    endTime: s.endTime,
    venue: s.venue,
    existingEventId: s.existingEventId,
  }));
}

/** The Monday of the week `date` falls in. A Sunday belongs to the week before. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/**
 * The date a series first happens: its earliest weekday, Monday-first, in the
 * flyer's week. "Tue/Fri" on the week of Aug 31 starts Tuesday Sep 1.
 */
export function firstDateFor(weekStart: string, weekdays: number[]): string {
  const monday = mondayOf(weekStart);
  const offsets = weekdays.map((d) => (d + 6) % 7);
  return addDays(monday, offsets.length ? Math.min(...offsets) : 0);
}

export type RowProblem = { key: string; message: string };

/** What stops a kept row from being created, named per row. */
export function rowProblems(rows: ReviewRow[]): RowProblem[] {
  const problems: RowProblem[] = [];
  for (const row of rows) {
    if (!row.include) continue;
    const name = row.title.trim() || "A program";
    if (!row.title.trim()) problems.push({ key: row.key, message: "A kept row has no program name." });
    if (!row.weekdays.length) problems.push({ key: row.key, message: `${name} has no days ticked.` });
    if (!/^\d{2}:\d{2}$/.test(row.startTime)) problems.push({ key: row.key, message: `${name} has no start time.` });
    if (row.endTime && row.endTime <= row.startTime) problems.push({ key: row.key, message: `${name} ends before it starts.` });
  }
  return problems;
}

export type EventPayload = {
  title: string;
  status: string;
  instructor: string;
  categoryId: string;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  allDay: false;
  recurrence: { freq: "weekly"; interval: 1; weekdays: number[]; until: string | null };
  recurrenceOverrides: [];
};

/** One kept row as the body of POST /api/events. */
export function eventPayloadFor(
  row: ReviewRow,
  options: { weekStart: string; timeZone: string; status: string; categoryId: string; until?: string },
): EventPayload {
  const first = firstDateFor(options.weekStart, row.weekdays);
  return {
    title: row.title.trim(),
    status: options.status,
    instructor: row.instructor.trim(),
    categoryId: options.categoryId,
    timezone: options.timeZone,
    startsAt: zonedInputToIso(`${first}T${row.startTime}`, options.timeZone),
    endsAt: row.endTime ? zonedInputToIso(`${first}T${row.endTime}`, options.timeZone) : null,
    allDay: false,
    recurrence: {
      freq: "weekly",
      interval: 1,
      weekdays: [...row.weekdays].sort((a, b) => a - b),
      until: options.until || null,
    },
    recurrenceOverrides: [],
  };
}

/** Venue names kept rows use that the project does not have yet. */
export function venuesToCreate(rows: ReviewRow[], venues: HarvestVenue[]): HarvestVenue[] {
  const used = new Set(rows.filter((r) => r.include && r.venue).map((r) => r.venue.toLowerCase()));
  return venues.filter((v) => !v.categoryId && used.has(v.name.toLowerCase()));
}
