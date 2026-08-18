/**
 * Proximity effects — the shared engine behind "something answers the cursor".
 *
 * Two features in this codebase already did this job by different means. The
 * TractorNav module drew concentric rings and lit whichever one the pointer
 * was inside. The Explore link on the login screen grew a blurred oval of
 * light that swelled the closer you got. They are the SAME driver with two
 * renderers: measure the pointer's distance from a centre, turn it into one
 * 0-to-1 number, and paint something off that number.
 *
 * This file is the driver, and nothing else. It has no DOM in it, which is
 * the point — the geometry is pure arithmetic, so it can be unit-tested, and
 * in a repo where NOTHING tests CSS that is the only part of an effect that
 * can be held still. The renderers live with whoever draws:
 * `components/builder-tractor-nav-module.tsx` owns the elements and the
 * stylesheet, and calls in here for every number it needs.
 *
 * The 0-to-1 number is deliberately the whole interface. Continuous renderers
 * (Glow, Spotlight, Swell) read it straight; the stepped renderer (Rings)
 * asks a second question — which band am I in — and gets an index. That is
 * the only real difference between "concentric circles" and "a halo", and
 * having it be one branch rather than two implementations is the tool.
 */

/** What the cursor's approach actually draws. */
export const PROXIMITY_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: "rings",     label: "Rings" },
  { value: "glow",      label: "Glow" },
  { value: "spotlight", label: "Spotlight" },
  { value: "swell",     label: "Swell" }
];

export const DEFAULT_PROXIMITY_EFFECT = "rings";

/**
 * How far away the pointer is first felt, in pixels.
 *
 * Rings do not use it: their reach IS the outer ring, and a second number
 * that silently disagreed with the drawn circle would be a control that
 * looks like it does something and does not.
 */
export const DEFAULT_PROXIMITY_REACH = 460;

/**
 * The shape of the approach. 1 is linear — the light rises at a constant rate
 * the whole way in, which reads as a flat wash. Above 1 holds the effect back
 * until the pointer is genuinely close and then opens it quickly, which is
 * what makes it feel like a response rather than a gradient.
 */
export const DEFAULT_PROXIMITY_FALLOFF = 2;

/**
 * What the effect sits at with the pointer nowhere near.
 *
 * Not zero for the Explore link, whose glow has to still burn with JS off, on
 * a phone, or before the first mouse move — a resting value is what makes the
 * effect degrade to a static design rather than to nothing. Zero is right for
 * Rings, which have nothing to say until you approach.
 */
export const DEFAULT_PROXIMITY_REST = 0;

export const PROXIMITY_REACH_MIN = 40;
export const PROXIMITY_REACH_MAX = 2000;
export const PROXIMITY_FALLOFF_MIN = 1;
export const PROXIMITY_FALLOFF_MAX = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Which presets draw concentric bands rather than one continuous shape. */
export function proximityUsesRings(effect: string | undefined): boolean {
  return (effect || DEFAULT_PROXIMITY_EFFECT) === "rings";
}

/**
 * Which presets read the continuous 0-to-1 value, and therefore need Reach
 * and Falloff. Rings are the odd one out, so this is not simply "not rings" —
 * it is stated positively so a new stepped preset does not silently inherit
 * two controls that do nothing for it.
 */
export function proximityIsContinuous(effect: string | undefined): boolean {
  const value = effect || DEFAULT_PROXIMITY_EFFECT;
  return value === "glow" || value === "spotlight" || value === "swell";
}

/** Presets that paint a body of light, and so want a colour and an intensity. */
export function proximityGlows(effect: string | undefined): boolean {
  const value = effect || DEFAULT_PROXIMITY_EFFECT;
  return value === "glow" || value === "spotlight";
}

/**
 * The distance-to-brightness curve. One number in, one number out.
 *
 * `coreRadius` is the distance inside which the effect is simply at full —
 * without it the value would only reach 1 at the exact centre pixel, so
 * crossing the middle of the shape would read as a dip rather than a peak.
 *
 * Returns `rest` at or beyond `reach`, 1 at or inside `coreRadius`, and an
 * eased blend between. Guards its own inputs because it is called from a
 * mousemove path where one NaN would write "NaN" into a custom property and
 * kill the whole effect silently.
 */
