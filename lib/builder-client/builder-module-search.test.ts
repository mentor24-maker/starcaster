import { describe, expect, it } from "vitest";
import {
  normalizeSearchQuery,
  scoreModuleMatch,
  searchModulePalette,
  type ModuleSearchHit
} from "@/lib/builder-module-search";
import { modulePaletteGroups, modulePaletteItems } from "@/components/builder/builder-types";

const GROUPS = modulePaletteGroups.map((group) => ({
  value: group.value,
  label: group.label,
  description: group.description
}));

const ITEMS = modulePaletteItems.map((item) => ({
  id: item.id,
  label: item.label,
  description: item.description,
  group: item.group,
  groupLabel: modulePaletteGroups.find((group) => group.value === item.group)?.label ?? item.group
}));

const search = (query: string) => searchModulePalette(query, { groups: GROUPS, items: ITEMS });

const labelOf = (hit: ModuleSearchHit) =>
  hit.kind === "group" ? hit.group.label : hit.kind === "item" ? hit.item.label : hit.saved.label;

describe("normalizeSearchQuery", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeSearchQuery("  Feature   CARDS ")).toBe("feature cards");
  });
});

describe("scoreModuleMatch", () => {
  it("ranks an exact label above a prefix, above a word start, above a description hit", () => {
    const exact = scoreModuleMatch("slideshow", "Slideshow");
    const prefix = scoreModuleMatch("slide", "Slideshow");
    const wordStart = scoreModuleMatch("cards", "Feature Cards");
    const description = scoreModuleMatch("rotating", "Slideshow", "Full-width auto-rotating image slideshow.");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(description);
    expect(description).toBeGreaterThan(0);
  });

  it("returns 0 for no match and for an empty query", () => {
    expect(scoreModuleMatch("zzzz", "Slideshow", "images")).toBe(0);
    expect(scoreModuleMatch("", "Slideshow")).toBe(0);
  });

  it("matches multi-term queries whose words are spread across fields", () => {
    expect(scoreModuleMatch("menu navigation", "Top Menu", "The main site navigation menu.")).toBeGreaterThan(0);
  });

  it("does not treat regex characters in the query as a pattern", () => {
    expect(() => scoreModuleMatch("c++ (a)", "Code")).not.toThrow();
    expect(scoreModuleMatch("c++ (a)", "Code")).toBe(0);
  });
});

describe("searchModulePalette", () => {
  it("returns nothing for a blank query rather than the whole library", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("finds a module by name across every category, without browsing first", () => {
    const hits = search("feature cards");

    expect(hits.length).toBeGreaterThan(0);
    expect(labelOf(hits[0])).toBe("Feature Cards");
  });

  it("puts the module above the category when both match the same word", () => {
    const hits = search("slideshow");
    const firstItem = hits.findIndex((hit) => hit.kind === "item");
    const firstGroup = hits.findIndex((hit) => hit.kind === "group");

    expect(firstItem).toBeGreaterThanOrEqual(0);
    expect(firstGroup).toBeGreaterThan(firstItem);
  });

  it("tells the operator which category each module came from", () => {
    const hit = search("top menu").find((entry) => entry.kind === "item");

    expect(hit?.kind).toBe("item");
    if (hit?.kind === "item") {
      expect(hit.item.groupLabel).toBe("Navigation");
    }
  });

  it("finds modules by description when the name gives nothing away", () => {
    // "Tractor Nav" does not contain the word "rings".
    const hits = search("rings");

    expect(hits.some((hit) => labelOf(hit) === "TractorNav")).toBe(true);
  });

  it("includes saved modules in results", () => {
    const hits = searchModulePalette("welcome", {
      groups: GROUPS,
      items: ITEMS,
      saved: [{ id: "cm-1", label: "Welcome Banner", group: "", groupLabel: "Saved Modules" }]
    });

    expect(hits.some((hit) => hit.kind === "saved" && hit.saved.label === "Welcome Banner")).toBe(true);
  });

  it("sorts equal scores alphabetically so results do not jump around", () => {
    const hits = search("blog");
    const scores = hits.map((hit) => hit.score);

    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});
