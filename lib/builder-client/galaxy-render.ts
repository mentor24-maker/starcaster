/**
 * Galaxy render — how a field of stars becomes pixels on a Canvas 2D.
 *
 * `galaxy-field.ts` (slice 1) owns every number that places and moves a star
 * and has no DOM in it. This file owns the other half: the module's LOOK
 * settings (colours, haze, glow, opacity), the four presets, the glow sprites,
 * and `drawGalaxyFrame`, which is the ONE function that paints a frame.
 *
 * ONE DRAW FUNCTION, TWO CALLERS. The Builder card (a still) and the page
 * runtime (animated) both paint through `drawGalaxyFrame`. TractorNav is why:
 * its card drew concentric rings while its runtime drew a row of circles, and
 * because the card looked right nobody noticed for two months
 * (docs/PROXIMITY_EFFECTS.md). A card and a page that share their painter
 * cannot disagree about what a galaxy looks like.
 *
 * GLOW IS PRE-DRAWN. A radial gradient per star per frame is thousands of
 * gradient objects sixty times a second. Instead each colour × size class gets
 * one small offscreen canvas with the soft star already painted on it, and a
 * frame is just `drawImage` calls blended with `"lighter"` — overlapping glow
 * adds up the way light does.
 *
 * Task 86bc7f5hg (Galaxy module 2/6). docs/GALAXY.md.
 */

import {
  GALAXY_DEFAULT_PALETTE,
  GALAXY_SETTING_DEFAULTS,
  galaxyCoreRadius,
  mulberry32,
  type GalaxyField,
  type GalaxyProjection
} from "./galaxy-field";

// ---------------------------------------------------------------------------
// Look settings
// ---------------------------------------------------------------------------

/** How many colour slots the panel offers (c1..c5 with weights w1..w5). */
export const GALAXY_COLOUR_SLOTS = 5;

/** The haze the reference page lays behind its stars. */
export const GALAXY_DEFAULT_HAZE = "#23435F";

/** Defaults for the look keys, as strings like every module setting. */
export const GALAXY_LOOK_DEFAULTS: Record<string, string> = {
  glow: "70",
  opacity: "100",
  haze: GALAXY_DEFAULT_HAZE,
  hazeStrength: "55",
  // Galaxy module 5/6 (task 86bc7f5hm): the four-point streak on a flare star.
  flareSize: "41",
  flareIntensity: "28",
  w1: "52",
  w2: "15",
  w3: "18",
  w4: "7",
  w5: "8"
};

