import { describe, expect, it } from "vitest";
import {
  activeTagSlug,
  maxTagCount,
  parseCloudTags,
  resolveTagCloudSettings,
  tagFontSize,
  tagHref
} from "./blog-tag-cloud";

describe("resolveTagCloudSettings", () => {
  it("fills in every fallback for a module inserted straight from the palette", () => {
    // The palette entry carries ONLY { layout: "cloud" } — every other key
    // arrives undefined, which is the state the old live renderer mishandled.
    const resolved = resolveTagCloudSettings({ layout: "cloud" });
    expect(resolved.minFontSize).toBe(12);
    expect(resolved.maxFontSize).toBe(22);
    expect(resolved.gap).toBe(8);
    expect(resolved.alignment).toBe("left");
    expect(resolved.filterParam).toBe("tag");
    expect(resolved.inactiveColor).toBe("#587592");
  });

  it("keeps counts hidden when the setting was never written", () => {
    // The live renderer used `showCounts !== "false"`, so an unset value showed
    // counts while the panel's checkbox read unchecked. It is `=== "true"` now.
    expect(resolveTagCloudSettings({}).showCounts).toBe(false);
    expect(resolveTagCloudSettings({ showCounts: "false" }).showCounts).toBe(false);
    expect(resolveTagCloudSettings({ showCounts: "true" }).showCounts).toBe(true);
  });

  it("rejects a layout it does not know rather than passing it through", () => {
    expect(resolveTagCloudSettings({ layout: "spiral" }).layout).toBe("cloud");
    expect(resolveTagCloudSettings({ layout: "list" }).layout).toBe("list");
    expect(resolveTagCloudSettings({ layout: "pills" }).layout).toBe("pills");
  });

  it("falls back when a number setting is blank or unparseable", () => {
    const resolved = resolveTagCloudSettings({ minFontSize: "", maxFontSize: "abc", gap: "0" });
    expect(resolved.minFontSize).toBe(12);
    expect(resolved.maxFontSize).toBe(22);
    // 0 is a real value the operator can choose, so it must survive.
    expect(resolved.gap).toBe(0);
  });

  it("treats a blank filter param as the default rather than an empty key", () => {
    expect(resolveTagCloudSettings({ filterParam: "   " }).filterParam).toBe("tag");
    expect(resolveTagCloudSettings({ filterParam: "topic" }).filterParam).toBe("topic");
  });
});

describe("tagHref", () => {
  it("filters the current page when no target page is set", () => {
    const resolved = resolveTagCloudSettings({});
    expect(tagHref("news", resolved)).toBe("?tag=news");
  });

  it("points at the target page when one is set", () => {
    const resolved = resolveTagCloudSettings({ targetPageUrl: "/blog", filterParam: "topic" });
    expect(tagHref("case studies", resolved)).toBe("/blog?topic=case%20studies");
  });

  it("encodes a slug that would otherwise break the query string", () => {
    const resolved = resolveTagCloudSettings({});
    expect(tagHref("a&b=c", resolved)).toBe("?tag=a%26b%3Dc");
  });
});

describe("tagFontSize", () => {
  it("sizes by count only in the cloud layout", () => {
    const cloud = resolveTagCloudSettings({ layout: "cloud", minFontSize: "10", maxFontSize: "30" });
    expect(tagFontSize(20, 20, cloud)).toBe(30);
    expect(tagFontSize(10, 20, cloud)).toBe(20);
    expect(tagFontSize(1, 20, cloud)).toBe(11);

    const pills = resolveTagCloudSettings({ layout: "pills", minFontSize: "10", maxFontSize: "30" });
    expect(tagFontSize(20, 20, pills)).toBe(10);
  });

  it("does not divide by zero when every tag is countless", () => {
    const cloud = resolveTagCloudSettings({ layout: "cloud" });
    expect(tagFontSize(undefined, 0, cloud)).toBe(22);
    expect(maxTagCount([])).toBe(1);
  });
});

describe("activeTagSlug", () => {
  it("reads the filtered tag off the real query string", () => {
    const resolved = resolveTagCloudSettings({ filterParam: "tag" });
    expect(activeTagSlug("?tag=news&page=2", resolved)).toBe("news");
    expect(activeTagSlug("tag=news", resolved)).toBe("news");
    expect(activeTagSlug("", resolved)).toBe("");
    expect(activeTagSlug("?category=news", resolved)).toBe("");
  });
});

describe("parseCloudTags", () => {
  it("survives a settings value that is not a tag array", () => {
    expect(parseCloudTags({ tags: "not json" })).toEqual([]);
    expect(parseCloudTags({ tags: '{"a":1}' })).toEqual([]);
    expect(parseCloudTags({})).toEqual([]);
    expect(parseCloudTags({ tags: '[{"id":"a","label":"News","slug":"news"},{"nope":1}]' }))
      .toEqual([{ id: "a", label: "News", slug: "news" }]);
  });
});
