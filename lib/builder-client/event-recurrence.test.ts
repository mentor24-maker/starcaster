import { describe, expect, it } from "vitest";
import {
  addDays, describeRecurrence, expandOccurrences, isoToZonedInput, weekdayOf,
  zonedInputToIso, zonedTimeToUtc, type RepeatableEvent,
} from "./event-recurrence";

const NY = "America/New_York";

// Drills & Games I, from Delray's program guide: Mon–Sat 8:30–10:00am.
const drills: RepeatableEvent = {
  id: "evt_drills",
  startsAt: "2026-08-31T12:30:00.000Z", // Mon Aug 31, 8:30am EDT
  endsAt: "2026-08-31T14:00:00.000Z",
  timezone: NY,
  recurrence: { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5, 6], until: null },
  recurrenceOverrides: [],
};

const range = (a: string, b: string): [number, number] => [Date.parse(a), Date.parse(b)];

describe("plain dates", () => {
  it("knows the weekday of a date with no time zone involved", () => {
    expect(weekdayOf("2026-08-31")).toBe(1);
    expect(weekdayOf("2026-09-06")).toBe(0);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("zoned conversions", () => {
  it("round-trips a form value through the event's zone, not the viewer's", () => {
    expect(zonedInputToIso("2026-09-14T08:30", NY)).toBe("2026-09-14T12:30:00.000Z");
    expect(zonedInputToIso("2026-12-14T08:30", NY)).toBe("2026-12-14T13:30:00.000Z");
    expect(isoToZonedInput("2026-09-14T12:30:00.000Z", NY)).toBe("2026-09-14T08:30");
    expect(isoToZonedInput("2026-09-15T01:00:00.000Z", NY, true)).toBe("2026-09-14");
    expect(zonedInputToIso("", NY)).toBeNull();
  });

  it("puts a time in the missing spring-forward hour an hour later, like every calendar", () => {
    expect(new Date(zonedTimeToUtc("2027-03-14", "02:30", NY)).toISOString()).toBe("2027-03-14T07:30:00.000Z");
  });
});

describe("expandOccurrences", () => {
  it("produces each chosen weekday and skips the rest", () => {
    const dates = expandOccurrences(drills, ...range("2026-08-30T00:00:00Z", "2026-09-07T03:00:00Z")).map((o) => o.date);
    expect(dates).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
  });

  it("keeps 8:30am local across the November clock change", () => {
    const [before, after] = expandOccurrences(
      { ...drills, recurrence: { ...drills.recurrence!, weekdays: [6] } },
      ...range("2026-10-30T00:00:00Z", "2026-11-08T23:00:00Z"),
    );
    expect(before.date).toBe("2026-10-31");
    expect(before.startsAt).toBe("2026-10-31T12:30:00.000Z"); // EDT
    expect(after.date).toBe("2026-11-07");
    expect(after.startsAt).toBe("2026-11-07T13:30:00.000Z"); // EST — same wall clock
    expect(after.endsAt).toBe("2026-11-07T15:00:00.000Z");
  });

  it("stops at the end date, inclusive", () => {
    const occ = expandOccurrences(
      { ...drills, recurrence: { ...drills.recurrence!, until: "2026-09-02" } },
      ...range("2026-08-01T00:00:00Z", "2026-12-01T00:00:00Z"),
    );
    expect(occ.map((o) => o.date)).toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  it("never starts before the first date", () => {
    const occ = expandOccurrences(drills, ...range("2026-08-01T00:00:00Z", "2026-08-31T23:59:00Z"));
    expect(occ.map((o) => o.date)).toEqual(["2026-08-31"]);
  });

  it("counts every-other-week from the week the series starts", () => {
    const occ = expandOccurrences(
      { ...drills, recurrence: { freq: "weekly", interval: 2, weekdays: [2], until: null } },
      ...range("2026-08-30T00:00:00Z", "2026-09-30T00:00:00Z"),
    );
    expect(occ.map((o) => o.date)).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
  });

  it("marks a cancelled date and applies a changed time to that date only", () => {
    const occ = expandOccurrences(
      {
        ...drills,
        recurrenceOverrides: [
          { date: "2026-09-01", cancelled: true },
          { date: "2026-09-02", startTime: "09:00", endTime: "10:30", note: "Court 4" },
        ],
      },
      ...range("2026-08-31T00:00:00Z", "2026-09-03T23:00:00Z"),
    );
    const byDate = Object.fromEntries(occ.map((o) => [o.date, o]));
    expect(byDate["2026-08-31"].changed).toBe(false);
    expect(byDate["2026-09-01"].cancelled).toBe(true);
    expect(byDate["2026-09-02"].startsAt).toBe("2026-09-02T13:00:00.000Z");
    expect(byDate["2026-09-02"].endsAt).toBe("2026-09-02T14:30:00.000Z");
    expect(byDate["2026-09-02"].note).toBe("Court 4");
    expect(byDate["2026-09-03"].startsAt).toBe("2026-09-03T12:30:00.000Z");
  });

  it("files an evening program on its local date even when that is tomorrow in UTC", () => {
    const wwo: RepeatableEvent = {
      ...drills,
      startsAt: "2026-09-01T23:00:00.000Z", // Tue 7:00pm EDT
      endsAt: "2026-09-02T00:30:00.000Z", // 8:30pm EDT, Wednesday in UTC
      recurrence: { freq: "weekly", interval: 1, weekdays: [2], until: null },
    };
    const occ = expandOccurrences(wwo, ...range("2026-09-07T00:00:00Z", "2026-09-10T00:00:00Z"));
    expect(occ).toHaveLength(1);
    expect(occ[0].date).toBe("2026-09-08");
    expect(occ[0].endsAt).toBe("2026-09-09T00:30:00.000Z");
  });

  it("treats a one-off event as a single occurrence, only inside the range", () => {
    const oneOff = { id: "x", startsAt: "2026-09-14T12:00:00.000Z", timezone: NY };
    expect(expandOccurrences(oneOff, ...range("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"))).toHaveLength(1);
    expect(expandOccurrences(oneOff, ...range("2026-10-01T00:00:00Z", "2026-10-30T00:00:00Z"))).toHaveLength(0);
    expect(expandOccurrences({ id: "y" }, ...range("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"))).toHaveLength(0);
  });

  it("cannot be made to scan forever by a rule with no end", () => {
    const occ = expandOccurrences(drills, ...range("2026-09-01T00:00:00Z", "2099-01-01T00:00:00Z"));
    expect(occ.length).toBeLessThan(800);
    expect(occ.length).toBeGreaterThan(600);
  });
});

describe("describeRecurrence", () => {
  it("says the rule the way a person would", () => {
    expect(describeRecurrence({ freq: "weekly", interval: 1, weekdays: [3, 1], until: null })).toBe("Weekly on Mon, Wed");
    expect(describeRecurrence({ freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5], until: null })).toBe("Weekly on weekdays");
    expect(describeRecurrence({ freq: "weekly", interval: 2, weekdays: [2], until: "2026-12-19" }, "en-US")).toBe("Every 2 weeks on Tuesday until Dec 19, 2026");
    expect(describeRecurrence({ freq: "weekly", interval: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], until: null })).toBe("Daily");
    expect(describeRecurrence(null)).toBe("");
  });
});

import { formatOccurrenceDate, formatTimeRange } from "./event-recurrence";

describe("display helpers", () => {
  it("reads a time range in the event's zone whatever the viewer's zone is", () => {
    expect(formatTimeRange("2026-09-14T12:30:00.000Z", "2026-09-14T14:00:00.000Z", NY, false, "en-US")).toBe("8:30 AM – 10:00 AM");
    expect(formatTimeRange("2026-09-14T12:30:00.000Z", null, NY, true)).toBe("All day");
    expect(formatOccurrenceDate("2026-09-14", "en-US")).toBe("Mon, Sep 14");
  });
});
