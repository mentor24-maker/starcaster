/**
 * Galaxy field — the arithmetic behind the Galaxy module's spiral of stars.
 *
 * This file has no DOM in it, on purpose, exactly as `proximity-effects.ts`
 * is for TractorNav: an animated effect cannot be tested as pixels in this
 * repo, but the numbers that place every star, spin them and turn the whole
 * field in three dimensions CAN be held still. So they live here, as plain
 * functions over typed arrays, and the renderer (slice 2, Galaxy module 2/6)
 * calls in for every number it draws.
 *
 * Four jobs:
 *
 *   1. `generateGalaxyField(settings)` lays the stars out along logarithmic
 *      spiral arms from a SEEDED random source, so the same seed draws the
 *      same galaxy on every load (and every screenshot).
 *   2. `stepGalaxyField(field, dt, settings)` moves them one frame: the
 *      pattern turns, stars stream inward along their arm (faster the
 *      further in), and the twinkle phase advances.
 *   3. `projectGalaxyField(field, yaw, pitch, w, h, out)` rotates the flat
 *      disc in 3D and projects it to screen pixels — into arrays the caller
 *      owns, allocating nothing, because it runs sixty times a second.
 *   4. `readGalaxySettings` / `scaleGalaxyCount` / `readDeviceTier` turn the
 *      module's string settings and the visitor's device into clamped numbers.
 *
 * Since slice 3 it also holds the view a visitor turns (drag, keys, tilt),
 * and since slice 4 the intro and the scroll: every star has a seeded
 * scatter offset, and `projectGalaxyField` draws it part of the way out
 * there according to a `GalaxyMix` the runtime works out from the clock
 * and the scroll position (`galaxyIntroProgress`, `galaxyScrollDisperse`).
 *
 * THE SHAPE HOLDS. A spiral whose inner stars simply rotate faster than its
 * outer ones winds itself up: at the default settings the arms were gone in
 * a minute (round-1 review, task 86bc7f5hf). So the motion here is built
 * from the only two movements that leave a spiral's shape alone:
 *
 *   - the whole PATTERN turns rigidly at `spinSpeed` — one number, `spin`,
 *     shared by every star; and
 *   - stars stream INWARD ALONG THEIR ARM. A star sliding along a
 *     logarithmic spiral sweeps more angle per second the further in it is,
 *     which is what the eye reads as "the inside turns faster". `flowSpeed`
 *     sets that streaming directly; `differential` adds more of it in
 *     proportion to the spin.
 *
 * The spiral's handedness follows `spinDirection`, so the arms always trail
 * and inward streaming always moves WITH the spin. (With a fixed handedness
 * the inside would look faster in one direction and slower in the other.)
 *
 * And the streaming does not change the picture over time: arm stars are
 * laid out with a density that falls with radius, and the along-arm speed
 * is the inverse of that density, so the layout is the flow's own steady
 * state — a star re-seeded at the rim for every one that reaches the core,
 * and the count in every radius band constant up to sampling noise. The
 * Builder's still frame and the visitor's page a minute later are the same
 * galaxy.
 *
 * TWO SLIDERS, ONE MOTION (round-2 review, item 8). `differential` is more
 * inward streaming, scaled by the spin and by 1/twist so its ANGULAR gain at
 * the rim is stable — but the radial speed the visitor sees then swings with
 * `turns`, and at turns 0.5, spin 100 and differential 100 the rim-to-core
 * trip was 1.08 s: every arm star popping in at the rim more than once a
 * second. So the total streaming is CAPPED at flowSpeed 100's own speed
 * (`flowRimSpeedAtMax`): no slider combination beats the twenty-second trip.
 * Decision (i) of the two the review offered; the alternative was to leave
 * it for slice 2's measurement.
 *
 * `turns` COUNTS THE ARM BAND. The twist is anchored at the arm floor (the
 * core's edge), not at the spiral's mathematical origin, so the spiral a
 * visitor can see — floor to rim — wraps exactly `turns` times whatever the
 * core size. Anchored at 0.03 it wrapped 1.89 times at the default core and
 * 0.46 at coreSize 100 while the panel would have said 2.35 (round-2 review,
 * item 7). The trade, accepted: moving Core Size re-twists the spiral.
 *
 * Units: the field lives in a unit disc — radius 1 is the rim, and angles are
 * radians measured the way a canvas does (y down, so a growing angle turns
 * CLOCKWISE on screen). Nothing here knows about pixels until `project`.
 *
 * Plan: ~/Desktop/Galaxy-module-plan.md (2026-09-24). Task 86bc7f5hf.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Every module's settings are a bag of strings, so the defaults are strings
 * too. `readGalaxySettings` turns the bag into clamped numbers.
 */
export const GALAXY_SETTING_DEFAULTS: Record<string, string> = {
  seed: "27",
  particleCount: "4000",
  arms: "2",
  turns: "2.35",
  armWidth: "40",
  coreSize: "12",
  coreStrength: "66",
  flareStars: "7",
  starSize: "2",
  spinSpeed: "10",
  spinDirection: "clockwise",
  differential: "50",
  flowSpeed: "30",
  twinkle: "60"
};

/** The range every numeric setting is clamped into. Stated once, read by the test. */
export const GALAXY_SETTING_RANGES: Record<string, { min: number; max: number; integer?: boolean }> = {
  seed: { min: 0, max: 2147483647, integer: true },
  particleCount: { min: 500, max: 8000, integer: true },
  arms: { min: 1, max: 6, integer: true },
  turns: { min: 0.5, max: 4 },
  armWidth: { min: 0, max: 100 },
  coreSize: { min: 0, max: 100 },
  coreStrength: { min: 0, max: 100 },
  flareStars: { min: 0, max: 12, integer: true },
  starSize: { min: 0.5, max: 8 },
  spinSpeed: { min: 0, max: 100 },
  differential: { min: 0, max: 100 },
  flowSpeed: { min: 0, max: 100 },
  twinkle: { min: 0, max: 100 }
};

export const GALAXY_SPIN_DIRECTIONS = ["clockwise", "counterclockwise"] as const;
export type GalaxySpinDirection = (typeof GALAXY_SPIN_DIRECTIONS)[number];

