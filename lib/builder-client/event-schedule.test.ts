import { describe, expect, it } from "vitest";
import {
  calendarTimeZone, datesRange, eventPageHref, formatWeekLabel, groupByDate,
  occurrenceDates, occurrenceOn, scheduleBetween, todayIn, weekDates,
  type SchedulableEvent,
} from "./event-schedule";

const NY = "America/New_York";
const drills: SchedulableEvent = {
  id: "evt_d", title: "Drills & Games I", slug: "drills", timezone: NY,
  startsAt: "2026-08-31T12:30:00.000Z", endsAt: "2026-08-31T14:00:00.000Z",
  recurrence: { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5, 6], until: null },
  recurrenceOverrides: [{ date: "2026-09-15", cancelled: true }],
};
const wwo: SchedulableEvent = {
  id: "evt_w", title: "WWO II", slug: "wwo", timezone: NY,
  startsAt: "2026-08-31T23:00:00.000Z", endsAt: "2026-09-01T00:30:00.000Z", // Mon 7–8:30pm
  recurrence: { freq: "weekly", interval: 1, weekdays: [1, 3], until: null },
};
const tournament: SchedulableEvent = {
  id: "evt_t", title: "Club Championship", slug: "champ", timezone: NY, allDay: true,
  startsAt: "2026-09-19T04:00:00.000Z", endsAt: "2026-09-20T04:00:00.000Z",
};

describe("weekDates", () => {
  it("starts on the chosen weekday and covers seven days", () => {
    expect(weekDates("2026-09-16", 1)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(weekDates("2026-09-14", 0)[0]).toBe("2026-09-13");
    expect(weekDates("2026-09-13", 1)[0]).toBe("2026-09-07"); // a Sunday belongs to the week before
  });
});

describe("a week of the program guide", () => {
  const dates = weekDates("2026-09-14", 1);
  const [from, to] = datesRange(dates, NY);
  const byDate = groupByDate(scheduleBetween([tournament, wwo, drills], from, to), dates);

  it("puts each program under the right day, evening ones included", () => {
    expect(byDate.get("2026-09-14")!.map((i) => i.event.title)).toEqual(["Drills & Games I", "WWO II"]);
    expect(byDate.get("2026-09-16")!.map((i) => i.event.title)).toEqual(["Drills & Games I", "WWO II"]);
    expect(byDate.get("2026-09-17")!.map((i) => i.event.title)).toEqual(["Drills & Games I"]);
    expect(byDate.get("2026-09-20")!.map((i) => i.event.title)).toEqual(["Club Championship"]);
  });

  it("keeps a cancelled date in the schedule, marked", () => {
    const tue = byDate.get("2026-09-15")!;
    expect(tue).toHaveLength(1);
    expect(tue[0].occurrence.cancelled).toBe(true);
  });

  it("puts a two-day all-day event on both days", () => {
    expect(byDate.get("2026-09-19")!.map((i) => i.event.title)).toContain("Club Championship");
    expect(byDate.get("2026-09-20")!.map((i) => i.event.title)).toContain("Club Championship");
  });

  it("does not put a program ending at midnight on the next day too", () => {
    const late: SchedulableEvent = { id: "l", title: "Late", timezone: NY, startsAt: "2026-09-15T01:00:00.000Z", endsAt: "2026-09-15T04:00:00.000Z" };
    const [item] = scheduleBetween([late], from, to);
    expect(occurrenceDates(item)).toEqual(["2026-09-14"]);
  });
});

describe("helpers", () => {
  it("draws a calendar in the events' zone, not the viewer's", () => {
    expect(calendarTimeZone([{ timezone: "" }, { timezone: NY }])).toBe(NY);
    expect(todayIn(NY, Date.parse("2026-09-15T02:00:00Z"))).toBe("2026-09-14");
  });

  it("labels a week the short way a person would", () => {
    expect(formatWeekLabel(weekDates("2026-09-14", 1), "en-US")).toBe("Sep 14 – 20, 2026");
    expect(formatWeekLabel(weekDates("2026-09-30", 1), "en-US")).toBe("Sep 28 – Oct 4, 2026");
    expect(formatWeekLabel(weekDates("2026-12-30", 1), "en-US")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });

  it("links a repeating program to its date, and a one-off to itself", () => {
    const [from, to] = datesRange(["2026-09-14"], NY);
    const [rep] = scheduleBetween([drills], from, to);
    const [one] = scheduleBetween([tournament], ...datesRange(["2026-09-19"], NY));
    expect(eventPageHref("/event", "drills", rep)).toBe("/event?event=drills&date=2026-09-14");
    expect(eventPageHref("/event?x=1", "champ", one)).toBe("/event?x=1&event=champ");
    expect(eventPageHref("", "drills", rep)).toBeUndefined();
  });

  it("finds one date of a series, and nothing on a date the rule skips", () => {
    expect(occurrenceOn(drills, "2026-09-16")?.startsAt).toBe("2026-09-16T12:30:00.000Z");
    expect(occurrenceOn(drills, "2026-09-15")?.cancelled).toBe(true);
    expect(occurrenceOn(drills, "2026-09-20")).toBeNull();
  });
});
