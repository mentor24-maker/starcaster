import { describe, expect, it } from "vitest";
import {
  eventPayloadFor, firstDateFor, mondayOf, rowProblems, rowsFromHarvest, venuesToCreate,
  type HarvestResult, type ReviewRow,
} from "./event-harvest";
import { expandOccurrences } from "./event-recurrence";

const RESULT: HarvestResult = {
  weekStart: "2026-08-31",
  lineCount: 9,
  dropped: 0,
  venues: [
    { name: "Delray Beach Tennis Center", color: "#0b2d6b", categoryId: "ecat_1" },
    { name: "Pickleball", color: "#f7a600", categoryId: "" },
    { name: "Unused Venue", color: "#123456", categoryId: "" },
  ],
  series: [
    { key: "a", title: "Drills & Games I", instructor: "Wayne L", startTime: "08:30", endTime: "10:00", venue: "Delray Beach Tennis Center", weekdays: [1, 2, 3, 4, 5, 6], dates: [], existingEventId: "evt_9" },
    { key: "b", title: "PB 101", instructor: "Mike C", startTime: "07:30", endTime: "08:30", venue: "Pickleball", weekdays: [3, 4], dates: [], existingEventId: "" },
    { key: "c", title: "Elite", instructor: "Bob D", startTime: "15:00", endTime: "18:00", venue: "", weekdays: [0], dates: [], existingEventId: "" },
  ],
};

describe("review rows", () => {
  it("start ticked unless the program is already on the calendar", () => {
    expect(rowsFromHarvest(RESULT).map((r) => r.include)).toEqual([false, true, true]);
  });

  it("name what stops a kept row, and ignore unticked ones", () => {
    const rows: ReviewRow[] = rowsFromHarvest(RESULT);
    rows[1] = { ...rows[1], weekdays: [] };
    rows[2] = { ...rows[2], endTime: "14:00" };
    rows[0] = { ...rows[0], title: "" }; // unticked: not a problem
    expect(rowProblems(rows).map((p) => p.message)).toEqual(["PB 101 has no days ticked.", "Elite ends before it starts."]);
  });

  it("only create venues that a kept row actually uses", () => {
    expect(venuesToCreate(rowsFromHarvest(RESULT), RESULT.venues).map((v) => v.name)).toEqual(["Pickleball"]);
  });
});

describe("dates", () => {
  it("finds the Monday of the flyer's week", () => {
    expect(mondayOf("2026-09-02")).toBe("2026-08-31");
    expect(mondayOf("2026-09-06")).toBe("2026-08-31"); // Sunday closes the week
    expect(mondayOf("2026-08-31")).toBe("2026-08-31");
  });

  it("starts a series on its earliest day in that week, Sunday last", () => {
    expect(firstDateFor("2026-08-31", [3, 4])).toBe("2026-09-02");
    expect(firstDateFor("2026-09-03", [2, 5])).toBe("2026-09-01"); // any date in the week works
    expect(firstDateFor("2026-08-31", [0])).toBe("2026-09-06");
    expect(firstDateFor("2026-08-31", [0, 1])).toBe("2026-08-31");
  });
});

describe("event payloads", () => {
  it("put the printed time in the CLUB's zone, and the series lands on the printed days", () => {
    const [, pb] = rowsFromHarvest(RESULT);
    const body = eventPayloadFor(pb, { weekStart: "2026-08-31", timeZone: "America/New_York", status: "published", categoryId: "ecat_2" });
    expect(body.startsAt).toBe("2026-09-02T11:30:00.000Z"); // 7:30am EDT on Wed Sep 2
    expect(body.endsAt).toBe("2026-09-02T12:30:00.000Z");
    expect(body.recurrence).toEqual({ freq: "weekly", interval: 1, weekdays: [3, 4], until: null });
    expect(body.categoryId).toBe("ecat_2");

    const dates = expandOccurrences({ id: "x", ...body }, Date.parse("2026-08-31T00:00:00Z"), Date.parse("2026-09-07T00:00:00Z")).map((o) => o.date);
    expect(dates).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("leave the end empty when the flyer printed none", () => {
    const row = { ...rowsFromHarvest(RESULT)[2], endTime: "" };
    expect(eventPayloadFor(row, { weekStart: "2026-08-31", timeZone: "America/New_York", status: "draft", categoryId: "" }).endsAt).toBeNull();
  });
});
