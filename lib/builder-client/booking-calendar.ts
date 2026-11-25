/**
 * The visitor's booking calendar, its logic kept out of the React component so
 * it can be tested on its own (SC-911, slice 3 of the booking calendar).
 *
 * The server decides which times are free (lib/bookingAvailability.js) and
 * sends each one as a UTC instant. Everything here is about showing those
 * instants in the VISITOR's own time zone: which of the visitor's days each
 * one falls on, how it reads on a clock there, and what that zone is called,
 * so the screen can name it.
 */

import { monthGrid, type CalendarCell } from "./event-format";

export type VisitorSlot = { startsAt: string; endsAt: string };

export type VisitorCalendar = {
  id: string;
  name: string;
  timeZone: string;
  meetingMinutes: number;
  heading: string;
  intro: string;
};

export type VisitorCalendarData = {
  calendar: VisitorCalendar;
  from: string;
  to: string;
  days: number;
  slots: VisitorSlot[];
};

export type BookingCalendarCell = CalendarCell & { key: string; bookable: boolean };

/** The visitor's own time zone, as their browser reports it. */
export function visitorTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" for a plain calendar date (a month-grid cell). */
export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The visitor's calendar date, "YYYY-MM-DD", that an instant falls on in `timeZone`. */
export function dayKeyInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Every free time, filed under the visitor's day it falls on, earliest first. */
export function groupSlotsByDay(slots: VisitorSlot[], timeZone: string): Map<string, VisitorSlot[]> {
  const byDay = new Map<string, VisitorSlot[]>();
  const sorted = [...slots].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  for (const slot of sorted) {
    const key = dayKeyInZone(slot.startsAt, timeZone);
    const list = byDay.get(key);
    if (list) list.push(slot);
    else byDay.set(key, [slot]);
  }
  return byDay;
}

/** "9:30 AM" — the time on the visitor's own clock. */
export function formatSlotTime(iso: string, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "Tuesday, December 1" for a "YYYY-MM-DD" day key. */
export function formatDayHeading(key: string, locale?: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "December 2026" */
export function formatMonthHeading(year: number, month: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month, 1)));
}

/**
 * The zone, named the way a visitor reads it: "Mountain Standard Time
 * (America/Denver)". The long name alone can be ambiguous and the IANA id
 * alone is jargon, so both. `at` matters: the long name changes with
 * daylight saving.
 */
export function timeZoneLabel(timeZone: string, at: string | number | Date = Date.now(), locale?: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "long" }).formatToParts(new Date(at));
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return name && name !== timeZone ? `${name} (${timeZone})` : timeZone;
  } catch {
    return timeZone;
  }
}

/** A month grid with each day marked bookable when it has at least one free time. */
export function bookingMonthGrid(
  year: number,
  month: number,
  byDay: Map<string, VisitorSlot[]>,
  weekStartsOn: 0 | 1 = 0
): BookingCalendarCell[][] {
  return monthGrid(year, month, weekStartsOn).map((week) =>
    week.map((cell) => {
      const key = dateKeyOf(cell.date);
      return { ...cell, key, bookable: cell.inMonth && (byDay.get(key)?.length ?? 0) > 0 };
    })
  );
}

/** { year, month } of a "YYYY-MM-DD" key (month is 0-based, like Date). */
export function monthOfKey(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m - 1 };
}

/** The months the visitor may page through: from the first free day's month to the last's. */
export function bookableMonthRange(byDay: Map<string, VisitorSlot[]>): { first: { year: number; month: number }; last: { year: number; month: number } } | null {
  const keys = [...byDay.keys()].sort();
  if (!keys.length) return null;
  return { first: monthOfKey(keys[0]), last: monthOfKey(keys[keys.length - 1]) };
}

export function addMonths(at: { year: number; month: number }, delta: number): { year: number; month: number } {
  const total = at.year * 12 + at.month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function compareMonths(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** What a visitor reads when nothing is free: never blank, never a builder note. */
export function noTimesMessage(days: number): string {
  const n = Math.max(1, Math.round(days || 0));
  return `No times available in the next ${n} day${n === 1 ? "" : "s"}.`;
}

/** Read the calendar response, refusing anything that is not the shape the server sends. */
export function parseVisitorCalendarData(value: unknown): VisitorCalendarData | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const cal = raw.calendar as Record<string, unknown> | undefined;
  if (!cal || typeof cal !== "object" || !cal.id) return null;
  const slots = Array.isArray(raw.slots) ? raw.slots : [];
  return {
    calendar: {
      id: String(cal.id),
      name: String(cal.name ?? ""),
      timeZone: String(cal.timeZone ?? "UTC"),
      meetingMinutes: Number(cal.meetingMinutes) || 0,
      heading: String(cal.heading ?? ""),
      intro: String(cal.intro ?? ""),
    },
    from: String(raw.from ?? ""),
    to: String(raw.to ?? ""),
    days: Number(raw.days) || 0,
    slots: slots
      .filter((s): s is { startsAt: unknown; endsAt: unknown } => Boolean(s) && typeof s === "object")
      .map((s) => ({ startsAt: String(s.startsAt ?? ""), endsAt: String(s.endsAt ?? "") }))
      .filter((s) => !Number.isNaN(Date.parse(s.startsAt))),
  };
}
