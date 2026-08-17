import type { CSSProperties } from "react";

/**
 * Image module effects — the option list, the class names, and the CSS
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
 * 25 turns/min is 2.4s a turn — exactly the speed Spin has always run at, so
 * every page that already uses it renders unchanged.
 */
export const DEFAULT_IMAGE_EFFECT_ROTATION_RATE = "25";

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

/** Cruise / tumbleweed keyframes move ±100vw and can force a horizontal scrollbar that reads like a bottom progress bar. */
export function usesHorizontalMotionClip(effect: string | undefined): boolean {
  return effect === "cruise" || effect === "tumbleweed";
}

/** The effects Rotation Rate applies to — nothing else shows the control. */
export function imageEffectRotates(effect: string | undefined): boolean {
  return effect === "spin" || effect === "tumbleweed";
}

export function normalizeImageEffectRotationRate(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_IMAGE_EFFECT_ROTATION_RATE);
  return Math.min(Math.max(parsed, 1), 600);
}

/**
 * The CSS variables an effect needs, or undefined when it needs none.
 *
 * Tumbleweed rotates and travels in ONE animation (a single `transform`
 * keyframe pair), so the number of turns is baked in rather than timed: a
 * second animation on a wrapper element would have meant a second DOM node
 * in a renderer four other module types share.
 */
export function getImageEffectStyle(settings: Record<string, string>): CSSProperties | undefined {
  const effect = settings.effect;
  if (!imageEffectRotates(effect)) return undefined;

  const rate = normalizeImageEffectRotationRate(settings.effectRotationRate);

  if (effect === "tumbleweed") {
    return {
      "--sc-effect-spins": String(Math.round(((rate * IMAGE_EFFECT_TRAVEL_SECONDS) / 60) * 100) / 100)
    } as CSSProperties;
  }

  return { "--sc-effect-rotation-duration": `${Math.round((60 / rate) * 1000) / 1000}s` } as CSSProperties;
}