export interface GalaxyLook {
  /** Five colours as [r, g, b], already resolved: an empty slot is the reference colour. */
  colours: [number, number, number][];
  /** Five weights, 0..100. All zero is read as the reference weights rather than "no stars". */
  weights: number[];
  /** 0..1 — how far each star's halo reaches. */
  glow: number;
  /** 0..1 — the whole field's opacity. */
  opacity: number;
  haze: [number, number, number];
  /** 0..1 */
  hazeStrength: number;
  /** 0..1 — flareSize / 100. 0.41 (the default) draws a streak reaching `GALAXY_FLARE_REACH` field radii. */
  flareSize: number;
  /** 0..1 — how bright a flare star's streak is. */
  flareIntensity: number;
  /** 0..1 — how deep a star's twinkle dips; the engine reads the same setting for how fast. */
  twinkle: number;
  /** 0..100 — the engine's Core Size, which sizes the core glow. */
  coreSize: number;
  /** 0..1 — the engine's Core Stars, which sets the core glow's brightness. */
  coreStrength: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readPercent(bag: Record<string, string | undefined>, key: string): number {
  const parsed = Number.parseFloat(String(bag[key] ?? ""));
  const fallback = Number.parseFloat(GALAXY_LOOK_DEFAULTS[key] ?? GALAXY_SETTING_DEFAULTS[key] ?? "0");
  return clamp(Number.isFinite(parsed) ? parsed : fallback, 0, 100);
}

/**
 * `#rgb` or `#rrggbb` to [r, g, b]; anything else is null. The colour fields
 * write hex, and a value this cannot read falls back to the slot's reference
 * colour rather than painting black — a black star on a black sky is a star
 * that silently vanished.
 */
export function parseHexColour(value: string | undefined): [number, number, number] | null {
  const clean = String(value ?? "").trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * String bag in, resolved look out. An EMPTY colour slot means "follow the
 * default" — the theme-colour control's reset — and resolves to the
 * reference palette's colour for that slot, because no site theme carries
 * star colours to follow.
 */
export function readGalaxyLook(bag: Record<string, string | undefined> = {}): GalaxyLook {
  const colours: [number, number, number][] = [];
  const weights: number[] = [];
  for (let i = 0; i < GALAXY_COLOUR_SLOTS; i++) {
    const reference = GALAXY_DEFAULT_PALETTE[i];
    colours.push(parseHexColour(bag[`c${i + 1}`]) ?? (parseHexColour(reference.hex) as [number, number, number]));
    weights.push(readPercent(bag, `w${i + 1}`));
  }
  return {
    colours,
    weights,
    glow: readPercent(bag, "glow") / 100,
    opacity: readPercent(bag, "opacity") / 100,
    haze: parseHexColour(bag.haze) ?? (parseHexColour(GALAXY_DEFAULT_HAZE) as [number, number, number]),
    hazeStrength: readPercent(bag, "hazeStrength") / 100,
    flareSize: readPercent(bag, "flareSize") / 100,
    flareIntensity: readPercent(bag, "flareIntensity") / 100,
    twinkle: readPercent(bag, "twinkle") / 100,
    coreSize: readPercent(bag, "coreSize"),
    coreStrength: readPercent(bag, "coreStrength") / 100
  };
}

/**
 * Which colour slot each star wears, by INDEX, from the panel's weights.
 *
 * The engine stamps its own `colour` per star from the reference weights and
 * re-stamps it whenever a star streams in to the core and is re-seeded at the
 * rim — so honouring the panel's weights through `field.colour` would drift
 * back to the reference mix within a minute of flow. A star's colour is
 * therefore a property of its slot in the arrays: re-seeding keeps the index,
 * so it keeps the colour, and the mix on screen is the mix the panel asked
 * for for as long as the page is open. Flare stars (index below `flareCount`)
 * keep slot 0, the near-white, as the engine intends.
 *
 * Seeded from the field's seed so the same settings colour the same stars on
 * every load.
 */
export function assignGalaxyColours(count: number, weights: number[], seed: number, flareCount = 0): Uint8Array {
  const out = new Uint8Array(Math.max(0, count));
  const usable = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  let total = usable.reduce((sum, w) => sum + w, 0);
  const table = total > 0 ? usable : GALAXY_DEFAULT_PALETTE.map((entry) => entry.weight);
  if (total <= 0) total = table.reduce((sum, w) => sum + w, 0);
  const random = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  for (let i = 0; i < out.length; i++) {
    if (i < flareCount) {
      out[i] = 0;
      continue;
    }
    let pick = random() * total;
    let slot = 0;
    for (; slot < table.length - 1; slot++) {
      pick -= table[slot];
      if (pick < 0) break;
    }
    out[i] = slot;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * A preset is a set of VALUES, not a mode: choosing one writes these keys into
 * the module's settings and that is the end of its involvement. Nothing reads
 * a preset name at render time, so a slider moved afterwards simply wins, and
 * the panel shows "Custom" until the values match a preset again.
 *
 * Astra is the reference picture — the engine's defaults and the reference
 * page's palette. Classic, Nebula and Subtle follow the plan's brief for
 * each (task 86bc7f5hm): docs/GALAXY.md, "Look", has the table.
 */
export const GALAXY_PRESETS: Record<string, Record<string, string>> = {
  // The reference picture: the engine's defaults and the reference page's palette.
  astra: {
    particleCount: "4000", arms: "2", turns: "2.35", armWidth: "40", coreSize: "12", coreStrength: "66",
    flareStars: "7", starSize: "2", spinSpeed: "10", differential: "50", flowSpeed: "30", twinkle: "60",
    c1: "#F5F6FB", c2: "#6DCBF4", c3: "#7AB1FE", c4: "#F87915", c5: "#FA994C",
    w1: "52", w2: "15", w3: "18", w4: "7", w5: "8",
    haze: "#23435F", hazeStrength: "55", glow: "70", opacity: "100", flareSize: "41", flareIntensity: "28"
  },
  // A textbook spiral: three looser arms, white and pale blue only, a bare black sky.
  classic: {
    particleCount: "5000", arms: "3", turns: "1.6", armWidth: "35", coreSize: "14", coreStrength: "70",
    flareStars: "5", starSize: "1.8", spinSpeed: "8", differential: "40", flowSpeed: "25", twinkle: "45",
    c1: "#FFFFFF", c2: "#CFE3FF", c3: "#7AB1FE", c4: "#F87915", c5: "#FA994C",
    w1: "60", w2: "40", w3: "0", w4: "0", w5: "0",
    haze: "#23435F", hazeStrength: "0", glow: "60", opacity: "100", flareSize: "36", flareIntensity: "24"
  },
  // Two wide, soft arms in purples over a strong violet haze.
  nebula: {
    particleCount: "3000", arms: "2", turns: "2", armWidth: "75", coreSize: "16", coreStrength: "55",
    flareStars: "6", starSize: "2.4", spinSpeed: "6", differential: "50", flowSpeed: "25", twinkle: "70",
    c1: "#B388FF", c2: "#7AB1FE", c3: "#F5F6FB", c4: "#F87915", c5: "#FA994C",
    w1: "45", w2: "30", w3: "25", w4: "0", w5: "0",
    haze: "#1B1040", hazeStrength: "90", glow: "85", opacity: "100", flareSize: "48", flareIntensity: "30"
  },
  // A quiet background: fewer, smaller, dimmer stars, turning slowly.
  subtle: {
    particleCount: "1500", arms: "2", turns: "2.35", armWidth: "45", coreSize: "10", coreStrength: "45",
    flareStars: "3", starSize: "1.6", spinSpeed: "4", differential: "30", flowSpeed: "15", twinkle: "30",
    c1: "#F5F6FB", c2: "#6DCBF4", c3: "#7AB1FE", c4: "#F87915", c5: "#FA994C",
    w1: "52", w2: "15", w3: "18", w4: "7", w5: "8",
    haze: "#23435F", hazeStrength: "30", glow: "40", opacity: "60", flareSize: "30", flareIntensity: "16"
  }
};

export const GALAXY_PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: "astra", label: "Astra" },
  { value: "classic", label: "Classic" },
  { value: "nebula", label: "Nebula" },
  { value: "subtle", label: "Subtle" }
];

function sameValue(a: string | undefined, b: string): boolean {
  if ((a ?? "").toLowerCase() === b.toLowerCase()) return true;
  const na = Number.parseFloat(String(a ?? ""));
  const nb = Number.parseFloat(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/** Which preset the settings currently match exactly, or "custom" when none does. */
export function matchGalaxyPreset(settings: Record<string, string | undefined>): string {
  for (const option of GALAXY_PRESET_OPTIONS) {
    const values = GALAXY_PRESETS[option.value];
    if (Object.entries(values).every(([key, value]) => sameValue(settings[key], value))) return option.value;
  }
  return "custom";
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/**
 * Star radii (CSS pixels) the sprites are painted at. A star is drawn with the
 * sprite of the nearest class and scaled to its exact size by `drawImage`, so
 * the classes only need to be close enough that scaling never blurs a small
 * star or pixelates a big one.
 */
export const GALAXY_SIZE_CLASSES = [0.75, 1.25, 2, 3, 4.5, 7, 11, 18];

/** At glow 100 a halo reaches this many core radii out from the centre. */
const HALO_REACH_AT_MAX = 4;

/** How far, in core radii, a star's sprite extends at this glow. Always at least 1.6 so a star has a soft edge. */
export function galaxyHaloReach(glow: number): number {
  return 1.6 + clamp(glow, 0, 1) * (HALO_REACH_AT_MAX - 1.6);
}

/** Something with a 2D context and a size — an HTMLCanvasElement or OffscreenCanvas. */
export type GalaxySpriteCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): unknown;
};

export interface GalaxySprites {
  /** `canvases[colour][sizeClass]`; null where a context could not be had. */
  canvases: (GalaxySpriteCanvas | null)[][];
  /** The halo reach the sprites were painted with, in core radii. */
  reach: number;
  /**
   * The flare streak: one horizontal line and one vertical, in the flare
   * stars' colour (slot 0). Null where a context could not be had — flare
   * stars are then drawn as round stars, nothing more.
   */
  flare: { horizontal: GalaxySpriteCanvas; vertical: GalaxySpriteCanvas } | null;
}

// ---------------------------------------------------------------------------
// Flare streaks
// ---------------------------------------------------------------------------

/**
 * How far a flare streak reaches from its star at flareSize 41 (the
 * default), in FIELD radii — 0.085 of the galaxy's radius, so the streak
 * keeps its proportion from the Builder card to a full window. Other sizes
 * scale linearly: flareSize 82 reaches twice as far.
 */
export const GALAXY_FLARE_REACH = 0.085;
/** The flareSize the reach above is quoted at. */
export const GALAXY_FLARE_REACH_AT = 41;
/** The streak's cross-section: a gaussian with this standard deviation, in CSS pixels. */
export const GALAXY_FLARE_SIGMA_PX = 0.7;
/** The streak sprite's thickness in CSS pixels — six sigma, so the gaussian has faded to nothing at its edges. */
export const GALAXY_FLARE_THICKNESS_PX = 6 * GALAXY_FLARE_SIGMA_PX;
/** The sprite's length in CSS pixels before `drawImage` stretches it to the streak's reach. */
const FLARE_SPRITE_LENGTH_PX = 128;

/** Streak reach in CSS pixels, for a galaxy drawn at `scale` px per field radius. */
export function galaxyFlareReachPx(flareSize: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const size = clamp(Number.isFinite(flareSize) ? flareSize : 0, 0, 1) * 100;
  return GALAXY_FLARE_REACH * (size / GALAXY_FLARE_REACH_AT) * scale;
}

/**
 * Peak opacity of a streak at its centre. flareIntensity 28 (the default)
 * gives 0.7, and 40 and above saturate — the streak is drawn with
 * `"lighter"` over everything else, so past full opacity there is nothing
 * left to add.
 */
export function galaxyFlareAlpha(flareIntensity: number): number {
  return clamp((Number.isFinite(flareIntensity) ? flareIntensity : 0) * 2.5, 0, 1);
}

/**
 * The brightness of one streak pixel: `u` runs -1..1 along the line (0 at
 * the star), `d` is the distance across it in CSS pixels. A gaussian across,
 * and a fall-off along that is steep near the star and long in the tail,
 * which is what reads as a diffraction spike rather than a plus sign.
 */
export function galaxyFlarePixel(u: number, d: number): number {
  const along = Math.pow(Math.max(0, 1 - Math.abs(u)), 2.2);
  const across = Math.exp(-(d * d) / (2 * GALAXY_FLARE_SIGMA_PX * GALAXY_FLARE_SIGMA_PX));
  return along * across;
}

/**
 * Paint the two streak sprites. Pixel by pixel through ImageData, because a
 * line that is a gaussian across and a power curve along is two gradients
 * multiplied, which Canvas 2D has no one call for. It is 128 × 5 pixels,
 * painted once per settings change, never per frame.
 *
 * Two sprites rather than one plus-shaped one so `drawImage` can stretch
 * each ALONG its length only: the streak's reach follows the canvas size,
 * and its thickness stays a hairline at every size.
 */
export function buildGalaxyFlareSprite(
  colour: [number, number, number],
  pixelRatio: number,
  makeCanvas: (width: number, height: number) => GalaxySpriteCanvas
): GalaxySprites["flare"] {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const length = Math.max(8, Math.round(FLARE_SPRITE_LENGTH_PX * ratio));
  const thickness = Math.max(3, Math.round(GALAXY_FLARE_THICKNESS_PX * ratio) | 1);
  const paint = (width: number, height: number, horizontal: boolean): GalaxySpriteCanvas | null => {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!ctx || typeof ctx.createImageData !== "function" || typeof ctx.putImageData !== "function") return null;
    let image: ImageData | undefined;
    try {
      image = ctx.createImageData(width, height);
    } catch {
      return null;
    }
    // The same "existing is not working" rule as galaxyRadialGradient.
    if (!image || !image.data || image.data.length < width * height * 4) return null;
    const [r, g, b] = colour;
    const midLength = (length - 1) / 2;
    const midThick = (thickness - 1) / 2;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const along = horizontal ? px : py;
        const across = horizontal ? py : px;
        const value = galaxyFlarePixel((along - midLength) / midLength, (across - midThick) / ratio);
        const o = (py * width + px) * 4;
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = Math.round(255 * value);
      }
    }
    try {
      ctx.putImageData(image, 0, 0);
    } catch {
      return null;
    }
    return canvas;
  };
  const horizontal = paint(length, thickness, true);
  const vertical = paint(thickness, length, false);
  return horizontal && vertical ? { horizontal, vertical } : null;
}

