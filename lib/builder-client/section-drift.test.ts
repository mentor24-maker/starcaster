import { describe, expect, it } from "vitest";
import { getSectionContent, hasSectionDrifted, sectionContentHash, stampSectionLineage } from "./section-drift";

// NOTE: the server hand-ports these two functions in lib/builder/document.js.
// That twin is checked in scripts/builder/sectionDriftServerTwin.test.js (the
// NODE suite), NOT here: document.js requires the generated ./template, which
// CI has not built at `vitest` time — requiring it from a vitest file makes CI
// red while every local run stays green (the generated-lib-in-vitest landmine).

const master = {
  id: "master-1",
  savedSectionId: undefined,
  canonical: undefined,
  title: "Footer",
  layout: "main",
  modules: [{ id: "m1", type: "text", column: "main", name: "", text: "Call us today", settings: {} }],
};

function instance(overrides: Record<string, unknown> = {}) {
  return {
    id: "inst-1",
    savedSectionId: "saved_section_footer",
    canonical: true,
    title: "Footer",
    layout: "main",
    modules: [{ id: "m1", type: "text", column: "main", name: "", text: "Call us today", settings: {} }],
    ...overrides,
  };
}

/**
 * The one fixture both suites hash, and the value both pin.
 *
 * This is what keeps the two hand-ported copies honest: nothing imports across
 * the TS/CJS line, so a change to either hash that is not made to the other
 * shows up as this literal failing on one side. Change it here and the node
 * suite goes red, and vice versa — which is the point.
 */
const PINNED_FIXTURE_HASH = "e81b0a4fd564cd2b";

describe("getSectionContent", () => {
  it("strips id, savedSectionId, canonical and the lineage stamp — exactly what a push overwrites", () => {
    const content = getSectionContent(instance({ canonicalSourceHash: "abc" }));
    expect(content).not.toHaveProperty("id");
    expect(content).not.toHaveProperty("savedSectionId");
    expect(content).not.toHaveProperty("canonical");
    expect(content).not.toHaveProperty("canonicalSourceHash");
    expect(content.title).toBe("Footer");
  });

  it("a missing section reads as no content, not a crash", () => {
    expect(getSectionContent(null)).toEqual({});
    expect(getSectionContent(undefined)).toEqual({});
  });
});

describe("hasSectionDrifted", () => {
  it("an untouched copy — identical content, different id/provenance — has not drifted", () => {
    expect(hasSectionDrifted(instance(), master)).toBe(false);
  });

  it("a copy with an edited module reads as drifted", () => {
    const edited = instance({
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "SOMEONE CHANGED THIS", settings: {} }],
    });
    expect(hasSectionDrifted(edited, master)).toBe(true);
  });

  it("a copy with a changed section-level setting reads as drifted", () => {
    const edited = instance({ widthMode: "narrow" });
    expect(hasSectionDrifted(edited, master)).toBe(true);
  });

  it("id/savedSectionId/canonical differing alone is NOT drift — that's provenance, not content", () => {
    const onlyProvenanceDiffers = { ...master, id: "different-id", savedSectionId: "saved_section_footer", canonical: true };
    expect(hasSectionDrifted(onlyProvenanceDiffers, master)).toBe(false);
  });

  it("fails open: a missing instance or master is never reported as drifted", () => {
    expect(hasSectionDrifted(null, master)).toBe(false);
    expect(hasSectionDrifted(instance(), null)).toBe(false);
    expect(hasSectionDrifted(undefined, undefined)).toBe(false);
  });
});

describe("sectionContentHash", () => {
  it("hashes the fixture to the value the server twin pins", () => {
    expect(sectionContentHash(instance())).toBe(PINNED_FIXTURE_HASH);
  });

  it("does not depend on key ORDER — Postgres jsonb hands the keys back rearranged", () => {
    const reordered = {
      modules: [{ settings: {}, text: "Call us today", name: "", column: "main", type: "text", id: "m1" }],
      layout: "main",
      title: "Footer",
      canonical: true,
      savedSectionId: "saved_section_footer",
      id: "inst-1",
    };
    expect(sectionContentHash(reordered)).toBe(sectionContentHash(instance()));
  });

  it("ignores provenance — two copies of one master hash the same", () => {
    expect(sectionContentHash(instance({ id: "inst-2", canonical: false, canonicalSourceHash: "stale" })))
      .toBe(sectionContentHash(instance()));
  });

  it("changes when the content changes", () => {
    const edited = instance({
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "CHANGED", settings: {} }],
    });
    expect(sectionContentHash(edited)).not.toBe(sectionContentHash(instance()));
  });
});

describe("the lineage stamp", () => {
  it("clears drift for a copy a failed push never wrote — the whole fix", () => {
    // The copy still holds the content the LAST successful push put there, and
    // the master has moved on because its own save landed. Judged against the
    // master alone this reads as a hand edit; judged against its own record it
    // is simply a page that was not written.
    const stale = stampSectionLineage(instance());
    const masterMovedOn = {
      ...master,
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "the new copy", settings: {} }],
    };
    expect(hasSectionDrifted(stale, masterMovedOn)).toBe(false);
  });

  it("does NOT clear drift for a copy edited after it was stamped", () => {
    const stamped = stampSectionLineage(instance());
    const edited = {
      ...stamped,
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "HAND-EDITED HERE", settings: {} }],
    };
    expect(hasSectionDrifted(edited, master)).toBe(true);
  });

  it("a stale or garbage stamp changes nothing — it can only ever clear, never assert", () => {
    // A stamp that could ASSERT drift would, the first time normalization
    // moved a field, report every copy on every page as hand-edited.
    expect(hasSectionDrifted(instance({ canonicalSourceHash: "not-a-real-hash" }), master)).toBe(false);
    const edited = instance({
      canonicalSourceHash: "not-a-real-hash",
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "CHANGED", settings: {} }],
    });
    expect(hasSectionDrifted(edited, master)).toBe(true);
  });

  it("an unstamped copy behaves exactly as it did before the stamp existed", () => {
    // Every copy on every live page is unstamped the day this ships.
    const masterMovedOn = {
      ...master,
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "the new copy", settings: {} }],
    };
    expect(hasSectionDrifted(instance(), masterMovedOn)).toBe(true);
  });
});
