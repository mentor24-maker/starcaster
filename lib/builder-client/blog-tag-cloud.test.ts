import { describe, expect, it } from "vitest";
import {
  activeTagSlug,
  blogTagsToCloudTags,
  maxTagCount,
  parseCloudTags,
  resolveTagCloudSettings,
  resolveTagCloudSource,
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

describe("resolveTagCloudSource — the migration for pages that predate the setting", () => {
  it("keeps an existing hand-typed list on MANUAL, so no live page silently changes", () => {
    const settings = { tags: JSON.stringify([{ id: "a", label: "News", slug: "news" }]) };
    expect(resolveTagCloudSource(settings)).toBe("manual");
  });

  it("defaults an EMPTY module to auto, where it has nothing to lose", () => {
    expect(resolveTagCloudSource({})).toBe("auto");
    expect(resolveTagCloudSource({ tags: "[]" })).toBe("auto");
    expect(resolveTagCloudSource({ tags: "not json" })).toBe("auto");
  });

  it("obeys an explicit choice over the migration guess, in both directions", () => {
    const typed = { tags: JSON.stringify([{ id: "a", label: "News", slug: "news" }]) };
    expect(resolveTagCloudSource({ ...typed, tagSource: "auto" })).toBe("auto");
    expect(resolveTagCloudSource({ tagSource: "manual" })).toBe("manual");
  });

  it("ignores a value that is neither, rather than trusting it", () => {
    expect(resolveTagCloudSource({ tagSource: "messaging" })).toBe("auto");
  });
});

describe("blogTagsToCloudTags", () => {
  const rows = [
    { tag: "Delray Beach Open", postCount: 3 },
    { tag: "Davis Cup", postCount: 2 },
    { tag: "tennis", postCount: 1 },
  ];

  it("carries the tag WORD as the slug, because the blog filters on an exact word", () => {
    const [first] = blogTagsToCloudTags(rows);
    expect(first.slug).toBe("Delray Beach Open");
    expect(first.label).toBe("Delray Beach Open");
    // A slugified value would filter nothing at all.
    expect(first.slug).not.toBe("delray-beach-open");
  });

  it("keeps the post count and the order the endpoint served", () => {
    expect(blogTagsToCloudTags(rows).map((t) => [t.label, t.count])).toEqual([
      ["Delray Beach Open", 3],
      ["Davis Cup", 2],
      ["tennis", 1],
    ]);
  });

  it("drops blank tags rather than rendering an empty pill", () => {
    expect(blogTagsToCloudTags([{ tag: "", postCount: 4 }, { tag: "  " }, { tag: "real" }])
      .map((t) => t.label)).toEqual(["real"]);
  });

  it("never counts a tag as zero, so the cloud can size it", () => {
    const [t] = blogTagsToCloudTags([{ tag: "quiet", postCount: 0 }]);
    expect(t.count).toBe(1);
  });

  it("survives a payload that is not an array", () => {
    expect(blogTagsToCloudTags(null)).toEqual([]);
    expect(blogTagsToCloudTags(undefined)).toEqual([]);
    expect(blogTagsToCloudTags({ tags: [] })).toEqual([]);
  });
});

describe("a real blog tag survives the round trip into a link", () => {
  it("builds a filter a multi-word tag actually matches", () => {
    const [tag] = blogTagsToCloudTags([{ tag: "Delray Beach Open", postCount: 3 }]);
    const href = tagHref(tag.slug, { filterParam: "tag", targetPageUrl: "" });
    // What the browser will hand back to the blog list after decoding.
    const value = new URLSearchParams(href.replace(/^\?/, "")).get("tag");
    expect(value).toBe("Delray Beach Open");
  });
});
