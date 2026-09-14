import { describe, expect, it } from "vitest";
import {
  describeThemeSaveImpact,
  readThemeUsage,
  themeUsagePageIds,
  themeUsagePageLabel,
} from "./theme-save-impact";

const page = (id: string, name = "", slug = "") => ({ id, name, slug });

describe("readThemeUsage", () => {
  it("reads the pages out of the envelope, dropping entries with no id", () => {
    const body = { ok: true, data: { pages: [page("1", "Home", "home"), { name: "no id" }, page("2")], total: 3 } };
    expect(readThemeUsage(body)).toEqual([page("1", "Home", "home"), page("2")]);
  });

  it("returns null — not an empty list — when the body carries no page list", () => {
    // A failed read must still ask the question; zero pages skips it.
    expect(readThemeUsage(null)).toBeNull();
    expect(readThemeUsage({ ok: false, error: { message: "boom" } })).toBeNull();
    expect(readThemeUsage({ ok: true, data: {} })).toBeNull();
  });

  it("returns an empty list when the route counted zero", () => {
    expect(readThemeUsage({ ok: true, data: { pages: [], total: 0 } })).toEqual([]);
  });
});

describe("describeThemeSaveImpact", () => {
  it("names the pages and counts them", () => {
    const impact = describeThemeSaveImpact("Go Navy", [page("1", "Home", "home"), page("2", "", "about")]);
    expect(impact.summary).toContain("“Go Navy”");
    expect(impact.summary).toContain("2 pages");
    expect(impact.pageLabels).toEqual(["Home", "/about"]);
    expect(impact.more).toBe(0);
    expect(impact.driftedPageLabels).toEqual([]);
  });

  it("caps the list at twelve and says how many more", () => {
    const pages = Array.from({ length: 15 }, (_, i) => page(String(i + 1), `Page ${i + 1}`));
    const impact = describeThemeSaveImpact("Go Navy", pages);
    expect(impact.pageLabels).toHaveLength(12);
    expect(impact.more).toBe(3);
  });

  it("says so when no page uses the theme", () => {
    const impact = describeThemeSaveImpact("Go Navy", []);
    expect(impact.summary).toMatch(/No page uses it/);
    expect(impact.pageLabels).toEqual([]);
  });

  it("says the count could not be read rather than pretending it was empty", () => {
    const impact = describeThemeSaveImpact("Go Navy", null);
    expect(impact.summary).toMatch(/could not be counted/);
    expect(impact.summary).not.toMatch(/No page uses it/);
  });

  it("falls back to 'this theme' for a blank name", () => {
    expect(describeThemeSaveImpact("   ", []).summary).toContain("“this theme”");
  });
});

describe("themeUsagePageLabel", () => {
  it("prefers the name, then the address, then the id", () => {
    expect(themeUsagePageLabel(page("7", "About us", "about"))).toBe("About us");
    expect(themeUsagePageLabel(page("7", "", "/about"))).toBe("/about");
    expect(themeUsagePageLabel(page("7"))).toBe("Page 7");
  });
});

describe("themeUsagePageIds", () => {
  it("hands back exactly the ids, and an empty list for nothing — never undefined", () => {
    expect(themeUsagePageIds([page("1"), page("2")])).toEqual(["1", "2"]);
    // An empty array publishes nothing; undefined would publish the whole site.
    expect(themeUsagePageIds(null)).toEqual([]);
    expect(themeUsagePageIds([])).toEqual([]);
  });
});
