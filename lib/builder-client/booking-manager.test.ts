import { describe, expect, it } from "vitest";
import {
  bookingEmailNote,
  bookingMeetState,
  googleStatusLine,
  normalizeGoogleStatus,
  readGoogleConnectReturn,
  addBlockedDate,
  addDayWindow,
  bookingContactHref,
  dayWindowProblem,
  emptyBookingsMessage,
  formatBookingTime,
  normalizeCalendar,
  normalizeWeeklyHours,
  removeBlockedDate,
  setDayOpen,
  splitBookings,
  wholeNumberOrProblem,
  type Booking,
} from "./booking-manager";

const week = normalizeWeeklyHours({ mon: [{ start: "09:00", end: "17:00" }] });

function booking(id: string, startsAt: string, endsAt: string, status = "booked"): Booking {
  return { id, calendarId: "c1", startsAt, endsAt, visitorName: id, visitorEmail: `${id}@x.test`, crmContactId: null, status };
}

describe("weekly hours", () => {
  it("fills every day, so a day the server left out reads as a day off", () => {
    expect(week.tue).toEqual([]);
    expect(Object.keys(week)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });

  it("turns a day off by emptying it, and back on with one default range", () => {
    const off = setDayOpen(week, "mon", false);
    expect(off.mon).toEqual([]);
    expect(setDayOpen(off, "mon", true).mon).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("adds a second range starting where the first ends", () => {
    expect(addDayWindow(week, "mon").mon[1]).toEqual({ start: "17:00", end: "18:00" });
  });

  it("names a range that ends before it starts, or overlaps the one before", () => {
    expect(dayWindowProblem([{ start: "17:00", end: "09:00" }])).toMatch(/ends before it starts/);
    expect(dayWindowProblem([{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }])).toMatch(/starts before/);
    expect(dayWindowProblem([{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }])).toBe("");
  });
});

describe("blocked dates", () => {
  it("keeps them sorted and never twice, and ignores anything that is not a date", () => {
    const dates = addBlockedDate(addBlockedDate(["2026-12-25"], "2026-12-24"), "2026-12-25");
    expect(dates).toEqual(["2026-12-24", "2026-12-25"]);
    expect(addBlockedDate(dates, "Christmas")).toEqual(dates);
    expect(removeBlockedDate(dates, "2026-12-24")).toEqual(["2026-12-25"]);
  });
});

describe("bookings list", () => {
  const now = Date.parse("2026-12-01T12:00:00Z");

  it("puts live future bookings in Upcoming, soonest first, and cancelled or over ones in Past", () => {
    const { upcoming, past } = splitBookings(
      [
        booking("later", "2026-12-05T15:00:00Z", "2026-12-05T15:30:00Z"),
        booking("soon", "2026-12-02T15:00:00Z", "2026-12-02T15:30:00Z"),
        booking("cancelled", "2026-12-03T15:00:00Z", "2026-12-03T15:30:00Z", "cancelled"),
        booking("over", "2026-11-20T15:00:00Z", "2026-11-20T15:30:00Z"),
      ],
      now,
    );
    expect(upcoming.map((b) => b.id)).toEqual(["soon", "later"]);
    expect(past.map((b) => b.id)).toEqual(["cancelled", "over"]);
  });

  it("says why it is empty, never just nothing", () => {
    expect(emptyBookingsMessage({ weeklyHours: week }, "upcoming", 0)).toMatch(/nobody has booked/);
    expect(emptyBookingsMessage({ weeklyHours: normalizeWeeklyHours({}) }, "upcoming", 0)).toMatch(/every day is switched off/);
    expect(emptyBookingsMessage({ weeklyHours: week }, "upcoming", 3)).toMatch(/already happened or was cancelled/);
    expect(emptyBookingsMessage({ weeklyHours: week }, "past", 2)).toMatch(/still to come/);
  });

  it("links a contact by id on the Contact Manager page, and not at all without one", () => {
    expect(bookingContactHref("/admin-contact-manager", "c 1")).toBe("/admin-contact-manager?contact=c%201");
    expect(bookingContactHref("/people?tab=all", "c1")).toBe("/people?tab=all&contact=c1");
    expect(bookingContactHref("", "c1")).toBe("/admin-contact-manager?contact=c1");
    expect(bookingContactHref("/admin-contact-manager", null)).toBeNull();
  });

  it("shows a booking's time in the calendar's own zone", () => {
    expect(formatBookingTime("2026-12-02T16:30:00Z", "2026-12-02T17:00:00Z", "America/Denver")).toBe(
      "Wed, Dec 2, 2026, 9:30 AM to 10:00 AM",
    );
  });
});

describe("reading what the server sent", () => {
  it("refuses a calendar with no id and fills missing messaging", () => {
    expect(normalizeCalendar({})).toBeNull();
    const cal = normalizeCalendar({ id: "c1", messaging: { intro: "Hi" } });
    expect(cal?.messaging.intro).toBe("Hi");
    expect(cal?.messaging.reminderEmailBody).toBe("");
  });

  it("checks a typed number names the field and its range", () => {
    expect(wholeNumberOrProblem("45", "Meeting length", 5, 480)).toEqual({ value: 45 });
    expect(wholeNumberOrProblem("4", "Meeting length", 5, 480)).toEqual({ problem: "Meeting length must be from 5 to 480." });
    expect(wholeNumberOrProblem("4.5", "Meeting length", 5, 480)).toEqual({ problem: "Meeting length must be a whole number." });
  });
});

describe("bookingEmailNote (SC-912)", () => {
  it("names a failed send and its reason, and says nothing otherwise", () => {
    expect(bookingEmailNote({ notifyStatus: "failed", notifyError: "the visitor was not emailed: bounced" }))
      .toBe("Email not sent: the visitor was not emailed: bounced");
    expect(bookingEmailNote({ notifyStatus: "failed", notifyError: "" })).toBe("Email not sent");
    expect(bookingEmailNote({ notifyStatus: "sent", notifyError: "" })).toBeNull();
    expect(bookingEmailNote({ notifyStatus: null })).toBeNull();
  });
});

describe("Google Calendar on the Booking Manager (SC-913)", () => {
  it("shows a booked meeting's Meet link", () => {
    expect(bookingMeetState({ status: "booked", meetLink: "https://meet.google.com/abc-defg-hij", googleSyncStatus: "synced" }))
      .toEqual({ kind: "link", href: "https://meet.google.com/abc-defg-hij" });
  });

  it("says why a booked meeting has no Meet link yet", () => {
    expect(bookingMeetState({ status: "booked", meetLink: "", googleSyncStatus: "failed", googleSyncError: "Google could not be reached" }))
      .toEqual({ kind: "missing", note: "No Meet link yet: Google could not be reached" });
  });

  it("says nothing for a project with no Google Calendar, or a cancelled meeting Google already let go", () => {
    expect(bookingMeetState({ status: "booked", meetLink: "", googleSyncStatus: null })).toBeNull();
    expect(bookingMeetState({ status: "cancelled", meetLink: "https://meet.google.com/x", googleSyncStatus: "synced" })).toBeNull();
    expect(bookingMeetState({ status: "cancelled", meetLink: "", googleSyncStatus: null })).toBeNull();
  });

  it("a failed MOVE outranks the stored link: the note shows, with the link, so Retry is offered", () => {
    expect(bookingMeetState({
      status: "booked", meetLink: "https://meet.google.com/abc-defg-hij", googleSyncStatus: "failed",
      googleSyncError: "the Google Calendar event could not be moved: Backend Error",
    })).toEqual({
      kind: "missing",
      href: "https://meet.google.com/abc-defg-hij",
      note: "Google Calendar not updated: the Google Calendar event could not be moved: Backend Error",
    });
  });

  it("a cancelled meeting whose Google event could not be removed says so", () => {
    expect(bookingMeetState({
      status: "cancelled", meetLink: "https://meet.google.com/x", googleSyncStatus: "failed",
      googleSyncError: "the Google Calendar event could not be removed: Backend Error",
    })).toEqual({ kind: "missing", note: "Still on Google Calendar: the Google Calendar event could not be removed: Backend Error" });
  });

  it("never turns a non-https value into a link", () => {
    expect(bookingMeetState({ status: "booked", meetLink: "javascript:alert(1)", googleSyncStatus: "synced" })).toBeNull();
  });

  it("names the connected account, and the reason when it needs attention", () => {
    const base = normalizeGoogleStatus({ configured: true, connected: true, accountLabel: "owner@gmail.example" });
    expect(googleStatusLine(base)).toBe("Connected as owner@gmail.example.");
    expect(googleStatusLine({ ...base, needsAttention: true, lastError: "Could not renew it." }))
      .toBe("Connected as owner@gmail.example. Could not renew it.");
  });

  it("reads a sign-in that came back in this tab, and leaves the rest of the address alone", () => {
    expect(readGoogleConnectReturn("#tab=g&connect_provider=google_calendar&connect_notice=Connected%20as%20a%40b.example"))
      .toEqual({ ok: true, message: "Connected as a@b.example", hash: "#tab=g" });
    expect(readGoogleConnectReturn("#connect_provider=google_calendar&connect_error=You%20chose%20not%20to%20allow%20access"))
      .toEqual({ ok: false, message: "You chose not to allow access", hash: "" });
  });

  it("ignores an address with no Google Calendar outcome on it", () => {
    expect(readGoogleConnectReturn("")).toBeNull();
    expect(readGoogleConnectReturn("#page=settingsConnectionsPage")).toBeNull();
    expect(readGoogleConnectReturn("#connect_provider=x&connect_error=no")).toBeNull();
    expect(readGoogleConnectReturn("#connect_provider=google_calendar")).toBeNull();
  });

  it("says plainly when the server cannot connect Google at all", () => {
    expect(googleStatusLine(normalizeGoogleStatus({ configured: false, connected: false })))
      .toMatch(/cannot be connected on this server yet/);
    expect(googleStatusLine(normalizeGoogleStatus({ configured: true, connected: false })))
      .toMatch(/^Not connected\./);
  });
});
