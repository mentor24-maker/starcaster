import { describe, expect, it } from "vitest";
import {
  BUILDER_VIDEO_LOOP_FADE_MAX,
  builderVideoCrossfades,
  createDefaultBackgroundSettings,
  normalizeBackgroundSettings,
  resolveBuilderVideoLoopFade
} from "@/lib/builder-template";

/**
 * The crossfade at the loop seam (Dane, 2026-08-31 — "so it doesn't have the
 * jerky switch"). The arithmetic lives here, away from the browser, because a
 * dissolve is the one part of this feature a test can hold still: whether it
 * LOOKS right is the operator's eye, but whether it is longer than the clip is
 * a number.
 */
describe("the loop fade setting", () => {
  it("defaults to a dissolve rather than a cut", () => {
    expect(createDefaultBackgroundSettings().videoLoopFade).toBe(0.6);
    expect(normalizeBackgroundSettings({ mode: "video" }).videoLoopFade).toBe(0.6);
  });

  it("keeps a hard cut reachable", () => {
    const background = normalizeBackgroundSettings({ mode: "video", videoLoopFade: 0 });
    expect(background.videoLoopFade).toBe(0);
    expect(resolveBuilderVideoLoopFade(background, 10)).toBe(0);
    expect(builderVideoCrossfades(background)).toBe(false);
  });

  it("clamps an absurd request to the ceiling", () => {
    expect(normalizeBackgroundSettings({ mode: "video", videoLoopFade: 99 }).videoLoopFade).toBe(
      BUILDER_VIDEO_LOOP_FADE_MAX
    );
    expect(normalizeBackgroundSettings({ mode: "video", videoLoopFade: -2 }).videoLoopFade).toBe(0);
  });

  it("falls back rather than reading an emptied box as a cut", () => {
    // The same trap the Speed box had: Number("") is 0, which is finite and
    // would silently mean "no dissolve" instead of "not set".
    expect(normalizeBackgroundSettings({ mode: "video", videoLoopFade: "" }).videoLoopFade).toBe(0.6);
  });
});

describe("clamping the fade against the clip", () => {
  const background = normalizeBackgroundSettings({ mode: "video", videoLoopFade: 3 });

  it("leaves the request alone when the clip is long enough", () => {
    expect(resolveBuilderVideoLoopFade(background, 30)).toBe(3);
  });

  it("never lets the dissolve exceed a third of the playing window", () => {
    // A 3s fade on a 3s clip would leave the section permanently mid-dissolve,
    // both copies half-visible and neither ever clearly on screen.
    expect(resolveBuilderVideoLoopFade(background, 3)).toBe(1);
    expect(resolveBuilderVideoLoopFade(background, 1.5)).toBe(0.5);
  });

  it("honours the request while the duration is still unknown", () => {
    // Metadata has not loaded; 0 means "cannot say yet", not "zero-length".
    expect(resolveBuilderVideoLoopFade(background, 0)).toBe(3);
  });
});

describe("whether a background crossfades at all", () => {
  it("does with a fade set and looping on", () => {
    expect(builderVideoCrossfades(normalizeBackgroundSettings({ mode: "video" }))).toBe(true);
  });

  it("does NOT when looping is off — there is no seam to hide", () => {
    expect(
      builderVideoCrossfades(normalizeBackgroundSettings({ mode: "video", videoLoop: false }))
    ).toBe(false);
  });

  it("does not when the fade has been turned down to a cut", () => {
    expect(
      builderVideoCrossfades(normalizeBackgroundSettings({ mode: "video", videoLoopFade: 0 }))
    ).toBe(false);
  });
});
