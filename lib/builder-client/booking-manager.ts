/**
 * The Booking Manager's logic, kept out of the React component so it can be
 * tested on its own (SC-910, slice 2 of the booking calendar).
 *
 * The server owns the rules (lib/bookingStore.js validates every save and
 * refuses anything wrong, naming the field). These helpers only shape the
 * screen: which day is open, which bookings are upcoming, what an empty list
 * says, and where a booking's contact link goes.
 */

export const BOOKING_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type BookingDayKey = (typeof BOOKING_DAY_KEYS)[number];

export const BOOKING_DAY_LABELS: Record<BookingDayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type BookingWindow = { start: string; end: string };
export type BookingWeeklyHours = Record<BookingDayKey, BookingWindow[]>;

/** Mirrors MESSAGING_KEYS in lib/bookingStore.js. */
export const BOOKING_MESSAGING_KEYS = [
  "heading",
  "intro",
  "confirmation",
  "confirmationEmailSubject",
  "confirmationEmailBody",
  "reminderEmailSubject",
  "reminderEmailBody",
] as const;
export type BookingMessagingKey = (typeof BOOKING_MESSAGING_KEYS)[number];
export type BookingMessaging = Record<BookingMessagingKey, string>;

export type BookingCalendar = {
  id: string;
  name: string;
  timeZone: string;
  weeklyHours: BookingWeeklyHours;
  blockedDates: string[];
  meetingMinutes: number;
  gapMinutes: number;
  minNoticeMinutes: number;
  daysAhead: number;
  messaging: BookingMessaging;
  updatedAt?: string;
};

export type Booking = {
  id: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  visitorName: string;
  visitorEmail: string;
  visitorPhone?: string;
  visitorNote?: string;
  crmContactId: string | null;
  status: string;
  cancelledAt?: string | null;
  /** How the latest booking emails went (SC-912): "sent", "failed", or null when none were tried. */
  notifyStatus?: string | null;
  notifyError?: string;
  /** The Google Meet link, when the connected Google Calendar made one (SC-913). */
  meetLink?: string;
  /** How the booking's Google step went: "synced", "failed", or null when Google was never involved. */
  googleSyncStatus?: string | null;
  googleSyncError?: string;
};

/**
 * What a booking row says about its Google Meet link (SC-913). A booked
 * meeting whose Google step FAILED gets a note and a Retry button; one with a
 * link gets the link. Cancelled meetings and projects with no Google Calendar
 * say nothing.
 */
export function bookingMeetState(
  booking: Pick<Booking, "status" | "meetLink" | "googleSyncStatus" | "googleSyncError">,
): { kind: "link"; href: string } | { kind: "missing"; note: string; href?: string } | null {
  const failed = booking.googleSyncStatus === "failed";
  const why = String(booking.googleSyncError || "").trim();
  if (booking.status === "cancelled") {
    // A cancel whose Google event could not be removed: that event still keeps
    // the time busy for every visitor, so the row says so and offers Retry
    // (review, SC-913 round 2).
    if (!failed) return null;
    return { kind: "missing", note: why ? `Still on Google Calendar: ${why}` : "Still on Google Calendar" };
  }
  if (booking.status !== "booked") return null;
  const link = String(booking.meetLink || "").trim();
  const href = link && /^https:\/\//.test(link) ? link : "";
  if (failed) {
    // A failed step outranks a link already stored: a MOVE that did not reach
    // Google leaves the old event, link and all, at the old time (round 2).
    if (href) {
      return { kind: "missing", href, note: why ? `Google Calendar not updated: ${why}` : "Google Calendar not updated" };
    }
    return { kind: "missing", note: why ? `No Meet link yet: ${why}` : "No Meet link yet" };
  }
  if (href) return { kind: "link", href };
  return null;
}

/** The Booking Manager's Google Calendar card, as GET /api/admin/booking/google answers. */
export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  accountLabel: string;
  needsAttention: boolean;
  lastError: string;
};

export function normalizeGoogleStatus(value: unknown): GoogleCalendarStatus {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    configured: v.configured === true,
    connected: v.connected === true,
    accountLabel: typeof v.accountLabel === "string" ? v.accountLabel : "",
    needsAttention: v.needsAttention === true,
    lastError: typeof v.lastError === "string" ? v.lastError : "",
  };
}

/** The one line the Google Calendar card shows under its heading. */
export function googleStatusLine(status: GoogleCalendarStatus): string {
  if (status.connected) {
    const who = status.accountLabel ? `Connected as ${status.accountLabel}.` : "Connected.";
    return status.needsAttention && status.lastError ? `${who} ${status.lastError}` : who;
  }
  if (status.needsAttention) {
    return status.lastError || "Google no longer accepts this connection. Connect it again.";
  }
  if (!status.configured) {
    return "Google Calendar cannot be connected on this server yet: its Google app is not set up.";
  }
  return "Not connected. Connect it to give every booking a Google Meet link and hide the times you are busy.";
}

