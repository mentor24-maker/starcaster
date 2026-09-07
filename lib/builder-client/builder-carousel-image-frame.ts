import { applyBuilderColorOpacity, normalizeBuilderHexColor } from "./builder-hex-color";

/**
 * The frame around a carousel picture — border, radius and drop shadow.
 *
 * Asked for on 2026-08-16: *"the carousel module is currently missing
 * controls for the border of the images. We should have full border control
 * that applies to all images, including dropshadows."*
 *
 * ONE setting set for BOTH formats and EVERY item, which is what was asked
 * for and also what a carousel is: a row of pictures shown together, so a
 * border only some of them carried would read as a mistake. There is
 * deliberately no per-item override.
 *
 * Pure and shared, so the three places that draw a carousel picture — the
 * public renderer's slideshow frame, its cards, and the canvas glance —
 * cannot drift apart. It is also the only unit-testable half of this
 * feature: nothing in this repo tests CSS (DOCTRINE §5.14), so what CAN be
 * tested is the values this builds.
 */

export type CarouselImageFrameStyle = {
  border?: string;
  borderRadius?: string;
  boxShadow?: string;
};

export const CAROUSEL_BORDER_STYLES = ["none", "solid", "dashed", "dotted", "double"] as const;

export type CarouselBorderStyle = (typeof CAROUSEL_BORDER_STYLES)[number];

/**
 * `radius: 8` is not a taste call — it is what both formats already looked
 * like. The stylesheet rounds the slideshow frame and the card picture by
 * 8px each, and has since before either had a control, so anything else here
 * would have restyled every live carousel the moment this shipped. The
 * setting is new; the appearance is not.
 *
 * The shadow defaults describe a shadow worth seeing the moment the box is
 * ticked (soft, below, 30% black) rather than the hard 3/3/2 the shared
 * `dropShadowFields()` uses for text — a photo sitting on a hairline is the
 * effect being asked for.
 */
export const CAROUSEL_IMAGE_FRAME_DEFAULTS = {
  borderStyle: "solid" as CarouselBorderStyle,
  borderWidth: 0,
  borderColor: "#0f4f8f",
  radius: 8,
  shadow: false,
  shadowColor: "#000000",
  shadowX: 0,
  shadowY: 6,
  shadowBlur: 18,
  shadowSpread: 0,
  shadowOpacity: 30
};

const SHADOW_OFFSET_MAX = 40;

export const CAROUSEL_IMAGE_FRAME_LIMITS = {
  borderWidth: { min: 0, max: 24 },
  radius: { min: 0, max: 80 },
  shadowOffset: { min: -SHADOW_OFFSET_MAX, max: SHADOW_OFFSET_MAX },
  shadowBlur: { min: 0, max: 80 },
  shadowSpread: { min: -20, max: 20 },
  shadowOpacity: { min: 0, max: 100 },
  /**
   * DERIVED, not stored — see `carouselShadowPolar` below.
   *
   * The distance ceiling is the DIAGONAL of the X/Y square, not its side.
   * A shadow already saved at the corner (`x: 40, y: 40`) is 57 away from
   * the picture, and a control that capped at 40 would show a clamped 40,
   * re-derive smaller offsets from it, and move a shadow on a live page
   * just by opening the panel. Computed from the offset cap so the two
   * cannot drift apart.
   */
  shadowAngle: { min: 0, max: 359 },
  shadowDistance: { min: 0, max: Math.round(Math.SQRT2 * SHADOW_OFFSET_MAX) }
};

/**
 * Angle counts in 15s — twenty-four positions round the picture, which is
 * fine enough to place a shadow and coarse enough to pick from a list.
 */
export const CAROUSEL_SHADOW_ANGLE_STEP = 15;

type Settings = Record<string, string | undefined>;

