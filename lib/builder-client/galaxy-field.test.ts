import { describe, expect, it } from "vitest";
import {
  GALAXY_CORE_ARM,
  GALAXY_COUNT_FLOOR,
  GALAXY_REFERENCE_AREA_PX,
  GALAXY_SETTING_DEFAULTS,
  GALAXY_SETTING_RANGES,
  createGalaxyProjection,
  galaxyArmFloor,
  galaxyArmSigma,
  galaxyCoreRadius,
  galaxySpineAngle,
  generateGalaxyField,
  mulberry32,
  projectGalaxyField,
  readDeviceTier,
  readGalaxySettings,
  scaleGalaxyCount,
  stepGalaxyField,
  type GalaxyField,
  type GalaxySettings
} from "./galaxy-field";

/**
 * The Galaxy engine, 2026-09-25 (Galaxy module 1/6, task 86bc7f5hf).
 *
 * Nothing in this repo can look at an animated canvas, so the engine is
 * arithmetic over typed arrays and these tests hold that arithmetic still:
 * the same seed draws the same picture, every star sits on its arm, the
 * inner stars turn faster than the rim, the spiral keeps its shape for
 * minutes at the default settings, rotation does not move a star off its
 * circle, and a frame allocates nothing.
 */

const TWO_PI = 2 * Math.PI;
const FRAME = 1 / 60;

function settingsWith(overrides: Record<string, string> = {}): GalaxySettings {
  return readGalaxySettings({ ...GALAXY_SETTING_DEFAULTS, ...overrides });
}

/** Fold an angle into (-π, π]. */
function wrap(angle: number): number {
  let a = angle % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  return a;
}

/**
 * EVERY array the field owns, in one place. The byte comparison, the length
 * check and the no-allocation test all read this list, so a new array added
 * to the field is covered by all three or by none — the round-1 review found
 * `bytesOf` silently skipping three of twelve.
 */
function fieldArrays(field: GalaxyField): (Float32Array | Uint8Array)[] {
  return [
    field.x,
    field.y,
    field.z,
    field.radius,
    field.angle,
    field.jitter,
    field.size,
    field.brightness,
    field.twinklePhase,
    field.colour,
    field.arm,
    field.flare
  ];
}

function bytesOf(field: GalaxyField): Buffer {
  return Buffer.concat(fieldArrays(field).map((array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength)));
}

function isArmStar(field: GalaxyField, i: number): boolean {
  return field.arm[i] !== GALAXY_CORE_ARM && field.flare[i] === 0;
}

/** A star's angle as it would be drawn: from x/y, so the pattern's spin is included. */
function screenAngle(field: GalaxyField, i: number): number {
  return Math.atan2(field.y[i], field.x[i]);
}

function indexOfExtremeRadius(field: GalaxyField, pick: "min" | "max"): number {
  let index = -1;
  for (let i = 0; i < field.count; i++) {
    // Arm stars only: the core does not flow and its tiny radii are held at a
    // floor for spin, which would make "smallest radius" a different question.
    if (!isArmStar(field, i)) continue;
    if (index < 0) {
      index = i;
      continue;
    }
    const better = pick === "min" ? field.radius[i] < field.radius[index] : field.radius[i] > field.radius[index];
    if (better) index = i;
  }
  return index;
}

/**
 * The share of arm stars sitting within ±2σ of their own arm's spine, as
 * drawn — the pattern's spin is subtracted so the comparison is fair after
 * any amount of turning.
 */
function shareOnArm(field: GalaxyField, settings: GalaxySettings): number {
  const sigma = galaxyArmSigma(settings.armWidth);
  let armStars = 0;
  let inBand = 0;
  for (let i = 0; i < field.count; i++) {
    if (!isArmStar(field, i)) continue;
    armStars += 1;
    const radius = Math.hypot(field.x[i], field.y[i]);
    const offset = wrap(screenAngle(field, i) - field.spin - galaxySpineAngle(radius, field.arm[i], settings));
    if (Math.abs(offset) <= 2 * sigma) inBand += 1;
  }
  return armStars ? inBand / armStars : 0;
}

/** Arm-star counts in five equal radius bands, rim to centre. */
function radialHistogram(field: GalaxyField): number[] {
  const bins = [0, 0, 0, 0, 0];
  for (let i = 0; i < field.count; i++) {
    if (!isArmStar(field, i)) continue;
    bins[Math.min(4, Math.floor(field.radius[i] * 5))] += 1;
  }
  return bins;
}

