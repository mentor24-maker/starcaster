import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getSectionContent,
  hasSectionDrifted,
  relinkReading,
  sectionContentHash,
  sectionMatchesMaster,
  stampSectionLineage,
} from "./section-drift";

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

/**
 * The relink toggle's reading — the round-1 send-back of task 86bbwe530.
 *
 * `hasSectionDrifted` answers "may a push overwrite this copy?". Ticking
 * "Following" back on asks a DIFFERENT question, "does this copy already match
 * the original?", and it was answered with the first one — so a stale copy
 * whose stamp cleared its drift took the fast path, got the flag and kept the
 * old content, with the screen saying it was Following.
 */
describe("relinkReading", () => {
  const masterMovedOn = {
    ...master,
    modules: [{ id: "m1", type: "text", column: "main", name: "", text: "the new copy", settings: {} }],
  };

  it("a copy a failed push never reached reads as awaiting-push, NOT as a match", () => {
    // The regression itself. `hasSectionDrifted` says false here — correctly,
    // it is not a hand edit — and the toggle must still pull the master's
    // content in rather than flipping the flag over stale content.
    const stale = stampSectionLineage(instance());
    expect(hasSectionDrifted(stale, masterMovedOn)).toBe(false);
    expect(relinkReading(stale, masterMovedOn)).toBe("awaiting-push");
  });

  it("an identical copy reads as a match, so relinking changes nothing on screen", () => {
    expect(relinkReading(instance(), master)).toBe("matches");
    expect(relinkReading(stampSectionLineage(instance()), master)).toBe("matches");
  });

  it("a copy edited after it was stamped reads as hand-edited, so the operator is still asked", () => {
    const edited = {
      ...stampSectionLineage(instance()),
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "HAND-EDITED HERE", settings: {} }],
    };
    expect(relinkReading(edited, master)).toBe("hand-edited");
  });

  it("an unstamped stale copy reads as hand-edited — unchanged from before the stamp existed", () => {
    // Fails towards asking. Every copy on every live page is unstamped the day
    // this ships, and being asked about content that turns out to be stale is
    // recoverable; silently replacing a hand edit is not.
    expect(relinkReading(instance(), masterMovedOn)).toBe("hand-edited");
  });

  it("nothing to compare reads as a match — the same fail-open hasSectionDrifted has", () => {
    expect(relinkReading(null, master)).toBe("matches");
    expect(relinkReading(instance(), null)).toBe("matches");
  });
});

describe("sectionMatchesMaster", () => {
  it("ignores provenance, exactly as the drift comparison does", () => {
    expect(sectionMatchesMaster(instance({ canonicalSourceHash: "abc" }), master)).toBe(true);
  });

  it("is not fooled by a stamp — this is the reading with no lineage in it", () => {
    const stale = stampSectionLineage(instance());
    const masterMovedOn = {
      ...master,
      modules: [{ id: "m1", type: "text", column: "main", name: "", text: "the new copy", settings: {} }],
    };
    expect(sectionMatchesMaster(stale, masterMovedOn)).toBe(false);
  });
});

/**
 * The rule, not the instance.
 *
 * Round 1 of this task was not a wrong function — it was the RIGHT function
 * asked the wrong question, at one of five call sites, and reading the code
 * cannot tell the two apart. So the guard is the rule: the editor decides
 * about a copy's content with `relinkReading`, and does not reach for the
 * propagation reading at all. Reintroducing `hasSectionDrifted` there is what
 * this fails on, whatever the new call site happens to be doing.
 */
describe("the editor asks the relink question, not the propagation one", () => {
  const source = readFileSync(
    new URL("../../components/admin-builder-editor.tsx", import.meta.url),
    "utf8"
  );

  it("does not import or call hasSectionDrifted anywhere", () => {
    // Comment lines are allowed to name it — the two readings have to be
    // explained somewhere, and the explanation lives at the call site.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
    expect(code.filter((line) => line.includes("hasSectionDrifted"))).toEqual([]);
  });

  it("uses relinkReading instead", () => {
    expect(source).toContain("relinkReading");
  });
});
