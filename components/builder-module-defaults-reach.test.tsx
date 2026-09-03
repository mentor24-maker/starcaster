import { describe, expect, it } from "vitest";
import {
  createEmptyModule,
  normalizeBuilderModuleSettingsForType,
  normalizeLayoutSections
} from "@/lib/builder-template";

/**
 * WHERE A MODULE DEFAULT ACTUALLY REACHES.
 *
 * There are two places a default can be written, and they have different blast
 * radii. Doctrine §5.27 named the narrow one while describing the wide one's
 * consequence, and on 2026-09-03 (task 86bbunf43) that sent a guard to the
 * wrong file — the test it produced could not fail.
 *
 *   createEmptyModule                     → a module newly created from the
 *                                           palette, and nothing else.
 *   a per-type block inside               → EVERY saved module, on every load.
 *   normalizeBuilderModuleSettingsForType
 *
 * The distinction is invisible by reading and one assertion away by measuring,
 * so it is measured here. If a future change makes createEmptyModule's defaults
 * reach saved modules, the second test fails and §5.27 needs rewriting again.
 */
describe("module defaults: which ones reach a module already saved on a page", () => {
  it("createEmptyModule seeds a module created from the palette", () => {
    const created = createEmptyModule("blog-tag-cloud");

    expect(created.settings.layout).toBe("cloud");
    expect(created.settings.minFontSize).toBe("12");
  });

  it("does NOT backfill those defaults into a module already saved on a page", () => {
    // A tag cloud saved months ago, carrying a hand-typed list and nothing else.
    const [section] = normalizeLayoutSections([
      {
        id: "s1",
        title: "",
        layout: "single",
        modules: [{
          id: "m1", type: "blog-tag-cloud", column: "main", text: "",
          settings: { tags: JSON.stringify([{ id: "t1", label: "clay", slug: "clay" }]) }
        }]
      }
    ]);
    const keys = Object.keys(section.modules[0].settings);

    // Only its own key plus the universal spacing migration.
    expect(keys).toContain("tags");
    expect(keys).not.toContain("layout");
    expect(keys).not.toContain("minFontSize");
    expect(keys).not.toContain("tagSource");
  });

  it("but a per-type block inside the normalizer DOES reach a saved module", () => {
    // This is the site doctrine §5.27's warning belongs to: it fills keys on
    // every load, so a key whose ABSENCE is the signal must never be set here.
    const settings = normalizeBuilderModuleSettingsForType("tractor-nav", {});

    expect(settings.color).toBe("#0000ff");
    expect(settings.ringCount).toBe("10");
  });
});
