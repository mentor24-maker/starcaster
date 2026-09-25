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
 *   2. `stepGalaxyField(field, dt, settings)` moves them one frame: spin
 *      (inner faster than outer), a slow inward drift along the arm, and the
 *      twinkle phase.
 *   3. `projectGalaxyField(field, yaw, pitch, w, h, out)` rotates the flat
 *      disc in 3D and projects it to screen pixels — into arrays the caller
 *      owns, allocating nothing, because it runs sixty times a second.
 *   4. `readGalaxySettings` / `scaleGalaxyCount` / `readDeviceTier` turn the
 *      module's string settings and the visitor's device into clamped numbers.
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

/**
 * String bag in, clamped numbers out. An empty bag is the defaults; a value
 * that does not parse is its default; a value outside its range is pulled to
 * the nearest edge rather than trusted. Nothing in here can produce a NaN,
 * because one NaN in a per-frame loop paints nothing and says nothing.
 */
export function readGalaxySettings(bag: Record<string, string | undefined> = {}): GalaxySettings {
  const direction = bag.spinDirection;
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
    spinDirection: direction === "counterclockwise" ? "counterclockwise" : "clockwise",
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

/** Smallest radius an arm star is laid at; ln(r) needs r above zero. */
export const GALAXY_RADIUS_MIN = 0.03;
/** Radii are drawn as u^bias, so a bias above 1 packs stars toward the centre. */
const RADIUS_BIAS = 1.7;
/** Angular width of an arm at armWidth 100, as one standard deviation, in radians. */
export const GALAXY_ARM_SIGMA_MAX = 0.55;
/** At most this share of the stars belongs to the centre cluster (at coreStrength 100). */
const CORE_SHARE_MAX = 0.35;
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
 * from the rim inward. Fixed on purpose: flare stars are the landmarks the
 * eye anchors on, and landmarks that move with the seed are not landmarks.
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

// ---------------------------------------------------------------------------
// Motion constants
// ---------------------------------------------------------------------------

/** spinSpeed 100 turns the rim once every ten seconds. */
const SPIN_RADIANS_PER_SECOND_AT_MAX = (2 * Math.PI) / 10;
/** flowSpeed 100 carries a star from the rim to the centre in twenty seconds. */
const FLOW_UNITS_PER_SECOND_AT_MAX = 1 / 20;
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
 * `radius`, `angle` and `arm` are the canonical position (polar, per arm);
 * `x`/`y` are derived from them after every step. `jitter` is the star's
 * fixed offset from its arm's spine in standard deviations, kept because size
 * and brightness fall off toward the arm edges and the step needs it back
 * when a star is re-seeded.
 */
export interface GalaxyField {
  count: number;
  seed: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  radius: Float32Array;
  angle: Float32Array;
  jitter: Float32Array;
  size: Float32Array;
  brightness: Float32Array;
  twinklePhase: Float32Array;
  colour: Uint8Array;
  arm: Uint8Array;
  flare: Uint8Array;
  /** How far the RIM has spun since generation; a re-seeded star starts here so it lands beside its neighbours. */
  rimSpin: number;
  /** The field's own random source, so re-seeding inside `step` stays deterministic. */
  random: () => number;
}

/** The angular offset between neighbouring arms. */
function armSpacing(arms: number): number {
  return TWO_PI / Math.max(1, arms);
}

/**
 * How many radians the spiral turns per unit of ln(r). Chosen so the whole
 * disc, from `GALAXY_RADIUS_MIN` to the rim, wraps exactly `turns` times.
 */
export function galaxyTwist(turns: number): number {
  return (turns * TWO_PI) / Math.log(1 / GALAXY_RADIUS_MIN);
}

/**
 * The angle of an arm's spine at a radius: the logarithmic spiral itself.
 * A star's own angle is this plus its jitter plus whatever spin it has
 * accumulated. This is the "twist term" the arm-band test subtracts.
 */
export function galaxySpineAngle(radius: number, arm: number, settings: Pick<GalaxySettings, "turns" | "arms">): number {
  const r = Math.max(GALAXY_RADIUS_MIN, radius);
  return galaxyTwist(settings.turns) * Math.log(r / GALAXY_RADIUS_MIN) + armSpacing(settings.arms) * arm;
}

/** One standard deviation of arm jitter, in radians, for an armWidth setting. */
export function galaxyArmSigma(armWidth: number): number {
  return (clamp(armWidth, 0, 100) / 100) * GALAXY_ARM_SIGMA_MAX;
}

/** The radius of the centre cluster in unit-disc terms. */
export function galaxyCoreRadius(coreSize: number): number {
  return (clamp(coreSize, 0, 100) / 100) * 0.5;
}

/** The number of stars the centre cluster takes out of the total. */
export function galaxyCoreCount(settings: Pick<GalaxySettings, "particleCount" | "coreStrength" | "flareStars">): number {
  const available = Math.max(0, settings.particleCount - settings.flareStars);
  return Math.min(available, Math.round(settings.particleCount * (clamp(settings.coreStrength, 0, 100) / 100) * CORE_SHARE_MAX));
}

function pickColour(random: () => number): number {
  const total = GALAXY_DEFAULT_PALETTE.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
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
function seedArmStar(field: GalaxyField, i: number, radius: number, arm: number, settings: GalaxySettings, spinOffset: number): void {
  const random = field.random;
  const jitter = gaussian(random);
  field.radius[i] = radius;
  field.arm[i] = arm;
  field.jitter[i] = jitter;
  field.angle[i] = galaxySpineAngle(radius, arm, settings) + jitter * galaxyArmSigma(settings.armWidth) + spinOffset;
  field.z[i] = gaussian(random) * DISC_THICKNESS;
  field.size[i] = settings.starSize * edgeFactor(jitter) * (0.7 + 0.6 * random());
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
 *   the rest                     arm stars, radius weighted toward the centre
 *
 * `particleCount` is honoured exactly: the three populations always sum to it.
 */
export function generateGalaxyField(settings: GalaxySettings): GalaxyField {
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
    rimSpin: 0,
    random: mulberry32(settings.seed)
  };
  const random = field.random;
  const flareCount = Math.min(count, Math.max(0, Math.round(settings.flareStars)));
  const coreCount = Math.min(count - flareCount, galaxyCoreCount({ ...settings, particleCount: count }));
  const coreRadius = galaxyCoreRadius(settings.coreSize);
  const arms = Math.max(1, Math.round(settings.arms));

  let i = 0;
  for (let f = 0; f < flareCount; f++, i++) {
    const fraction = GALAXY_FLARE_FRACTIONS[f % GALAXY_FLARE_FRACTIONS.length];
    const radius = 1 - fraction * (1 - GALAXY_RADIUS_MIN);
    const arm = f % arms;
    field.radius[i] = radius;
    field.arm[i] = arm;
    field.jitter[i] = 0;
    field.angle[i] = galaxySpineAngle(radius, arm, settings);
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
    const radius = GALAXY_RADIUS_MIN + (1 - GALAXY_RADIUS_MIN) * Math.pow(random(), RADIUS_BIAS);
    seedArmStar(field, i, radius, Math.floor(random() * arms) % arms, settings, 0);
  }
  writeCartesian(field);
  return field;
}

function writeCartesian(field: GalaxyField): void {
  const { count, x, y, radius, angle } = field;
  for (let i = 0; i < count; i++) {
    x[i] = radius[i] * Math.cos(angle[i]);
    y[i] = radius[i] * Math.sin(angle[i]);
  }
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/**
 * Advance the field by `dtSeconds`, in place. Returns the same field object.
 *
 * Spin: every star's angle grows by spinSpeed × dt ÷ r^(differential/100),
 * so at differential 0 the disc turns as one piece and at 100 the innermost
 * star turns 1/r times as fast as the rim. Clockwise means a growing angle,
 * which is clockwise on a canvas (y down).
 *
 * Flow: arm stars drift toward the centre at flowSpeed, and they drift ALONG
 * their arm — the angle takes the spine's own change over that radius as
 * well, so an arm stays an arm. Without that the stars would keep their
 * angle while the spine under them swung through several radians on the way
 * in, and a minute of flow would smear the spiral into a plain disc. A star
 * that reaches the core is re-seeded at the outer end of the same arm, with
 * fresh jitter, starting at the rim's accumulated spin so it lands among its
 * neighbours rather than a lap behind them. Flare stars are pinned and the
 * core cluster is already home, so neither flows.
 *
 * Twinkle: the phase advances at twinkle × 1 Hz and wraps, so it never grows
 * past what a float32 can hold precisely.
 *
 * The caller clamps `dt` (plan rule 5, 50 ms); this function only refuses a
 * non-finite or negative one.
 */
export function stepGalaxyField(field: GalaxyField, dtSeconds: number, settings: GalaxySettings): GalaxyField {
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
  if (dt === 0) return field;
  const { count, radius, angle, arm, flare, twinklePhase } = field;
  const direction = settings.spinDirection === "counterclockwise" ? -1 : 1;
  const spinRate = direction * (clamp(settings.spinSpeed, 0, 100) / 100) * SPIN_RADIANS_PER_SECOND_AT_MAX;
  const exponent = clamp(settings.differential, 0, 100) / 100;
  const flow = (clamp(settings.flowSpeed, 0, 100) / 100) * FLOW_UNITS_PER_SECOND_AT_MAX * dt;
  const twinkleStep = (clamp(settings.twinkle, 0, 100) / 100) * TWINKLE_RADIANS_PER_SECOND_AT_MAX * dt;
  const twist = galaxyTwist(settings.turns);
  const sigma = galaxyArmSigma(settings.armWidth);
  const coreEdge = Math.max(GALAXY_RADIUS_MIN, galaxyCoreRadius(settings.coreSize));

  field.rimSpin += spinRate * dt;

  for (let i = 0; i < count; i++) {
    const r = radius[i];
    // Spin — the differential is a power of the radius, and r is never below
    // GALAXY_RADIUS_MIN for arm stars; core stars at tiny radii are held at
    // that floor so a star at the exact centre does not spin infinitely fast.
    const rForSpin = Math.max(GALAXY_RADIUS_MIN, r);
    angle[i] += (spinRate * dt) / (exponent === 0 ? 1 : Math.pow(rForSpin, exponent));

    // Flow — arm stars only, along the arm.
    if (flow > 0 && arm[i] !== GALAXY_CORE_ARM && flare[i] === 0) {
      const next = r - flow;
      if (next <= coreEdge) {
        seedArmStar(field, i, 1, arm[i], settings, field.rimSpin);
        // seedArmStar rewrote angle/jitter/size/brightness/phase/colour; z is fresh too.
      } else {
        angle[i] += twist * Math.log(next / r);
        radius[i] = next;
      }
    }

    // Twinkle.
    let phase = twinklePhase[i] + twinkleStep;
    if (phase >= TWO_PI) phase -= TWO_PI;
    twinklePhase[i] = phase;
  }
  // Angles grow without bound under spin; fold them so float32 keeps its
  // precision over a long visit. (A wrap does not change cos/sin.)
  for (let i = 0; i < count; i++) {
    if (angle[i] > TWO_PI * 64 || angle[i] < -TWO_PI * 64) angle[i] %= TWO_PI;
  }
  writeCartesian(field);
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
}

/** The unit disc fills this fraction of the shorter viewport side. */
export const GALAXY_VIEWPORT_FILL = 0.92;

export function createGalaxyProjection(count: number): GalaxyProjection {
  const n = Math.max(0, Math.round(count));
  return { x: new Float32Array(n), y: new Float32Array(n), depth: new Float32Array(n), scale: 0 };
}

/**
 * Rotate the field — yaw about the screen's vertical axis, then pitch about
 * its horizontal one — and project it orthographically to pixels centred in
 * the viewport, into `out`. Returns `out`. Nothing is allocated: the arrays
 * are the caller's, sized by `createGalaxyProjection(field.count)`.
 *
 * Orthographic on purpose: at yaw 0 and pitch 0 every star's distance from
 * the centre is exactly its field radius times `out.scale`, which is what
 * lets a test hold the projection still. Perspective, if a renderer wants
 * it, is a size tweak off `depth`, not a change to where a star lands.
 *
 * A star past the end of `out` is dropped rather than written out of bounds.
 */
export function projectGalaxyField(
  field: GalaxyField,
  yaw: number,
  pitch: number,
  viewportW: number,
  viewportH: number,
  out: GalaxyProjection
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
  const { x, y, z } = field;
  const n = Math.min(field.count, out.x.length, out.y.length, out.depth.length);
  const ox = out.x;
  const oy = out.y;
  const od = out.depth;
  for (let i = 0; i < n; i++) {
    const px = x[i];
    const py = y[i];
    const pz = z[i];
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
  return out;
}

// ---------------------------------------------------------------------------
// Device budget
// ---------------------------------------------------------------------------

export type GalaxyDeviceTier = "high" | "mid" | "low";

/**
 * Which class of machine is looking, from what a browser will admit to.
 * `saveData` is the visitor asking for less, and wins outright. A browser
 * that reports nothing (Safari hides `deviceMemory`) is treated as mid, not
 * high: guessing high on an old phone is the guess that stutters.
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
  if ((cores !== null && cores <= 4) || (memory !== null && memory <= 4)) return "mid";
  if (cores === null && memory === null) return "mid";
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
