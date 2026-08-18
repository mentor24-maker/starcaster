import { describe, expect, it } from "vitest";
import {
  activeRingIndex,
  computeRingSizes,
  normalizeProximityEffect,
  normalizeProximityEffectSettings,
  normalizeProximityFalloff,
  normalizeProximityReach,
  proximityIsContinuous,
  proximityValue,
  ringOpacity
} from "./proximity-effects";

/**
 * The proximity driver, 2026-08-17.
 *
 * These exist because the thing they replace shipped broken and stayed broken
 * for two months without anybody noticing: TractorNav laid its rings out in a
 * ROW rather than concentrically, and its hit test measured every ring's
 * radius from the outermost ring's centre. Nothing failed — there is no test
 * in this repo that can see a rendered circle — it simply drew the wrong
 * picture on live sites.
 *
 * The geometry is now arithmetic, and arithmetic can be held still. That is
 * the whole reason this file is separate from the component.
 */

describe("proximityValue", () => {
  it("is full inside the core and at rest beyond the reach", () => {
    expect(proximityValue({ distance: 0, coreRadius: 20, reach: 400 })).toBe(1);
    expect(proximityValue({ distance: 20, coreRadius: 20, reach: 400 })).toBe(1);
    expect(proximityValue({ distance: 400, coreRadius: 20, reach: 400, rest: 0.42 })).toBe(0.42);
    expect(proximityValue({ distance: 9999, coreRadius: 20, reach: 400, rest: 0.42 })).toBe(0.42);
  });

  it("rises monotonically as the pointer closes in", () => {
    const samples = [400, 300, 200, 100, 50, 10].map((distance) =>
      proximityValue({ distance, coreRadius: 8, reach: 400 })
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it("never leaves 0..1, whatever it is handed", () => {
    const inputs = [
      { distance: -50, reach: 400 },
      { distance: Number.NaN, reach: 400 },
      { distance: 200, reach: 400, rest: 5 },
      { distance: 200, reach: 400, rest: -5 },
      { distance: 200, reach: 0 },
      { distance: 200, reach: 400, falloff: 0 }
    ];
    for (const input of inputs) {
      const value = proximityValue(input);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("holds the swell back near the word as the falloff rises", () => {
    // Same halfway distance, three curves. A higher falloff must give LESS
    // light at the midpoint — that is what 'holds it back until you are close'
    // means, and getting the exponent inverted would still look like an
    // effect, just the wrong one.
    const linear = proximityValue({ distance: 200, reach: 400, falloff: 1 });
    const squared = proximityValue({ distance: 200, reach: 400, falloff: 2 });
    const cubed = proximityValue({ distance: 200, reach: 400, falloff: 3 });
    expect(squared).toBeLessThan(linear);
    expect(cubed).toBeLessThan(squared);
  });

  it("survives a core wider than the reach instead of inverting", () => {
    const value = proximityValue({ distance: 50, coreRadius: 900, reach: 400 });
    expect(value).toBe(1);
  });
});

describe("computeRingSizes", () => {
  const base = { dotSize: 10, ringCount: 10, ringStep: 10, outerSize: 600, curve: 2 };

  it("returns one size per ring, largest first", () => {
    const sizes = computeRingSizes({ ...base, sizingMode: "linear" });
    expect(sizes).toHaveLength(10);
    expect(sizes[0]).toBe(110);
    expect(sizes[sizes.length - 1]).toBe(20);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    }
  });

  it("descends in both sizing modes, and reaches the outer size on the curve", () => {
    const geometric = computeRingSizes({ ...base, sizingMode: "geometric" });
    expect(geometric[0]).toBe(600);
    for (let i = 1; i < geometric.length; i++) {
      expect(geometric[i]).toBeLessThan(geometric[i - 1]);
    }
  });

  it("never returns an empty set, so there is always something to measure from", () => {
    expect(computeRingSizes({ ...base, ringCount: 0, sizingMode: "linear" })).toHaveLength(1);
    expect(computeRingSizes({ ...base, ringCount: 0.4, sizingMode: "geometric" })).toHaveLength(1);
  });
});

describe("activeRingIndex", () => {
  // Outermost first, exactly as computeRingSizes returns them.
  const sizes = [200, 160, 120, 80, 40];

  it("lights the SMALLEST ring that still contains the pointer", () => {
    // 30px out is inside every ring; only the innermost (40 wide, r=20)...
    // no: 30 > 20, so the innermost does NOT contain it. The 80-wide one does.
    expect(activeRingIndex(30, sizes)).toBe(3);
    expect(activeRingIndex(15, sizes)).toBe(4);
    expect(activeRingIndex(95, sizes)).toBe(0);
  });

  it("walks outward one band at a time as the pointer retreats", () => {
    const walk = [10, 30, 50, 70, 90].map((d) => activeRingIndex(d, sizes));
    expect(walk).toEqual([4, 3, 2, 1, 0]);
  });

  it("returns -1 outside every ring", () => {
    expect(activeRingIndex(101, sizes)).toBe(-1);
    expect(activeRingIndex(5000, sizes)).toBe(-1);
    expect(activeRingIndex(Number.NaN, sizes)).toBe(-1);
  });

  it("treats the boundary as inside, so there is no dead pixel between bands", () => {
    expect(activeRingIndex(20, sizes)).toBe(4);
    expect(activeRingIndex(100, sizes)).toBe(0);
  });
});

describe("ringOpacity", () => {
  it("gives the innermost ring the full inner opacity", () => {
    expect(ringOpacity({ index: 4, count: 5, innerOpacity: 90, opacityStep: 10 })).toBeCloseTo(0.9);
  });

  it("fades by one step per ring outward, and floors at zero", () => {
    expect(ringOpacity({ index: 3, count: 5, innerOpacity: 90, opacityStep: 10 })).toBeCloseTo(0.8);
    expect(ringOpacity({ index: 0, count: 5, innerOpacity: 90, opacityStep: 50 })).toBe(0);
  });
});

describe("normalizers", () => {
  it("falls back to Rings for an unknown or missing effect", () => {
    expect(normalizeProximityEffect(undefined)).toBe("rings");
    expect(normalizeProximityEffect("sparkles")).toBe("rings");
    expect(normalizeProximityEffect("glow")).toBe("glow");
  });

  it("clamps reach and falloff rather than trusting a hand-edited value", () => {
    expect(normalizeProximityReach("99999")).toBe(2000);
    expect(normalizeProximityReach("-3")).toBe(40);
    expect(normalizeProximityReach("banana")).toBe(460);
    expect(normalizeProximityFalloff("42")).toBe(5);
    expect(normalizeProximityFalloff("0")).toBe(1);
  });

  it("KEEPS a ring layout when the preset moves off Rings", () => {
    // The image-effects normalizer deletes keys its effect ignores. This one
    // must not: those keys are somebody's hand-tuned ring set, and a flick to
    // Glow and back would destroy it with no way to get it returned.
    const settings: Record<string, string> = {
      effect: "glow",
      ringCount: "14",
      ringStep: "22",
      curve: "3.5"
    };
    normalizeProximityEffectSettings(settings);
    expect(settings.ringCount).toBe("14");
    expect(settings.ringStep).toBe("22");
    expect(settings.curve).toBe("3.5");
  });

  it("stamps reach and falloff only for the presets that read them", () => {
    const rings: Record<string, string> = { effect: "rings" };
    normalizeProximityEffectSettings(rings);
    expect(rings.reach).toBeUndefined();
    expect(proximityIsContinuous("rings")).toBe(false);

    const glow: Record<string, string> = { effect: "glow" };
    normalizeProximityEffectSettings(glow);
    expect(glow.reach).toBe("460");
    expect(glow.falloff).toBe("2");
  });
});
