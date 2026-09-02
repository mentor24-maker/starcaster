import { describe, expect, it } from "vitest";

import { normalizeModuleType } from "./builder-template";
import { modulePaletteGroups, modulePaletteItems } from "@/components/builder/builder-types";

/**
 * Landmine 1, and the reason this test exists at all: a module type registered
 * in the palette but missing from `normalizeModuleType` is silently coerced to
 * "text" **on every page load**. The module does not fail to render — it stops
 * being the module, and the saved settings go with it. Nothing errors.
 *
 * The palette entry and the normalizer live in different files, so they are
 * exactly the pair that drifts. This asserts they agree.
 */

describe("the media-manager module is registered on both sides", () => {
  it("survives normalization instead of being coerced to text", () => {
    expect(normalizeModuleType("media-manager")).toBe("media-manager");
  });

  it("appears in the module palette", () => {
    const entry = modulePaletteItems.find((item) => item.type === "media-manager");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Media Manager (Admin)");
  });

  it("is filed under a group the palette actually declares", () => {
    // A group that is not declared renders no card, so the module would exist
    // and be unreachable — which is how this ticket started.
    const entry = modulePaletteItems.find((item) => item.type === "media-manager");
    const groups = modulePaletteGroups.map((group) => group.value);
    expect(groups).toContain(entry?.group);
  });

  it("is under Admin, where the operator looks for a management panel", () => {
    const entry = modulePaletteItems.find((item) => item.type === "media-manager");
    expect(entry?.group).toBe("admin");
  });
});

describe("every palette module normalizes to itself", () => {
  // The general form of the same rule. If any module is ever added to the
  // palette without the normalizer, this fails for that module by name rather
  // than waiting for someone to notice a page turning into text.
  for (const item of modulePaletteItems) {
    it(`${item.type} is a known module type`, () => {
      expect(normalizeModuleType(item.type)).toBe(item.type);
    });
  }
});
