import { describe, expect, it } from "vitest";
import {
  addMonths,
  bookableMonthRange,
  bookingMonthGrid,
  dayKeyInZone,
  formatSlotTime,
  groupSlotsByDay,
  noTimesMessage,
  parseVisitorCalendarData,
  timeZoneLabel,
} from "./booking-calendar";

/*
 * SC-911. A booking calendar's opening hours are in the OPERATOR's zone and the
 * server sends every free time as a UTC instant; the visitor must see each one
 * on their own clock, on their own day, with the zone named.
 */

// 9:00 AM in Denver on Tuesday 2026-12-01 is 16:00 UTC, and 1:00 AM in Tokyo
// on Wednesday 2026-12-02. 4:30 PM Denver (23:30 UTC) is the same Tuesday in
// Denver and New York, but already Wednesday in Tokyo.
const NINE_DENVER = { startsAt: "2026-12-01T16:00:00.000Z", endsAt: "2026-12-01T16:30:00.000Z" };
const LATE_DENVER = { startsAt: "2026-12-01T23:30:00.000Z", endsAt: "2026-12-02T00:00:00.000Z" };

describe("a visitor in another time zone sees the times converted", () => {
  it("reads 9:00 AM Denver as 11:00 AM in New York and 1:00 AM next day in Tokyo", () => {
    expect(formatSlotTime(NINE_DENVER.startsAt, "America/Denver", "en-US")).toBe("9:00 AM");
    expect(formatSlotTime(NINE_DENVER.startsAt, "America/New_York", "en-US")).toBe("11:00 AM");
    expect(formatSlotTime(NINE_DENVER.startsAt, "Asia/Tokyo", "en-US")).toBe("1:00 AM");
    expect(dayKeyInZone(NINE_DENVER.startsAt, "Asia/Tokyo")).toBe("2026-12-02");
  });

  it("files each time under the visitor's own day, not the server's", () => {
    const denver = groupSlotsByDay([LATE_DENVER, NINE_DENVER], "America/Denver");
    expect([...denver.keys()]).toEqual(["2026-12-01"]);
    expect(denver.get("2026-12-01")?.map((s) => s.startsAt)).toEqual([NINE_DENVER.startsAt, LATE_DENVER.startsAt]);

    const tokyo = groupSlotsByDay([NINE_DENVER, LATE_DENVER], "Asia/Tokyo");
    expect([...tokyo.keys()]).toEqual(["2026-12-02"]);
    expect(tokyo.get("2026-12-02")).toHaveLength(2);
  });

  it("names the zone in words and by its id, and follows daylight saving", () => {
    expect(timeZoneLabel("America/Denver", "2026-12-01T16:00:00Z", "en-US")).toBe("Mountain Standard Time (America/Denver)");
    expect(timeZoneLabel("America/Denver", "2026-07-01T16:00:00Z", "en-US")).toBe("Mountain Daylight Time (America/Denver)");
    expect(timeZoneLabel("Not/AZone")).toBe("Not/AZone");
  });
});

describe("the month grid", () => {
  it("marks only days with a free time as bookable", () => {
    const byDay = groupSlotsByDay([NINE_DENVER], "America/Denver");
    const cells = bookingMonthGrid(2026, 11, byDay).flat();
    expect(cells.filter((c) => c.bookable).map((c) => c.key)).toEqual(["2026-12-01"]);
    expect(bookingMonthGrid(2026, 11, byDay).every((week) => week.length === 7)).toBe(true);
  });

  it("pages only through months that have a free day", () => {
    const byDay = groupSlotsByDay(
      [NINE_DENVER, { startsAt: "2027-01-05T16:00:00.000Z", endsAt: "2027-01-05T16:30:00.000Z" }],
      "America/Denver"
    );
    expect(bookableMonthRange(byDay)).toEqual({ first: { year: 2026, month: 11 }, last: { year: 2027, month: 0 } });
    expect(bookableMonthRange(new Map())).toBeNull();
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2027, month: 0 }, -1)).toEqual({ year: 2026, month: 11 });
  });
});

describe("what the visitor reads", () => {
  it("says how far ahead it looked when nothing is free", () => {
    expect(noTimesMessage(61)).toBe("No times available in the next 61 days.");
    expect(noTimesMessage(1)).toBe("No times available in the next 1 day.");
  });

  it("reads the server's answer, and refuses anything without a calendar", () => {
    const parsed = parseVisitorCalendarData({
      calendar: { id: "cal_1", name: "Calls", timeZone: "America/Denver", meetingMinutes: 30, heading: "Book", intro: "" },
      days: 61,
      slots: [NINE_DENVER, { startsAt: "nonsense" }],
    });
    expect(parsed?.calendar.id).toBe("cal_1");
    expect(parsed?.slots).toEqual([NINE_DENVER]);
    expect(parseVisitorCalendarData({ slots: [] })).toBeNull();
    expect(parseVisitorCalendarData(null)).toBeNull();
  });
});
