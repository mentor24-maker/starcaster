import { describe, expect, it, vi } from "vitest";
import {
  GALAXY_ARM_FLOOR_MAX,
  GALAXY_DAMPING,
  GALAXY_DRAG_RADIANS_PER_PX,
  GALAXY_KEY_STEP,
  GALAXY_PITCH_LIMIT,
  GALAXY_TILT_PITCH,
  GALAXY_TILT_YAW,
  createGalaxyView,
  dragGalaxyView,
  easeToward,
  resolveGalaxyInteraction,
  stepGalaxyView,
  stepGalaxyViewByKey,
  tiltGalaxyView,
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
  galaxyTwist,
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

/**
 * One limit for the whole file. Four of these tests step thousands of
 * frames over thousands of stars; two of them were given 30 s by hand and
 * two neighbours of the same cost were left on vitest's default 5 s, which
 * a loaded CI runner can cross (round-2 review, item 3). A per-test guess
 * is how the next one gets missed.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * The seeds and star counts the first-frame and differential guards are
 * proven over. Round 2 found both passing only for seed 27 at exactly
 * 4,000 stars — red on 823 of 1,200 seed × count pairs — and slice 2 will
 * spread a scaled count (2,800 on a mid-tier device) into the settings, at
 * which point a seed-lucky bar goes red on correct code and gets loosened.
 * Seeds 2, 3, 4, 6, 7 and 145 are the ones the review named.
 */
const SEED_SWEEP = [...Array.from({ length: 20 }, (_, i) => i + 1), 27, 145];
const COUNT_SWEEP = ["2000", "2800", "4000", "8000"];
/**
 * Further than one frame carries any star at the defaults. flowSpeed 100 is
 * a 20 s rim-to-core trip; at the defaults one frame at the rim is about
 * 6e-4 of the disc, and at the floor a quarter of that. Round 1's defect was
 * stars born 0.03 BELOW the floor — fifteen times this margin.
 */
const ONE_FRAME_REACH = 0.002;

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
 * EVERY array the field owns, discovered rather than listed. The byte
 * comparison, the length check and the same-arrays test all read this, so a
 * thirteenth array added to the field is covered by all three the moment it
 * exists — the round-1 review found `bytesOf` silently skipping three of
 * twelve, and round 2 pointed out that a hand-typed list would skip the
 * next one the same way.
 */
function fieldArrays(field: GalaxyField): (Float32Array | Uint8Array)[] {
  return Object.values(field).filter((value): value is Float32Array | Uint8Array => ArrayBuffer.isView(value));
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

/**
 * The innermost or outermost ARM star — and for "min", the innermost one
 * that one frame's slide cannot carry past the floor. The very innermost
 * star is by definition the one closest to the floor, so with any streaming
 * on it is the likeliest star in the field to be re-seeded during the one
 * frame being measured, and its "advance" is then a jump to the rim (round-2
 * review: 44 of 200 seeds). A star measured for streaming must be one that
 * streams.
 */
function indexOfExtremeRadius(field: GalaxyField, pick: "min" | "max", settings: GalaxySettings): number {
  const minimum = pick === "min" ? galaxyArmFloor(settings) + ONE_FRAME_REACH : 0;
  let index = -1;
  for (let i = 0; i < field.count; i++) {
    // Arm stars only: the core does not flow and its tiny radii are held at a
    // floor for spin, which would make "smallest radius" a different question.
    if (!isArmStar(field, i) || field.radius[i] < minimum) continue;
    if (index < 0) {
      index = i;
      continue;
    }
    const better = pick === "min" ? field.radius[i] < field.radius[index] : field.radius[i] > field.radius[index];
    if (better) index = i;
  }
  return index;
}

/** Arm stars that went OUTWARD in a step — the only way that happens is a re-seed at the rim. */
function reseededIndexes(before: Float32Array, field: GalaxyField): number[] {
  const out: number[] = [];
  for (let i = 0; i < field.count; i++) {
    if (isArmStar(field, i) && field.radius[i] > before[i]) out.push(i);
  }
  return out;
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

function meanArmRadius(field: GalaxyField): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < field.count; i++) {
    if (!isArmStar(field, i)) continue;
    sum += field.radius[i];
    n += 1;
  }
  return n ? sum / n : 0;
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

  it("wraps the visible arm band — floor to rim — exactly `turns` times, whatever the core size", () => {
    // The twist used to be anchored at the spiral's mathematical origin
    // (0.03), so a fifth of the turns lay inside the core where no arm star
    // is: 1.89 visible wraps at the default core, 0.46 at coreSize 100,
    // while the setting said 2.35 (round-2 review, item 7). Anchored at the
    // floor, the Turns setting describes the spiral a visitor can see.
    for (const coreSize of ["0", "12", "60", "100"]) {
      for (const turns of ["0.5", "2.35", "4"]) {
        const settings = settingsWith({ coreSize, turns });
        const floor = galaxyArmFloor(settings);
        expect(floor).toBeLessThanOrEqual(GALAXY_ARM_FLOOR_MAX);
        const sweep = Math.abs(galaxySpineAngle(1, 0, settings) - galaxySpineAngle(floor, 0, settings));
        expect(sweep, `coreSize ${coreSize}, turns ${turns}`).toBeCloseTo(Number(turns) * TWO_PI, 6);
      }
    }
  });
});

