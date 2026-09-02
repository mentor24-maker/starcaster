/**
 * Background parallax — the arithmetic, and nothing else.
 *
 * This file is the driver, in the shape `proximity-effects.ts` established and
 * for the same reason its header gives: nothing in this repo tests CSS, so the
 * geometry is the only part of an effect that can be held still. There is no
 * DOM in here. Scroll position and a box go in, pixels come out, and the
 * renderer (`components/builder/builder-background-layer.tsx`) owns every
 * element and every stylesheet rule and asks in here for every number.
 *
 * WHY NOT `background-attachment: fixed`, which is the one-line answer:
 *
 *  1. It is defeated by an ancestor carrying transform, filter, perspective,
 *     backdrop-filter, will-change naming one of those, or paint/layout
 *     containment — the same six properties behind the `blur(0px)` incident in
 *     DOCTRINE 5.17 (fixed in #327). The hazard is structural rather than
 *     historical: the moment a theme or an effect puts a filter on an ancestor
 *     column, a fixed-attachment background inside it silently stops
 *     parallaxing, with no error and no failing test. It just becomes an
 *     ordinary background on some themes and not others.
 *  2. iOS Safari ignores it outright.
 *
 * So the layer is a real element that is TRANSLATED, which nothing can defeat
 * from an ancestor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE GEOMETRY, because the sign conventions are easy to get backwards.
 *
 * Everything is measured against the VIEWPORT CENTRE. Let
 *
 *     centre = sectionTop + sectionHeight / 2 - viewportHeight / 2
 *
 * — the section's midpoint minus the viewport's midpoint. It is positive while
 * the section sits below the middle of the screen, zero as it passes through,
 * negative once it is above. Scrolling down makes it fall.
 *
 * The background should move at `speed` times the page's rate, so relative to
 * the section it must give back the other `1 - speed`:
 *
 *     offset = -centre * (1 - speed)
 *
 * Check the two ends. At speed 1 the offset is always zero, so the background
 * moves exactly with the page — today's rendering, to the pixel, which is what
 * makes "parallax off" and "reduce motion" the same code path rather than a
 * second branch that could rot. At speed 0 the offset is exactly `-centre`,
 * which cancels the page's own movement and pins the background to the screen.
 *
 * THE OVERSCAN is the part every naive parallax gets wrong, and it is
 * acceptance criterion 7 on the ticket: a layer exactly as tall as its section
 * slides off one edge the moment it translates, leaving a gap at the top or
 * the bottom of the band. `centre` runs from +(viewportHeight + sectionHeight)/2
 * down to -(viewportHeight + sectionHeight)/2 across the whole time any part of
 * the section is on screen, so the offset's full swing is
 *
 *     (1 - speed) * (viewportHeight + sectionHeight)
 *
 * and the layer must be that much taller than the section, hung half above it
 * and half below. Then the band is covered at every scroll position there is.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Off by default. An existing page must render byte-identically with this
 * shipped, and the only way to guarantee that is for the absent key to mean
 * "no layer at all" rather than "a layer at some speed".
 */
export const DEFAULT_BACKGROUND_PARALLAX_SPEED = 0.3;

/**
 * 0 pins the background to the screen; 1 is ordinary scrolling. Bigger means
 * MORE movement, which is the way round an operator reads a speed control —
 * the lag it actually produces is `1 - speed`, and naming the field after the
 * lag would have made the slider run backwards.
 */
export const BACKGROUND_PARALLAX_SPEED_MIN = 0;
export const BACKGROUND_PARALLAX_SPEED_MAX = 1;

/** The one speed that means "do not move at all differently from the page". */
export const BACKGROUND_PARALLAX_SPEED_INERT = 1;

export type BackgroundParallaxInput = {
  /** The section's top edge relative to the viewport, as getBoundingClientRect gives it. */
  sectionTop: number;
  sectionHeight: number;
  viewportHeight: number;
  speed: number;
};

export type BackgroundParallaxGeometry = {
  /** Total extra height the layer needs beyond its section, in pixels. */
  overscan: number;
  /** The layer's top edge relative to the section's, in pixels — always <= 0. */
  inset: number;
  /** The layer's height in pixels. */
  height: number;
  /** translateY for this scroll position, in pixels. */
  offset: number;
};

