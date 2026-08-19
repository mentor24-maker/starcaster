import { describe, expect, it } from "vitest";
import { getSectionContent, hasSectionDrifted } from "./section-drift";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverTwin = require("../builder/document.js");

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

describe("getSectionContent", () => {
  it("strips id, savedSectionId, and canonical — exactly what a push overwrites", () => {
    const content = getSectionContent(instance());
    expect(content).not.toHaveProperty("id");
    expect(content).not.toHaveProperty("savedSectionId");
    expect(content).not.toHaveProperty("canonical");
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

// lib/builder/document.js hand-ports these two functions for the server,
// which cannot require a .ts file. Nothing enforces the two copies agree
// except this test — if it goes red, the port has drifted from its source.
describe("the server's hand-ported twin (lib/builder/document.js) agrees", () => {
  it("on an untouched copy", () => {
    expect(serverTwin.hasSectionDrifted(instance(), master)).toBe(hasSectionDrifted(instance(), master));
  });

  it("on a drifted copy", () => {
    const edited = instance({ modules: [{ id: "m1", type: "text", column: "main", name: "", text: "changed", settings: {} }] });
    expect(serverTwin.hasSectionDrifted(edited, master)).toBe(true);
    expect(serverTwin.hasSectionDrifted(edited, master)).toBe(hasSectionDrifted(edited, master));
  });

  it("on which fields getSectionContent strips", () => {
    expect(serverTwin.getSectionContent(instance())).toEqual(getSectionContent(instance()));
  });
});