describe("stepGalaxyField", () => {
  it("spins the innermost star through a larger angle than the outermost when differential > 0 — on every seed and count", () => {
    // flowSpeed 0 so the only things moving a star are the pattern's spin
    // and the differential; the angle is read as drawn (from x/y), because
    // that is what "advanced by an angle" means on screen.
    //
    // Round 2: this picked the star of minimum radius, and with differential
    // 50 the slide is > 0 even at flowSpeed 0 — so on 44 of 200 seeds that
    // exact star was re-seeded to the rim during the measured frame and
    // `innerDelta` was a random jump (seed 145 read −0.072). The picker now
    // skips stars within one frame of the floor, the step is checked to have
    // streamed the chosen star rather than re-seeded it, and the bar is
    // proven over the sweep rather than one lucky seed.
    for (const count of COUNT_SWEEP) {
      for (const seed of SEED_SWEEP) {
        const label = `seed ${seed}, ${count} stars`;
        const settings = settingsWith({ seed: String(seed), differential: "50", flowSpeed: "0", particleCount: count });
        const field = generateGalaxyField(settings);
        const inner = indexOfExtremeRadius(field, "min", settings);
        const outer = indexOfExtremeRadius(field, "max", settings);
        const innerRadiusBefore = field.radius[inner];
        const innerBefore = screenAngle(field, inner);
        const outerBefore = screenAngle(field, outer);
        stepGalaxyField(field, FRAME, settings);
        // The measured star streamed inward; it was not re-seeded.
        expect(field.radius[inner], `${label}: the innermost star streamed`).toBeLessThan(innerRadiusBefore);
        const innerDelta = wrap(screenAngle(field, inner) - innerBefore);
        const outerDelta = wrap(screenAngle(field, outer) - outerBefore);
        expect(innerDelta, `${label}: inner advance`).toBeGreaterThan(0);
        expect(outerDelta, `${label}: outer advance`).toBeGreaterThan(0);
        // A real margin, not a bare "greater than": angles live in float32, so
        // two EQUAL deltas read back unequal by rounding, and a bare comparison
        // passed with the differential forced to zero (found by break-testing).
        // At differential 50 the innermost arm star turns about two and a half
        // times as fast as the rim, spin included; twice is the bar.
        expect(innerDelta, `${label}: inner turns at least twice the rim`).toBeGreaterThan(outerDelta * 2);
      }
    }
  });

  it("spins every star through the same angle when differential is 0 — on every seed and count", () => {
    for (const count of COUNT_SWEEP) {
      for (const seed of SEED_SWEEP) {
        const label = `seed ${seed}, ${count} stars`;
        const settings = settingsWith({ seed: String(seed), differential: "0", flowSpeed: "0", particleCount: count });
        const field = generateGalaxyField(settings);
        const inner = indexOfExtremeRadius(field, "min", settings);
        const outer = indexOfExtremeRadius(field, "max", settings);
        const innerBefore = screenAngle(field, inner);
        const outerBefore = screenAngle(field, outer);
        stepGalaxyField(field, FRAME, settings);
        const innerDelta = wrap(screenAngle(field, inner) - innerBefore);
        const outerDelta = wrap(screenAngle(field, outer) - outerBefore);
        expect(innerDelta, `${label}: inner advance`).toBeGreaterThan(0);
        expect(innerDelta, `${label}: inner equals outer`).toBeCloseTo(outerDelta, 5);
      }
    }
  });

  it("turns the other way for counterclockwise", () => {
    const settings = settingsWith({ spinDirection: "counterclockwise", flowSpeed: "0", particleCount: "1000" });
    const field = generateGalaxyField(settings);
    const i = indexOfExtremeRadius(field, "max", settings);
    const before = screenAngle(field, i);
    stepGalaxyField(field, FRAME, settings);
    expect(wrap(screenAngle(field, i) - before)).toBeLessThan(0);
  });

  it("re-seeds on the first step only a star one frame's flow carries past the floor — nothing born inside it jumps to the rim, on any seed or count", () => {
    // The round-1 defect: 374 arm stars sat at exactly radius 1 after one
    // step, because they were BORN 0.03 below the floor the step re-seeds at.
    //
    // Round 2: the guard demanded ZERO stars at the rim and passed only for
    // seed 27 at 4,000 stars. The engine's own design re-seeds a star the
    // moment it crosses the floor, and there is almost always one sitting
    // within a frame's slide of it at t=0 — measured red on 823 of 1,200
    // seed × count pairs. So the test tells the two cases apart: a star that
    // went outward must have started AT OR ABOVE the floor and within one
    // frame's reach of it (round 1's stars were fifteen reaches below); every
    // other star moved inward by less than a frame. Violations are collected
    // as plain strings and asserted once per sweep entry, so a sweep of
    // 88 fields is fast and a failure names the star.
    for (const count of COUNT_SWEEP) {
      for (const seed of SEED_SWEEP) {
        const label = `seed ${seed}, ${count} stars`;
        const settings = settingsWith({ seed: String(seed), particleCount: count });
        const field = generateGalaxyField(settings);
        const floor = galaxyArmFloor(settings);
        const before = Float32Array.from(field.radius);
        stepGalaxyField(field, FRAME, settings);
        const violations: string[] = [];
        let armStars = 0;
        let reseeded = 0;
        for (let i = 0; i < field.count; i++) {
          if (!isArmStar(field, i)) continue;
          armStars += 1;
          if (field.radius[i] > before[i]) {
            reseeded += 1;
            if (field.radius[i] !== 1) violations.push(`star ${i} went outward to ${field.radius[i]}, not to the rim`);
            if (before[i] < floor) violations.push(`star ${i} was born at ${before[i]}, inside the floor ${floor}`);
            if (before[i] - floor >= ONE_FRAME_REACH) violations.push(`star ${i} re-seeded from ${before[i]}, more than a frame above the floor`);
          } else {
            const moved = before[i] - field.radius[i];
            if (!(moved > 0)) violations.push(`star ${i} did not move inward (${moved})`);
            if (!(moved < ONE_FRAME_REACH)) violations.push(`star ${i} moved ${moved}, more than one frame's worth`);
          }
        }
        expect(violations, label).toEqual([]);
        expect(armStars, label).toBeGreaterThan(Number(count) * 0.5);
        // The steady-state trickle is a star or two a frame; hundreds is the defect.
        expect(reseeded, `${label}: re-seeded on the first frame`).toBeLessThan(armStars * 0.01);
      }
    }
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

  it("keeps the same radial density through five minutes of flow — the still frame and the running page are one galaxy", () => {
    // Round 1 measured the centre-packed layout sloshing into a hollow disc
    // (mean radius 0.39 → 0.57 → 0.47). Stars now stream at the inverse of
    // the layout's density, so the layout is the flow's own steady state.
    //
    // Sampled EVERY five seconds, not once at the end: under constant-speed
    // flow the profile circulates with a ~41 s period, and a single sample
    // at 300 s landed within 15% of frame 0 by coincidence (break-tested).
    // 8,000 stars so that the sampling noise in the smallest band stays
    // well inside the bar; the seed is fixed, so the reading is repeatable.
    const settings = settingsWith({ particleCount: "8000" });
    const field = generateGalaxyField(settings);
    const atStart = radialHistogram(field);
    const meanAtStart = meanArmRadius(field);
    // The inner bands hold more stars than the outer — the shape being kept.
    expect(atStart[0]).toBeGreaterThan(atStart[4] * 1.5);
    // 50 ms is the frame-time clamp slice 2 applies; 100 of them is 5 s, 60 samples is 300 s.
    for (let sample = 1; sample <= 60; sample++) {
      for (let frame = 0; frame < 100; frame++) stepGalaxyField(field, 0.05, settings);
      const now = radialHistogram(field);
      for (let bin = 0; bin < 5; bin++) {
        expect(Math.abs(now[bin] - atStart[bin]) / atStart[bin], `band ${bin} at ${sample * 5} s: ${atStart[bin]} → ${now[bin]}`).toBeLessThanOrEqual(0.15);
      }
      expect(Math.abs(meanArmRadius(field) - meanAtStart), `mean radius at ${sample * 5} s`).toBeLessThan(0.03);
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
    // Every star, not "most": measured, 0 of 500 phases are unchanged at dt
    // 2.6, and a 99% bar would let 80 stars in an 8,000-star field stop
    // twinkling while the test named for it stayed green (round-2 review).
    expect(changed).toBe(field.count);
  });

  it("clamps a hand-built turns of 0 instead of dividing the differential by it — flow neither explodes nor dies", () => {
    // Settings built by hand skip readGalaxySettings, and `turns` is the
    // divisor under the differential. Unclamped, turns 0 made the slide
    // Infinity (3,069 of 4,000 arm stars re-seeded in ONE frame) and, with
    // the spin off, 0/0 — a NaN that quietly stopped every star.
    const floor = galaxyArmFloor(settingsWith());
    expect(galaxyTwist(0, floor)).toBe(galaxyTwist(GALAXY_SETTING_RANGES.turns.min, floor));
    expect(galaxyTwist(Number.NaN, floor)).toBe(galaxyTwist(2.35, floor));

    const explosive = { ...settingsWith({ spinSpeed: "100", differential: "100", flowSpeed: "0" }), turns: 0 };
    const field = generateGalaxyField(explosive);
    const before = Float32Array.from(field.radius);
    stepGalaxyField(field, FRAME, explosive);
    let armStars = 0;
    for (let i = 0; i < field.count; i++) if (isArmStar(field, i)) armStars += 1;
    expect(reseededIndexes(before, field).length).toBeLessThan(armStars * 0.01);

    const dead = { ...settingsWith({ spinSpeed: "0", differential: "0", flowSpeed: "50" }), turns: 0 };
    const still = generateGalaxyField(dead);
    const radiiBefore = Float32Array.from(still.radius);
    stepGalaxyField(still, FRAME, dead);
    for (let i = 0; i < still.count; i++) {
      if (!isArmStar(still, i)) continue;
      expect(Number.isFinite(still.x[i])).toBe(true);
      expect(still.radius[i]).toBeLessThan(radiiBefore[i]);
    }
  });

  it("never streams faster than flowSpeed 100 — the slider extremes cannot beat the twenty-second trip", () => {
    // The differential is scaled by 1/twist so its ANGULAR gain at the rim
    // is stable, which makes its RADIAL speed swing 8× with `turns`: at
    // turns 0.5, spin 100, differential 100 and flowSpeed 0 the rim-to-core
    // trip was 1.08 s — every arm star popping in at the rim more than once
    // a second (round-2 review, item 8). The total slide is now capped at the
    // flow knob's own maximum. Same seed and count, so the star of largest
    // radius — the one that moves furthest per frame — is the same star.
    const ceiling = settingsWith({ flowSpeed: "100", spinSpeed: "0", differential: "0", particleCount: "2000" });
    const extreme = settingsWith({ flowSpeed: "0", spinSpeed: "100", differential: "100", turns: "0.5", particleCount: "2000" });
    const largestMove = (settings: GalaxySettings): number => {
      const field = generateGalaxyField(settings);
      const before = Float32Array.from(field.radius);
      stepGalaxyField(field, FRAME, settings);
      let largest = 0;
      for (let i = 0; i < field.count; i++) {
        if (isArmStar(field, i) && field.radius[i] < before[i]) largest = Math.max(largest, before[i] - field.radius[i]);
      }
      return largest;
    };
    const ceilingMove = largestMove(ceiling);
    expect(ceilingMove).toBeGreaterThan(0);
    expect(largestMove(extreme)).toBeLessThanOrEqual(ceilingMove * (1 + 1e-5));
    // And the cap is a cap, not a switch: at the defaults the differential still adds to the flow.
    expect(largestMove(settingsWith({ spinSpeed: "10", differential: "50", flowSpeed: "30" }))).toBeGreaterThan(
      largestMove(settingsWith({ spinSpeed: "10", differential: "0", flowSpeed: "30" }))
    );
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

  it("refuses a non-finite count out loud rather than handing back empty arrays", () => {
    // Same hole as generateGalaxyField's: a typed array of length NaN is
    // silently empty, and `out.count` 0 looks like a field with no stars.
    expect(() => createGalaxyProjection(Number.NaN)).toThrow(RangeError);
    expect(() => createGalaxyProjection(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("a frame keeps its arrays", () => {
  // What this proves is IDENTITY: step and project write into the arrays
  // they were given and hand the same objects back, so a renderer can hold
  // references. It cannot see a scratch allocation inside a step; slice 2
  // measures the heap over real frames (round 2 measured 18 bytes a frame).
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

describe("interaction (Galaxy module 3/6, task 86bc7f5hh)", () => {
  it("easeToward never overshoots, from either side, even on a huge frame", () => {
    for (const [from, to] of [[0, 1], [1, 0], [-2, 3], [5, -5]]) {
      let v = from;
      for (const dt of [FRAME, 0.05, 0.5, 10]) {
        const next = easeToward(v, to, GALAXY_DAMPING, dt);
        const gapBefore = to - v;
        const gapAfter = to - next;
        // Same sign (or zero) and strictly no bigger: never past the target.
        expect(gapAfter * gapBefore).toBeGreaterThanOrEqual(0);
        expect(Math.abs(gapAfter)).toBeLessThanOrEqual(Math.abs(gapBefore));
        v = next;
      }
    }
  });

  it("easeToward reaches within 1% of the target in under 1 s at damping 6", () => {
    let v = 0;
    let t = 0;
    while (Math.abs(1 - v) > 0.01 && t < 2) {
      v = easeToward(v, 1, 6, FRAME);
      t += FRAME;
    }
    expect(t).toBeLessThan(1);
  });

  it("easeToward is frame-rate independent — 60 small frames land where 1 big one does", () => {
    let small = 0;
    for (let i = 0; i < 60; i++) small = easeToward(small, 1, GALAXY_DAMPING, 1 / 60);
    expect(small).toBeCloseTo(easeToward(0, 1, GALAXY_DAMPING, 1), 10);
  });

  it("easeToward with no time or no damping does not move", () => {
    expect(easeToward(0.3, 1, GALAXY_DAMPING, 0)).toBe(0.3);
    expect(easeToward(0.3, 1, 0, FRAME)).toBe(0.3);
  });

  it("a drag turns yaw by 0.005 rad/px and clamps pitch at ±1.2", () => {
    const view = createGalaxyView();
    dragGalaxyView(view, 100, 0);
    expect(view.targetYaw).toBeCloseTo(100 * GALAXY_DRAG_RADIANS_PER_PX, 10);
    dragGalaxyView(view, -300, 0);
    expect(view.targetYaw).toBeLessThan(0);
    dragGalaxyView(view, 0, 10_000);
    expect(view.targetPitch).toBe(GALAXY_PITCH_LIMIT);
    dragGalaxyView(view, 0, -100_000);
    expect(view.targetPitch).toBe(-GALAXY_PITCH_LIMIT);
  });

  it("each arrow key steps 0.08 rad, and only arrow keys are claimed", () => {
    const view = createGalaxyView();
    expect(stepGalaxyViewByKey(view, "ArrowLeft")).toBe(true);
    expect(view.targetYaw).toBeCloseTo(-GALAXY_KEY_STEP, 10);
    expect(stepGalaxyViewByKey(view, "ArrowRight")).toBe(true);
    expect(stepGalaxyViewByKey(view, "ArrowRight")).toBe(true);
    expect(view.targetYaw).toBeCloseTo(GALAXY_KEY_STEP, 10);
    expect(stepGalaxyViewByKey(view, "ArrowDown")).toBe(true);
    expect(view.targetPitch).toBeCloseTo(GALAXY_KEY_STEP, 10);
    expect(stepGalaxyViewByKey(view, "ArrowUp")).toBe(true);
    expect(view.targetPitch).toBeCloseTo(0, 10);
    // Tab, Space, Enter must keep their usual meaning on the page.
    for (const key of ["Tab", " ", "Enter", "PageDown"]) expect(stepGalaxyViewByKey(view, key)).toBe(false);
  });

  it("tilt spans exactly 0.5 rad of yaw from the left edge to the right edge", () => {
    const view = createGalaxyView();
    tiltGalaxyView(view, 0, 400, 1280, 800);
    const left = view.targetYaw;
    tiltGalaxyView(view, 1280, 400, 1280, 800);
    expect(view.targetYaw - left).toBeCloseTo(2 * GALAXY_TILT_YAW, 10);
    expect(2 * GALAXY_TILT_YAW).toBeCloseTo(0.5, 10);
    tiltGalaxyView(view, 640, 0, 1280, 800);
    expect(view.targetYaw).toBeCloseTo(0, 10);
    expect(view.targetPitch).toBeCloseTo(-GALAXY_TILT_PITCH, 10);
  });

  it("the view eases toward its target and arrives", () => {
    const view = createGalaxyView();
    stepGalaxyViewByKey(view, "ArrowRight");
    stepGalaxyView(view, FRAME);
    expect(view.yaw).toBeGreaterThan(0);
    expect(view.yaw).toBeLessThan(GALAXY_KEY_STEP);
    for (let i = 0; i < 120; i++) stepGalaxyView(view, FRAME);
    expect(view.yaw).toBeCloseTo(GALAXY_KEY_STEP, 4);
  });

  it("an interaction the placement does not offer resolves to that placement's default", () => {
    expect(resolveGalaxyInteraction(true, undefined)).toBe("rotate");
    expect(resolveGalaxyInteraction(false, undefined)).toBe("tilt");
    expect(resolveGalaxyInteraction(true, "tilt")).toBe("rotate");
    expect(resolveGalaxyInteraction(false, "rotate")).toBe("tilt");
    expect(resolveGalaxyInteraction(true, "none")).toBe("none");
    expect(resolveGalaxyInteraction(false, "none")).toBe("none");
    expect(resolveGalaxyInteraction(false, "spin")).toBe("tilt");
  });
});