describe("mulberry32", () => {
  it("repeats the same sequence for the same seed, and a different one for a different seed", () => {
    const a = mulberry32(27);
    const b = mulberry32(27);
    const c = mulberry32(28);
    const fromA = Array.from({ length: 8 }, () => a());
    const fromB = Array.from({ length: 8 }, () => b());
    const fromC = Array.from({ length: 8 }, () => c());
    expect(fromA).toEqual(fromB);
    expect(fromA).not.toEqual(fromC);
    for (const value of fromA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("readGalaxySettings", () => {
  it("returns the stated defaults for an empty bag", () => {
    const settings = readGalaxySettings({});
    expect(settings).toEqual({
      seed: 27,
      particleCount: 4000,
      arms: 2,
      turns: 2.35,
      armWidth: 40,
      coreSize: 12,
      coreStrength: 66,
      flareStars: 7,
      starSize: 2,
      spinSpeed: 10,
      spinDirection: "clockwise",
      differential: 50,
      flowSpeed: 30,
      twinkle: 60
    });
    expect(readGalaxySettings()).toEqual(settings);
  });

  it("clamps every number to its stated range, from both sides", () => {
    const keys = Object.keys(GALAXY_SETTING_RANGES);
    expect(keys.length).toBe(13);
    const tooHigh: Record<string, string> = {};
    const tooLow: Record<string, string> = {};
    for (const key of keys) {
      tooHigh[key] = "1e12";
      tooLow[key] = "-1e12";
    }
    const high = readGalaxySettings(tooHigh) as unknown as Record<string, number>;
    const low = readGalaxySettings(tooLow) as unknown as Record<string, number>;
    for (const key of keys) {
      expect(high[key]).toBe(GALAXY_SETTING_RANGES[key].max);
      expect(low[key]).toBe(GALAXY_SETTING_RANGES[key].min);
    }
  });

  it("falls back to the default for a value that does not parse, and never yields NaN", () => {
    const settings = readGalaxySettings({ particleCount: "lots", turns: "", seed: "banana", spinDirection: "sideways" });
    expect(settings.particleCount).toBe(4000);
    expect(settings.turns).toBe(2.35);
    expect(settings.seed).toBe(27);
    expect(settings.spinDirection).toBe("clockwise");
    for (const value of Object.values(settings)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
    expect(readGalaxySettings({ spinDirection: "counterclockwise" }).spinDirection).toBe("counterclockwise");
    // The direction is validated against the exported list, not a hand-typed string.
    expect(readGalaxySettings({ spinDirection: "Clockwise" }).spinDirection).toBe("clockwise");
  });

  it("rounds the integer settings", () => {
    const settings = readGalaxySettings({ particleCount: "1234.6", arms: "2.4", flareStars: "3.5" });
    expect(settings.particleCount).toBe(1235);
    expect(settings.arms).toBe(2);
    expect(settings.flareStars).toBe(4);
  });
});

describe("generateGalaxyField", () => {
  it("draws byte-identical arrays for the same seed and settings, and different ones for a different seed", () => {
    const a = generateGalaxyField(settingsWith());
    const b = generateGalaxyField(settingsWith());
    const c = generateGalaxyField(settingsWith({ seed: "28" }));
    expect(bytesOf(a).equals(bytesOf(b))).toBe(true);
    expect(bytesOf(a).equals(bytesOf(c))).toBe(false);
    // And the typed arrays are distinct objects — a second field is not the first one handed back.
    expect(a.x).not.toBe(b.x);
  });

  it("honours particleCount exactly, across every population", () => {
    for (const count of ["500", "1234", "4000", "8000"]) {
      const field = generateGalaxyField(settingsWith({ particleCount: count }));
      expect(field.count).toBe(Number(count));
      for (const array of fieldArrays(field)) expect(array.length).toBe(Number(count));
    }
    // Flare stars come out of the count, never on top of it.
    const flares = generateGalaxyField(settingsWith({ particleCount: "600", flareStars: "12" }));
    expect(flares.count).toBe(600);
    expect(Array.from(flares.flare).filter((f) => f === 1).length).toBe(12);
  });

  it("refuses a non-finite particleCount out loud rather than drawing an empty galaxy", () => {
    // A typed array of length NaN is silently empty; slice 2 will spread a
    // scaled count into the settings, and a NaN there must not paint nothing.
    expect(() => generateGalaxyField({ ...settingsWith(), particleCount: Number.NaN })).toThrow(RangeError);
  });

  it("keeps every arm star within its arm's band: at least 90% of each arm within ±2 armWidth", () => {
    const settings = settingsWith({ arms: "3", particleCount: "6000" });
    const field = generateGalaxyField(settings);
    const sigma = galaxyArmSigma(settings.armWidth);
    expect(sigma).toBeGreaterThan(0);
    const perArm = new Map<number, { total: number; inBand: number }>();
    for (let i = 0; i < field.count; i++) {
      const arm = field.arm[i];
      if (arm === GALAXY_CORE_ARM) continue;
      const radius = Math.hypot(field.x[i], field.y[i]);
      const offset = wrap(screenAngle(field, i) - galaxySpineAngle(radius, arm, settings));
      const bucket = perArm.get(arm) ?? { total: 0, inBand: 0 };
      bucket.total += 1;
      if (Math.abs(offset) <= 2 * sigma) bucket.inBand += 1;
      perArm.set(arm, bucket);
    }
    expect(perArm.size).toBe(3);
    for (const [arm, bucket] of perArm) {
      expect(bucket.total, `arm ${arm} has stars`).toBeGreaterThan(1000);
      expect(bucket.inBand / bucket.total, `arm ${arm} share within ±2σ`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("lays every arm star out at or beyond the core's edge — the radius the step re-seeds at", () => {
    // Round 1: arm stars were laid from 0.03 outward while the step re-seeded
    // anything inside the core edge (0.06), so one in eight jumped to the rim
    // on the first frame. Layout and step now read ONE floor.
    const settings = settingsWith();
    const field = generateGalaxyField(settings);
    const floor = galaxyArmFloor(settings);
    expect(floor).toBeGreaterThan(0.03);
    let armStars = 0;
    for (let i = 0; i < field.count; i++) {
      if (!isArmStar(field, i)) continue;
      armStars += 1;
      expect(field.radius[i]).toBeGreaterThanOrEqual(floor);
      expect(field.radius[i]).toBeLessThan(1);
    }
    expect(armStars).toBeGreaterThan(2000);
  });

  it("puts the centre cluster inside the core radius, and gives it no arm", () => {
    const settings = settingsWith();
    const field = generateGalaxyField(settings);
    const coreRadius = galaxyCoreRadius(settings.coreSize);
    let coreStars = 0;
    for (let i = 0; i < field.count; i++) {
      if (field.arm[i] !== GALAXY_CORE_ARM) continue;
      coreStars += 1;
      expect(Math.hypot(field.x[i], field.y[i])).toBeLessThanOrEqual(coreRadius + 1e-6);
    }
    expect(coreStars).toBeGreaterThan(0);
    expect(generateGalaxyField(settingsWith({ coreStrength: "0" })).arm.includes(GALAXY_CORE_ARM)).toBe(false);
  });

  it("gives a core of size 0 no stars, and a smaller core fewer stars, rather than stacking the cluster on one point", () => {
    const coreStars = (coreSize: string) =>
      Array.from(generateGalaxyField(settingsWith({ coreSize })).arm).filter((arm) => arm === GALAXY_CORE_ARM).length;
    expect(coreStars("0")).toBe(0);
    expect(coreStars("6")).toBeGreaterThan(0);
    expect(coreStars("6")).toBeLessThan(coreStars("12"));
    // At and above the default size the count is coreStrength's alone.
    expect(coreStars("40")).toBe(coreStars("12"));
  });

  it("pins the flare stars on the spine, larger and at full brightness", () => {
    const settings = settingsWith({ flareStars: "5" });
    const field = generateGalaxyField(settings);
    for (let i = 0; i < 5; i++) {
      expect(field.flare[i]).toBe(1);
      expect(field.brightness[i]).toBe(1);
      expect(field.size[i]).toBeGreaterThan(settings.starSize * 2);
      const radius = Math.hypot(field.x[i], field.y[i]);
      const offset = wrap(screenAngle(field, i) - galaxySpineAngle(radius, field.arm[i], settings));
      expect(Math.abs(offset)).toBeLessThan(1e-3);
    }
    expect(field.flare[5]).toBe(0);
  });

  it("never pins a flare star inside the core, whatever the core size", () => {
    for (const coreSize of ["12", "14", "50", "100"]) {
      const settings = settingsWith({ coreSize, flareStars: "12" });
      const field = generateGalaxyField(settings);
      const coreRadius = galaxyCoreRadius(settings.coreSize);
      for (let i = 0; i < 12; i++) {
        expect(field.flare[i]).toBe(1);
        expect(field.radius[i], `flare ${i} at coreSize ${coreSize}`).toBeGreaterThan(coreRadius);
      }
    }
  });
});

describe("stepGalaxyField", () => {
  it("spins the innermost star through a larger angle than the outermost when differential > 0", () => {
    // flowSpeed 0 so the only things moving a star are the pattern's spin
    // and the differential; the angle is read as drawn (from x/y), because
    // that is what "advanced by an angle" means on screen.
    const settings = settingsWith({ differential: "50", flowSpeed: "0", particleCount: "2000" });
    const field = generateGalaxyField(settings);
    const inner = indexOfExtremeRadius(field, "min");
    const outer = indexOfExtremeRadius(field, "max");
    const innerBefore = screenAngle(field, inner);
    const outerBefore = screenAngle(field, outer);
    stepGalaxyField(field, FRAME, settings);
    const innerDelta = wrap(screenAngle(field, inner) - innerBefore);
    const outerDelta = wrap(screenAngle(field, outer) - outerBefore);
    expect(innerDelta).toBeGreaterThan(0);
    expect(outerDelta).toBeGreaterThan(0);
    // A real margin, not a bare "greater than": angles live in float32, so
    // two EQUAL deltas read back unequal by rounding, and a bare comparison
    // passed with the differential forced to zero (found by break-testing).
    // At differential 50 the innermost arm star turns about two and a half
    // times as fast as the rim, spin included; twice is the bar.
    expect(innerDelta).toBeGreaterThan(outerDelta * 2);
  });

  it("spins every star through the same angle when differential is 0", () => {
    const settings = settingsWith({ differential: "0", flowSpeed: "0", particleCount: "2000" });
    const field = generateGalaxyField(settings);
    const inner = indexOfExtremeRadius(field, "min");
    const outer = indexOfExtremeRadius(field, "max");
    const innerBefore = screenAngle(field, inner);
    const outerBefore = screenAngle(field, outer);
    stepGalaxyField(field, FRAME, settings);
    const innerDelta = wrap(screenAngle(field, inner) - innerBefore);
    const outerDelta = wrap(screenAngle(field, outer) - outerBefore);
    expect(innerDelta).toBeGreaterThan(0);
    expect(innerDelta).toBeCloseTo(outerDelta, 5);
  });

  it("turns the other way for counterclockwise", () => {
    const settings = settingsWith({ spinDirection: "counterclockwise", flowSpeed: "0", particleCount: "1000" });
    const field = generateGalaxyField(settings);
    const i = indexOfExtremeRadius(field, "max");
    const before = screenAngle(field, i);
    stepGalaxyField(field, FRAME, settings);
    expect(wrap(screenAngle(field, i) - before)).toBeLessThan(0);
  });

  it("moves no arm star more than one frame's flow on the first step — nothing jumps to the rim", () => {
    // The round-1 defect: 374 arm stars sat at exactly radius 1 after one step.
    const settings = settingsWith();
    const field = generateGalaxyField(settings);
    const before = Float32Array.from(field.radius);
    stepGalaxyField(field, FRAME, settings);
    // flowSpeed 100 is a 20 s rim-to-core trip; at 30, one frame at the rim
    // is well under a thousandth of the disc.
    const oneFrameAtMost = 0.002;
    let atRim = 0;
    for (let i = 0; i < field.count; i++) {
      if (!isArmStar(field, i)) continue;
      const moved = before[i] - field.radius[i];
      expect(moved, `star ${i} moved inward`).toBeGreaterThan(0);
      expect(moved, `star ${i} moved one frame's worth`).toBeLessThan(oneFrameAtMost);
      if (field.radius[i] >= 1) atRim += 1;
    }
    expect(atRim).toBe(0);
  });

  it("keeps the spiral's shape for two minutes at the DEFAULT settings — spin, flow and differential all on", () => {
    // Round 1 measured 0.955 → 0.390 over 60 s: a spiral whose inner stars
    // simply turn faster winds itself away. The pattern now turns rigidly and
    // the differential is streaming ALONG the arm, which leaves the shape alone.
    const settings = settingsWith();
    expect(settings.spinSpeed).toBeGreaterThan(0);
    expect(settings.flowSpeed).toBeGreaterThan(0);
    expect(settings.differential).toBeGreaterThan(0);
    const field = generateGalaxyField(settings);
    const atStart = shareOnArm(field, settings);
    expect(atStart).toBeGreaterThanOrEqual(0.9);
    for (let frame = 0; frame < 60 * 120; frame++) stepGalaxyField(field, FRAME, settings);
    expect(field.spin).toBeGreaterThan(0);
    expect(shareOnArm(field, settings)).toBeGreaterThanOrEqual(0.9);
  });

  it("carries arm stars inward along their arm, so the spiral survives a minute of full-speed flow", () => {
    const settings = settingsWith({ flowSpeed: "100", spinSpeed: "0", particleCount: "3000", arms: "2" });
    const field = generateGalaxyField(settings);
    const radiusBefore = Float32Array.from(field.radius);
    for (let frame = 0; frame < 60 * 60; frame++) stepGalaxyField(field, FRAME, settings);
    let moved = 0;
    let armStars = 0;
    for (let i = 0; i < field.count; i++) {
      if (!isArmStar(field, i)) continue;
      armStars += 1;
      if (field.radius[i] !== radiusBefore[i]) moved += 1;
      const radius = Math.hypot(field.x[i], field.y[i]);
      expect(radius).toBeLessThanOrEqual(1 + 1e-6);
      expect(radius).toBeGreaterThan(0);
    }
    expect(moved).toBe(armStars);
    expect(shareOnArm(field, settings)).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps the same radial density after five minutes of flow — the still frame and the running page are one galaxy", () => {
    // Round 1 measured the centre-packed layout sloshing into a hollow disc
    // (mean radius 0.39 → 0.57 → 0.47). Stars now stream at the inverse of
    // the layout's density, so the layout is the flow's own steady state.
    const settings = settingsWith();
    const field = generateGalaxyField(settings);
    const atStart = radialHistogram(field);
    // The inner bands hold more stars than the outer — the shape being kept.
    expect(atStart[0]).toBeGreaterThan(atStart[4] * 1.5);
    // 50 ms is the frame-time clamp slice 2 applies; 6,000 of them is 300 s.
    for (let frame = 0; frame < 6000; frame++) stepGalaxyField(field, 0.05, settings);
    const atEnd = radialHistogram(field);
    for (let bin = 0; bin < 5; bin++) {
      expect(Math.abs(atEnd[bin] - atStart[bin]) / atStart[bin], `band ${bin}: ${atStart[bin]} → ${atEnd[bin]}`).toBeLessThanOrEqual(0.15);
    }
  });

  it("re-seeds a star that reaches the core at the rim of the same arm, deterministically", () => {
    const settings = settingsWith({ flowSpeed: "100", spinSpeed: "0", particleCount: "1000" });
    const a = generateGalaxyField(settings);
    const b = generateGalaxyField(settings);
    const armBefore = Uint8Array.from(a.arm);
    // 100 → a rim-to-centre trip takes 20 s; 30 s guarantees every arm star was re-seeded at least once.
    for (let frame = 0; frame < 60 * 30; frame++) {
      stepGalaxyField(a, FRAME, settings);
      stepGalaxyField(b, FRAME, settings);
    }
    expect(bytesOf(a).equals(bytesOf(b))).toBe(true);
    const floor = galaxyArmFloor(settings);
    for (let i = 0; i < a.count; i++) {
      if (!isArmStar(a, i)) continue;
      expect(a.radius[i]).toBeGreaterThan(floor);
      expect(a.arm[i]).toBe(armBefore[i]);
    }
  });

  it("leaves flare stars and the core cluster where they are under flow", () => {
    const settings = settingsWith({ flowSpeed: "100", spinSpeed: "0", flareStars: "4" });
    const field = generateGalaxyField(settings);
    const before = Float32Array.from(field.radius);
    for (let frame = 0; frame < 120; frame++) stepGalaxyField(field, FRAME, settings);
    for (let i = 0; i < field.count; i++) {
      if (!isArmStar(field, i)) expect(field.radius[i]).toBe(before[i]);
    }
  });

  it("advances the twinkle phase and keeps it inside one turn, even when one step is several turns", () => {
    const settings = settingsWith({ twinkle: "100", spinSpeed: "0", flowSpeed: "0", particleCount: "500" });
    const field = generateGalaxyField(settings);
    const before = Float32Array.from(field.twinklePhase);
    // twinkle 100 is one turn per second; a tab coming back from the
    // background can hand the step several seconds at once.
    stepGalaxyField(field, 2.6, settings);
    let changed = 0;
    for (let i = 0; i < field.count; i++) {
      if (field.twinklePhase[i] !== before[i]) changed += 1;
      expect(field.twinklePhase[i]).toBeGreaterThanOrEqual(0);
      expect(field.twinklePhase[i]).toBeLessThan(TWO_PI);
    }
    expect(changed).toBeGreaterThan(field.count * 0.99);
  });

  it("folds the pattern's spin into one turn, so a page left running for a day keeps its precision", () => {
    const settings = settingsWith({ spinSpeed: "100", flowSpeed: "0", differential: "0", particleCount: "500" });
    const field = generateGalaxyField(settings);
    // spinSpeed 100 is a turn every ten seconds; 3,600 one-second steps is an hour and 360 turns.
    for (let s = 0; s < 3600; s++) stepGalaxyField(field, 1, settings);
    expect(field.spin).toBeGreaterThanOrEqual(0);
    expect(field.spin).toBeLessThan(TWO_PI);
  });

  it("ignores a non-finite or negative frame time rather than writing NaN into the field", () => {
    const settings = settingsWith({ particleCount: "500" });
    const field = generateGalaxyField(settings);
    const before = bytesOf(field);
    stepGalaxyField(field, Number.NaN, settings);
    stepGalaxyField(field, -1, settings);
    expect(bytesOf(field).equals(before)).toBe(true);
  });
});

describe("projectGalaxyField", () => {
  it("preserves every star's distance from the centre at yaw 0 and pitch 0", () => {
    const settings = settingsWith({ particleCount: "2000" });
    const field = generateGalaxyField(settings);
    const out = createGalaxyProjection(field.count);
    projectGalaxyField(field, 0, 0, 1280, 720, out);
    expect(out.scale).toBeGreaterThan(0);
    for (let i = 0; i < field.count; i++) {
      const fieldRadius = Math.hypot(field.x[i], field.y[i]);
      const screenRadius = Math.hypot(out.x[i] - 640, out.y[i] - 360) / out.scale;
      expect(Math.abs(screenRadius - fieldRadius)).toBeLessThan(1e-4);
    }
  });

  it("collapses y toward 0 for every star at a pitch of π/2", () => {
    const settings = settingsWith({ particleCount: "2000" });
    const field = generateGalaxyField(settings);
    const flat = createGalaxyProjection(field.count);
    const tilted = createGalaxyProjection(field.count);
    projectGalaxyField(field, 0, 0, 1000, 1000, flat);
    projectGalaxyField(field, 0, Math.PI / 2, 1000, 1000, tilted);
    let flatSum = 0;
    let tiltedSum = 0;
    for (let i = 0; i < field.count; i++) {
      const before = Math.abs(flat.y[i] - 500);
      const after = Math.abs(tilted.y[i] - 500);
      flatSum += before;
      tiltedSum += after;
      // The disc is thin: edge-on, no star sits more than a sliver off the centre line.
      expect(after).toBeLessThan(0.2 * tilted.scale);
    }
    expect(tiltedSum).toBeLessThan(flatSum * 0.1);
  });

  it("rotates about the vertical axis for yaw, leaving y alone", () => {
    const settings = settingsWith({ particleCount: "500" });
    const field = generateGalaxyField(settings);
    const flat = createGalaxyProjection(field.count);
    const yawed = createGalaxyProjection(field.count);
    projectGalaxyField(field, 0, 0, 800, 600, flat);
    projectGalaxyField(field, Math.PI / 3, 0, 800, 600, yawed);
    let xMoved = 0;
    for (let i = 0; i < field.count; i++) {
      expect(Math.abs(yawed.y[i] - flat.y[i])).toBeLessThan(1e-3);
      if (Math.abs(yawed.x[i] - flat.x[i]) > 1e-3) xMoved += 1;
    }
    expect(xMoved).toBeGreaterThan(field.count * 0.9);
  });

  it("says how many stars it wrote: the field's count, or fewer when the output is smaller", () => {
    // Observable through `out.count` — a typed array drops an out-of-range
    // write silently, so the round-1 version of this test could not fail.
    const field = generateGalaxyField(settingsWith({ particleCount: "500" }));
    const small = createGalaxyProjection(10);
    projectGalaxyField(field, 0, 0, 100, 100, small);
    expect(small.count).toBe(10);
    const large = createGalaxyProjection(800);
    large.x.fill(-1);
    projectGalaxyField(field, 0, 0, 100, 100, large);
    expect(large.count).toBe(500);
    // The tail past the field is untouched, which is why a renderer loops to `count`.
    expect(large.x[500]).toBe(-1);
    expect(large.x[499]).not.toBe(-1);
  });
});

describe("a frame allocates nothing", () => {
  it("step and project hand back the same arrays on every one of 1,000 calls over a 4,000-star field", () => {
    const settings = settingsWith({ particleCount: "4000" });
    const field = generateGalaxyField(settings);
    const out = createGalaxyProjection(field.count);
    const arrays = fieldArrays(field);
    expect(arrays.length).toBe(12);
    const outArrays = [out.x, out.y, out.depth];
    for (let frame = 0; frame < 1000; frame++) {
      const stepped = stepGalaxyField(field, FRAME, settings);
      const projected = projectGalaxyField(field, frame * 0.01, 0.2, 1440, 900, out);
      expect(stepped).toBe(field);
      expect(projected).toBe(out);
      const after = fieldArrays(field);
      for (let k = 0; k < arrays.length; k++) expect(after[k]).toBe(arrays[k]);
      expect(out.x).toBe(outArrays[0]);
      expect(out.y).toBe(outArrays[1]);
      expect(out.depth).toBe(outArrays[2]);
    }
    // And nothing in the field went non-finite along the way.
    for (let i = 0; i < field.count; i++) {
      expect(Number.isFinite(field.x[i])).toBe(true);
      expect(Number.isFinite(out.x[i])).toBe(true);
    }
  });
});

describe("scaleGalaxyCount", () => {
  it("never returns more than requested, and halves on the low tier", () => {
    expect(scaleGalaxyCount(4000, GALAXY_REFERENCE_AREA_PX, "high")).toBe(4000);
    expect(scaleGalaxyCount(4000, GALAXY_REFERENCE_AREA_PX, "mid")).toBe(2800);
    expect(scaleGalaxyCount(4000, GALAXY_REFERENCE_AREA_PX, "low")).toBe(2000);
    expect(scaleGalaxyCount(4000, GALAXY_REFERENCE_AREA_PX * 100, "high")).toBe(4000);
  });

  it("scales with the square root of the area, and keeps a floor unless fewer were asked for", () => {
    expect(scaleGalaxyCount(4000, GALAXY_REFERENCE_AREA_PX / 4, "high")).toBe(2000);
    expect(scaleGalaxyCount(4000, 1, "high")).toBe(GALAXY_COUNT_FLOOR);
    expect(scaleGalaxyCount(50, 1, "low")).toBe(50);
    expect(scaleGalaxyCount(0, 1, "low")).toBe(0);
  });

  it("does not penalise an unmeasured area", () => {
    expect(scaleGalaxyCount(3000, 0, "high")).toBe(3000);
    expect(scaleGalaxyCount(3000, Number.NaN, "high")).toBe(3000);
  });
});

describe("readDeviceTier", () => {
  it("reads three tiers from cores and memory, with data-saver winning", () => {
    expect(readDeviceTier({ hardwareConcurrency: 10, deviceMemory: 8 })).toBe("high");
    expect(readDeviceTier({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe("mid");
    expect(readDeviceTier({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe("mid");
    expect(readDeviceTier({ hardwareConcurrency: 2, deviceMemory: 8 })).toBe("low");
    expect(readDeviceTier({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe("low");
    expect(readDeviceTier({ hardwareConcurrency: 16, deviceMemory: 16, saveData: true })).toBe("low");
  });

  it("caps a browser that hides memory at mid — Safari on a six-core iPhone is not a high-tier desktop", () => {
    expect(readDeviceTier({})).toBe("mid");
    expect(readDeviceTier({ hardwareConcurrency: null, deviceMemory: undefined })).toBe("mid");
    // Safari: cores reported, deviceMemory hidden on every device.
    expect(readDeviceTier({ hardwareConcurrency: 6 })).toBe("mid");
    expect(readDeviceTier({ hardwareConcurrency: 8 })).toBe("mid");
    // Two cores is low whatever else is hidden.
    expect(readDeviceTier({ hardwareConcurrency: 2 })).toBe("low");
  });
});
