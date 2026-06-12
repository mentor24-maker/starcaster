import { describe, expect, it } from "vitest";
import { normalizeGalleryMediaAspect } from "@/lib/gallery-media-aspect";

describe("normalizeGalleryMediaAspect", () => {
  it("accepts tall, wide, and square", () => {
    expect(normalizeGalleryMediaAspect("tall")).toBe("tall");
    expect(normalizeGalleryMediaAspect("wide")).toBe("wide");
    expect(normalizeGalleryMediaAspect("square")).toBe("square");
  });

  it("defaults invalid values to square", () => {
    expect(normalizeGalleryMediaAspect("portrait")).toBe("square");
  });
});