/**
 * The Google sign-in's outcome, when it came back in THIS tab (pop-ups
 * blocked): the callback sends the browser back here with
 * `connect_provider=google_calendar` and `connect_notice` or `connect_error`
 * on the hash (lib/connections/redirectCallback.js). Null when the hash holds
 * no Google Calendar outcome. `hash` is what is left for the address once the
 * outcome is read, so a reload does not show it twice.
 */
export function readGoogleConnectReturn(rawHash: string): { ok: boolean; message: string; hash: string } | null {
  const bare = String(rawHash || "").replace(/^#/, "");
  const parts = bare.split("&").filter(Boolean);
  const read = (key: string): string | null => {
    const part = parts.find((p) => p.startsWith(`${key}=`));
    if (part === undefined) return null;
    const value = part.slice(key.length + 1);
    try { return decodeURIComponent(value); } catch { return value; }
  };
  if (read("connect_provider") !== "google_calendar") return null;
  const error = read("connect_error");
  const notice = read("connect_notice");
  if (error === null && notice === null) return null;
  const kept = parts.filter((p) => !p.startsWith("connect_")).join("&");
  return error !== null
    ? { ok: false, message: error || "Google Calendar was not connected.", hash: kept ? `#${kept}` : "" }
    : { ok: true, message: notice || "Google Calendar is connected.", hash: kept ? `#${kept}` : "" };
}

/**
 * What a booking row says about its emails (SC-912). Only a FAILED send is
 * shown: it is the one the operator must act on (the visitor may not know
 * their time). null when there is nothing to say.
 */
export function bookingEmailNote(booking: Pick<Booking, "notifyStatus" | "notifyError">): string | null {
  if (booking.notifyStatus !== "failed") return null;
  const why = String(booking.notifyError || "").trim();
  return why ? `Email not sent: ${why}` : "Email not sent";
}

/** The window a day gets when it is switched on. */
export const DEFAULT_DAY_WINDOW: BookingWindow = { start: "09:00", end: "17:00" };

/** Read whatever the server sent into a full week: every day present, unknown days dropped. */
export function normalizeWeeklyHours(value: unknown): BookingWeeklyHours {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out = {} as BookingWeeklyHours;
  for (const day of BOOKING_DAY_KEYS) {
    const raw = Array.isArray(source[day]) ? (source[day] as unknown[]) : [];
    out[day] = raw
      .filter((w): w is { start: unknown; end: unknown } => Boolean(w) && typeof w === "object")
      .map((w) => ({ start: String(w.start ?? ""), end: String(w.end ?? "") }));
  }
  return out;
}

export function normalizeMessaging(value: unknown): BookingMessaging {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out = {} as BookingMessaging;
  for (const key of BOOKING_MESSAGING_KEYS) out[key] = typeof source[key] === "string" ? (source[key] as string) : "";
  return out;
}

/** A calendar as the server sent it, made safe to render. */
export function normalizeCalendar(value: unknown): BookingCalendar | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id : "";
  if (!id) return null;
  const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  return {
    id,
    name: typeof v.name === "string" ? v.name : "",
    timeZone: typeof v.timeZone === "string" ? v.timeZone : "",
    weeklyHours: normalizeWeeklyHours(v.weeklyHours),
    blockedDates: Array.isArray(v.blockedDates) ? v.blockedDates.filter((d): d is string => typeof d === "string") : [],
    meetingMinutes: num(v.meetingMinutes),
    gapMinutes: num(v.gapMinutes),
    minNoticeMinutes: num(v.minNoticeMinutes),
    daysAhead: num(v.daysAhead),
    messaging: normalizeMessaging(v.messaging),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
  };
}

/** Switch a day on (one default window) or off (no windows = a day off). */
export function setDayOpen(hours: BookingWeeklyHours, day: BookingDayKey, open: boolean): BookingWeeklyHours {
  return { ...hours, [day]: open ? (hours[day].length ? hours[day] : [{ ...DEFAULT_DAY_WINDOW }]) : [] };
}

/** Add another time range to a day, starting where the last one ends. */
export function addDayWindow(hours: BookingWeeklyHours, day: BookingDayKey): BookingWeeklyHours {
  const windows = hours[day];
  const last = windows[windows.length - 1];
  const next = last ? { start: last.end, end: last.end < "23:00" ? addHour(last.end) : "23:59" } : { ...DEFAULT_DAY_WINDOW };
  return { ...hours, [day]: [...windows, next] };
}

export function removeDayWindow(hours: BookingWeeklyHours, day: BookingDayKey, index: number): BookingWeeklyHours {
  return { ...hours, [day]: hours[day].filter((_, i) => i !== index) };
}

export function updateDayWindow(
  hours: BookingWeeklyHours,
  day: BookingDayKey,
  index: number,
  patch: Partial<BookingWindow>,
): BookingWeeklyHours {
  return { ...hours, [day]: hours[day].map((w, i) => (i === index ? { ...w, ...patch } : w)) };
}

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "17:00";
  return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * A day's problem in plain words, or "" when it is fine. The server refuses
 * the same things; saying it beside the day first means the operator sees
 * WHICH row is wrong before pressing Save.
 */