function num(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * "on" is the legacy truthy the shared `dropShadowFields()` checkbox writes.
 * Accepted here so the two halves of one checkbox can never disagree — the
 * same reason `builder-nav-style.ts` accepts it.
 */
function flag(value: string | undefined, fallback: boolean): boolean {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "true" || trimmed === "on") return true;
  if (trimmed === "false") return false;
  return fallback;
}

export function carouselImageShadowIsOn(settings: Settings): boolean {
  return flag(settings.imageShadow, CAROUSEL_IMAGE_FRAME_DEFAULTS.shadow);
}

/**
 * WHERE THE SHADOW FALLS, said the other way round.
 *
 * Asked for on 2026-08-25: *"One more element to add is the angle of
 * dropshadow"*, and then, when the first draft of the ticket proposed
 * replacing X and Y with it: *"I don't think you are right. On dropshadow
 * tools I've used before, there are X/Y settings AND direction."* He is
 * right. Both pairs are live, and they are two views of the same two
 * numbers — the same arrangement `V Margin` and its two sides already use.
 *
 * `imageShadowX` and `imageShadowY` stay the ONLY stored keys. Angle and
 * distance are derived for display and never written, so the two pairs
 * cannot drift apart, and every shadow already saved keeps its exact look
 * with no migration and no fallback logic at all.
 *
 * 0 DEGREES IS RIGHT AND THE ANGLE GROWS ANTICLOCKWISE, so 90 is straight
 * up — the design-tool convention, which is what he will have in his hands
 * from every other tool. CSS `box-shadow` runs the other way (a positive Y
 * moves a shadow DOWN), which is why the sine is negated on the way out and
 * the Y is negated on the way in. Get that backwards and every shadow lands
 * on the wrong side of the picture. (The chrome's `V Offset` hint says
 * "Positive moves up" and is a different control; this one is stated here
 * rather than inherited from it.)
 */
export type CarouselShadowPolar = { angle: number; distance: number };

function clampOffset(value: number): number {
  const l = CAROUSEL_IMAGE_FRAME_LIMITS.shadowOffset;
  const clamped = Math.min(Math.max(value, l.min), l.max);
  // `Math.round(-0.2)` is NEGATIVE zero, and a cosine of 90 degrees is a tiny
  // negative number rather than a clean 0. It stringifies as "0" so nothing
  // reached the page wrong, but it is not equal to 0 under `Object.is`, which
  // is what a test — or any later comparison — would ask.
  return clamped === 0 ? 0 : clamped;
}

/**
 * The direction a shadow at these offsets falls, 0-359.
 *
 * `x: 0, y: 0` has no direction at all — a shadow sitting exactly under its
 * picture points nowhere. `Math.atan2(0, 0)` is 0 in JavaScript and 0 is
 * what the panel shows: it is the value the control would round to anyway,
 * and picking an angle at distance 0 correctly does nothing until there is
 * a distance to swing.
 */
