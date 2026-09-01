import { describe, it, expect } from "vitest";
import {
  formatEventWhen,
  isoToLocalInput,
  localInputToIso,
  normalizeEventStatus,
} from "./event-format";

/**
 * These are the conversions a wrong answer does not announce.
 *
 * A date an hour out, or an all-day event reading "12:00 AM", renders
 * perfectly and tells the visitor the wrong thing. Nothing else in the Event
 * Calendar can be tested this precisely — the module itself is admin-only, so
 * it is filtered out of the render harness by design — which is why the logic
 * lives here rather than inside the component.
 */

describe("isoToLocalInput", () => {
  it("returns the LOCAL wall-clock time, not a slice of the ISO string", () => {
    const iso = "2026-04-12T18:00:00.000Z";
    const out = isoToLocalInput(iso);
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(out).toBe(expected);

    // The trap this guards: `iso.slice(0, 16)` looks right and is wrong by the
    // viewer's offset. It only agrees with the correct answer in UTC.
    if (d.getTimezoneOffset() !== 0) {
      expect(out).not.toBe(iso.slice(0, 16));
    }
  });

  it("gives a date-only value when the event is all day", () => {
    expect(isoToLocalInput("2026-04-19T12:00:00.000Z", true)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has no opinion about missing or unreadable input", () => {
    expect(isoToLocalInput("")).toBe("");
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput(undefined)).toBe("");
    expect(isoToLocalInput("next tuesday-ish")).toBe("");
  });
});

describe("localInputToIso", () => {
  it("round-trips a date and time through the input format unchanged", () => {
    const iso = "2026-04-12T18:00:00.000Z";
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
  });

  it("reads a bare date as LOCAL midnight, not UTC midnight", () => {
    // Date.parse("2026-04-19") is UTC by specification. Taken literally, an
    // all-day event would be filed on the previous day for everyone west of
    // Greenwich — the whole of the Americas, this project's tenants included.
    const out = localInputToIso("2026-04-19");
    expect(out).not.toBeNull();
    const back = new Date(out as string);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(3);
    expect(back.getDate()).toBe(19);
    expect(back.getHours()).toBe(0);
  });

  it("answers null rather than passing rubbish to a timestamp column", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("   ")).toBeNull();
    expect(localInputToIso("sometime in spring")).toBeNull();
  });
});

describe("formatEventWhen", () => {
  const day = (h: number) => new Date(2026, 3, 12, h, 0, 0).toISOString();

  it("says an event is not scheduled rather than rendering an empty cell", () => {
    expect(formatEventWhen({})).toBe("Not scheduled");
    expect(formatEventWhen({ startsAt: null })).toBe("Not scheduled");
    expect(formatEventWhen({ startsAt: "not a date" })).toBe("Not scheduled");
  });

  it("shows no clock for an all-day event", () => {
    const out = formatEventWhen({ startsAt: day(0), allDay: true }, "en-US");
    expect(out).toContain("all day");
    // "12:00 AM" is the exact thing an all-day event must never show.
    expect(out).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("spans two dates for a multi-day all-day event", () => {
    const out = formatEventWhen(
      { startsAt: new Date(2026, 3, 12).toISOString(), endsAt: new Date(2026, 3, 14).toISOString(), allDay: true },
      "en-US"
    );
    expect(out).toContain("Apr 12");
    expect(out).toContain("Apr 14");
    expect(out).not.toContain("all day");
  });

  it("names the date once when an event starts and ends the same day", () => {
    const out = formatEventWhen({ startsAt: day(18), endsAt: day(21) }, "en-US");
    expect(out.match(/Apr 12/g)).toHaveLength(1);
    expect(out).toMatch(/6:00/);
    expect(out).toMatch(/9:00/);
  });

  it("names both dates when an event runs past midnight", () => {
    const out = formatEventWhen(
      { startsAt: new Date(2026, 3, 12, 22, 0).toISOString(), endsAt: new Date(2026, 3, 13, 2, 0).toISOString() },
      "en-US"
    );
    expect(out).toContain("Apr 12");
    expect(out).toContain("Apr 13");
  });

  it("drops the range when there is no end time", () => {
    const out = formatEventWhen({ startsAt: day(18) }, "en-US");
    expect(out).not.toContain("–");
  });
});

describe("normalizeEventStatus", () => {
  it("keeps the three real states", () => {
    expect(normalizeEventStatus("draft")).toBe("draft");
    expect(normalizeEventStatus("published")).toBe("published");
    expect(normalizeEventStatus("cancelled")).toBe("cancelled");
  });

  it("folds case, because 'Published' is the same intention", () => {
    expect(normalizeEventStatus("Published")).toBe("published");
    expect(normalizeEventStatus("  CANCELLED ")).toBe("cancelled");
  });

  it("makes anything else a draft — the state that shows nobody anything by accident", () => {
    expect(normalizeEventStatus("pubished")).toBe("draft");
    expect(normalizeEventStatus("live")).toBe("draft");
    expect(normalizeEventStatus("")).toBe("draft");
    expect(normalizeEventStatus(null)).toBe("draft");
  });
});
