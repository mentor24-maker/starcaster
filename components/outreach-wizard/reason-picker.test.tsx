import { describe, expect, it } from "vitest";
import { chipsFor, decisionNotice, DEFAULT_REASONS, reasonKey, rejectNotice } from "./reason-picker";

/** Outreach wizard 12/19 (86bcrmbnw) — the pure half of the shared reason picker. */
describe("reason picker helpers", () => {
  it("chipsFor offers the five defaults first, then his own, never one twice", () => {
    expect(chipsFor(null).map((c) => c.reason)).toEqual(DEFAULT_REASONS);
    const chips = chipsFor({
      defaults: DEFAULT_REASONS.map((reason) => ({ reason, count: reason === "too long" ? 3 : 0 })),
      saved: [{ reason: "Preachy", count: 2 }, { reason: "Too Long ", count: 1 }],
    });
    expect(chips.map((c) => c.reason)).toEqual([...DEFAULT_REASONS, "Preachy"]);
    expect(chips.find((c) => c.reason === "too long")?.count).toBe(3);
  });

  it("reasonKey treats case and spacing as the same reason", () => {
    expect(reasonKey("  Too   Salesy ")).toBe(reasonKey("too salesy"));
  });

  it("rejectNotice says out loud when the reason was not saved", () => {
    expect(rejectNotice("Rejected.", { recorded: true })).toBe("Rejected.");
    expect(rejectNotice("Rejected.", undefined)).toBe("Rejected.");
    expect(rejectNotice("Rejected.", { recorded: false, error: "run docs/SQL/outreach_feedback_setup.sql" }))
      .toBe("Rejected. The reason was NOT saved: run docs/SQL/outreach_feedback_setup.sql.");
  });

  it("an Approve or Reject says when the lessons refresh it triggered failed, and says nothing when it worked", () => {
    const lessons = { refreshed: false, error: "The lessons were not refreshed: run docs/SQL/outreach_lessons_setup.sql" };
    expect(decisionNotice("Approved.", { recorded: true, lessons }))
      .toBe("Approved. The lessons were not refreshed: run docs/SQL/outreach_lessons_setup.sql.");
    expect(rejectNotice("Rejected.", { recorded: true, lessons: { ...lessons, error: "The lessons were not refreshed: down." } }))
      .toBe("Rejected. The lessons were not refreshed: down.");
    expect(decisionNotice("Approved.", { recorded: true, lessons: { refreshed: true, error: "" } })).toBe("Approved.");
    expect(decisionNotice("Approved.", undefined)).toBe("Approved.");
  });
});
