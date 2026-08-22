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
 * cartwheels, parkour, axis-rotate — were the other half of the same drift:
 * reachable only by hand-editing a setting, because surfacing them was a
 * design question for the operator rather than a bug fix.
 *
 * He answered it on 2026-08-19 (ClickUp 86bbfrpbb). Slide, axis-rotate and
 * flips are offered here from 2026-08-22. CARTWHEELS IS DELIBERATELY NOT —
 * his words, "which is the same as tumbleweed, let's stick with tumbleweed" —
 * and parkour is a harder piece of work of its own. Both keep their dead
 * keyframes in `_builder-react.css`; `check:render` reports them as orphans
 * every run, which is the intended state, not an oversight to tidy away.
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
  { value: "tumbleweed", label: "Tumbleweed" },
  // Surfaced 2026-08-22 on the operator's decision (ClickUp 86bbfrpbb): three
  // of the five effects that had keyframes but no way to pick them. Cartwheels
  // stays unsurfaced — it is Tumbleweed under another name — and Parkour is a
  // separate piece of work.
  { value: "slide", label: "Slide" },
  { value: "axis-rotate", label: "Axis Rotate" },
  { value: "flips", label: "Flips" }
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
// Bare counts, not "N per crossing": the count means per-CROSSING for the
// travelling hoppers (Tumbleweed) but per-TURN for the in-place ones (Flips
// counts hops per turn, and its hop speed rides Rotation Rate). One label set
// that is honest for both — the field is "Frequency (hops)" and the effect
// decides what a hop is timed against.
export const IMAGE_EFFECT_FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "6", label: "6" },
  { value: "8", label: "8" },
  { value: "12", label: "12" },
  { value: "16", label: "16" }
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

/**
 * Speed — how long ONE crossing takes, in seconds (operator, 2026-08-17).
 * The label says Speed and the numbers say seconds, so both halves are on the
 * option: a bare "16" under a field called Speed reads as fast, and it is the
 * slowest thing on the list.
 *
 * Everything else that is counted PER CROSSING follows it automatically —
 * four hops stay four hops whether the trip takes three seconds or thirty,
 * which is the whole reason Frequency was defined that way.
 */
export const IMAGE_EFFECT_SPEED_OPTIONS: { value: string; label: string }[] = [
  { value: "2", label: "Very Fast (2s)" },
  { value: "4", label: "Fast (4s)" },
  { value: "8", label: "Medium (8s)" },
  { value: "16", label: "Slow (16s)" },
  { value: "30", label: "Very Slow (30s)" },
  { value: "60", label: "Drifting (60s)" }
];

/**
 * Repeat. "Once" is for a graphic that should cross when the page opens and
 * then be gone — a mascot that runs past, not a loop the visitor watches for
 * as long as they stay.
 */
export const IMAGE_EFFECT_REPEAT_OPTIONS: { value: string; label: string }[] = [
  { value: "loop", label: "Forever" },
  { value: "once", label: "Once" }
];

/**
 * Start Delay. This one exists for a specific failure: put two of these on a
 * page and they leave together, cross together and land together, which reads
 * as one mechanism rather than two objects. A different delay on each is what
 * separates them.
 */
export const IMAGE_EFFECT_DELAY_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "None" },
  { value: "1", label: "1s" },
  { value: "2", label: "2s" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "8", label: "8s" },
  { value: "12", label: "12s" }
];

export const DEFAULT_IMAGE_EFFECT_SPEED = "8";
export const DEFAULT_IMAGE_EFFECT_REPEAT = "loop";
export const DEFAULT_IMAGE_EFFECT_DELAY = "0";

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

/**
 * How long one crossing takes when the operator has not chosen a Speed.
 * Must stay equal to DEFAULT_IMAGE_EFFECT_SPEED — a test holds them together.
 */
export const IMAGE_EFFECT_TRAVEL_SECONDS = 8;

export function getImageEffectClassName(effect: string | undefined) {
  if (effect === "bounce") return " starcaster-effect-bounce";
  if (effect === "fast-bounce") return " starcaster-effect-fast-bounce";
  if (effect === "big-bounce") return " starcaster-effect-big-bounce";
  if (effect === "spin") return " starcaster-effect-spin";
  if (effect === "cruise") return " starcaster-effect-cruise";
  if (effect === "tumbleweed") return " starcaster-effect-tumbleweed";
  if (effect === "slide") return " starcaster-effect-slide";
  if (effect === "axis-rotate") return " starcaster-effect-axis-rotate";
  if (effect === "flips") return " starcaster-effect-flips";
  return "";
}

/**
 * Cruise / tumbleweed travel a whole viewport width in each direction, so
 * they need the clip — both to stop the page scrolling sideways and, since
 * 2026-08-17, to break the corridor out of whatever column contains it.
 */
export function usesHorizontalMotionClip(effect: string | undefined): boolean {
  return imageEffectTravels(effect);
}

/** The effects that cross the page — Direction applies to these. */
export function imageEffectTravels(effect: string | undefined): boolean {
  return effect === "cruise" || effect === "tumbleweed" || effect === "slide";
}

/** The effects Rotation Rate applies to — nothing else shows the control. */
export function imageEffectRotates(effect: string | undefined): boolean {
  return (
    effect === "spin" ||
    effect === "tumbleweed" ||
    effect === "axis-rotate" ||
    effect === "flips"
  );
}

/** The effects Frequency applies to. */
export function imageEffectBounces(effect: string | undefined): boolean {
  return effect === "tumbleweed" || effect === "flips";
}