export interface GalaxySettings {
  seed: number;
  particleCount: number;
  arms: number;
  turns: number;
  armWidth: number;
  coreSize: number;
  coreStrength: number;
  flareStars: number;
  starSize: number;
  spinSpeed: number;
  spinDirection: GalaxySpinDirection;
  differential: number;
  flowSpeed: number;
  twinkle: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumber(bag: Record<string, string | undefined>, key: string): number {
  const range = GALAXY_SETTING_RANGES[key];
  const fallback = Number.parseFloat(GALAXY_SETTING_DEFAULTS[key]);
  const parsed = Number.parseFloat(String(bag[key] ?? ""));
  const value = clamp(Number.isFinite(parsed) ? parsed : fallback, range.min, range.max);
  return range.integer ? Math.round(value) : value;
}

function readSpinDirection(value: string | undefined): GalaxySpinDirection {
  return (GALAXY_SPIN_DIRECTIONS as readonly string[]).includes(value ?? "")
    ? (value as GalaxySpinDirection)
    : (GALAXY_SETTING_DEFAULTS.spinDirection as GalaxySpinDirection);
}

/**
 * String bag in, clamped numbers out. An empty bag is the defaults; a value
 * that does not parse is its default; a value outside its range is pulled to
 * the nearest edge rather than trusted. Nothing in here can produce a NaN,
 * because one NaN in a per-frame loop paints nothing and says nothing.
 */
export function readGalaxySettings(bag: Record<string, string | undefined> = {}): GalaxySettings {
  return {
    seed: readNumber(bag, "seed"),
    particleCount: readNumber(bag, "particleCount"),
    arms: readNumber(bag, "arms"),
    turns: readNumber(bag, "turns"),
    armWidth: readNumber(bag, "armWidth"),
    coreSize: readNumber(bag, "coreSize"),
    coreStrength: readNumber(bag, "coreStrength"),
    flareStars: readNumber(bag, "flareStars"),
    starSize: readNumber(bag, "starSize"),
    spinSpeed: readNumber(bag, "spinSpeed"),
    spinDirection: readSpinDirection(bag.spinDirection),
    differential: readNumber(bag, "differential"),
    flowSpeed: readNumber(bag, "flowSpeed"),
    twinkle: readNumber(bag, "twinkle")
  };
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32 — a small, fast, seeded random source. Returns a function that
 * yields a uniform number in [0, 1) on each call, and the same sequence for
 * the same seed on every machine. `Math.random` cannot be seeded, and an
 * unseeded galaxy is a different picture on every load, which also makes
 * a Builder screenshot unrepeatable (plan rule 7).
 */
export function mulberry32(seed: number): () => number {
  let a = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard-normal sample (Box–Muller) from a uniform source. */
function gaussian(random: () => number): number {
  // 1 - u keeps the log away from 0; a log of exactly 0 is -Infinity.
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Layout constants — the shape of the galaxy in unit-disc terms
// ---------------------------------------------------------------------------

/** The spiral is anchored here: ln(r) needs r above zero, and `turns` counts from this radius to the rim. */
export const GALAXY_RADIUS_MIN = 0.03;
/** The core radius at coreSize 100, and so the furthest out the arm floor can sit. */
export const GALAXY_ARM_FLOOR_MAX = 0.5;
/**
 * Arm stars are laid out with a density per unit radius proportional to
 * r^-EXPONENT (denser toward the centre), and they stream inward at a speed
 * proportional to r^+EXPONENT — the inverse. Those two facts are one
 * constant on purpose: the layout is the streaming's steady state only while
 * they agree, and `galaxyArmRadius` and `radialSpeedProfile` are the two
 * places that read it.
 */
const RADIAL_DENSITY_EXPONENT = 0.5;
/** Angular width of an arm at armWidth 100, as one standard deviation, in radians. */
export const GALAXY_ARM_SIGMA_MAX = 0.55;
/** At most this share of the stars belongs to the centre cluster (at coreStrength 100). */
const CORE_SHARE_MAX = 0.35;
/**
 * Below this core size the cluster loses stars in proportion, so a shrinking
 * core thins out rather than packing the same crowd into a smaller ball —
 * at coreSize 0 it has no stars at all. At and above it the count is
 * coreStrength's alone. Equal to the default coreSize, so the default
 * picture is unaffected.
 */
const CORE_COUNT_FULL_AT_SIZE = 12;
/** Half-thickness of the disc (one standard deviation) in unit-disc terms. */
const DISC_THICKNESS = 0.02;
/** The core is a puffier ball than the arms. */
const CORE_THICKNESS_SCALE = 2.5;
/** Star size falls toward the arm edges by this fraction at two sigma (reference: 0.45). */
const EDGE_SIZE_FALLOFF = 0.45;
/** Flare stars are drawn this many times the base size, and at full brightness. */
export const GALAXY_FLARE_SIZE_SCALE = 2.6;
/**
 * Where along the arm each flare star is pinned, as a fraction of the way
 * from the rim in to the core's edge. Fixed on purpose: flare stars are the
 * landmarks the eye anchors on, and landmarks that move with the seed are
 * not landmarks. Measured from the core's edge, never the disc's centre, so
 * no flare lands inside the core whatever `coreSize` is.
 */
export const GALAXY_FLARE_FRACTIONS = [0.18, 0.31, 0.44, 0.57, 0.7, 0.83, 0.96, 0.25, 0.5, 0.75, 0.38, 0.62];

/** Arm index stamped on a star that belongs to the centre cluster rather than to an arm. */
export const GALAXY_CORE_ARM = 255;

/**
 * The reference palette, read out of the reference page's configuration:
 * a near-white majority, two blues, two oranges. The weights are what the
 * layout reads; the hex values wait here for the renderer.
 */
export const GALAXY_DEFAULT_PALETTE: { hex: string; weight: number }[] = [
  { hex: "#F5F6FB", weight: 52 },
  { hex: "#6DCBF4", weight: 15 },
  { hex: "#7AB1FE", weight: 18 },
  { hex: "#F87915", weight: 7 },
  { hex: "#FA994C", weight: 8 }
];
const PALETTE_TOTAL_WEIGHT = GALAXY_DEFAULT_PALETTE.reduce((sum, entry) => sum + entry.weight, 0);

// ---------------------------------------------------------------------------
// Motion constants
// ---------------------------------------------------------------------------

/** spinSpeed 100 turns the pattern once every ten seconds. */
const SPIN_RADIANS_PER_SECOND_AT_MAX = (2 * Math.PI) / 10;
/** flowSpeed 100 carries a star from the rim to the core's edge in twenty seconds. */
const FLOW_TRIP_SECONDS_AT_MAX = 20;
/**
 * differential 100 adds along-arm streaming worth this many times the rigid
 * spin rate at the RIM; further in it is 1/√r times that (r^-EXPONENT), so
 * at the default core edge the innermost stars turn about four times as
 * fast as the rim on top of the spin. Scaled by the spin on purpose: a
 * differential is a property of rotation, and a galaxy that does not spin
 * has none.
 */
const DIFFERENTIAL_RIM_GAIN = 2;
/** twinkle 100 cycles a star's twinkle phase once per second. */
const TWINKLE_RADIANS_PER_SECOND_AT_MAX = 2 * Math.PI;
const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * Star state as parallel typed arrays — never an array of objects — so a
 * frame reads and writes memory in order and allocates nothing.
 *
 * `radius`, `arm` and `jitter` are an arm star's canonical position: its
 * `angle` is derived from them (the arm's spine at that radius, plus the
 * jitter in arm widths) and rewritten whenever the radius changes, so it
 * never drifts from the arm by accumulated rounding. A core star's `angle`
 * is fixed at generation; a flare star's is the spine at its pinned radius.
 * None of them include the pattern's spin: a star's on-screen angle is
 * `angle[i] + spin`, and `x`/`y` are derived from that after every step.
 */
export interface GalaxyField {
  count: number;
  seed: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  radius: Float32Array;
  /** Angle in the pattern's own frame — without `spin`. */
  angle: Float32Array;
  /** An arm star's offset from its arm's spine in standard deviations; 0 for core and flare stars. */
  jitter: Float32Array;
  size: Float32Array;
  brightness: Float32Array;
  twinklePhase: Float32Array;
  colour: Uint8Array;
  arm: Uint8Array;
  flare: Uint8Array;
  /**
   * Where each star waits before the intro (Galaxy module 4/6): an OFFSET
   * from its layout position, in unit-disc terms, 2 to 4 field radii long in
   * a seeded random direction. An offset rather than a point, so a star that
   * has turned or streamed since generation still flies in to where it IS.
   */
  scatterX: Float32Array;
  scatterY: Float32Array;
  scatterZ: Float32Array;
  /** How far the whole pattern has turned since generation, radians, folded into [0, 2π). */
  spin: number;
  /** The field's own random source, so re-seeding inside `step` stays deterministic. */
  random: () => number;
}

/** The angular offset between neighbouring arms. */
function armSpacing(arms: number): number {
  return TWO_PI / Math.max(1, arms);
}

function spinSign(direction: GalaxySpinDirection): number {
  return direction === "counterclockwise" ? -1 : 1;
}

/**
 * How many radians the spiral turns per unit of ln(r). Chosen so the ARM
 * BAND — from `floor` (the core's edge, `galaxyArmFloor`) to the rim — wraps
 * exactly `turns` times: that band is the only spiral a visitor can see, so
 * it is the one the Turns setting describes. `turns` is clamped to its
 * stated range here, not trusted: this is the divisor under the differential
 * in `stepGalaxyField`, and hand-built settings with `turns: 0` (the shape
 * this file's own tests use) made it Infinity — 3,069 of 4,000 arm stars
 * re-seeded at the rim in ONE frame — or 0/0 with the spin off, which is a
 * NaN that silently stops every star (round-2 review, item 5).
 */
export function galaxyTwist(turns: number, floor: number): number {
  const range = GALAXY_SETTING_RANGES.turns;
  const t = clamp(Number.isFinite(turns) ? turns : Number.parseFloat(GALAXY_SETTING_DEFAULTS.turns), range.min, range.max);
  const f = clamp(Number.isFinite(floor) ? floor : GALAXY_RADIUS_MIN, GALAXY_RADIUS_MIN, GALAXY_ARM_FLOOR_MAX);
  return (t * TWO_PI) / Math.log(1 / f);
}

/** The arm geometry a step or a layout reads once rather than per star. */
interface ArmGeometry {
  twist: number;
  spacing: number;
  sigma: number;
  /** +1 clockwise, -1 counterclockwise: the spiral's handedness and the spin's sign. */
  direction: number;
  /** The innermost arm radius, where the twist is anchored. */
  floor: number;
}

/**
 * ONE builder for the geometry, read by the layout, the step and the
 * exported `galaxySpineAngle`. `armWidth` is optional because the spine
 * helper has no use for the band's width; everything else is required, so
 * the anchor (`coreSize` → floor) cannot be left out by a caller and drift.
 */
function armGeometry(
  settings: Pick<GalaxySettings, "turns" | "arms" | "spinDirection" | "coreSize"> & { armWidth?: number }
): ArmGeometry {
  const floor = galaxyArmFloor(settings);
  return {
    twist: galaxyTwist(settings.turns, floor),
    spacing: armSpacing(Math.max(1, Math.round(settings.arms))),
    sigma: galaxyArmSigma(settings.armWidth ?? 0),
    direction: spinSign(settings.spinDirection),
    floor
  };
}

function spineAngle(radius: number, arm: number, geo: ArmGeometry): number {
  const r = Math.max(geo.floor, radius);
  // The sign makes the arms TRAIL: going inward the spine turns in the spin
  // direction, so a star streaming inward along it moves with the spin.
  return geo.spacing * arm - geo.direction * geo.twist * Math.log(r / geo.floor);
}

/**
 * The angle of an arm's spine at a radius, in the pattern's frame: the
 * logarithmic spiral itself, anchored at the arm floor. A star's own angle
 * is this plus its jitter, and its on-screen angle adds the field's `spin`.
 * This is the "twist term" the arm-band test subtracts.
 */
export function galaxySpineAngle(
  radius: number,
  arm: number,
  settings: Pick<GalaxySettings, "turns" | "arms" | "spinDirection" | "coreSize">
): number {
  return spineAngle(radius, arm, armGeometry(settings));
}

/** One standard deviation of arm jitter, in radians, for an armWidth setting. */
export function galaxyArmSigma(armWidth: number): number {
  return (clamp(armWidth, 0, 100) / 100) * GALAXY_ARM_SIGMA_MAX;
}

/** The radius of the centre cluster in unit-disc terms. */
export function galaxyCoreRadius(coreSize: number): number {
  return (clamp(coreSize, 0, 100) / 100) * GALAXY_ARM_FLOOR_MAX;
}

/**
 * The innermost radius an arm star lives at: the core's edge (or the
 * spiral's anchor, whichever is further out). ONE definition, read by the
 * layout and by the step: a star laid out inside the radius the step
 * re-seeds at would jump to the rim on the first frame — one in eight of
 * them did (round-1 review).
 */
export function galaxyArmFloor(settings: Pick<GalaxySettings, "coreSize">): number {
  return Math.max(GALAXY_RADIUS_MIN, galaxyCoreRadius(settings.coreSize));
}

/** The number of stars the centre cluster takes out of the total. */
export function galaxyCoreCount(
  settings: Pick<GalaxySettings, "particleCount" | "coreStrength" | "coreSize" | "flareStars">
): number {
  const available = Math.max(0, settings.particleCount - settings.flareStars);
  const strength = clamp(settings.coreStrength, 0, 100) / 100;
  const sizeFactor = clamp(settings.coreSize / CORE_COUNT_FULL_AT_SIZE, 0, 1);
  return Math.min(available, Math.round(settings.particleCount * strength * CORE_SHARE_MAX * sizeFactor));
}

/**
 * An arm star's radius from a uniform draw u in [0, 1): the inverse of the
 * r^-EXPONENT density over [floor, 1]. `radialSpeedProfile` is its partner.
 */
export function galaxyArmRadius(u: number, floor: number): number {
  const p = 1 - RADIAL_DENSITY_EXPONENT;
  const lo = Math.pow(floor, p);
  return Math.pow(lo + u * (1 - lo), 1 / p);
}

/** The along-arm speed at a radius, relative to the rim: r^EXPONENT, the inverse of the layout density. */
function radialSpeedProfile(radius: number): number {
  return Math.pow(radius, RADIAL_DENSITY_EXPONENT);
}

/**
 * The rim speed (unit-disc radii per second) at which a star streaming under
 * `radialSpeedProfile` takes `FLOW_TRIP_SECONDS_AT_MAX` seconds from the rim
 * to the floor — flowSpeed 100's speed.
 */
function flowRimSpeedAtMax(floor: number): number {
  const p = 1 - RADIAL_DENSITY_EXPONENT;
  return (1 - Math.pow(floor, p)) / (p * FLOW_TRIP_SECONDS_AT_MAX);
}

function pickColour(random: () => number): number {
  let roll = random() * PALETTE_TOTAL_WEIGHT;
  for (let i = 0; i < GALAXY_DEFAULT_PALETTE.length; i++) {
    roll -= GALAXY_DEFAULT_PALETTE[i].weight;
    if (roll < 0) return i;
  }
  return 0;
}

/** Size and brightness fall off toward the arm edges; a star two sigma out is the smallest. */
function edgeFactor(jitterSigmas: number): number {
  return 1 - EDGE_SIZE_FALLOFF * clamp(Math.abs(jitterSigmas) / 2, 0, 1);
}

/** Write one arm star at index i, given its radius and arm; everything else is drawn from the field's random source. */
function seedArmStar(field: GalaxyField, i: number, radius: number, arm: number, starSize: number, geo: ArmGeometry): void {
  const random = field.random;
  const jitter = gaussian(random);
  field.radius[i] = radius;
  field.arm[i] = arm;
  field.jitter[i] = jitter;
  field.angle[i] = spineAngle(radius, arm, geo) + jitter * geo.sigma;
  field.z[i] = gaussian(random) * DISC_THICKNESS;
  field.size[i] = starSize * edgeFactor(jitter) * (0.7 + 0.6 * random());
  field.brightness[i] = (0.55 + 0.45 * random()) * edgeFactor(jitter);
  field.twinklePhase[i] = random() * TWO_PI;
  field.colour[i] = pickColour(random);
  field.flare[i] = 0;
}

/**
 * Lay the field out. Three populations, in this order in the arrays:
 *
 *   [0, flareStars)              flare stars, pinned on the spine at fixed fractions
 *   [flareStars, +coreCount)     the centre cluster — a soft ball, no arm
 *   the rest                     arm stars, from the core's edge to the rim, denser inward
 *
 * `particleCount` is honoured exactly: the three populations always sum to it.
 * A non-finite count is refused out loud — a typed array of length NaN is
 * silently empty, and a galaxy with no stars says nothing about why.
 */
export function generateGalaxyField(settings: GalaxySettings): GalaxyField {
  if (!Number.isFinite(settings.particleCount)) {
    throw new RangeError(`generateGalaxyField: particleCount must be a finite number, got ${String(settings.particleCount)}`);
  }
  const count = Math.max(0, Math.round(settings.particleCount));
  const field: GalaxyField = {
    count,
    seed: settings.seed,
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    radius: new Float32Array(count),
    angle: new Float32Array(count),
    jitter: new Float32Array(count),
    size: new Float32Array(count),
    brightness: new Float32Array(count),
    twinklePhase: new Float32Array(count),
    colour: new Uint8Array(count),
    arm: new Uint8Array(count),
    flare: new Uint8Array(count),
    scatterX: new Float32Array(count),
    scatterY: new Float32Array(count),
    scatterZ: new Float32Array(count),
    spin: 0,
    random: mulberry32(settings.seed)
  };
  writeScatter(field, settings.seed);
  const random = field.random;
  const geo = armGeometry(settings);
  const flareCount = Math.min(count, Math.max(0, Math.round(settings.flareStars)));
  const coreCount = Math.min(count - flareCount, galaxyCoreCount({ ...settings, particleCount: count }));
  const coreRadius = galaxyCoreRadius(settings.coreSize);
  const floor = galaxyArmFloor(settings);
  const arms = Math.max(1, Math.round(settings.arms));

  let i = 0;
  for (let f = 0; f < flareCount; f++, i++) {
    const fraction = GALAXY_FLARE_FRACTIONS[f % GALAXY_FLARE_FRACTIONS.length];
    const radius = 1 - fraction * (1 - floor);
    const arm = f % arms;
    field.radius[i] = radius;
    field.arm[i] = arm;
    field.jitter[i] = 0;
    field.angle[i] = spineAngle(radius, arm, geo);
    field.z[i] = 0;
    field.size[i] = settings.starSize * GALAXY_FLARE_SIZE_SCALE;
    field.brightness[i] = 1;
    field.twinklePhase[i] = random() * TWO_PI;
    field.colour[i] = 0;
    field.flare[i] = 1;
  }
  for (let c = 0; c < coreCount; c++, i++) {
    // A soft ball: gaussian radius, capped at the core radius; uniform angle.
    const radius = Math.min(coreRadius, Math.abs(gaussian(random)) * coreRadius * 0.45);
    field.radius[i] = radius;
    field.arm[i] = GALAXY_CORE_ARM;
    field.jitter[i] = 0;
    field.angle[i] = random() * TWO_PI;
    field.z[i] = gaussian(random) * DISC_THICKNESS * CORE_THICKNESS_SCALE * Math.max(0.2, 1 - radius / Math.max(coreRadius, 1e-6));
    field.size[i] = settings.starSize * (0.6 + 0.6 * random());
    field.brightness[i] = 0.6 + 0.4 * random();
    field.twinklePhase[i] = random() * TWO_PI;
    field.colour[i] = pickColour(random);
    field.flare[i] = 0;
  }
  for (; i < count; i++) {
    const radius = galaxyArmRadius(random(), floor);
    seedArmStar(field, i, radius, Math.floor(random() * arms) % arms, settings.starSize, geo);
  }
  writeCartesian(field);
  return field;
}

function writeCartesian(field: GalaxyField): void {
  const { count, x, y, radius, angle, spin } = field;
  for (let i = 0; i < count; i++) {
    const a = angle[i] + spin;
    x[i] = radius[i] * Math.cos(a);
    y[i] = radius[i] * Math.sin(a);
  }
}

/**
 * Give every star its scatter offset (Galaxy module 4/6). Drawn from a source
 * of its OWN, seeded from the field's seed: taking these numbers from the
 * layout's source would move every star of every existing galaxy, and the
 * layout is what slices 1 to 3 pinned. Mostly in the disc's plane, so the
 * stars come in from the edges of the picture rather than from in front of it.
 */
function writeScatter(field: GalaxyField, seed: number): void {
  const random = mulberry32((Number.isFinite(seed) ? Math.floor(seed) : 0) ^ GALAXY_SCATTER_SEED_SALT);
  const { count, scatterX, scatterY, scatterZ } = field;
  for (let i = 0; i < count; i++) {
    const direction = random() * TWO_PI;
    const distance = GALAXY_SCATTER_MIN + random() * (GALAXY_SCATTER_MAX - GALAXY_SCATTER_MIN);
    scatterX[i] = Math.cos(direction) * distance;
    scatterY[i] = Math.sin(direction) * distance;
    scatterZ[i] = gaussian(random) * GALAXY_SCATTER_DEPTH;
  }
}

/** Fold an angle into [0, 2π) with a modulo, so ANY step — a tab back from the background included — lands inside one turn. */
function foldTurn(angle: number): number {
  const folded = angle % TWO_PI;
  return folded < 0 ? folded + TWO_PI : folded;
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/**
 * Advance the field by `dtSeconds`, in place. Returns the same field object.
 *
 * Spin: the whole pattern turns by spinSpeed × dt — one scalar, `spin`,
 * folded into [0, 2π) as it is updated so a kiosk page running for a day
 * keeps float32 precision. Clockwise means a growing angle, which is
 * clockwise on a canvas (y down).
 *
 * Streaming: arm stars slide inward ALONG their arm at a speed that falls
 * toward the centre as r^EXPONENT — the inverse of the layout's density, so
 * the density never changes — and their angle is recomputed from the spine
 * at the new radius, so an arm stays an arm. Sliding along a logarithmic
 * spiral sweeps angle at twist × speed ÷ r, so the innermost stars visibly
 * turn fastest; `flowSpeed` sets the speed directly and `differential` adds
 * to it in proportion to the spin. A star that reaches the core's edge is
 * re-seeded at the rim of the same arm, with fresh jitter, from the field's
 * own seeded source — two fields with the same seed stay byte-identical.
 * Flare stars are pinned and the core cluster is already home, so neither
 * streams; both turn with the pattern.
 *
 * Twinkle: the phase advances at twinkle × 1 Hz and is folded by a modulo,
 * so a large dt cannot carry it past one turn.
 *
 * The caller clamps `dt` (plan rule 5, 50 ms); this function only refuses a
 * non-finite or negative one.
 */
export function stepGalaxyField(field: GalaxyField, dtSeconds: number, settings: GalaxySettings): GalaxyField {
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
  if (dt === 0) return field;
  const { count, x, y, radius, angle, jitter, arm, flare, twinklePhase } = field;
  const geo = armGeometry(settings);
  const spinRate = geo.direction * (clamp(settings.spinSpeed, 0, 100) / 100) * SPIN_RADIANS_PER_SECOND_AT_MAX;
  const floor = galaxyArmFloor(settings);
  // Rim speed of the streaming, in radii per second: the flow setting's own
  // share, plus the differential's share, which is an angular rate at the rim
  // (a multiple of the spin) converted to a radial speed through the twist.
  // The sum is CAPPED at flowSpeed 100's speed — the differential's radial
  // speed swings 8× with `turns`, and uncapped, the slider extremes recycled
  // every arm star rim-to-core in about a second (header, "two sliders").
  const flowCeiling = flowRimSpeedAtMax(floor);
  const flowRim = (clamp(settings.flowSpeed, 0, 100) / 100) * flowCeiling;
  const differentialRim = (clamp(settings.differential, 0, 100) / 100) * DIFFERENTIAL_RIM_GAIN * Math.abs(spinRate) / geo.twist;
  const slide = Math.min(flowCeiling, flowRim + differentialRim) * dt;
  const twinkleStep = (clamp(settings.twinkle, 0, 100) / 100) * TWINKLE_RADIANS_PER_SECOND_AT_MAX * dt;

  field.spin = foldTurn(field.spin + spinRate * dt);
  const spin = field.spin;

  for (let i = 0; i < count; i++) {
    if (slide > 0 && arm[i] !== GALAXY_CORE_ARM && flare[i] === 0) {
      const r = radius[i];
      const next = r - slide * radialSpeedProfile(r);
      if (next <= floor) {
        seedArmStar(field, i, 1, arm[i], settings.starSize, geo);
      } else {
        radius[i] = next;
        angle[i] = spineAngle(next, arm[i], geo) + jitter[i] * geo.sigma;
      }
    }
    const a = angle[i] + spin;
    const rr = radius[i];
    x[i] = rr * Math.cos(a);
    y[i] = rr * Math.sin(a);
    twinklePhase[i] = foldTurn(twinklePhase[i] + twinkleStep);
  }
  return field;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/** The arrays `projectGalaxyField` writes into. Allocate once with `createGalaxyProjection`. */
export interface GalaxyProjection {
  x: Float32Array;
  y: Float32Array;
  /** Rotated z, unit-disc terms: positive is toward the viewer. The renderer may scale size by it. */
  depth: Float32Array;
  /** The pixel radius the unit disc was drawn at, so a caller can turn field units back into pixels. */
  scale: number;
  /**
   * How many entries the last projection wrote — the field's count, or the
   * arrays' length if that is smaller. A renderer loops to THIS, not to the
   * arrays' length: a buffer reused after the field shrank keeps stale stars
   * in its tail.
   */
  count: number;
}

/** The unit disc fills this fraction of the shorter viewport side. */
export const GALAXY_VIEWPORT_FILL = 0.92;

export function createGalaxyProjection(count: number): GalaxyProjection {
  // The same refusal `generateGalaxyField` makes: a typed array of length
  // NaN is silently empty, and a projection that writes nothing says nothing.
  if (!Number.isFinite(count)) {
    throw new RangeError(`createGalaxyProjection: count must be a finite number, got ${String(count)}`);
  }
  const n = Math.max(0, Math.round(count));
  return { x: new Float32Array(n), y: new Float32Array(n), depth: new Float32Array(n), scale: 0, count: 0 };
}

/**
 * Rotate the field — yaw about the screen's vertical axis, then pitch about
 * its horizontal one — and project it orthographically to pixels centred in
 * the viewport, into `out`. Returns `out`. Nothing is allocated: the arrays
 * are the caller's, sized by `createGalaxyProjection(field.count)`.
 *
 * `mix` is the intro and the scroll (Galaxy module 4/6): each star is drawn
 * `galaxyStarPlacement` of the way from its scatter position to where it
 * really is, BEFORE the rotation, so a star flying in turns with the view
 * like everything else. Left out, every star is in place — the card, and
 * every caller written before the intro existed.
 *
 * Orthographic on purpose: at yaw 0 and pitch 0 every star's distance from
 * the centre is exactly its field radius times `out.scale`, which is what
 * lets a test hold the projection still. Perspective, if a renderer wants
 * it, is a size tweak off `depth`, not a change to where a star lands.
 *
 * A star past the end of `out` is dropped rather than written out of bounds,
 * and `out.count` says how many were written.
 */
export function projectGalaxyField(
  field: GalaxyField,
  yaw: number,
  pitch: number,
  viewportW: number,
  viewportH: number,
  out: GalaxyProjection,
  mix: GalaxyMix = GALAXY_MIX_IN_PLACE
): GalaxyProjection {
  const w = Number.isFinite(viewportW) ? Math.max(0, viewportW) : 0;
  const h = Number.isFinite(viewportH) ? Math.max(0, viewportH) : 0;
  const scale = (Math.min(w, h) / 2) * GALAXY_VIEWPORT_FILL;
  const cx = w / 2;
  const cy = h / 2;
  const cosYaw = Math.cos(Number.isFinite(yaw) ? yaw : 0);
  const sinYaw = Math.sin(Number.isFinite(yaw) ? yaw : 0);
  const cosPitch = Math.cos(Number.isFinite(pitch) ? pitch : 0);
  const sinPitch = Math.sin(Number.isFinite(pitch) ? pitch : 0);
  const { x, y, z, radius, scatterX, scatterY, scatterZ } = field;
  const n = Math.min(field.count, out.x.length, out.y.length, out.depth.length);
  const ox = out.x;
  const oy = out.y;
  const od = out.depth;
  const converge = galaxyUnit(mix.converge, 1);
  const disperse = galaxyUnit(mix.disperse, 0);
  // The common case — everything home — pays nothing per star.
  const mixing = converge < 1 || disperse > 0;
  for (let i = 0; i < n; i++) {
    let px = x[i];
    let py = y[i];
    let pz = z[i];
    if (mixing) {
      const away = 1 - galaxyStarPlacement(converge, disperse, radius[i]);
      px += scatterX[i] * away;
      py += scatterY[i] * away;
      pz += scatterZ[i] * away;
    }
    // Yaw: rotate in the x–z plane.
    const x1 = px * cosYaw + pz * sinYaw;
    const z1 = -px * sinYaw + pz * cosYaw;
    // Pitch: rotate in the y–z plane.
    const y2 = py * cosPitch - z1 * sinPitch;
    const z2 = py * sinPitch + z1 * cosPitch;
    ox[i] = cx + x1 * scale;
    oy[i] = cy + y2 * scale;
    od[i] = z2;
  }
  out.scale = scale;
  out.count = n;
  return out;
}

// ---------------------------------------------------------------------------
// Device budget
// ---------------------------------------------------------------------------

export type GalaxyDeviceTier = "high" | "mid" | "low";

/**
 * Which class of machine is looking, from what a browser will admit to.
 * `saveData` is the visitor asking for less, and wins outright. `high`
 * needs BOTH cores and memory reported and both generous: a browser that
 * hides either (Safari hides `deviceMemory` on every device, an eight-core
 * iPhone included) is capped at mid, because guessing high on an old phone
 * is the guess that stutters.
 */
export function readDeviceTier(input: {
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  saveData?: boolean | null;
}): GalaxyDeviceTier {
  if (input.saveData === true) return "low";
  const cores = Number.isFinite(input.hardwareConcurrency as number) ? (input.hardwareConcurrency as number) : null;
  const memory = Number.isFinite(input.deviceMemory as number) ? (input.deviceMemory as number) : null;
  if ((cores !== null && cores <= 2) || (memory !== null && memory <= 2)) return "low";
  if (cores === null || memory === null || cores <= 4 || memory <= 4) return "mid";
  return "high";
}

/** The pixel area the full star count is budgeted for: a 1920 × 1080 backdrop. */
export const GALAXY_REFERENCE_AREA_PX = 1920 * 1080;
/** Below this the field reads as empty, so a scaled count never goes lower (unless fewer were asked for). */
export const GALAXY_COUNT_FLOOR = 100;
const TIER_SCALE: Record<GalaxyDeviceTier, number> = { high: 1, mid: 0.7, low: 0.5 };

/**
 * How many stars to actually draw: the requested count, scaled down by the
 * area it is drawn into (by the square root, so a quarter of the area keeps
 * half the stars — density, not count, is what the eye reads) and by the
 * device tier (a low tier halves it). Never MORE than requested, never below
 * the floor unless the request itself was. An unknown area (0 or NaN) does
 * not penalise: the caller has not measured yet, and a first frame drawn
 * thin would be a flash.
 */
export function scaleGalaxyCount(requested: number, areaPx: number, deviceTier: GalaxyDeviceTier): number {
  const wanted = Number.isFinite(requested) ? Math.max(0, Math.round(requested)) : 0;
  if (wanted === 0) return 0;
  const area = Number.isFinite(areaPx) && areaPx > 0 ? areaPx : GALAXY_REFERENCE_AREA_PX;
  const areaScale = Math.min(1, Math.sqrt(area / GALAXY_REFERENCE_AREA_PX));
  const tierScale = TIER_SCALE[deviceTier] ?? TIER_SCALE.mid;
  const scaled = Math.round(wanted * areaScale * tierScale);
  return Math.min(wanted, Math.max(Math.min(wanted, GALAXY_COUNT_FLOOR), scaled));
}

// ---------------------------------------------------------------------------
// Interaction (Galaxy module 3/6, task 86bc7f5hh)
// ---------------------------------------------------------------------------

/**
 * How a visitor turns the galaxy. Which ones are offered depends on where it
 * sits: `rotate` (drag and arrow keys) needs something to press, so it exists
 * only In Place; a Window galaxy sits behind the page at z-index -9999 and can
 * never receive a pointer, so it gets `tilt`, read from the cursor anywhere on
 * the page (TractorNav trap 3). `none` is valid in both.
 */
export const GALAXY_INTERACTIONS = ["rotate", "tilt", "none"] as const;
export type GalaxyInteraction = (typeof GALAXY_INTERACTIONS)[number];

/** Radians the galaxy turns per pixel dragged — the reference page's value. */
export const GALAXY_DRAG_RADIANS_PER_PX = 0.005;
/** Radians one arrow-key press turns it. */
export const GALAXY_KEY_STEP = 0.08;
/** Pitch never passes this, so a drag cannot flip the disc over onto its back. */
export const GALAXY_PITCH_LIMIT = 1.2;
/** How quickly the view eases toward where it was turned to (per second). */
export const GALAXY_DAMPING = 6;
/** Window tilt: the cursor at a viewport edge turns the backdrop this far. */
export const GALAXY_TILT_YAW = 0.25;
export const GALAXY_TILT_PITCH = 0.15;

/** The interaction a placement gets when none is stored, or the stored one is not offered there. */
export function defaultGalaxyInteraction(inline: boolean): GalaxyInteraction {
  return inline ? "rotate" : "tilt";
}

/** The interactions the panel offers for a placement, in panel order. */
export function galaxyInteractionsFor(inline: boolean): GalaxyInteraction[] {
  return inline ? ["rotate", "none"] : ["tilt", "none"];
}

/**
 * The interaction that actually runs. A stored value the placement does not
 * offer — `rotate` on a Window galaxy, say, after somebody switched Sits —
 * becomes that placement's default rather than silently doing nothing.
 */
export function resolveGalaxyInteraction(inline: boolean, value: string | undefined): GalaxyInteraction {
  const wanted = String(value ?? "").trim().toLowerCase();
  return (galaxyInteractionsFor(inline) as string[]).includes(wanted)
    ? (wanted as GalaxyInteraction)
    : defaultGalaxyInteraction(inline);
}

/**
 * Move `current` toward `target`, frame-rate independent: the gap shrinks by
 * e^(-damping × dt) each frame. To first order that is the reference's
 * "(target − current) × damping × dt", but it can never overshoot however
 * long the frame was, which the linear form does once damping × dt passes 1.
 */
export function easeToward(current: number, target: number, damping: number, dtSeconds: number): number {
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(current)) return target;
  const k = Number.isFinite(damping) && damping > 0 ? damping : 0;
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
  const share = 1 - Math.exp(-k * dt);
  if (share >= 1) return target;
  const next = current + (target - current) * share;
  // Rounding alone can step one unit past the target; the target is the limit.
  return (target - next) * (target - current) < 0 ? target : next;
}

/** Where the view is, and where it was turned to. Yaw and pitch in radians. */
export interface GalaxyView {
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
}

export function createGalaxyView(): GalaxyView {
  return { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
}

function clampPitch(pitch: number): number {
  return clamp(pitch, -GALAXY_PITCH_LIMIT, GALAXY_PITCH_LIMIT);
}

/** A drag of (dx, dy) pixels turns the target; the view eases after it. */
export function dragGalaxyView(view: GalaxyView, dx: number, dy: number): GalaxyView {
  if (Number.isFinite(dx)) view.targetYaw += dx * GALAXY_DRAG_RADIANS_PER_PX;
  if (Number.isFinite(dy)) view.targetPitch = clampPitch(view.targetPitch + dy * GALAXY_DRAG_RADIANS_PER_PX);
  return view;
}

/**
 * One arrow-key press. Returns false for any other key, so the caller only
 * calls `preventDefault` — and only stops the page scrolling — for the four
 * keys that turn the galaxy. The directions match a drag: Right is a drag to
 * the right, Down a drag downward.
 */
export function stepGalaxyViewByKey(view: GalaxyView, key: string): boolean {
  switch (key) {
    case "ArrowLeft":
      view.targetYaw -= GALAXY_KEY_STEP;
      return true;
    case "ArrowRight":
      view.targetYaw += GALAXY_KEY_STEP;
      return true;
    case "ArrowUp":
      view.targetPitch = clampPitch(view.targetPitch - GALAXY_KEY_STEP);
      return true;
    case "ArrowDown":
      view.targetPitch = clampPitch(view.targetPitch + GALAXY_KEY_STEP);
      return true;
    default:
      return false;
  }
}

/**
 * Window tilt: the cursor's place in the viewport sets the target directly —
 * the left edge is −GALAXY_TILT_YAW, the right edge +GALAXY_TILT_YAW, the top
 * −GALAXY_TILT_PITCH, the bottom +. A viewport with no size leaves it alone.
 */
export function tiltGalaxyView(view: GalaxyView, clientX: number, clientY: number, viewportW: number, viewportH: number): GalaxyView {
  if (Number.isFinite(clientX) && Number.isFinite(viewportW) && viewportW > 0) {
    view.targetYaw = (clamp(clientX / viewportW, 0, 1) * 2 - 1) * GALAXY_TILT_YAW;
  }
  if (Number.isFinite(clientY) && Number.isFinite(viewportH) && viewportH > 0) {
    view.targetPitch = (clamp(clientY / viewportH, 0, 1) * 2 - 1) * GALAXY_TILT_PITCH;
  }
  return view;
}

/** Ease the view one frame toward its target. */
export function stepGalaxyView(view: GalaxyView, dtSeconds: number): GalaxyView {
  view.yaw = easeToward(view.yaw, view.targetYaw, GALAXY_DAMPING, dtSeconds);
  view.pitch = easeToward(view.pitch, view.targetPitch, GALAXY_DAMPING, dtSeconds);
  return view;
}

// ---------------------------------------------------------------------------
// Intro and scroll (Galaxy module 4/6, task 86bc7f5hj)
// ---------------------------------------------------------------------------

/** A star waits this many field radii from where it belongs, at least… */
export const GALAXY_SCATTER_MIN = 2;
/** …and at most. */
export const GALAXY_SCATTER_MAX = 4;
/** The scatter's depth (one standard deviation): a little, so the fly-in is not perfectly flat. */
const GALAXY_SCATTER_DEPTH = 0.3;
/** XOR'd into the seed so the scatter's random source is not the layout's. Any fixed number works. */
const GALAXY_SCATTER_SEED_SALT = 0x5ca77e4;
/**
 * The share of the intro the wave takes to cross the field. The core leaves
 * at converge 0 and the rim at converge STAGGER, and each star then takes
 * (1 − STAGGER) of the timeline to arrive — so at 0.5 the innermost star is
 * home and the outermost has not set off.
 */
export const GALAXY_INTRO_STAGGER = 0.5;

/** How far the intro and the scroll have got. Both 0..1. */
export interface GalaxyMix {
  /** 0 = every star at its scatter position, 1 = every star in place. */
  converge: number;
  /** 0 = in place, 1 = scattered again and faded out. */
  disperse: number;
}

/** Everything home: what a caller that knows nothing of the intro gets. */
export const GALAXY_MIX_IN_PLACE: Readonly<GalaxyMix> = Object.freeze({ converge: 1, disperse: 0 });

/** A finite number clamped into [0, 1]; anything else is the fallback. */
function galaxyUnit(value: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * How far ONE star has got from its scatter position to its place, 0..1,
 * eased. A star's turn in the wave is its radius: the core (radius 0) moves
 * first, the rim (radius 1) last — so the galaxy assembles from the centre
 * out, and comes apart from the arm tips in.
 *
 * Dispersing is the intro run backwards (`1 − disperse` through the same
 * wave), multiplied in, so a galaxy scrolled away while still arriving is
 * the lesser of the two and never jumps.
 */
export function galaxyStarPlacement(converge: number, disperse: number, radius: number): number {
  const turn = GALAXY_INTRO_STAGGER * galaxyUnit(radius, 1);
  const span = 1 - GALAXY_INTRO_STAGGER;
  const arriving = smoothstep(clamp((galaxyUnit(converge, 1) - turn) / span, 0, 1));
  const staying = smoothstep(clamp((1 - galaxyUnit(disperse, 0) - turn) / span, 0, 1));
  return arriving * staying;
}

/**
 * How visible the field is while it disperses: 1 in place, 0 fully dispersed.
 * Applied to the whole frame by the runtime, on top of the Opacity setting.
 */
export function galaxyDisperseOpacity(disperse: number): number {
  return 1 - galaxyUnit(disperse, 0);
}

export const GALAXY_INTROS = ["converge", "none"] as const;
export type GalaxyIntro = (typeof GALAXY_INTROS)[number];

/** The intro and scroll settings' defaults, as the strings the module stores. */
export const GALAXY_MOTION_DEFAULTS: Record<string, string> = {
  intro: "converge",
  introDelay: "1",
  introDuration: "5",
  scrollDisperse: "true",
  scrollDistance: "800"
};

export const GALAXY_MOTION_RANGES: Record<string, { min: number; max: number }> = {
  introDelay: { min: 0, max: 5 },
  introDuration: { min: 1, max: 10 },
  scrollDistance: { min: 200, max: 2000 }
};

export interface GalaxyMotion {
  intro: GalaxyIntro;
  /** Seconds after the galaxy appears before the stars set off. */
  introDelay: number;
  /** Seconds the whole wave takes, first star leaving to last star home. */
  introDuration: number;
  scrollDisperse: boolean;
  /** Pixels of scrolling over which the field disperses and fades. */
  scrollDistance: number;
}

function readMotionNumber(bag: Record<string, string | undefined>, key: string): number {
  const range = GALAXY_MOTION_RANGES[key];
  const parsed = Number.parseFloat(String(bag[key] ?? ""));
  return clamp(Number.isFinite(parsed) ? parsed : Number.parseFloat(GALAXY_MOTION_DEFAULTS[key]), range.min, range.max);
}

/**
 * The intro and scroll settings, clamped. Absent means the default — the
 * intro ON, scroll-disperse ON — and only the exact strings "none" and
 * "false" switch them off, so a value nobody recognises never quietly turns
 * a feature off.
 */
export function readGalaxyMotion(bag: Record<string, string | undefined> = {}): GalaxyMotion {
  return {
    intro: String(bag.intro ?? "").trim().toLowerCase() === "none" ? "none" : "converge",
    introDelay: readMotionNumber(bag, "introDelay"),
    introDuration: readMotionNumber(bag, "introDuration"),
    scrollDisperse: String(bag.scrollDisperse ?? "").trim().toLowerCase() !== "false",
    scrollDistance: readMotionNumber(bag, "scrollDistance")
  };
}

/**
 * The intro's timeline: `elapsed` seconds after the galaxy appeared, how far
 * the wave has got — 0 through the delay, then a straight line to 1 over the
 * duration. Linear on purpose: each star eases itself (`galaxyStarPlacement`),
 * and easing the timeline as well would stack two slow starts.
 */
export function galaxyIntroProgress(elapsedSeconds: number, delaySeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds)) return 1;
  const delay = Number.isFinite(delaySeconds) ? Math.max(0, delaySeconds) : 0;
  const duration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  if (duration <= 0) return elapsedSeconds >= delay ? 1 : 0;
  return clamp((elapsedSeconds - delay) / duration, 0, 1);
}

/** Scrolled `px` out of `distance` px, as 0..1. A distance of nothing disperses nothing. */
export function galaxyScrollDisperse(scrolledPx: number, distancePx: number): number {
  if (!Number.isFinite(scrolledPx) || !Number.isFinite(distancePx) || distancePx <= 0) return 0;
  return clamp(scrolledPx / distancePx, 0, 1);
}