/**
 * A radial gradient, or null when the context cannot actually make one.
 *
 * The method EXISTING is not the same as the method WORKING: jsdom (and any
 * degraded or stubbed 2D context) exposes `createRadialGradient` and returns
 * `undefined` from it, so a `typeof ctx.createRadialGradient === "function"`
 * guard passes and the very next `.addColorStop` throws. A throw inside the
 * runtime's effect unmounts the React tree the module sits in, which on a
 * published tenant page is a blank screen for a visitor. So every gradient in
 * this file comes through here, and callers treat null as "paint without it".
 */
export function galaxyRadialGradient(
  ctx: { createRadialGradient?: unknown },
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number
): CanvasGradient | null {
  const make = ctx.createRadialGradient;
  if (typeof make !== "function") return null;
  let gradient: unknown;
  try {
    gradient = (make as CanvasRenderingContext2D["createRadialGradient"]).call(
      ctx as CanvasRenderingContext2D,
      x0,
      y0,
      r0,
      x1,
      y1,
      r1
    );
  } catch {
    return null;
  }
  if (!gradient || typeof (gradient as CanvasGradient).addColorStop !== "function") return null;
  return gradient as CanvasGradient;
}

/**
 * Paint one sprite per colour × size class. `makeCanvas` is injected so a test
 * can count what was built without a real canvas; the runtime passes
 * `document.createElement("canvas")`.
 */
