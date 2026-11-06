import { describe, expect, it } from "vitest";
import {
  buildDisabledReason,
  buildStatusLine,
  previewIsCurrent,
  summarizePreview,
  type BuildRequest,
} from "./site-import-build-controls-model";

// The Site Import screen's Preview build / Build draft pages (task 86bcz9wcx).

const NORMALIZE = { at: "2026-11-05T10:00:00.000Z", blobPath: "https://blob/ir.json" };

describe("buildStatusLine", () => {
  it("says who it is waiting for, and that previews change nothing", () => {
    expect(buildStatusLine({ mode: "preview", status: "queued" })?.text).toMatch(/import worker on the Mac Mini/);
    expect(buildStatusLine({ mode: "preview", status: "running" })?.text).toMatch(/Nothing is being changed/);
    expect(buildStatusLine({ mode: "apply", status: "running" })?.text).toMatch(/Nothing is published/);
  });

  it("names the draft pages a build made", () => {
    const req: BuildRequest = {
      mode: "apply",
      status: "done",
      result: { applied: { created: 10, updated: 2, pages: 12 } },
    };
    expect(buildStatusLine(req)?.text).toBe("Built 12 draft pages (10 new, 2 updated). Nothing was published.");
  });

  it("a failure says what failed in words, never a bare error", () => {
    const line = buildStatusLine({ mode: "apply", status: "failed", error: "Report does not reconcile" });
    expect(line).toEqual({ text: "The build failed: Report does not reconcile", tone: "failed" });
    expect(buildStatusLine({ mode: "preview", status: "failed" })?.text).toMatch(/did not say why/);
  });

  it("nothing requested, nothing shown", () => {
    expect(buildStatusLine(null)).toBeNull();
  });
});

describe("Build button", () => {
  it("is greyed out until a preview exists", () => {
    expect(buildDisabledReason({ normalize: NORMALIZE })).toMatch(/Preview Build first/);
  });

  it("is available once a preview is current", () => {
    const cps = { normalize: NORMALIZE, buildPreview: { at: "2026-11-05T11:00:00.000Z" } };
    expect(previewIsCurrent(cps)).toBe(true);
    expect(buildDisabledReason(cps)).toBeNull();
  });

  it("goes grey again when pages were built or the site copied since the preview", () => {
    const preview = { at: "2026-11-05T11:00:00.000Z" };
    expect(previewIsCurrent({ normalize: NORMALIZE, buildPreview: preview, map: { at: "2026-11-05T12:00:00.000Z" } })).toBe(false);
    expect(previewIsCurrent({ normalize: { ...NORMALIZE, at: "2026-11-06T00:00:00.000Z" }, buildPreview: preview })).toBe(false);
    expect(buildDisabledReason({ normalize: NORMALIZE, buildPreview: preview, map: { at: "2026-11-05T12:00:00.000Z" } })).toMatch(
      /changed since the preview/
    );
  });

  it("is greyed out while a step is waiting or running", () => {
    const cps = {
      normalize: NORMALIZE,
      buildPreview: { at: "2026-11-05T11:00:00.000Z" },
      build: { mode: "apply", status: "queued" },
    };
    expect(buildDisabledReason(cps)).toMatch(/Wait/);
  });
});

describe("summarizePreview", () => {
  it("counts pages to create and update, and lists the theme colours as swatches", () => {
    const s = summarizePreview({
      pages: [
        { path: "/", slug: "home", name: "Home", action: "create" },
        { path: "/about", slug: "about", name: "About", action: "update" },
        { path: "/contact", slug: "contact", name: "Contact", action: "create" },
      ],
      theme: { name: "strandsmovie 2", palette: { background: "#000000", text: "#111111" }, notes: ["text darkened"], makesDefault: true },
      warnings: ["2 picture(s) could not be copied"],
    });
    expect(s?.headline).toBe("The build will create 2 pages and update 1 page an earlier import built, all as drafts.");
    expect(s?.theme).toEqual({
      kind: "theme",
      name: "strandsmovie 2",
      swatches: [
        { role: "background", hex: "#000000" },
        { role: "text", hex: "#111111" },
      ],
      notes: ["text darkened"],
      makesDefault: true,
    });
    expect(s?.warnings).toEqual(["2 picture(s) could not be copied"]);
  });

  it("a skipped theme says so", () => {
    expect(summarizePreview({ pages: [], theme: { skipped: true } })?.theme).toEqual({ kind: "skipped" });
  });

  it("an empty plan is named, not blank", () => {
    expect(summarizePreview({ pages: [] })?.headline).toMatch(/no pages/);
  });

  it("no result, no summary", () => {
    expect(summarizePreview(null)).toBeNull();
  });
});