function finite(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * `-centre * lag` produces NEGATIVE zero the instant the section is centred,
 * and `-0` is a real value that survives all the way into `translate3d(0,
 * -0px, 0)` and into every test that compares against 0. Harmless to a
 * browser, confusing to everyone else, so it is normalised here rather than
 * apologised for at each call site.
 */
function zeroed(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Anything unreadable becomes the default rather than 0. A stored `null` or a
 * half-typed number in the panel must not silently mean "pinned", which is the
 * most dramatic setting on the control.
 */
export function clampBackgroundParallaxSpeed(value: unknown): number {
  return clamp(
    finite(value, DEFAULT_BACKGROUND_PARALLAX_SPEED),
    BACKGROUND_PARALLAX_SPEED_MIN,
    BACKGROUND_PARALLAX_SPEED_MAX
  );
}

/**
 * The same question asked of a KEYSTROKE rather than of stored data, and the
 * answer is different — which is the whole reason this exists beside
 * `clampBackgroundParallaxSpeed` instead of inside it.
 *
 * A value arriving from storage is finished: unreadable means the operator
 * never set one, so the default is right. A value arriving from the panel is
 * half-typed, and `<input type="number">` reports an empty string for
 * everything it cannot yet parse — a cleared box and the "0." on the way to
 * "0.7" are indistinguishable at that end. Feeding those through the storage
 * clamp put the DEFAULT back on every such keystroke, so backspace could not
 * empty the box: it snapped to 0.3 and the digits typed next landed inside
 * that number. Type 0.7, get 0.37 (review of #481, 2026-08-31).
 *
 * So: `null` means "they are still typing — leave the stored value alone",
 * and it is the caller's job to keep showing what was typed until they leave
 * the field. Only a number that is actually readable commits.
 */
export function backgroundParallaxSpeedFromInput(typed: string): number | null {
  const trimmed = String(typed ?? "").trim();
  // A trailing point is checked for by hand because `Number("0.")` is 0, which
  // is finite, and 0 is "pinned" — the most dramatic setting on the control.
  // A number input never actually hands this over (it reports "" instead), but
  // a function named "from input" should not answer a half-typed number with
  // the most destructive value in its range on the day something does.
  if (trimmed === "" || trimmed.endsWith(".")) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return clampBackgroundParallaxSpeed(parsed);
}

/**
 * How much taller than its section the layer has to be.
 *
 * Zero at speed 1, which is what makes "off" and "reduce motion" cost nothing:
 * a zero overscan is a layer the same size as the section, sitting exactly
 * where the section's own CSS background already is.
 */
export function backgroundParallaxOverscan(
  sectionHeight: number,
  viewportHeight: number,
  speed: number
): number {
  const height = Math.max(0, finite(sectionHeight));
  const viewport = Math.max(0, finite(viewportHeight));
  const lag = 1 - clampBackgroundParallaxSpeed(speed);
  if (lag <= 0 || (height === 0 && viewport === 0)) return 0;
  return lag * (viewport + height);
}

/**
 * translateY for one scroll position, clamped to the overscan.
 *
 * The clamp is not decoration. The formula keeps growing as the section
 * travels beyond the screen in either direction, and an unclamped layer that
 * has drifted further than its own overscan is a layer with a gap under it —
 * invisible while the section is off screen, and visible for one frame as it
 * comes back. Clamping makes criterion 7 true by construction rather than by
 * the section never being scrolled past.
 */
export function backgroundParallaxOffset({
  sectionTop,
  sectionHeight,
  viewportHeight,
  speed
}: BackgroundParallaxInput): number {
  const overscan = backgroundParallaxOverscan(sectionHeight, viewportHeight, speed);
  if (overscan <= 0) return 0;

  const top = finite(sectionTop);
  const height = Math.max(0, finite(sectionHeight));
  const viewport = Math.max(0, finite(viewportHeight));
  const lag = 1 - clampBackgroundParallaxSpeed(speed);

  const centre = top + height / 2 - viewport / 2;
  return zeroed(clamp(-centre * lag, -overscan / 2, overscan / 2));
}

/** Everything the renderer needs for one frame, in one call. */
export function backgroundParallaxGeometry(
  input: BackgroundParallaxInput
): BackgroundParallaxGeometry {
  const overscan = backgroundParallaxOverscan(input.sectionHeight, input.viewportHeight, input.speed);
  const height = Math.max(0, finite(input.sectionHeight));
  return {
    overscan,
    inset: zeroed(-overscan / 2),
    height: height + overscan,
    offset: backgroundParallaxOffset(input)
  };
}
