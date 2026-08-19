import { describe, expect, it } from "vitest";
import { buildGalleryMediaTopicOptions, normalizeGalleryMediaTopic } from "./gallery-media-topic";

describe("normalizeGalleryMediaTopic", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeGalleryMediaTopic("  Cats  ")).toBe("Cats");
  });

  it("null and undefined normalize to an empty string", () => {
    expect(normalizeGalleryMediaTopic(null)).toBe("");
    expect(normalizeGalleryMediaTopic(undefined)).toBe("");
  });

  it("caps length at 255 characters", () => {
    const long = "x".repeat(300);
    const result = normalizeGalleryMediaTopic(long);
    expect(result.length).toBe(255);
    expect(result).toBe("x".repeat(255));
  });
});

describe("buildGalleryMediaTopicOptions", () => {
  it("an empty list produces an empty list", () => {
    expect(buildGalleryMediaTopicOptions([])).toEqual([]);
  });

  it("de-duplicates case-insensitively, keeping the first-seen casing", () => {
    expect(buildGalleryMediaTopicOptions(["Cats", "cats"])).toEqual(["Cats"]);
  });

  it("skips empty and whitespace-only entries", () => {
    expect(buildGalleryMediaTopicOptions(["Cats", "", "   ", "Dogs"])).toEqual(["Cats", "Dogs"]);
  });

  it("returns results sorted with localeCompare", () => {
    expect(buildGalleryMediaTopicOptions(["Zebra", "Apple", "mango"])).toEqual(
      ["Zebra", "Apple", "mango"].sort((a, b) => a.localeCompare(b))
    );
  });

  it("combines de-duplication and sorting on a realistic mixed list", () => {
    expect(buildGalleryMediaTopicOptions(["Beach", "beach", "  ", "Aerial", "aerial ", "City"])).toEqual(
      ["Aerial", "Beach", "City"]
    );
  });
});