/**
 * Hops WITHOUT crossing the page — today that is Flips alone, and it is the
 * reason the hop does not always need the wrapper element.
 *
 * Tumbleweed needs one because its figure is already animating `translate`
 * for the travel, and one element cannot animate one property twice. Flips
 * does not travel, so `translate` is free on the figure itself: the spin
 * rides `rotate` and the hop rides `translate`, both on the same box, and no
 * stage element has to exist at all. Confirmed rather than assumed — the
 * renderer only ever mounts the hop stage inside the travel corridor, so a
 * stationary bouncer would have silently got no stage and no hop.
 */
export function imageEffectBouncesInPlace(effect: string | undefined): boolean {
  return imageEffectBounces(effect) && !imageEffectTravels(effect);
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

export function normalizeImageEffectSpeed(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return IMAGE_EFFECT_TRAVEL_SECONDS;
  return Math.min(Math.max(parsed, 1), 600);
}

export function normalizeImageEffectDelay(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 120);
}

export function imageEffectRunsOnce(settings: Record<string, string>): boolean {
  return imageEffectTravels(settings.effect) && settings.effectRepeat === "once";
}

export function normalizeImageEffectBounceHeight(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_IMAGE_EFFECT_BOUNCE_HEIGHT);
  // 0 is allowed and means "travel flat" — the same picture Cruise gives, but
  // reachable without losing the spin.
  return Math.min(Math.max(parsed, 0), 1000);
}

const seconds = (value: number) => `${Math.round(value * 1000) / 1000}s`;

/** The variables the FIGURE needs — travel speed, spin speed, direction, repeat. */
export function getImageEffectStyle(settings: Record<string, string>): CSSProperties | undefined {
  const rotates = imageEffectRotates(settings.effect);
  const travels = imageEffectTravels(settings.effect);
  const hopsInPlace = imageEffectBouncesInPlace(settings.effect);
  if (!rotates && !travels && !hopsInPlace) return undefined;

  const rate = normalizeImageEffectRotationRate(settings.effectRotationRate);
  const turnSeconds = 60 / rate;
  const travelSeconds = normalizeImageEffectSpeed(settings.effectSpeed);
  const delay = normalizeImageEffectDelay(settings.effectDelay);
  const once = imageEffectRunsOnce(settings);

  return {
    ...(rotates ? { "--sc-effect-rotation-duration": seconds(turnSeconds) } : {}),
    ...(travels ? { "--sc-effect-travel-duration": seconds(travelSeconds) } : {}),
    // A stationary hopper carries its own hop variables, because it has no
    // stage element to hang them on. Frequency counts hops PER TURN here
    // rather than per crossing — there is no crossing to count against, and
    // tying it to the turn is what makes one flip read as one flip.
    ...(hopsInPlace
      ? {
          "--sc-effect-bounce-duration": seconds(
            turnSeconds / normalizeImageEffectFrequency(settings.effectFrequency)
          ),
          "--sc-effect-bounce": `${normalizeImageEffectBounceHeight(settings.effectBounceHeight)}%`
        }
      : {}),
    // ONE keyword drives both the travel and the spin, which is the point:
    // `reverse` runs every animation on the figure backwards, so a ball
    // heading left also turns the way a ball heading left turns. Reversing the
    // travel alone would have it sliding backwards on its own axis.
    ...(travels && settings.effectDirection === "rtl" ? { "--sc-effect-direction": "reverse" } : {}),
    ...(delay > 0 ? { "--sc-effect-delay": seconds(delay) } : {}),
    // "Once" has to be counted per animation, not declared once for all of
    // them. A flat `animation-iteration-count: 1` would stop the SPIN after a
    // single turn — 1.5s of it — and the ball would slide the remaining six
    // seconds of the crossing without turning. So the travel runs once and the
    // spin runs however many turns fit inside that crossing.
    ...(once
      ? {
          "--sc-effect-travel-iterations": "1",
          "--sc-effect-turn-iterations": String(Math.max(1, Math.round(travelSeconds / turnSeconds))),
          "--sc-effect-fill": "forwards"
        }
      : {})
  } as CSSProperties;
}

/**
 * The variables the HOP STAGE needs. Frequency is a count per crossing and
 * the stylesheet wants a duration, so the conversion happens here, once,
 * rather than in a `calc()` that would have to know the travel time twice.
 */
export function getImageEffectStageStyle(settings: Record<string, string>): CSSProperties | undefined {
  // Only the effects that hop WHILE TRAVELLING need the stage. A stationary
  // hopper gets the same variables on the figure via getImageEffectStyle,
  // and returning them here too would put a hop on an element that never
  // renders for it.
  if (!imageEffectBounces(settings.effect) || imageEffectBouncesInPlace(settings.effect)) return undefined;

  const frequency = normalizeImageEffectFrequency(settings.effectFrequency);
  const height = normalizeImageEffectBounceHeight(settings.effectBounceHeight);
  const travelSeconds = normalizeImageEffectSpeed(settings.effectSpeed);
  const delay = normalizeImageEffectDelay(settings.effectDelay);

  return {
    "--sc-effect-bounce-duration": seconds(travelSeconds / frequency),
    "--sc-effect-bounce": `${height}%`,
    ...(delay > 0 ? { "--sc-effect-delay": seconds(delay) } : {}),
    // The hop count for one crossing IS the Frequency — which is the payoff
    // for defining Frequency per crossing rather than per second.
    ...(imageEffectRunsOnce(settings)
      ? { "--sc-effect-hop-iterations": String(frequency), "--sc-effect-fill": "forwards" }
      : {})
  } as CSSProperties;
}
