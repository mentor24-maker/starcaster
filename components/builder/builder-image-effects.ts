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
/**
 * Direction of travel (operator, 2026-08-17). Offered on Cruise as well as
 * Tumbleweed: it is one motion underneath, and a control that appears on one
 * of two identical travels is a control the operator has to remember the
 * exception for.
 */
export const IMAGE_EFFECT_DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: "ltr", label: "Left to Right" },
  { value: "rtl", label: "Right to Left" }
];

export const DEFAULT_IMAGE_EFFECT_DIRECTION = "ltr";

export const DEFAULT_IMAGE_EFFECT_ROTATION_RATE = "25";

export const DEFAULT_IMAGE_EFFECT_FREQUENCY = "4";

/**
 * Bounce Height, as a share of the PICTURE'S OWN height (operator,
 * 2026-08-17: "it has a pretty shallow bounce, and I don't seem to have a way
 * to control that" — it did not, the arc was a constant in the stylesheet).
 *
 * A share rather than a pixel count because the hop should stay in proportion
 * when the picture is resized: 100% is "one whole picture off the ground"
 * whether that picture is a 60px ball or a 600px banner. A fixed 50px hop is
 * enormous under the first and invisible under the second — the same reason
 * the arc was written as a percentage in the first place.
 */
export const IMAGE_EFFECT_BOUNCE_HEIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: "10", label: "10%" },
  { value: "25", label: "25%" },
  { value: "50", label: "50%" },
  { value: "75", label: "75%" },
  { value: "100", label: "100%" },
  { value: "150", label: "150%" },
  { value: "200", label: "200%" },
  { value: "300", label: "300%" },
  { value: "500", label: "500%" }
];

/**
 * 50% is where the stylesheet's constant sat (45%), rounded onto the list.
 * The two are indistinguishable on screen, so no page visibly moves — and the
 * operator wanted a bigger hop anyway, which is now one dropdown away.
 */
export const DEFAULT_IMAGE_EFFECT_BOUNCE_HEIGHT = "50";

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

/** The effects that cross the page — Direction applies to these. */
export function imageEffectTravels(effect: string | undefined): boolean {
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

export function normalizeImageEffectBounceHeight(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_IMAGE_EFFECT_BOUNCE_HEIGHT);
  // 0 is allowed and means "travel flat" — the same picture Cruise gives, but
  // reachable without losing the spin.
  return Math.min(Math.max(parsed, 0), 1000);
}

const seconds = (value: number) => `${Math.round(value * 1000) / 1000}s`;

/**
 * The variables the FIGURE needs — spin speed. Travel speed is a constant
 * today; it reads from a variable so a Speed control is one field away.
 */
export function getImageEffectStyle(settings: Record<string, string>): CSSProperties | undefined {
  const rotates = imageEffectRotates(settings.effect);
  const travels = imageEffectTravels(settings.effect);
  if (!rotates && !travels) return undefined;

  const rate = normalizeImageEffectRotationRate(settings.effectRotationRate);

  return {
    ...(rotates ? { "--sc-effect-rotation-duration": seconds(60 / rate) } : {}),
    // ONE keyword drives both the travel and the spin, which is the point:
    // `reverse` runs every animation on the figure backwards, so a ball
    // heading left also turns the way a ball heading left turns. Reversing the
    // travel alone would have it sliding backwards on its own axis.
    ...(travels && settings.effectDirection === "rtl" ? { "--sc-effect-direction": "reverse" } : {})
  } as CSSProperties;
}

/**
 * The variables the HOP STAGE needs. Frequency is a count per crossing and
 * the stylesheet wants a duration, so the conversion happens here, once,
 * rather than in a `calc()` that would have to know the travel time twice.
 */
export function getImageEffectStageStyle(settings: Record<string, string>): CSSProperties | undefined {
  if (!imageEffectBounces(settings.effect)) return undefined;

  const frequency = normalizeImageEffectFrequency(settings.effectFrequency);
  const height = normalizeImageEffectBounceHeight(settings.effectBounceHeight);

  return {
    "--sc-effect-bounce-duration": seconds(IMAGE_EFFECT_TRAVEL_SECONDS / frequency),
    "--sc-effect-bounce": `${height}%`
  } as CSSProperties;
}
