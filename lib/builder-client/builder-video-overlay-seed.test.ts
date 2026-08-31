import { describe, expect, it } from "vitest";
import {
  BUILDER_VIDEO_DEFAULT_OVERLAY_OPACITY,
  BUILDER_VIDEO_DEFAULT_OVERLAY_TINT,
  hasActiveRowOverlayScreen,
  seedVideoBackgroundOverlayScreen
} from "@/lib/builder-template";

/**
 * Choosing Video turns the row's tint on (operator, 2026-08-31: "Default
 * overlay tint ON"), because dark text over moving footage is unreadable
 * without one and "none" made the common case the broken case.
 *
 * The distinction these tests hold is between SEEDING and OWNING: the seed
 * only ever fills an empty setting, and nothing here removes a tint.
 */
describe("seeding the video overlay tint", () => {
  it("turns the tint on when the row has none", () => {
    const seeded = seedVideoBackgroundOverlayScreen(undefined);

    expect(hasActiveRowOverlayScreen(seeded)).toBe(true);
    expect(seeded.background.mode).toBe("color");
    expect(seeded.background.color).toBe(BUILDER_VIDEO_DEFAULT_OVERLAY_TINT);
    expect(seeded.opacity).toBe(BUILDER_VIDEO_DEFAULT_OVERLAY_OPACITY);
  });

  it("seeds a tint that lets the footage through rather than hiding it", () => {
    const seeded = seedVideoBackgroundOverlayScreen(undefined);

    expect(seeded.opacity).toBeGreaterThan(0);
    expect(seeded.opacity).toBeLessThan(100);
  });

  it("treats an explicitly-none overlay as empty and seeds it", () => {
    const seeded = seedVideoBackgroundOverlayScreen({
      background: { mode: "none" },
      opacity: 100
    });

    expect(hasActiveRowOverlayScreen(seeded)).toBe(true);
  });

  it("never overwrites a tint the operator already chose", () => {
    const mine = { background: { mode: "color", color: "#ff0000" }, opacity: 20 };
    const seeded = seedVideoBackgroundOverlayScreen(mine);

    expect(seeded.background.color).toBe("#ff0000");
    expect(seeded.opacity).toBe(20);
  });

  it("leaves a gradient tint alone too, not just a flat colour", () => {
    const seeded = seedVideoBackgroundOverlayScreen({
      background: { mode: "gradient", color: "#111111", color2: "#222222" },
      opacity: 80
    });

    expect(seeded.background.mode).toBe("gradient");
    expect(seeded.opacity).toBe(80);
  });

  it("is idempotent — seeding twice is the same as seeding once", () => {
    const once = seedVideoBackgroundOverlayScreen(undefined);
    const twice = seedVideoBackgroundOverlayScreen(once);

    expect(twice).toEqual(once);
  });
});
