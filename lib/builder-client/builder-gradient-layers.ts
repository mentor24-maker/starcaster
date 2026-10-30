/**
 * Layered gradient backgrounds (task 86bctde1m).
 *
 * A Builder gradient used to be exactly two colours and an angle. Real sites
 * paint far more than that: Alphire's hero is two soft radial glows stacked
 * over a three-stop linear wash, and the importer had nowhere to put any of
 * it, so the section arrived plain.
 *
 * `BackgroundSettings.gradientLayers` is an optional list of layers, painted
 * in CSS order — the FIRST layer is on top. It is only meaningful in mode
 * "gradient", and only when it holds at least one valid layer; otherwise the
 * two-colour gradient paints exactly as it always has. That absence is
 * load-bearing: every stored section that predates this key renders
 * byte-identically, because no layer means no change.
 *
 * Every value here reaches a `style` attribute, so nothing is passed through
 * as typed: colours are #rrggbb, alpha/positions/angles are clamped numbers,
 * and the radial size is an allowlisted keyword or one or two plain lengths.
 *
 * `color`, `color2` and `gradientAngle` are kept in step with the BOTTOM
 * layer (`withGradientLayers`), so every surface that has never heard of
 * layers — the frozen vanilla builder, the WordPress export, email — still
 * paints the nearest two-colour approximation instead of nothing.
 */

export type BuilderGradientStop = {
  /** #rrggbb. */
  color: string;
  /** 0–100. The stop's own see-through-ness; glows fade to 0. */
  alpha: number;
  /** 0–100, percent along the gradient line (linear) or ray (radial). */
  position: number;
};

export type BuilderGradientLayer = {
  kind: "linear" | "radial";
  /** Linear only — CSS degrees, 0–360. */
  angle: number;
  /** Radial only. */
  shape: "circle" | "ellipse";
  /**
   * Radial only: one of BUILDER_GRADIENT_RADIAL_SIZES, or one or two plain
   * lengths ("600px", "60% 40%"). Anything else reads as farthest-corner,
   * which is the CSS default.
   */
  size: string;
  /** Radial only — the centre, in percent of the box. */
  x: number;
  y: number;
  stops: BuilderGradientStop[];
};

export const BUILDER_GRADIENT_LAYER_LIMIT = 6;
export const BUILDER_GRADIENT_STOP_LIMIT = 8;

export const BUILDER_GRADIENT_RADIAL_SIZES = [
  { value: "farthest-corner", label: "Farthest corner" },
  { value: "farthest-side", label: "Farthest side" },
  { value: "closest-corner", label: "Closest corner" },
  { value: "closest-side", label: "Closest side" }
] as const;