export function dayWindowProblem(windows: BookingWindow[]): string {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const w of windows) {
    if (!time.test(w.start) || !time.test(w.end)) return "Each time range needs a start and an end time.";
    if (w.end <= w.start) return `${w.start} to ${w.end} ends before it starts.`;
  }
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end) {
      return `${sorted[i].start} starts before the range before it ends (${sorted[i - 1].end}).`;
    }
  }
  return "";
}

/** Add a blocked date (kept sorted, never twice). */
export function addBlockedDate(dates: string[], date: string): string[] {
  const d = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return dates;
  return [...new Set([...dates, d])].sort();
}

export function removeBlockedDate(dates: string[], date: string): string[] {
  return dates.filter((d) => d !== date);
}

/**
 * Upcoming = still booked and not yet over, soonest first. Past = everything
 * else (over, or cancelled), most recent first, so the list a cancel lands in
 * shows it at the top.
 */
export function splitBookings(bookings: Booking[], now: number): { upcoming: Booking[]; past: Booking[] } {
  const upcoming: Booking[] = [];
  const past: Booking[] = [];
  for (const b of bookings) {
    const ends = Date.parse(b.endsAt);
    if (b.status === "booked" && Number.isFinite(ends) && ends > now) upcoming.push(b);
    else past.push(b);
  }
  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  past.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { upcoming, past };
}

/**
 * What an empty Bookings list says. Never a blank area (landmine 17): the
 * operator cannot see the database, so "empty" must say WHY.
 */
export function emptyBookingsMessage(
  calendar: Pick<BookingCalendar, "weeklyHours"> | null,
  which: "upcoming" | "past",
  totalBookings: number,
): string {
  if (which === "past") {
    return totalBookings
      ? "No past bookings yet: every booking on this calendar is still to come."
      : "No past bookings yet: nobody has booked a time on this calendar.";
  }
  const openDays = calendar ? BOOKING_DAY_KEYS.filter((d) => calendar.weeklyHours[d]?.length) : [];
  if (!openDays.length) {
    return "No bookings yet: every day is switched off under Availability, so visitors have no times to choose from.";
  }
  if (totalBookings) {
    return "No upcoming bookings: every booking on this calendar has already happened or was cancelled.";
  }
  return "No bookings yet: nobody has booked a time on this calendar. Visitors book through the Booking Calendar module on your site.";
}

/**
 * Where a booking's contact link goes: the Contact Manager page, naming the
 * contact BY ID (landmine 19: never a copied name or email). null when the
 * booking has no CRM contact, so the row says so instead of linking nowhere.
 */
export function bookingContactHref(contactsPageUrl: string, contactId: string | null | undefined): string | null {
  const id = String(contactId || "").trim();
  if (!id) return null;
  const base = String(contactsPageUrl || "").trim() || "/admin-contact-manager";
  const [path, hash = ""] = base.split("#");
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}contact=${encodeURIComponent(id)}${hash ? `#${hash}` : ""}`;
}

/** "Tue, Dec 2, 2026, 9:30 AM to 10:00 AM" in the calendar's own time zone. */
export function formatBookingTime(startsAt: string, endsAt: string, timeZone: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) return startsAt || "Unknown time";
  const zone = safeZone(timeZone);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: zone,
  }).format(start);
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  const tail = Number.isNaN(end.getTime()) ? "" : ` to ${clock.format(end)}`;
  return `${day}, ${clock.format(start)}${tail}`;
}

function safeZone(timeZone: string): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/** Minimum-notice choices, in minutes. A saved value not listed is kept and shown. */
export const MIN_NOTICE_CHOICES: Array<{ minutes: number; label: string }> = [
  { minutes: 0, label: "None" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "1 day" },
  { minutes: 2880, label: "2 days" },
  { minutes: 10080, label: "1 week" },
];

export function minutesLabel(minutes: number): string {
  const listed = MIN_NOTICE_CHOICES.find((c) => c.minutes === minutes);
  if (listed) return listed.label;
  if (minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/**
 * A typed number as a whole number within range, or the problem in words.
 * The ranges mirror MINUTE_SETTINGS in lib/bookingStore.js.
 */
export function wholeNumberOrProblem(raw: string, label: string, min: number, max: number): { value: number } | { problem: string } {
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return { problem: `${label} must be a whole number.` };
  const value = Number(text);
  if (value < min || value > max) return { problem: `${label} must be from ${min} to ${max}.` };
  return { value };
}

export const BOOKING_NUMBER_RANGES = {
  meetingMinutes: { label: "Meeting length", min: 5, max: 480 },
  gapMinutes: { label: "Gap between meetings", min: 0, max: 240 },
  daysAhead: { label: "Days ahead", min: 1, max: 365 },
} as const;

/** The IANA zones the browser knows, for the time zone list. */
export function knownTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}
