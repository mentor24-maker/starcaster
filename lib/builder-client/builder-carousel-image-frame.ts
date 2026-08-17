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

export const CAROUSEL_IMAGE_FRAME_LIMITS = {
  borderWidth: { min: 0, max: 24 },
  radius: { min: 0, max: 80 },
  shadowOffset: { min: -40, max: 40 },
  shadowBlur: { min: 0, max: 80 },
  shadowSpread: { min: -20, max: 20 },
  shadowOpacity: { min: 0, max: 100 }
};

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
  const x = num(settings.imageShadowX, d.shadowX, l.shadowOffset.min, l.shadowOffset.max);
  const y = num(settings.imageShadowY, d.shadowY, l.shadowOffset.min, l.shadowOffset.max);
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
