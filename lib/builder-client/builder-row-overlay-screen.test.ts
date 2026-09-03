import { describe, expect, it } from "vitest";
import {
  BUILDER_OVERLAY_BLEND_MODES,
  getBuilderRowOverlayScreenStyle,
  hasActiveRowOverlayScreen,
  normalizeRowOverlayScreenSettings
} from "@/lib/builder-template";

/**
 * The tint screen over a row. Its settings were normalized on both sides for
 * months while only the frozen vanilla builder ever PAINTED one, so a
 * React-rendered row silently had no overlay — configured, saved, and doing
 * nothing. These pin the ported paint step.
 */
describe("the row overlay tint", () => {
  it("is inactive until a background mode is actually chosen", () => {
    expect(hasActiveRowOverlayScreen(undefined)).toBe(false);
    expect(hasActiveRowOverlayScreen({ background: { mode: "none" }, opacity: 50 })).toBe(false);
    expect(getBuilderRowOverlayScreenStyle(undefined)).toBeUndefined();
  });

  it("paints a chosen colour", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "color", color: "#101820" },
      opacity: 100
    });

    expect(style).toBeDefined();
    expect(style?.backgroundColor).toBe("#101820");
  });

  it("carries its own opacity, which is what makes the footage read through it", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "color", color: "#101820" },
      opacity: 50
    });

    expect(style?.opacity).toBeCloseTo(0.5);
  });

  it("omits opacity entirely at full strength rather than writing 1", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "color", color: "#101820" },
      opacity: 100
    });

    expect(style?.opacity).toBeUndefined();
  });

  it("supports a gradient screen, not just a flat colour", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "gradient", color: "#000000", color2: "#ffffff" },
      opacity: 60
    });

    expect(String(style?.backgroundImage ?? "")).toContain("linear-gradient");
    expect(style?.opacity).toBeCloseTo(0.6);
  });
});

/**
 * BLEND MODE — the difference between fogging a photo and tinting it.
 *
 * The value reaches a style attribute, so the two things worth pinning are
 * that "normal" writes NOTHING (every overlay configured before this setting
 * existed must render exactly as it did) and that an unrecognised stored value
 * cannot reach CSS at all.
 */
describe("the overlay's blend mode", () => {
  it("emits no mix-blend-mode at all when it is normal", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "color", color: "#101820" },
      opacity: 100,
      blendMode: "normal"
    });

    expect(style).toBeDefined();
    expect("mixBlendMode" in (style ?? {})).toBe(false);
  });

  it("emits nothing for an overlay saved before the setting existed", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "color", color: "#101820" },
      opacity: 100
    });

    expect("mixBlendMode" in (style ?? {})).toBe(false);
  });

  it("emits the chosen mode when it is not normal", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "color", color: "#101820" },
      opacity: 100,
      blendMode: "multiply"
    });

    expect(style?.mixBlendMode).toBe("multiply");
  });

  it("keeps the blend mode alongside a partial opacity", () => {
    const style = getBuilderRowOverlayScreenStyle({
      background: { mode: "color", color: "#101820" },
      opacity: 40,
      blendMode: "screen"
    });

    expect(style?.mixBlendMode).toBe("screen");
    expect(style?.opacity).toBeCloseTo(0.4);
  });

  it("offers every mode it accepts, and accepts every mode it offers", () => {
    for (const mode of BUILDER_OVERLAY_BLEND_MODES) {
      expect(normalizeRowOverlayScreenSettings({
        background: { mode: "color", color: "#101820" },
        opacity: 100,
        blendMode: mode.value
      }).blendMode).toBe(mode.value);
    }
  });

  it("never lets a hand-edited document put an arbitrary string into CSS", () => {
    for (const junk of ["hue-rotate(90)", "url(x)", "MULTIPLY; position:fixed", "", "luminosity", 7, null]) {
      const settings = {
        background: { mode: "color", color: "#101820" },
        opacity: 100,
        blendMode: junk
      };

      expect(normalizeRowOverlayScreenSettings(settings).blendMode).toBe("normal");
      expect("mixBlendMode" in (getBuilderRowOverlayScreenStyle(settings) ?? {})).toBe(false);
    }
  });

  it("normalizes a mode's own casing and padding rather than discarding it", () => {
    expect(normalizeRowOverlayScreenSettings({
      background: { mode: "color", color: "#101820" },
      opacity: 100,
      blendMode: "  Soft-Light  "
    }).blendMode).toBe("soft-light");
  });
});
