import { describe, expect, it } from "vitest";
import {
  GALLERY_MEDIA_BADGE_TYPE,
  galleryBadgeFlagForMediaType,
  isGalleryBadgeMediaItem,
  isGalleryBadgeMediaType,
} from "./gallery-media-badge-type";

describe("isGalleryBadgeMediaType", () => {
  it("is true for the canonical badge type", () => {
    expect(isGalleryBadgeMediaType(GALLERY_MEDIA_BADGE_TYPE)).toBe(true);
  });

  it("is true for the legacy label, including surrounding whitespace", () => {
    expect(isGalleryBadgeMediaType("Badge Symbol")).toBe(true);
    expect(isGalleryBadgeMediaType("  Badge Symbol  ")).toBe(true);
    expect(isGalleryBadgeMediaType(`  ${GALLERY_MEDIA_BADGE_TYPE}  `)).toBe(true);
  });

  it("is false for other media types and for undefined", () => {
    expect(isGalleryBadgeMediaType("Image")).toBe(false);
    expect(isGalleryBadgeMediaType("badge")).toBe(false);
    expect(isGalleryBadgeMediaType("")).toBe(false);
    expect(isGalleryBadgeMediaType(undefined)).toBe(false);
  });
});

describe("galleryBadgeFlagForMediaType", () => {
  it("returns undefined for an empty or whitespace-only type", () => {
    expect(galleryBadgeFlagForMediaType("")).toBeUndefined();
    expect(galleryBadgeFlagForMediaType("   ")).toBeUndefined();
  });

  it("returns the boolean flag for a non-empty type", () => {
    expect(galleryBadgeFlagForMediaType(GALLERY_MEDIA_BADGE_TYPE)).toBe(true);
    expect(galleryBadgeFlagForMediaType("Badge Symbol")).toBe(true);
    expect(galleryBadgeFlagForMediaType("Image")).toBe(false);
  });
});

describe("isGalleryBadgeMediaItem", () => {
  it("is true when item.badge is truthy, regardless of mediaType", () => {
    expect(isGalleryBadgeMediaItem({ badge: true })).toBe(true);
    expect(isGalleryBadgeMediaItem({ badge: true, mediaType: "Image" })).toBe(true);
  });

  it("is true when mediaType resolves to a badge type, regardless of badge", () => {
    expect(isGalleryBadgeMediaItem({ mediaType: GALLERY_MEDIA_BADGE_TYPE })).toBe(true);
    expect(isGalleryBadgeMediaItem({ badge: false, mediaType: "Badge Symbol" })).toBe(true);
  });

  it("is false when neither badge nor mediaType indicates a badge", () => {
    expect(isGalleryBadgeMediaItem({})).toBe(false);
    expect(isGalleryBadgeMediaItem({ badge: false })).toBe(false);
    expect(isGalleryBadgeMediaItem({ mediaType: "Image" })).toBe(false);
    expect(isGalleryBadgeMediaItem({ badge: false, mediaType: "Image" })).toBe(false);
  });
});