export function carouselShadowAngleFromOffsets(x: number, y: number): number {
  const degrees = (Math.atan2(-y, x) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** How far from the picture the shadow sits, 0-57 (the square's diagonal). */
export function carouselShadowDistanceFromOffsets(x: number, y: number): number {
  const l = CAROUSEL_IMAGE_FRAME_LIMITS.shadowDistance;
  return Math.min(Math.max(Math.round(Math.hypot(x, y)), l.min), l.max);
}

/**
 * The offsets an angle and a distance describe.
 *
 * X and Y are each capped at 40, so what they can reach is a SQUARE, while
 * angle and distance describe a CIRCLE. The two do not fit inside each
 * other: distance 57 at 0 degrees wants `x: 57`, which is off the square.
 * The components are clamped, and the shown distance then honestly
 * recomputes to 40. Widening the X/Y caps to "fix" this would only move the
 * same mismatch further out.
 */
export function carouselShadowOffsetsFromPolar(angle: number, distance: number): { x: number; y: number } {
  const raw = rawOffsetsFromPolar(angle, distance);
  return { x: clampOffset(raw.x), y: clampOffset(raw.y) };
}

/** The components before the square gets a say — the one place the sine and
 *  cosine are written, so "what was asked for" and "what fits" cannot round
 *  differently. */
function rawOffsetsFromPolar(angle: number, distance: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.round(distance * Math.cos(radians)),
    // Negated: 90 degrees is UP, and a CSS shadow moves up on a NEGATIVE y.
    y: Math.round(-distance * Math.sin(radians))
  };
}

/**
 * Can the square express this direction at this distance, or did the cap bite?
 *
 * The panel needs this to know when it may keep showing what the operator
 * PICKED. Whole-pixel offsets cannot express 24 distinct directions at a
 * short distance, so picking 15 degrees at distance 15 stores 14, -4 — which
 * reads back as 16. Showing 16 there overrules a choice the operator just
 * made from a list of fifteens (send-back, 2026-09-07: 16 of the 24 came back
 * as something else). Showing 15 is right, because 14, -4 IS the closest the
 * page can come to it.
 *
 * A CLAMPED pair is the opposite case and must not be remembered: distance 57
 * at 0 degrees wants `x: 57`, the shadow is drawn at 40, and a box still
 * reading 57 would describe a shadow the page is not drawing. So the question
 * is asked here, next to the arithmetic that decides it, rather than by the
 * panel comparing numbers of its own.
 */
export function carouselShadowPolarIsReachable(angle: number, distance: number): boolean {
  const l = CAROUSEL_IMAGE_FRAME_LIMITS.shadowOffset;
  const { x, y } = rawOffsetsFromPolar(angle, distance);
  return x >= l.min && x <= l.max && y >= l.min && y <= l.max;
}

/**
 * The angle and distance to SHOW for a module's stored settings.
 *
 * Reads the offsets through the same fallback-and-clamp the renderer uses,
 * so the panel can never describe a shadow the page is not drawing.
 */
export function carouselShadowPolar(settings: Settings): CarouselShadowPolar {
  const { x, y } = carouselShadowOffsets(settings);
  return {
    angle: carouselShadowAngleFromOffsets(x, y),
    distance: carouselShadowDistanceFromOffsets(x, y)
  };
}

/** The stored offsets, resolved — the one reader for both panels. */
export function carouselShadowOffsets(settings: Settings): { x: number; y: number } {
  const d = CAROUSEL_IMAGE_FRAME_DEFAULTS;
  const l = CAROUSEL_IMAGE_FRAME_LIMITS;
  return {
    x: num(settings.imageShadowX, d.shadowX, l.shadowOffset.min, l.shadowOffset.max),
    y: num(settings.imageShadowY, d.shadowY, l.shadowOffset.min, l.shadowOffset.max)
  };
}

/**
 * The settings patch an angle/distance edit writes — both keys, one update.
 *
 * The key names live here rather than in the two panels, which is what stops
 * a panel writing a third spelling of the same shadow.
 */
export function carouselShadowOffsetSettings(
  angle: number,
  distance: number
): { imageShadowX: string; imageShadowY: string } {
  const { x, y } = carouselShadowOffsetsFromPolar(angle, distance);
  return { imageShadowX: String(x), imageShadowY: String(y) };
}

export function carouselBorderStyle(value: string | undefined): CarouselBorderStyle {
  const trimmed = String(value ?? "").trim() as CarouselBorderStyle;
  return CAROUSEL_BORDER_STYLES.includes(trimmed)
    ? trimmed
    : CAROUSEL_IMAGE_FRAME_DEFAULTS.borderStyle;
}

/** The drop shadow as a `box-shadow` value, or "" when it is off. */
export function getCarouselImageShadow(settings: Settings): string {
  if (!carouselImageShadowIsOn(settings)) return "";

  const d = CAROUSEL_IMAGE_FRAME_DEFAULTS;
  const l = CAROUSEL_IMAGE_FRAME_LIMITS;
  // The same reader the Angle and Distance controls use, so what the panel
  // says about a shadow and what the page draws cannot disagree.
  const { x, y } = carouselShadowOffsets(settings);
  const blur = num(settings.imageShadowBlur, d.shadowBlur, l.shadowBlur.min, l.shadowBlur.max);
  const spread = num(
    settings.imageShadowSpread,
    d.shadowSpread,
    l.shadowSpread.min,
    l.shadowSpread.max
  );
  const tint = applyBuilderColorOpacity(
    settings.imageShadowColor?.trim() || d.shadowColor,
    num(settings.imageShadowOpacity, d.shadowOpacity, l.shadowOpacity.min, l.shadowOpacity.max)
  );

  return `${x}px ${y}px ${blur}px ${spread}px ${tint}`;
}

/**
 * How far the shadow reaches below and above the picture.
 *
 * The card row is a horizontal scroller, and `overflow-x: auto` forces the
 * OTHER axis to clip as well — there is no such thing as scrolling one axis
 * while the other overflows visibly. So a shadow under a card is cut off
 * exactly at the card, which looks like a bug rather than an effect. The row
 * is given this much breathing room top and bottom instead.
 *
 * Vertical only, deliberately: horizontal padding on a scroll container
 * shifts every scroll offset, and the card loop's arithmetic (parking on the
 * middle copy, the seam shift, stepping from the target) is measured in those
 * offsets and took two rounds of bugs to get right. The sideways spill is
 * clipped at the frame edge, where the row visibly continues anyway.
 */
export function getCarouselImageShadowGutter(settings: Settings): number {
  if (!carouselImageShadowIsOn(settings)) return 0;

  const d = CAROUSEL_IMAGE_FRAME_DEFAULTS;
  const l = CAROUSEL_IMAGE_FRAME_LIMITS;
  const y = num(settings.imageShadowY, d.shadowY, l.shadowOffset.min, l.shadowOffset.max);
  const blur = num(settings.imageShadowBlur, d.shadowBlur, l.shadowBlur.min, l.shadowBlur.max);
  const spread = num(
    settings.imageShadowSpread,
    d.shadowSpread,
    l.shadowSpread.min,
    l.shadowSpread.max
  );

  return Math.max(Math.abs(y) + blur + spread, 0);
}

/**
 * The inline style for one carousel picture.
 *
 * Inline rather than a stylesheet rule on purpose: these are per-module
 * operator choices, and the module's existing sizing settings (Height, Card
 * width, Gap) already arrive the same way. It also keeps the feature out of
 * the one layer this repo cannot test.
 */
export function getCarouselImageFrameStyle(settings: Settings): CarouselImageFrameStyle {
  const style: CarouselImageFrameStyle = {};

  const borderStyle = carouselBorderStyle(settings.imageBorderStyle);
  const borderWidth = num(
    settings.imageBorderWidth,
    CAROUSEL_IMAGE_FRAME_DEFAULTS.borderWidth,
    CAROUSEL_IMAGE_FRAME_LIMITS.borderWidth.min,
    CAROUSEL_IMAGE_FRAME_LIMITS.borderWidth.max
  );
  if (borderStyle !== "none" && borderWidth > 0) {
    const color = normalizeBuilderHexColor(
      settings.imageBorderColor?.trim() || CAROUSEL_IMAGE_FRAME_DEFAULTS.borderColor
    );
    style.border = `${borderWidth}px ${borderStyle} ${color}`;
  }

  const radius = num(
    settings.imageBorderRadius,
    CAROUSEL_IMAGE_FRAME_DEFAULTS.radius,
    CAROUSEL_IMAGE_FRAME_LIMITS.radius.min,
    CAROUSEL_IMAGE_FRAME_LIMITS.radius.max
  );
  style.borderRadius = `${radius}px`;

  const shadow = getCarouselImageShadow(settings);
  if (shadow) style.boxShadow = shadow;

  return style;
}
