import { describe, expect, it } from "vitest";
import { galleryMediaFileName, sortGalleryMediaList } from "@/lib/gallery-media-list-sort";
import type { AdminMediaItem } from "@/lib/admin-media-shared";

function item(overrides: Partial<AdminMediaItem> & { name: string }): AdminMediaItem {
  return {
    path: `/uploads/${overrides.name}.png`,
    directory: "gallery",
    kind: "image",
    extension: ".png",
    ...overrides
  } as AdminMediaItem;
}

describe("galleryMediaFileName", () => {
  it("takes the last path segment and drops the query string", () => {
    expect(galleryMediaFileName("https://cdn.test/a/b/logo_2x.png?v=9")).toBe("logo_2x.png");
  });

  it("decodes escaped characters", () => {
    expect(galleryMediaFileName("/uploads/Brandon%20Marinoff.png")).toBe("Brandon Marinoff.png");
  });
});

describe("sortGalleryMediaList", () => {
  const media = [
    item({ name: "Apple", createdAt: "2026-07-01T00:00:00Z", imageWidth: 100, imageHeight: 100 }),
    item({ name: "Banana", createdAt: "2026-07-28T00:00:00Z", imageWidth: 10, imageHeight: 10 }),
    item({ name: "Cherry", createdAt: "2026-07-14T00:00:00Z", imageWidth: 50, imageHeight: 50 })
  ];

  it("returns the list untouched when no column is active", () => {
    expect(sortGalleryMediaList(media, null)).toBe(media);
  });

  it("sorts newest first on a descending create-date sort", () => {
    const sorted = sortGalleryMediaList(media, { key: "createdAt", dir: "desc" });
    expect(sorted.map((m) => m.name)).toEqual(["Banana", "Cherry", "Apple"]);
  });

  it("sorts oldest first on an ascending create-date sort", () => {
    const sorted = sortGalleryMediaList(media, { key: "createdAt", dir: "asc" });
    expect(sorted.map((m) => m.name)).toEqual(["Apple", "Cherry", "Banana"]);
  });

  it("does not mutate the input", () => {
    sortGalleryMediaList(media, { key: "createdAt", dir: "desc" });
    expect(media.map((m) => m.name)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("sorts by pixel area for dimensions and by title otherwise", () => {
    expect(sortGalleryMediaList(media, { key: "dimensions", dir: "asc" }).map((m) => m.name)).toEqual([
      "Banana",
      "Cherry",
      "Apple"
    ]);
    expect(sortGalleryMediaList(media, { key: "name", dir: "desc" }).map((m) => m.name)).toEqual([
      "Cherry",
      "Banana",
      "Apple"
    ]);
  });

  it("puts assets with no create date last when sorting newest first", () => {
    const withGap = [item({ name: "Undated" }), ...media];
    const sorted = sortGalleryMediaList(withGap, { key: "createdAt", dir: "desc" });
    expect(sorted[sorted.length - 1]?.name).toBe("Undated");
  });

  // The bug this module was extracted for: the gallery shows one 60-item page
  // at a time. Sorting the page instead of the library hid the newest uploads
  // behind the page boundary whenever they sorted late by name.
  it("keeps the newest uploads on the first page when the library is paged", () => {
    const library = Array.from({ length: 163 }, (_, index) =>
      item({
        name: `Asset ${String(index).padStart(3, "0")}`,
        // Newest assets sort last alphabetically, so a name-ordered page misses them.
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString()
      })
    );

    const firstPage = sortGalleryMediaList(library, { key: "createdAt", dir: "desc" }).slice(0, 60);

    expect(firstPage[0]?.name).toBe("Asset 162");
    expect(firstPage).toHaveLength(60);
  });
});
