import { describe, expect, it } from "vitest";
import { fidelityCounts, fidelityView } from "./site-import-fidelity-model";

// The Imports screen's difference report (SC-862).

const MAP = { at: "2026-11-17T19:00:00.000Z", pageIds: { "/": 1 } };
const TOTALS = [
  { key: "text", label: "Text styling", count: 26 },
  { key: "links", label: "Links", count: 3 },
  { key: "shadow", label: "Shadows and glow", count: 0 },
];

describe("fidelityView", () => {
  it("shows nothing before any page is built", () => {
    expect(fidelityView({})).toBeNull();
    expect(fidelityView(undefined)).toBeNull();
  });

  it("says why there is no report for pages built before the build made one", () => {
    const view = fidelityView({ map: MAP });
    expect(view?.kind).toBe("none");
    expect(view && "text" in view ? view.text : "").toMatch(/built before the build made one/);
  });

  it("shows the link and the counts per category", () => {
    const view = fidelityView({
      map: MAP,
      fidelity: { at: "2026-11-17T19:10:00.000Z", status: "done", reportUrl: "https://blob/f.html", totals: TOTALS, cannotTell: [] },
    });
    expect(view).toMatchObject({ kind: "report", blind: false, reportUrl: "https://blob/f.html", counts: "Text styling 26, Links 3", stale: false });
  });

  it("names the CANNOT TELL pages and never reads as clean", () => {
    const view = fidelityView({
      map: MAP,
      fidelity: {
        at: "2026-11-17T19:10:00.000Z", status: "cannot-tell", reportUrl: "https://blob/f.html", totals: TOTALS,
        cannotTell: [{ path: "/contact/", reason: "no Builder page was recorded for it" }], blindSections: 2,
      },
    });
    expect(view).toMatchObject({ kind: "report", blind: true, cannotTell: [{ path: "/contact/", reason: "no Builder page was recorded for it" }] });
    expect(view && view.kind === "report" ? view.notes.join(" ") : "").toMatch(/2 section\(s\) could not be compared/);
  });

  it("says the report could not be made, and why", () => {
    const view = fidelityView({ map: MAP, fidelity: { status: "failed", error: "no app answered" } });
    expect(view).toEqual({ kind: "failed", text: "The difference report could not be made: no app answered. The pages themselves were built." });
  });

  it("marks a report older than the latest build as out of date", () => {
    const view = fidelityView({
      map: { ...MAP, at: "2026-11-18T08:00:00.000Z" },
      fidelity: { at: "2026-11-17T19:10:00.000Z", status: "done", reportUrl: "u", totals: TOTALS },
    });
    expect(view && view.kind === "report" ? view.stale : null).toBe(true);
  });
});

describe("fidelityCounts", () => {
  it("says nothing was lost only when every category is zero", () => {
    expect(fidelityCounts([{ key: "a", label: "A", count: 0 }])).toBe("Nothing lost in the measured categories.");
    expect(fidelityCounts(undefined)).toBe("Nothing lost in the measured categories.");
  });
});
