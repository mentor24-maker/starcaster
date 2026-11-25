/**
 * The Booking Manager's Reminders section, its logic kept out of the React
 * component so it can be tested (SC-914, slice 6 of the booking calendar).
 *
 * The server owns the rules (lib/bookingReminders.js checks every save and
 * refuses anything wrong, naming the field). These helpers shape the screen:
 * the reminder-time choices, their labels, and what a failed reminder says.
 */

import { formatBookingTime } from "./booking-manager";

export type ReminderSettings = {
  enabled: boolean;
  offsetsMinutes: number[];
  notifyOwner: boolean;
};

export type ReminderProblem = {
  id: string;
  bookingId: string;
  offsetMinutes: number;
  startsAt: string;
  recipient: string;
  attempts: number;
  error: string;
  visitorName: string;
  visitorEmail: string;
  bookingStatus: string;
};

/** Mirrors MAX_OFFSETS in lib/bookingReminders.js. */
export const MAX_REMINDERS = 3;

export const REMINDER_DEFAULTS: ReminderSettings = { enabled: true, offsetsMinutes: [1440, 60], notifyOwner: false };

/** How long before the meeting a reminder may go, longest first. */
export const REMINDER_CHOICES: number[] = [10080, 2880, 1440, 720, 240, 120, 60, 30, 15];

/** The order "Add Reminder" offers times in: the common ones first. */
const ADD_ORDER = [1440, 60, 120, 10080, 2880, 720, 240, 30, 15];

/** 1440 → "1 day before", 90 → "90 minutes before". */
export function reminderLabel(minutes: number): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  let amount: string;
  if (minutes % 10080 === 0) amount = plural(minutes / 10080, "week");
  else if (minutes % 1440 === 0) amount = plural(minutes / 1440, "day");
  else if (minutes % 60 === 0) amount = plural(minutes / 60, "hour");
  else amount = plural(minutes, "minute");
  return `${amount} before`;
}

/** Whatever the server sent, made safe to render. */
export function normalizeReminderSettings(value: unknown): ReminderSettings {
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const offsets = Array.isArray(v.offsetsMinutes)
    ? v.offsetsMinutes.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
    : [...REMINDER_DEFAULTS.offsetsMinutes];
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : REMINDER_DEFAULTS.enabled,
    offsetsMinutes: offsets,
    notifyOwner: typeof v.notifyOwner === "boolean" ? v.notifyOwner : REMINDER_DEFAULTS.notifyOwner,
  };
}

/** Add one more reminder time: the most common one not already chosen. */
export function addReminderOffset(offsets: number[]): number[] {
  if (offsets.length >= MAX_REMINDERS) return offsets;
  const next = ADD_ORDER.find((m) => !offsets.includes(m));
  return next === undefined ? offsets : [...offsets, next];
}

/** The choices one row's list offers: every choice not taken by another row, plus its own value. */
export function choicesForRow(offsets: number[], index: number): number[] {
  const own = offsets[index];
  const taken = new Set(offsets.filter((_, i) => i !== index));
  const list = REMINDER_CHOICES.filter((m) => !taken.has(m));
  if (own !== undefined && !list.includes(own)) list.push(own);
  return list.sort((a, b) => b - a);
}

/** What is wrong before saving, in plain words, or "". The server refuses the same things. */
export function reminderSettingsProblem(settings: ReminderSettings): string {
  if (settings.enabled && !settings.offsetsMinutes.length) {
    return "Add at least one reminder time, or switch reminders off.";
  }
  if (new Set(settings.offsetsMinutes).size !== settings.offsetsMinutes.length) {
    return "The same reminder time is chosen twice.";
  }
  return "";
}

/**
 * One reminder that failed every attempt, as a sentence naming who, which
 * meeting, which reminder and why (landmine 17: never an unexplained row).
 */
export function reminderProblemText(problem: ReminderProblem, timeZone: string): string {
  const who = problem.recipient === "owner"
    ? "the site owner"
    : problem.visitorEmail
      ? `${problem.visitorName || "the visitor"} (${problem.visitorEmail})`
      : "the visitor";
  const when = formatBookingTime(problem.startsAt, "", timeZone);
  const tries = problem.attempts === 1 ? "1 try" : `${problem.attempts} tries`;
  const why = String(problem.error || "").trim() || "the mail service did not say why";
  return `The ${reminderLabel(problem.offsetMinutes)} reminder to ${who} for the meeting on ${when} was not sent after ${tries}: ${why}`;
}
