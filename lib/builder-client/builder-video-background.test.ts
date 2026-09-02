import { describe, expect, it } from "vitest";
import {
  builderVideoBackgroundPosition,
  createDefaultBackgroundSettings,
  finalizeBackgroundSettings,
  getBuilderBackgroundLayerOpacity,
  getBuilderBackgroundStyle,
  normalizeBackgroundMode,
  normalizeBackgroundSettings
} from "@/lib/builder-template";

/**
 * Video is the fifth background mode. It is the only one that is not a CSS
 * background, so the contract these tests pin is the one that lets it exist at
 * all: it normalizes like every other mode, and it reports its POSTER as an
 * ordinary CSS image so that every surface which cannot play a video keeps
 * rendering without knowing the mode exists.
 */
describe("video background settings", () => {
  it("accepts video as a background mode", () => {
    expect(normalizeBackgroundMode("video")).toBe("video");
    expect(normalizeBackgroundMode("VIDEO")).toBe("video");
  });

  it("still rejects an unknown mode", () => {
    expect(normalizeBackgroundMode("hologram")).toBe("none");
    expect(normalizeBackgroundMode(undefined)).toBe("none");
  });

  it("round-trips every video field", () => {
    const normalized = normalizeBackgroundSettings({
      mode: "video",
      videoUrl: "/assets/clip.mp4",
      videoAssetId: "asset-1",
      posterUrl: "/assets/still.jpg",
      posterAssetId: "asset-2",
      videoSpeed: 0.5,
      videoLoop: false,
      videoTrimStart: 2,
      videoTrimEnd: 5,
      videoBlur: 8,
      videoPlayOnMobile: true,
      videoFocalX: 20,
      videoFocalY: 80
    });

    expect(normalized.mode).toBe("video");
    expect(normalized.videoUrl).toBe("/assets/clip.mp4");
    expect(normalized.videoAssetId).toBe("asset-1");
    expect(normalized.posterUrl).toBe("/assets/still.jpg");
    expect(normalized.posterAssetId).toBe("asset-2");
    expect(normalized.videoSpeed).toBe(0.5);
    expect(normalized.videoLoop).toBe(false);
    expect(normalized.videoTrimStart).toBe(2);
    expect(normalized.videoTrimEnd).toBe(5);
    expect(normalized.videoBlur).toBe(8);
    expect(normalized.videoPlayOnMobile).toBe(true);
    expect(normalized.videoFocalX).toBe(20);
    expect(normalized.videoFocalY).toBe(80);
  });

  it("clamps out-of-range values instead of storing them", () => {
    const normalized = normalizeBackgroundSettings({
      mode: "video",
      videoSpeed: 9,
      videoBlur: -3,
      videoFocalX: 250,
      videoFocalY: -40
    });

    expect(normalized.videoSpeed).toBe(2);
    expect(normalized.videoBlur).toBe(0);
    expect(normalized.videoFocalX).toBe(100);
    expect(normalized.videoFocalY).toBe(0);
  });

  it("falls back rather than storing junk when a number is not a number", () => {
    const normalized = normalizeBackgroundSettings({
      mode: "video",
      videoSpeed: "",
      videoBlur: null,
      videoFocalX: "left"
    });

    expect(normalized.videoSpeed).toBe(1);
    expect(normalized.videoBlur).toBe(0);
    expect(normalized.videoFocalX).toBe(50);
  });

  it("loops by default, so an older row with no key set keeps looping", () => {
    expect(normalizeBackgroundSettings({ mode: "video" }).videoLoop).toBe(true);
    expect(createDefaultBackgroundSettings().videoLoop).toBe(true);
    expect(normalizeBackgroundSettings({ mode: "video", videoLoop: false }).videoLoop).toBe(false);
  });

  it("does not play on phones unless it was explicitly turned on", () => {
    expect(normalizeBackgroundSettings({ mode: "video" }).videoPlayOnMobile).toBe(false);
    expect(
      normalizeBackgroundSettings({ mode: "video", videoPlayOnMobile: "yes" }).videoPlayOnMobile
    ).toBe(false);
    expect(
      normalizeBackgroundSettings({ mode: "video", videoPlayOnMobile: true }).videoPlayOnMobile
    ).toBe(true);
  });
});

describe("the poster fallback", () => {
  it("reports a video background as its poster image, cropped to the focal point", () => {
    const style = getBuilderBackgroundStyle(
      normalizeBackgroundSettings({
        mode: "video",
        videoUrl: "/assets/clip.mp4",
        posterUrl: "/assets/still.jpg",
        videoFocalX: 20,
        videoFocalY: 80
      })
    );

    expect(style?.backgroundImage).toContain("still.jpg");
    expect(style?.backgroundSize).toBe("cover");
    expect(style?.backgroundPosition).toBe("20% 80%");
  });

  it("never paints the clip itself — a CSS background cannot play one", () => {
    const style = getBuilderBackgroundStyle(
      normalizeBackgroundSettings({
        mode: "video",
        videoUrl: "/assets/clip.mp4",
        posterUrl: "/assets/still.jpg"
      })
    );

    expect(String(style?.backgroundImage ?? "")).not.toContain("clip.mp4");
  });

  it("returns nothing at all when there is no poster, rather than a broken url", () => {
    const style = getBuilderBackgroundStyle(
      normalizeBackgroundSettings({ mode: "video", videoUrl: "/assets/clip.mp4" })
    );

    expect(style).toBeUndefined();
  });

  it("centres the crop when no focal point was ever set", () => {
    expect(builderVideoBackgroundPosition(createDefaultBackgroundSettings())).toBe("50% 50%");
    expect(builderVideoBackgroundPosition(undefined)).toBe("50% 50%");
  });

  it("dims through the backdrop layer, the way an image background does", () => {
    const background = normalizeBackgroundSettings({
      mode: "video",
      videoUrl: "/assets/clip.mp4",
      posterUrl: "/assets/still.jpg",
      opacity: 40
    });

    expect(getBuilderBackgroundLayerOpacity(background)).toBeCloseTo(0.4);
  });
});

describe("promoting a half-set video background", () => {
  it("promotes a stray videoUrl to mode video, the way a stray imageUrl becomes image", () => {
    expect(finalizeBackgroundSettings({ videoUrl: "/assets/clip.mp4" }).mode).toBe("video");
  });

  it("still honours an explicit none", () => {
    expect(finalizeBackgroundSettings({ mode: "none", videoUrl: "/assets/clip.mp4" }).mode).toBe(
      "none"
    );
  });

  it("leaves an image background alone", () => {
    expect(finalizeBackgroundSettings({ imageUrl: "/assets/photo.jpg" }).mode).toBe("image");
  });
});
