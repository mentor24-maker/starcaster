import { describe, expect, it } from "vitest";

import {
  EMPTY_MEDIA_FILTERS,
  MEDIA_ASPECTS,
  mediaAssetMatchesFilters,
  mediaFiltersActive,
  mediaTagOptions,
  type MediaFilters
} from "./media-manager-filters";

/**
 * Ticket 86bbrvk01 — the gallery filter bar.
 *
 * Two things go wrong with a filter bar, and neither announces itself:
 *
 *   1. Filters REPLACE each other instead of combining, so picking a category
 *      quietly discards the name you typed and the result looks plausible.
 *   2. A filter that matches nothing is indistinguishable from an empty
 *      library, so the operator concludes their media is gone.
 *
 * The second is about what the renderer does with an empty result, and is
 * covered by the browser check. This file holds the first, plus the matching
 * rules that are easy to get subtly wrong.
 */

const f = (over: Partial<MediaFilters> = {}): MediaFilters => ({ ...EMPTY_MEDIA_FILTERS, ...over });

const asset = (over: Partial<Parameters<typeof mediaAssetMatchesFilters>[0]> = {}) => ({
  assetName: "Center Court.jpg",
  category: "Facilities",
  aspect: "wide",
  tags: ["Courts", "Outdoor"],
  ...over
});

describe("no filters", () => {
  it("passes everything", () => {
    expect(mediaFiltersActive(EMPTY_MEDIA_FILTERS)).toBe(false);
    expect(mediaAssetMatchesFilters(asset(), EMPTY_MEDIA_FILTERS)).toBe(true);
    // Even an asset with nothing filled in at all.
    expect(mediaAssetMatchesFilters({}, EMPTY_MEDIA_FILTERS)).toBe(true);
  });

  it("whitespace alone is not a filter", () => {
    expect(mediaFiltersActive(f({ name: "   " }))).toBe(false);
  });
});

describe("name", () => {
  it("matches a substring, in any case", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ name: "court" }))).toBe(true);
    expect(mediaAssetMatchesFilters(asset(), f({ name: "COURT" }))).toBe(true);
    expect(mediaAssetMatchesFilters(asset(), f({ name: "  court  " }))).toBe(true);
  });

  it("excludes what does not contain it", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ name: "clubhouse" }))).toBe(false);
  });

  it("an asset with no name is excluded rather than crashing", () => {
    expect(mediaAssetMatchesFilters({ assetName: undefined }, f({ name: "x" }))).toBe(false);
  });
});

describe("aspect", () => {
  it("matches exactly, against the three the column allows", () => {
    expect(MEDIA_ASPECTS.map((a) => a.value)).toEqual(["wide", "square", "tall"]);
    expect(mediaAssetMatchesFilters(asset({ aspect: "wide" }), f({ aspect: "wide" }))).toBe(true);
    expect(mediaAssetMatchesFilters(asset({ aspect: "tall" }), f({ aspect: "wide" }))).toBe(false);
  });

  it("an asset with no aspect is excluded when an aspect is asked for", () => {
    expect(mediaAssetMatchesFilters(asset({ aspect: undefined }), f({ aspect: "wide" }))).toBe(false);
  });
});

describe("category", () => {
  it("matches case-insensitively", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ category: "facilities" }))).toBe(true);
    expect(mediaAssetMatchesFilters(asset(), f({ category: "FACILITIES" }))).toBe(true);
  });

  it("excludes a different category", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ category: "Team" }))).toBe(false);
  });
});

describe("tag", () => {
  it("matches one of the asset's tags, case- and space-insensitively", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ tag: "Courts" }))).toBe(true);
    expect(mediaAssetMatchesFilters(asset(), f({ tag: "courts" }))).toBe(true);
    expect(mediaAssetMatchesFilters(asset(), f({ tag: "  COURTS  " }))).toBe(true);
  });

  it("excludes a file that does not carry it", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ tag: "Indoor" }))).toBe(false);
  });

  it("an untagged file is excluded when a tag is asked for", () => {
    expect(mediaAssetMatchesFilters(asset({ tags: [] }), f({ tag: "Courts" }))).toBe(false);
    expect(mediaAssetMatchesFilters(asset({ tags: undefined }), f({ tag: "Courts" }))).toBe(false);
  });
});

describe("filters COMBINE — they never replace one another", () => {
  // This is the defect worth the whole file. Each of these passes one filter
  // and fails the other, so an implementation that only honours the last
  // filter set would return true for at least one of them.
  it("all four together keep a file that satisfies all four", () => {
    expect(mediaAssetMatchesFilters(
      asset(),
      f({ name: "court", aspect: "wide", tag: "Courts", category: "Facilities" })
    )).toBe(true);
  });

  it("matching the name but not the category is excluded", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ name: "court", category: "Team" }))).toBe(false);
  });

  it("matching the category but not the name is excluded", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ name: "clubhouse", category: "Facilities" }))).toBe(false);
  });

  it("matching the tag but not the aspect is excluded", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ tag: "Courts", aspect: "tall" }))).toBe(false);
  });

  it("matching the aspect but not the tag is excluded", () => {
    expect(mediaAssetMatchesFilters(asset(), f({ aspect: "wide", tag: "Indoor" }))).toBe(false);
  });
});

describe("the Tag select's options", () => {
  // The first version offered the registry only, and the browser check caught
  // it: a file tagged outside the registry showed its tag on the card and
  // could not be filtered by it. A tag you can SEE but cannot filter by is
  // worse than no filter at all. It also matches what /api/asset-categories
  // already does for categories — merge the registry with what is in use.
  const registry = [{ tag: "Indoor" }, { tag: "Courts" }];
  const assets = [
    { tags: ["Courts", "Legacy Tag"] },
    { tags: ["courts"] },
    { tags: [] },
    {}
  ];

  it("includes registry tags, sorted", () => {
    expect(mediaTagOptions(registry, [])).toEqual(["Courts", "Indoor"]);
  });

  it("includes a tag that is only on an asset", () => {
    expect(mediaTagOptions(registry, assets)).toContain("Legacy Tag");
  });

  it("does not list the same tag twice over a casing difference", () => {
    const out = mediaTagOptions(registry, assets);
    expect(out.filter((t) => t.toLowerCase() === "courts")).toHaveLength(1);
  });

  it("survives empty and malformed input", () => {
    expect(mediaTagOptions([], [])).toEqual([]);
    expect(mediaTagOptions([{ tag: "  " }], [{ tags: ["", "  "] }])).toEqual([]);
  });
});

describe("mediaFiltersActive", () => {
  it("is true for any single filter, and only then", () => {
    expect(mediaFiltersActive(f({ name: "a" }))).toBe(true);
    expect(mediaFiltersActive(f({ aspect: "wide" }))).toBe(true);
    expect(mediaFiltersActive(f({ tag: "Courts" }))).toBe(true);
    expect(mediaFiltersActive(f({ category: "Team" }))).toBe(true);
    expect(mediaFiltersActive(f())).toBe(false);
  });
});