const RADIAL_SIZE_KEYWORDS = new Set<string>(BUILDER_GRADIENT_RADIAL_SIZES.map((size) => size.value));
const LENGTH = /^\d+(?:\.\d+)?(?:px|%)$/;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (value === undefined || value === null || String(value).trim() === "" || !Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeStopColor(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) {
    return `#${text
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return "";
}

/** A radial size safe to put in CSS, or "" for the default. */
export function normalizeRadialSize(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (RADIAL_SIZE_KEYWORDS.has(text)) return text;
  const parts = text.split(" ");
  if (parts.length >= 1 && parts.length <= 2 && parts.every((part) => LENGTH.test(part))) return text;
  return "";
}

/**
 * CSS is strict about which explicit sizes go with which shape: a circle takes
 * ONE length and no percentage, an ellipse takes TWO. A mismatched pair makes
 * the browser drop the whole `background-image` declaration, every layer with
 * it, so a mismatch falls back to the default size instead.
 */
function sizeForShape(shape: "circle" | "ellipse", size: string): string {
  if (!size || RADIAL_SIZE_KEYWORDS.has(size)) return size;
  const parts = size.split(" ");
  if (shape === "circle") return parts.length === 1 && parts[0].endsWith("px") ? size : "";
  return parts.length === 2 ? size : "";
}

function normalizeStop(value: unknown): BuilderGradientStop | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stop = value as Record<string, unknown>;
  const color = normalizeStopColor(stop.color);
  if (!color) return null;
  return {
    color,
    alpha: round(clampNumber(stop.alpha, 0, 100, 100)),
    position: round(clampNumber(stop.position, 0, 100, 0))
  };
}

function normalizeLayer(value: unknown): BuilderGradientLayer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const layer = value as Record<string, unknown>;
  const stops = (Array.isArray(layer.stops) ? layer.stops : [])
    .map(normalizeStop)
    .filter((stop): stop is BuilderGradientStop => stop !== null)
    .slice(0, BUILDER_GRADIENT_STOP_LIMIT);
  // One colour is not a gradient, and CSS rejects a gradient with one stop —
  // the whole background-image declaration would then paint nothing at all.
  if (stops.length < 2) return null;
  const shape = layer.shape === "circle" ? "circle" : "ellipse";
  return {
    kind: layer.kind === "radial" ? "radial" : "linear",
    angle: round(clampNumber(layer.angle, 0, 360, 180)),
    shape,
    size: sizeForShape(shape, normalizeRadialSize(layer.size)),
    x: round(clampNumber(layer.x, 0, 100, 50)),
    y: round(clampNumber(layer.y, 0, 100, 50)),
    stops
  };
}

/** Every valid layer, in paint order (first = top). Empty when there are none. */
export function normalizeBuilderGradientLayers(value: unknown): BuilderGradientLayer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeLayer)
    .filter((layer): layer is BuilderGradientLayer => layer !== null)
    .slice(0, BUILDER_GRADIENT_LAYER_LIMIT);
}

function stopCss(stop: BuilderGradientStop, opacityPercent: number): string {
  const n = Number.parseInt(stop.color.slice(1), 16);
  const alpha = round((stop.alpha / 100) * (opacityPercent / 100));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha}) ${stop.position}%`;
}

function layerCss(layer: BuilderGradientLayer, opacityPercent: number): string {
  const stops = layer.stops.map((stop) => stopCss(stop, opacityPercent)).join(", ");
  if (layer.kind === "radial") {
    const size = layer.size ? ` ${layer.size}` : "";
    return `radial-gradient(${layer.shape}${size} at ${layer.x}% ${layer.y}%, ${stops})`;
  }
  return `linear-gradient(${layer.angle}deg, ${stops})`;
}

/**
 * The CSS `background-image` for a list of layers, or "" when there is no
 * valid layer. Takes RAW settings on purpose: `getBuilderBackgroundStyle` is
 * handed un-normalized backgrounds on some surfaces, so the sanitizing happens
 * here, at the point the string is built, rather than trusting a caller.
 */
export function builderGradientLayersCss(value: unknown, opacityPercent = 100): string {
  const layers = normalizeBuilderGradientLayers(value);
  if (!layers.length) return "";
  const opacity = clampNumber(opacityPercent, 0, 100, 100);
  return layers.map((layer) => layerCss(layer, opacity)).join(", ");
}

/** The two-colour gradient a list of layers falls back to: its bottom layer's ends. */
export function gradientLayersFallback(
  layers: BuilderGradientLayer[]
): { color: string; color2: string; gradientAngle: number } | null {
  const bottom = layers[layers.length - 1];
  if (!bottom) return null;
  return {
    color: bottom.stops[0].color,
    color2: bottom.stops[bottom.stops.length - 1].color,
    gradientAngle: bottom.kind === "linear" ? bottom.angle : 180
  };
}

/**
 * Write a new layer list onto a background, keeping the two-colour fields in
 * step with it. An empty list removes the key, which puts the background back
 * into ordinary two-colour mode with the bottom layer's colours.
 */
export function withGradientLayers<T extends { color: string; color2: string; gradientAngle?: number }>(
  background: T,
  layers: BuilderGradientLayer[]
): T & { gradientLayers?: BuilderGradientLayer[] } {
  const next: T & { gradientLayers?: BuilderGradientLayer[] } = { ...background };
  if (!layers.length) {
    delete next.gradientLayers;
    return next;
  }
  next.gradientLayers = layers;
  const fallback = gradientLayersFallback(layers);
  if (fallback) Object.assign(next, fallback);
  return next;
}

/** Layer 1 of a background that is turning into layers: its own two colours. */
export function gradientLayerFromTwoColour(background: {
  color: string;
  color2: string;
  gradientAngle?: number;
}): BuilderGradientLayer {
  return {
    kind: "linear",
    angle: round(clampNumber(background.gradientAngle, 0, 360, 135)),
    shape: "ellipse",
    size: "",
    x: 50,
    y: 50,
    stops: [
      { color: normalizeStopColor(background.color) || "#ffffff", alpha: 100, position: 0 },
      { color: normalizeStopColor(background.color2) || "#eaf4ff", alpha: 100, position: 100 }
    ]
  };
}

/** What "Add Layer" puts on top: a soft white glow in the middle that fades out. */
export function createDefaultGlowLayer(): BuilderGradientLayer {
  return {
    kind: "radial",
    angle: 180,
    shape: "circle",
    size: "",
    x: 50,
    y: 50,
    stops: [
      { color: "#ffffff", alpha: 40, position: 0 },
      { color: "#ffffff", alpha: 0, position: 60 }
    ]
  };
}
