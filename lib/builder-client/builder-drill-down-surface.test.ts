import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, type BackgroundSettings } from "@/lib/builder-template";
import {
  resolveBuilderDrillDownSurfaceBackground,
  sanitizeCellBackgroundForDrillDown,
  usesBuilderDrillDownSurfaceDefault
} from "@/lib/builder-drill-down-surface";

describe("builder drill-down surfaces", () => {
  it("treats decorative style presets as hierarchy defaults", () => {
    expect(
      usesBuilderDrillDownSurfaceDefault({
        mode: "style",
        color: "#ffffff",
        color2: "#eaf4ff",
        imageUrl: "",
        styleKey: "blue-yellow-circles"
      })
    ).toBe(true);
  });

  it("resolves cell tier to the row-body background token", () => {
    expect(resolveBuilderDrillDownSurfaceBackground(createDefaultBackgroundSettings(), "cell")).toEqual({
      background: "var(--builder-bg-cell)"
    });
  });

  it("resolves column tier to the column background token", () => {
    expect(resolveBuilderDrillDownSurfaceBackground(createDefaultBackgroundSettings(), "column")).toEqual({
      background: "var(--builder-bg-column)"
    });
  });

  /*
   * A VIDEO cell background survives the sanitiser exactly as an IMAGE one
   * does. Both already do, by falling through the three "is this a surface
   * default" questions to `false` — so this pair is a lock, not a fix: the
   * sanitiser runs on every cell of every row on every load
   * (`normalizeCellBackgrounds`), and a future clause that swept video up with
   * the decorative styles would silently empty the clip and poster off every
   * cell in the project, reporting nothing.
   *
   * Asserted as an identity against the same input rather than against a
   * hand-written expectation, so it fails on ANY field the sanitiser drops,
   * not only the two named here.
   */
  it("leaves a video cell background alone, exactly as it leaves an image one", () => {
    const video: BackgroundSettings = {
      mode: "video",
      color: "#ffffff",
      color2: "#eaf4ff",
      imageUrl: "",
      styleKey: "",
      videoUrl: "/api/admin/media-file/clip.mp4",
      posterUrl: "/api/admin/media-file/poster.jpg",
      videoSpeed: 1,
      videoLoop: true
    };

    expect(sanitizeCellBackgroundForDrillDown(video)).toEqual(video);
    expect(usesBuilderDrillDownSurfaceDefault(video)).toBe(false);

    const image: BackgroundSettings = {
      mode: "image",
      color: "#ffffff",
      color2: "#eaf4ff",
      imageUrl: "/api/admin/media-file/photo.jpg",
      styleKey: ""
    };

    expect(sanitizeCellBackgroundForDrillDown(image)).toEqual(image);
    expect(usesBuilderDrillDownSurfaceDefault(image)).toBe(false);
  });

  it("sanitizes decorative cell backgrounds back to none", () => {
    expect(
      sanitizeCellBackgroundForDrillDown({
        mode: "style",
        color: "#ffffff",
        color2: "#eaf4ff",
        imageUrl: "",
        styleKey: "blue-yellow-circles"
      })
    ).toEqual(createDefaultBackgroundSettings());
  });
});
