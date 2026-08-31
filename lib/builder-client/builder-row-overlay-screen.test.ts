import { describe, expect, it } from "vitest";
import { getBuilderRowOverlayScreenStyle, hasActiveRowOverlayScreen } from "@/lib/builder-template";

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
