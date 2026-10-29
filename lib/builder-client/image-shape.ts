/**
 * The Image module's SHAPE (task 86bctde2b).
 *
 * Before this an Image had one shape control, Radius, in whole pixels —
 * rounded corners or square ones, nothing else. A circle or the soft organic
 * blob alphire.agency draws its hero picture as
 * (`border-radius: 50% 45% 52% 48% / 48% 52% 48% 52%`) could not be built,
 * so Site Import had nowhere to put one and the hero arrived a rectangle.
 *
 * Four shapes, and the empty one is the old behaviour on purpose: every image
 * saved before this has no `imageShape`, and must keep the corners its Radius
 * gives it.
 *
 *   ""        Rounded — Radius in px (the default; 0 is square corners)
 *   "square"  no rounding at all, whatever Radius says
 *   "circle"  a circle: the frame is made square and the picture fills it
 *   "custom"  any CSS border-radius made of px/% lengths, elliptical
 *             (`a b c d / e f g h`) included
 *
 * Pure, no DOM: the renderer, the settings normalizer and the tests share it.
 */

export const IMAGE_SHAPE_KEY = "imageShape";
export const IMAGE_SHAPE_RADII_KEY = "imageShapeRadii";

export type ImageShape = "" | "square" | "circle" | "custom";

export const IMAGE_SHAPE_OPTIONS: { value: ImageShape; label: string }[] = [
  { value: "", label: "Rounded" },
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "custom", label: "Custom" }
];

export function normalizeImageShape(value: unknown): ImageShape {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "square" || text === "circle" || text === "custom" ? text : "";
}

// One corner length: 0, or a non-negative number in px or %. Nothing else —
// this string is written straight into a style, so it is an allowlist rather
// than a cleanup.
const LENGTH = /^(?:0|\d{1,4}(?:\.\d{1,3})?(?:px|%))$/;

function cleanSide(side: string): string | null {
  const parts = side.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return null;
  const lengths = parts.map((part) => part.toLowerCase());
  if (!lengths.every((part) => LENGTH.test(part))) return null;
  // A percentage beyond 100 means nothing more than 100 does.
  if (lengths.some((part) => part.endsWith("%") && Number.parseFloat(part) > 100)) return null;
  return lengths.join(" ");
}

/**
 * A custom shape's radii, or "" when the value is not a border-radius made of
 * 1-4 px/% lengths with an optional `/` and 1-4 more. Returning "" (rather
 * than a guess) makes a bad value fall back to the Radius corners.
 */
export function sanitizeImageShapeRadii(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > 120) return "";
  const halves = text.split("/");
  if (halves.length > 2) return "";
  const cleaned = halves.map(cleanSide);
  if (cleaned.some((half) => half === null)) return "";
  return cleaned.join(" / ");
}

/** True when every corner is zero — a "shape" that is just a rectangle. */
function allZero(radii: string): boolean {
  return radii.split(/[\s/]+/).filter(Boolean).every((part) => Number.parseFloat(part) === 0);
}

/**
 * The frame's corner style for this shape. `cornersPx` is what Radius already
 * resolved to, so "Rounded" (and a Custom with nothing usable typed in) is
 * byte-for-byte the style images rendered with before shapes existed.
 */
export function getImageShapeFrameStyle(
  settings: Record<string, string>,
  cornersPx: number
): { borderRadius: string; aspectRatio?: string } {
  const shape = normalizeImageShape(settings[IMAGE_SHAPE_KEY]);
  if (shape === "square") return { borderRadius: "0px" };
  // Square first, THEN 50%: 50% of a landscape frame is an oval, not the
  // circle the setting is named after.
  if (shape === "circle") return { borderRadius: "50%", aspectRatio: "1 / 1" };
  if (shape === "custom") {
    const radii = sanitizeImageShapeRadii(settings[IMAGE_SHAPE_RADII_KEY]);
    if (radii) return { borderRadius: radii };
  }
  return { borderRadius: `${cornersPx}px` };
}

/**
 * Extra style for the picture inside a Circle frame. The frame is made square,
 * so the picture must fill it and crop rather than keep its own height and
 * leave a band of empty frame (or spill under the clip). Every other shape
 * keeps the picture's natural proportions — returns null.
 */
export function getImageShapeMediaStyle(settings: Record<string, string>): {
  height: string;
  objectFit: "cover";
} | null {
  return normalizeImageShape(settings[IMAGE_SHAPE_KEY]) === "circle"
    ? { height: "100%", objectFit: "cover" }
    : null;
}

/**
 * Normalize the two shape keys in place. Unknown shapes drop to the default;
 * a Custom shape whose radii do not parse keeps the shape (the panel shows it,
 * so the person editing can see and fix the value) but loses the bad string.
 */
export function normalizeImageShapeSettings(settings: Record<string, string>) {
  const shape = normalizeImageShape(settings[IMAGE_SHAPE_KEY]);
  if (shape) settings[IMAGE_SHAPE_KEY] = shape;
  else delete settings[IMAGE_SHAPE_KEY];

  if (settings[IMAGE_SHAPE_RADII_KEY] !== undefined) {
    const radii = sanitizeImageShapeRadii(settings[IMAGE_SHAPE_RADII_KEY]);
    if (radii && !allZero(radii)) settings[IMAGE_SHAPE_RADII_KEY] = radii;
    else delete settings[IMAGE_SHAPE_RADII_KEY];
  }
}