export function proximityValue(input: {
  distance: number;
  coreRadius?: number;
  reach?: number;
  falloff?: number;
  rest?: number;
}): number {
  const reach = Math.max(1, input.reach ?? DEFAULT_PROXIMITY_REACH);
  const rest = clamp(input.rest ?? DEFAULT_PROXIMITY_REST, 0, 1);
  const falloff = Math.max(0.01, input.falloff ?? DEFAULT_PROXIMITY_FALLOFF);
  const distance = Number.isFinite(input.distance) ? Math.max(0, input.distance) : reach;
  // A core wider than the reach would invert the curve, so it is capped just
  // inside it; the effect then still has somewhere to travel.
  const coreRadius = clamp(input.coreRadius ?? 0, 0, reach - 1);

  if (distance <= coreRadius) return 1;
  if (distance >= reach) return rest;

  const closeness = 1 - (distance - coreRadius) / (reach - coreRadius);
  const eased = Math.pow(closeness, falloff);
  return rest + (1 - rest) * eased;
}

/**
 * Ring diameters, outermost first.
 *
 * Linear steps every ring by the same number of pixels. Power Curve spaces
 * them so they bunch toward the centre, which is what makes a large ring set
 * read as depth rather than as a target.
 */
export function computeRingSizes(input: {
  dotSize: number;
  ringCount: number;
  sizingMode: string;
  ringStep: number;
  outerSize: number;
  curve: number;
}): number[] {
  const count = Math.max(1, Math.floor(input.ringCount));
  const sizes: number[] = [];
  if (input.sizingMode === "geometric") {
    const span = input.outerSize - input.dotSize;
    for (let i = 0; i < count; i++) {
      const t = (count - i) / count;
      sizes.push(Math.round(input.dotSize + span * Math.pow(t, input.curve)));
    }
  } else {
    for (let i = count; i >= 1; i--) {
      sizes.push(input.dotSize + i * input.ringStep);
    }
  }
  return sizes;
}

/**
 * Which ring the pointer is inside, as an index into the array
 * `computeRingSizes` returned; -1 for outside them all.
 *
 * "Inside" means the SMALLEST ring that still contains the pointer, so
 * exactly one lights at a time and crossing inward walks the highlight in
 * one band at a time. Reading the array outermost-first, that is the last
 * entry whose radius still contains the distance.
 *
 * Takes diameters, not radii, because that is what `computeRingSizes`
 * returns and what the elements are actually sized to — converting in one
 * place beats every caller remembering to halve.
 */
export function activeRingIndex(distance: number, sizes: number[]): number {
  if (!Number.isFinite(distance) || distance < 0) return -1;
  let active = -1;
  for (let i = 0; i < sizes.length; i++) {
    if (distance <= sizes[i] / 2) active = i;
  }
  return active;
}

/**
 * Per-ring alpha: the innermost ring carries `innerOpacity`, and each step
 * outward loses `opacityStep`. Percentages in, 0-to-1 out.
 */
export function ringOpacity(input: {
  index: number;
  count: number;
  innerOpacity: number;
  opacityStep: number;
}): number {
  const stepsOut = input.count - 1 - input.index;
  return clamp(input.innerOpacity - stepsOut * input.opacityStep, 0, 100) / 100;
}

export function normalizeProximityReach(value: string | undefined): number {
  return Math.round(
    clamp(toNumber(value, DEFAULT_PROXIMITY_REACH), PROXIMITY_REACH_MIN, PROXIMITY_REACH_MAX)
  );
}

export function normalizeProximityFalloff(value: string | undefined): number {
  return clamp(toNumber(value, DEFAULT_PROXIMITY_FALLOFF), PROXIMITY_FALLOFF_MIN, PROXIMITY_FALLOFF_MAX);
}

export function normalizeProximityEffect(value: string | undefined): string {
  return PROXIMITY_EFFECT_OPTIONS.some((option) => option.value === value)
    ? (value as string)
    : DEFAULT_PROXIMITY_EFFECT;
}

/**
 * Stamp and clamp the effect settings on a module.
 *
 * Unlike `normalizeImageEffectSettings`, this does NOT delete the keys that
 * the chosen preset ignores. The image module can afford to: its effect keys
 * exist only for the effect. Here the ignored keys are Ring Count, Ring Step,
 * Curve and the rest — a whole ring layout somebody tuned by hand. Deleting
 * it on a flick to Glow and back would be a silent, unrecoverable loss of
 * their work, and the panel already hides what does not apply. Gate the
 * display; keep the data.
 */
export function normalizeProximityEffectSettings(settings: Record<string, string>): void {
  settings.effect = normalizeProximityEffect(settings.effect);
  if (proximityIsContinuous(settings.effect)) {
    settings.reach = String(normalizeProximityReach(settings.reach));
    settings.falloff = String(normalizeProximityFalloff(settings.falloff));
  }
}
