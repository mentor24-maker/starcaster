import type { CSSProperties } from "react";

/**
 * Image module effects — the option lists, the class names, and the CSS
 * variables that drive them.
 *
 * ONE list, read by the image panel, the floating-image panel and the
 * renderer, because the two halves had already drifted apart: Cruise and
 * Tumbleweed were offered in both panels from the Normie port onward and
 * **no stylesheet ever defined them**. Picking either one set a class nobody
 * styled, so the operator saw a still picture and no error — the exact shape
 * of doctrine E7 ("a control that changes a setting nothing renders is a bug
 * wearing a feature's clothes"), except here the setting reached a renderer
 * that had nothing to say about it. Reported 2026-08-16.
 *
 * The five effects that DO have keyframes but no option — flips, slide,
 * cartwheels, parkour, axis-rotate — are the other half of the same drift.
 * They are left as they are: reachable only by hand-editing a setting, which
 * is where they already were, and adding them is a design question for the
 * operator rather than a bug fix.
 *
 * THREE MOTIONS, THREE PROPERTIES (2026-08-17). Travel, spin and hop each
 * needed its own rate, and three rates cannot share one `transform` — the
 * last animation to touch it wins. They are split across the independent
 * transform properties instead: the figure animates `translate` (travel) and
 * `rotate` (spin) at once, and the hop rides a wrapper element's `translate`.
 * The first cut folded the spin count into the travel keyframes as a
 * multiplier, which worked until Frequency arrived and a fourth number had
 * nowhere to live.
 */

export const IMAGE_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "bounce", label: "Bounce" },
  { value: "fast-bounce", label: "Fast Bounce" },
  { value: "big-bounce", label: "Big Bounce" },
  { value: "spin", label: "Spin" },
  { value: "cruise", label: "Cruise" },
  { value: "tumbleweed", label: "Tumbleweed" }
];

/**
 * Rotation Rate, in turns per minute. A rate is the natural unit here
 * because the two rotating effects spend their time differently: Spin turns
 * in place forever, Tumbleweed turns while it crosses the page, and "3 turns
 * per crossing" would mean two different speeds on two different screens.
 * One rate reads the same on both.
 */
export const IMAGE_EFFECT_ROTATION_RATE_OPTIONS: { value: string; label: string }[] = [
  { value: "5", label: "5 turns/min" },
  { value: "10", label: "10 turns/min" },
  { value: "15", label: "15 turns/min" },
  { value: "25", label: "25 turns/min" },
  { value: "40", label: "40 turns/min" },
  { value: "60", label: "60 turns/min" },
  { value: "90", label: "90 turns/min" },
  { value: "120", label: "120 turns/min" }
];

/**
 * Frequency — how many times the object leaves the midline and comes back to
 * it while crossing the page (operator, 2026-08-17). Counted per crossing
 * rather than per second so it stays a shape you can picture: "4" is four
 * hops from one edge to the other, however long that takes.
 */
export const IMAGE_EFFECT_FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "1 per crossing" },
  { value: "2", label: "2 per crossing" },
  { value: "3", label: "3 per crossing" },
  { value: "4", label: "4 per crossing" },
  { value: "6", label: "6 per crossing" },
  { value: "8", label: "8 per crossing" },
  { value: "12", label: "12 per crossing" },
  { value: "16", label: "16 per crossing" }
];

/**
 * 25 turns/min is 2.4s a turn — exactly the speed Spin has always run at, so
 * every page that already uses it renders unchanged.
 */
export const DEFAULT_IMAGE_EFFECT_ROTATION_RATE = "25";

export const DEFAULT_IMAGE_EFFECT_FREQUENCY = "4";

/** How long one crossing takes for the travelling effects, in seconds. */
export const IMAGE_EFFECT_TRAVEL_SECONDS = 8;

export function getImageEffectClassName(effect: string | undefined) {
  if (effect === "bounce") return " starcaster-effect-bounce";
  if (effect === "fast-bounce") return " starcaster-effect-fast-bounce";
  if (effect === "big-bounce") return " starcaster-effect-big-bounce";
  if (effect === "spin") return " starcaster-effect-spin";
  if (effect === "cruise") return " starcaster-effect-cruise";
  if (effect === "tumbleweed") return " starcaster-effect-tumbleweed";
  return "";
}

/**
 * Cruise / tumbleweed travel a whole viewport width in each direction, so
 * they need the clip — both to stop the page scrolling sideways and, since
 * 2026-08-17, to break the corridor out of whatever column contains it.
 */
export function usesHorizontalMotionClip(effect: string | undefined): boolean {
  return effect === "cruise" || effect === "tumbleweed";
}

/** The effects Rotation Rate applies to — nothing else shows the control. */
export function imageEffectRotates(effect: string | undefined): boolean {
  return effect === "spin" || effect === "tumbleweed";
}

/** The effects Frequency applies to. */
export function imageEffectBounces(effect: string | undefined): boolean {
  return effect === "tumbleweed";
}

export function normalizeImageEffectRotationRate(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_IMAGE_EFFECT_ROTATION_RATE);
  return Math.min(Math.max(parsed, 1), 600);
}

export function normalizeImageEffectFrequency(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_IMAGE_EFFECT_FREQUENCY);
  return Math.min(Math.max(parsed, 1), 60);
}

const seconds = (value: number) => `${Math.round(value * 1000) / 1000}s`;

/**
 * The variables the FIGURE needs — spin speed. Travel speed is a constant
 * today; it reads from a variable so a Speed control is one field away.
 */
export function getImageEffectStyle(settings: Record<string, string>): CSSProperties | undefined {
  if (!imageEffectRotates(settings.effect)) return undefined;

  const rate = normalizeImageEffectRotationRate(settings.effectRotationRate);
  return { "--sc-effect-rotation-duration": seconds(60 / rate) } as CSSProperties;
}

/**
 * The variables the HOP STAGE needs. Frequency is a count per crossing and
 * the stylesheet wants a duration, so the conversion happens here, once,
 * rather than in a `calc()` that would have to know the travel time twice.
 */
export function getImageEffectStageStyle(settings: Record<string, string>): CSSProperties | undefined {
  if (!imageEffectBounces(settings.effect)) return undefined;

  const frequency = normalizeImageEffectFrequency(settings.effectFrequency);
  return { "--sc-effect-bounce-duration": seconds(IMAGE_EFFECT_TRAVEL_SECONDS / frequency) } as CSSProperties;
}