export function buildGalaxySprites(
  look: GalaxyLook,
  pixelRatio: number,
  makeCanvas: (width: number, height: number) => GalaxySpriteCanvas
): GalaxySprites {
  const reach = galaxyHaloReach(look.glow);
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const canvases = look.colours.map(([r, g, b]) =>
    GALAXY_SIZE_CLASSES.map((radius) => {
      const side = Math.max(4, Math.ceil(radius * reach * 2 * ratio));
      const canvas = makeCanvas(side, side);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
      if (!ctx) return null;
      const centre = side / 2;
      const gradient = galaxyRadialGradient(ctx, centre, centre, 0, centre, centre, centre);
      if (!gradient) return null;
      // The core: solid out to one core radius (1 / reach of the sprite), then
      // the halo falls away to nothing at the sprite's edge.
      const core = 1 / reach;
      gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
      gradient.addColorStop(core * 0.55, `rgba(${r},${g},${b},0.95)`);
      gradient.addColorStop(core, `rgba(${r},${g},${b},0.5)`);
      gradient.addColorStop(Math.min(0.98, core + (1 - core) * 0.35), `rgba(${r},${g},${b},${(0.08 + 0.17 * look.glow).toFixed(3)})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, side, side);
      return canvas;
    })
  );
  return { canvases, reach, flare: buildGalaxyFlareSprite(look.colours[0], ratio, makeCanvas) };
}

/** The nearest size class for a radius in CSS pixels. */
export function galaxySizeClass(radius: number): number {
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < GALAXY_SIZE_CLASSES.length; i++) {
    const gap = Math.abs(GALAXY_SIZE_CLASSES[i] - radius);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** The page's backdrop under the haze — the reference page is black. */
export const GALAXY_BACKDROP = "#000000";

/**
 * A star's brightness multiplier at this twinkle phase: 1 at the top of its
 * cycle, and down to 1 − twinkle at the bottom — so Twinkle 0 is a still sky
 * and Twinkle 100 lets a star go dark for an instant. The plan's formula,
 * base × (1 − twinkle × 0.5 × (1 + sin(phase))).
 */
export function galaxyTwinkle(twinkle: number, phase: number): number {
  const depth = clamp(Number.isFinite(twinkle) ? twinkle : 0, 0, 1);
  return 1 - depth * 0.5 * (1 + Math.sin(Number.isFinite(phase) ? phase : 0));
}

/** The core glow reaches this many core radii — wide enough to read as light around the core, not a disc. */
export const GALAXY_CORE_GLOW_REACH = 2.6;
/** The core glow is never smaller than this many field radii, so Core Size 0 still has a faint centre. */
export const GALAXY_CORE_GLOW_MIN = 0.05;
/** Peak opacity of the core glow at Core Stars 100. */
export const GALAXY_CORE_GLOW_PEAK = 0.85;

/** The core glow's radius in CSS pixels, for a galaxy drawn at `scale` px per field radius. */
export function galaxyCoreGlowRadiusPx(coreSize: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  return Math.max(GALAXY_CORE_GLOW_MIN, galaxyCoreRadius(coreSize)) * GALAXY_CORE_GLOW_REACH * scale;
}

/**
 * The core glow's colour: the near-white slot warmed a third of the way
 * toward the last (the reference's pale orange), because the reference's
 * core is a warm white, not a blue one.
 */
export function galaxyCoreGlowColour(look: GalaxyLook): [number, number, number] {
  const [r1, g1, b1] = look.colours[0];
  const [r2, g2, b2] = look.colours[look.colours.length - 1];
  const mix = (a: number, b: number) => Math.round(a + (b - a) / 3);
  return [mix(r1, r2), mix(g1, g2), mix(b1, b2)];
}

export interface GalaxyFrameInput {
  field: GalaxyField;
  /** Already projected by `projectGalaxyField` for this frame. */
  projection: GalaxyProjection;
  /** Colour slot per star index — `assignGalaxyColours`. */
  colourOf: Uint8Array;
  /** CSS pixel size of what is being drawn into. */
  width: number;
  height: number;
  /** Nudge from the centre, CSS pixels; positive Y moves the galaxy UP. */
  offsetX?: number;
  offsetY?: number;
  /**
   * 0..1 — how assembled the galaxy is (the intro's converge). The core glow
   * scales by it, so the centre lights up as the stars arrive rather than
   * glowing alone in an empty sky. Left out, 1.
   */
  assembled?: number;
}

/** The subset of CanvasRenderingContext2D a frame uses, so a test can pass a recorder. */
export type GalaxyDrawContext = Pick<
  CanvasRenderingContext2D,
  "fillStyle" | "globalAlpha" | "globalCompositeOperation" | "fillRect" | "drawImage" | "createRadialGradient"
>;

/**
 * Paint one frame: backdrop, haze, the core glow, then every star as a
 * sprite blended with `"lighter"` — a flare star's streak drawn just under
 * its round sprite. Returns how many stars were actually drawn (stars entirely off
 * the canvas are skipped). Both the card and the runtime call this, and
 * nothing else in the module paints a star.
 */
export function drawGalaxyFrame(
  ctx: GalaxyDrawContext,
  input: GalaxyFrameInput,
  look: GalaxyLook,
  sprites: GalaxySprites
): number {
  const { field, projection, colourOf, width, height } = input;
  const offsetX = Number.isFinite(input.offsetX) ? (input.offsetX as number) : 0;
  const offsetY = Number.isFinite(input.offsetY) ? -(input.offsetY as number) : 0;

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = GALAXY_BACKDROP;
  ctx.fillRect(0, 0, width, height);

  // The haze: one gradient per frame, never one per star.
  const cx = width / 2 + offsetX;
  const cy = height / 2 + offsetY;
  const hazeRadius = Math.max(1, projection.scale * 1.15);
  if (look.hazeStrength > 0 && projection.scale > 0) {
    const [hr, hg, hb] = look.haze;
    const haze = galaxyRadialGradient(ctx, cx, cy, 0, cx, cy, hazeRadius);
    if (haze) {
      haze.addColorStop(0, `rgba(${hr},${hg},${hb},${(0.6 * look.hazeStrength).toFixed(3)})`);
      haze.addColorStop(0.5, `rgba(${hr},${hg},${hb},${(0.25 * look.hazeStrength).toFixed(3)})`);
      haze.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);
    }
  }

  if (look.opacity <= 0) return 0;
  ctx.globalCompositeOperation = "lighter";

  // The core glow: one gradient per frame, filled over its own box only.
  const assembled = clamp(Number.isFinite(input.assembled) ? (input.assembled as number) : 1, 0, 1);
  const coreAlpha = GALAXY_CORE_GLOW_PEAK * look.coreStrength * look.opacity * assembled;
  const coreRadius = galaxyCoreGlowRadiusPx(look.coreSize, projection.scale);
  if (coreAlpha > 0 && coreRadius > 0) {
    const [kr, kg, kb] = galaxyCoreGlowColour(look);
    const core = galaxyRadialGradient(ctx, cx, cy, 0, cx, cy, coreRadius);
    if (core) {
      core.addColorStop(0, `rgba(${kr},${kg},${kb},${coreAlpha.toFixed(3)})`);
      core.addColorStop(0.18, `rgba(${kr},${kg},${kb},${(coreAlpha * 0.55).toFixed(3)})`);
      core.addColorStop(0.5, `rgba(${kr},${kg},${kb},${(coreAlpha * 0.14).toFixed(3)})`);
      core.addColorStop(1, `rgba(${kr},${kg},${kb},0)`);
      ctx.fillStyle = core;
      ctx.fillRect(cx - coreRadius, cy - coreRadius, coreRadius * 2, coreRadius * 2);
    }
  }

  const flare = sprites.flare;
  const flareReach = galaxyFlareReachPx(look.flareSize, projection.scale);
  const flareAlpha = galaxyFlareAlpha(look.flareIntensity);
  const drawFlares = Boolean(flare) && flareReach > 0 && flareAlpha > 0;
  const flareThickness = GALAXY_FLARE_THICKNESS_PX;
  const { size, brightness, twinklePhase } = field;
  const isFlare = field.flare;
  const px = projection.x;
  const py = projection.y;
  const n = Math.min(projection.count, field.count, colourOf.length);
  const reach = sprites.reach;
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const radius = size[i];
    const half = radius * reach;
    const x = px[i] + offsetX;
    const y = py[i] + offsetY;
    if (x + half < 0 || y + half < 0 || x - half > width || y - half > height) continue;
    const sprite = sprites.canvases[colourOf[i]]?.[galaxySizeClass(radius)];
    if (!sprite) continue;
    const shine = clamp(brightness[i] * galaxyTwinkle(look.twinkle, twinklePhase[i]) * look.opacity, 0, 1);
    if (drawFlares && isFlare[i] === 1) {
      ctx.globalAlpha = clamp(shine * flareAlpha, 0, 1);
      ctx.drawImage(flare!.horizontal as unknown as CanvasImageSource, x - flareReach, y - flareThickness / 2, flareReach * 2, flareThickness);
      ctx.drawImage(flare!.vertical as unknown as CanvasImageSource, x - flareThickness / 2, y - flareReach, flareThickness, flareReach * 2);
    }
    ctx.globalAlpha = shine;
    ctx.drawImage(sprite as unknown as CanvasImageSource, x - half, y - half, half * 2, half * 2);
    drawn += 1;
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return drawn;
}
