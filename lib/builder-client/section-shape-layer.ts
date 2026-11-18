/**
 * SECTION SHAPE LAYER (task SC-859) — a curve, wave or slant in one colour,
 * painted over a section's background and under its content.
 *
 * Divi calls this a "background mask", Elementor a "shape divider". Bayside's
 * Contact Us band draws a white curve over a city photo so the address sits on
 * white and the photo shows on the right; before this a StarCaster section had
 * nowhere to hold such a layer, so the import dropped it and the text sat on
 * the bare photo.
 *
 * ONE SMALL BUILT-IN SET, NOT ARBITRARY SVG. Every shape is a path of numbers
 * written here, drawn inside a 100×100 box that stretches to the section. No
 * operator- or import-supplied markup ever reaches the SVG: the colour is
 * normalized to a hex, the opacity to an integer, the side to one of four
 * words. That is what makes it safe to paint as a data URL in a style
 * attribute on a client's live site.
 *
 * Each shape is written ONCE, anchored to the RIGHT edge (the shape fills from
 * the right edge inward). The other three sides are the same points mapped
 * through `mapPoint`, so "left" is a mirror and "top"/"bottom" are the shape
 * turned to lie along that edge — four sides from one definition, so they
 * cannot drift apart.
 */
import type { CSSProperties } from "react";

export const SECTION_SHAPE_KINDS = [
  { value: "none", label: "None" },
  { value: "curve", label: "Curve" },
  { value: "wave", label: "Wave" },
  { value: "slant", label: "Slant" }
] as const;

export type SectionShapeKind = (typeof SECTION_SHAPE_KINDS)[number]["value"];

export const SECTION_SHAPE_SIDES = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" }
] as const;

export type SectionShapeSide = (typeof SECTION_SHAPE_SIDES)[number]["value"];

export type SectionShapeLayer = {
  shape: SectionShapeKind;
  /** Which edge the shape grows from. */
  side: SectionShapeSide;
  /** #rrggbb. */
  color: string;
  /** 0–100. */
  opacity: number;
};

export const SECTION_SHAPE_DEFAULT: SectionShapeLayer = {
  shape: "none",
  side: "left",
  color: "#ffffff",
  opacity: 100
};

type Command = ["M" | "L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

/**
 * Right-anchored, in a 100×100 box: x=100 is the edge the shape grows from.
 *
 * `curve` is Divi's own "ellipse" mask (Bayside's), scaled from its
 * 1920×1440 viewBox to this one, so an imported curve keeps its proportions:
 * it bulges to 52% of the width at the middle and meets the top and bottom
 * edges at 61%.
 */
const SHAPE_PATHS: Record<Exclude<SectionShapeKind, "none">, Command[]> = {
  curve: [
    ["M", 100, 0],
    ["L", 61.24, 0],
    ["C", 55.5, 14.4, 52.16, 31.55, 52.16, 49.97],
    ["C", 52.16, 68.41, 55.5, 85.6, 61.27, 100],
    ["L", 100, 100],
    ["Z"]
  ],
  wave: [
    ["M", 100, 0],
    ["L", 62, 0],
    ["C", 50, 12.5, 50, 12.5, 56, 25],
    ["C", 62, 37.5, 62, 37.5, 56, 50],
    ["C", 50, 62.5, 50, 62.5, 56, 75],
    ["C", 62, 87.5, 62, 87.5, 56, 100],
    ["L", 100, 100],
    ["Z"]
  ],
  slant: [
    ["M", 100, 0],
    ["L", 70, 0],
    ["L", 50, 100],
    ["L", 100, 100],
    ["Z"]
  ]
};

/** A right-anchored point, turned to grow from `side`. */
function mapPoint(side: SectionShapeSide, x: number, y: number): [number, number] {
  switch (side) {
    case "right":
      return [x, y];
    case "left":
      return [100 - x, y];
    case "top":
      // the right edge (x=100) becomes the top edge (y=0)
      return [y, 100 - x];
    case "bottom":
      return [y, x];
  }
}

const round = (n: number) => String(Math.round(n * 100) / 100);

/** The path data for one shape on one side. Exported for the tests. */
export function sectionShapePath(shape: SectionShapeKind, side: SectionShapeSide): string {
  if (shape === "none") return "";
  return SHAPE_PATHS[shape]
    .map((command) => {
      if (command[0] === "Z") return "Z";
      const [op, ...nums] = command;
      const out: string[] = [];
      for (let i = 0; i < nums.length; i += 2) {
        const [x, y] = mapPoint(side, nums[i], nums[i + 1]);
        out.push(`${round(x)},${round(y)}`);
      }
      return `${op}${out.join(" ")}`;
    })
    .join("");
}

const KIND_VALUES: ReadonlySet<string> = new Set(SECTION_SHAPE_KINDS.map((k) => k.value));
const SIDE_VALUES: ReadonlySet<string> = new Set(SECTION_SHAPE_SIDES.map((s) => s.value));

function normalizeHex(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return SECTION_SHAPE_DEFAULT.color;
}

/**
 * Clean a stored or imported shape layer. Anything not on the allowlists falls
 * back to the default, because every value here reaches a style attribute.
 */
export function normalizeSectionShapeLayer(value: unknown): SectionShapeLayer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...SECTION_SHAPE_DEFAULT };
  }
  const raw = value as Record<string, unknown>;
  const opacityRaw = Number(raw.opacity);
  return {
    shape: KIND_VALUES.has(String(raw.shape)) ? (raw.shape as SectionShapeKind) : "none",
    side: SIDE_VALUES.has(String(raw.side)) ? (raw.side as SectionShapeSide) : SECTION_SHAPE_DEFAULT.side,
    color: normalizeHex(raw.color),
    opacity: Number.isFinite(opacityRaw) ? Math.min(100, Math.max(0, Math.round(opacityRaw))) : 100
  };
}

/** Is there a shape to paint? */
export function hasActiveSectionShapeLayer(value: unknown): boolean {
  const layer = normalizeSectionShapeLayer(value);
  return layer.shape !== "none" && layer.opacity > 0;
}

/**
 * The inline style for the layer element, or undefined when there is nothing
 * to paint (so no element is mounted and a section without a shape renders
 * exactly as it did before this existed).
 */
export function getSectionShapeLayerStyle(value: unknown): CSSProperties | undefined {
  if (!hasActiveSectionShapeLayer(value)) return undefined;
  const layer = normalizeSectionShapeLayer(value);
  const fillOpacity = layer.opacity >= 100 ? "" : ` fill-opacity="${layer.opacity / 100}"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<path fill="${layer.color}"${fillOpacity} d="${sectionShapePath(layer.shape, layer.side)}"/></svg>`;
  return {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat"
  };
}

/* ---------------------------------------------------------------------------
 * Matching a site builder's shape (Site Import)
 * ------------------------------------------------------------------------ */

export type SectionShapeMatch =
  | { ok: true; layer: SectionShapeLayer; note: string }
  | { ok: false; reason: string };

function parseCssColour(text: string): { hex: string; alpha: number } | null {
  const t = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (hex) return { hex: normalizeHex(t), alpha: 1 };
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(t);
  if (rgb) {
    const to2 = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0");
    let alpha = 1;
    if (rgb[4] !== undefined) alpha = rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    if (!Number.isFinite(alpha)) alpha = 1;
    return { hex: `#${to2(rgb[1])}${to2(rgb[2])}${to2(rgb[3])}`, alpha: Math.max(0, Math.min(1, alpha)) };
  }
  if (t === "white") return { hex: "#ffffff", alpha: 1 };
  if (t === "black") return { hex: "#000000", alpha: 1 };
  return null;
}

/** Pull the SVG text out of a CSS `background-image` value, or null. */
export function svgFromBackgroundImage(backgroundImage: string): string | null {
  // A quoted url() may hold `)` (an `rgba(...)` fill, URL-encoded); only an
  // unquoted one ends at the first `)`.
  const m =
    /url\(\s*"(data:image\/svg\+xml[^"]*)"\s*\)/i.exec(backgroundImage || "") ||
    /url\(\s*'(data:image\/svg\+xml[^']*)'\s*\)/i.exec(backgroundImage || "") ||
    /url\(\s*(data:image\/svg\+xml[^)\s]*)\s*\)/i.exec(backgroundImage || "");
  if (!m) return null;
  const data = m[1];
  const comma = data.indexOf(",");
  if (comma < 0) return null;
  const head = data.slice(0, comma);
  const body = data.slice(comma + 1);
  try {
    if (/;base64$/i.test(head)) {
      if (typeof atob === "function") return atob(body);
      const B = (globalThis as unknown as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer;
      return B ? B.from(body, "base64").toString("utf8") : null;
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

/** Is a CSS transform a left-right mirror? `matrix(-1, 0, 0, 1, …)`, `scale(-1, 1)`, `scaleX(-1)`. */
function mirrors(transform: string): { x: boolean; y: boolean } {
  const t = (transform || "").trim();
  const matrix = /^matrix\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)/i.exec(t);
  if (matrix) return { x: Number(matrix[1]) < 0, y: Number(matrix[4]) < 0 };
  const scale = /scale\(\s*([-\d.]+)\s*(?:,\s*([-\d.]+))?\s*\)/i.exec(t);
  if (scale) return { x: Number(scale[1]) < 0, y: Number(scale[2] ?? scale[1]) < 0 };
  return { x: /scaleX\(\s*-/i.test(t), y: /scaleY\(\s*-/i.test(t) };
}

/**
 * Read a site builder's mask/divider SVG and pick the nearest built-in shape.
 *
 * What it measures, from the path's own numbers in its own viewBox:
 * - WHICH EDGE the filled shape hugs: it touches the full length of one edge
 *   (Bayside's covers x=1920 from top to bottom, so the right edge), turned
 *   by any mirror the page applied — Bayside's band is `scale(-1,1)`, so the
 *   curve finally sits on the LEFT, which is where the original shows it.
 * - WHAT KIND: any curve command (C/S/Q/T/A) is a curve; several bends is a
 *   wave; straight lines only is a slant.
 *
 * It refuses — with a reason the import report shows — when it cannot read a
 * colour, a viewBox or a path, or when the shape hugs no single edge.
 */
export function matchSectionShape(backgroundImage: string, transform = ""): SectionShapeMatch {
  const svg = svgFromBackgroundImage(backgroundImage);
  if (!svg) return { ok: false, reason: "the shape is not an SVG drawing" };
  const paths = [...svg.matchAll(/<path\b[^>]*\bd\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  if (paths.length !== 1) {
    return { ok: false, reason: paths.length ? `the shape is ${paths.length} drawings, not one` : "the shape has no outline to read" };
  }
  const viewBox = /viewBox\s*=\s*"([-\d.\s,]+)"/i.exec(svg);
  const vb = viewBox ? viewBox[1].trim().split(/[\s,]+/).map(Number) : [];
  if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return { ok: false, reason: "the shape has no size to read" };
  const fillAttr = /<(?:svg|path)\b[^>]*\bfill\s*=\s*"([^"]+)"/i.exec(svg);
  const colour = parseCssColour(fillAttr ? fillAttr[1] : "#000000");
  if (!colour) return { ok: false, reason: `the shape's colour "${fillAttr?.[1]}" could not be read` };
  const fillOpacityAttr = /\bfill-opacity\s*=\s*"([\d.]+)"/i.exec(svg);
  const alpha = colour.alpha * (fillOpacityAttr ? Math.max(0, Math.min(1, Number(fillOpacityAttr[1]))) : 1);

  // Walk the path for its absolute points (control points included — good
  // enough to find the edges it touches) and the commands it uses.
  const d = paths[0];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const points: [number, number][] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let cmd = "";
  let curveCommands = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const arity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const lower = cmd.toLowerCase();
    if (!(lower in arity)) return { ok: false, reason: `the shape uses a drawing command ("${cmd}") this cannot read` };
    if (lower === "z") {
      cx = startX;
      cy = startY;
      continue;
    }
    const rel = cmd !== cmd.toUpperCase();
    const n = arity[lower];
    if (i + n > tokens.length) break;
    const args = Array.from({ length: n }, num);
    if (args.some((a) => !Number.isFinite(a))) return { ok: false, reason: "the shape's outline could not be read" };
    if ("csqta".includes(lower)) curveCommands += 1;
    if (lower === "h") {
      cx = rel ? cx + args[0] : args[0];
    } else if (lower === "v") {
      cy = rel ? cy + args[0] : args[0];
    } else if (lower === "a") {
      cx = rel ? cx + args[5] : args[5];
      cy = rel ? cy + args[6] : args[6];
    } else {
      for (let k = 0; k < n; k += 2) {
        const px = rel ? cx + args[k] : args[k];
        const py = rel ? cy + args[k + 1] : args[k + 1];
        if (k + 2 < n) points.push([px, py]);
        else {
          cx = px;
          cy = py;
        }
      }
    }
    points.push([cx, cy]);
    if (lower === "m") {
      startX = cx;
      startY = cy;
      cmd = rel ? "l" : "L";
    }
  }
  if (points.length < 3) return { ok: false, reason: "the shape's outline is too short to read" };

  // Normalize into 0..100 of the viewBox.
  const norm = points.map(([x, y]) => [((x - vb[0]) / vb[2]) * 100, ((y - vb[1]) / vb[3]) * 100] as [number, number]);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const spans = (pts: number[]) => pts.length > 0 && Math.min(...pts) <= 1 && Math.max(...pts) >= 99;
  const hugs: SectionShapeSide[] = [];
  if (spans(norm.filter(([x]) => near(x, 100)).map(([, y]) => y))) hugs.push("right");
  if (spans(norm.filter(([x]) => near(x, 0)).map(([, y]) => y))) hugs.push("left");
  if (spans(norm.filter(([, y]) => near(y, 0)).map(([x]) => x))) hugs.push("top");
  if (spans(norm.filter(([, y]) => near(y, 100)).map(([x]) => x))) hugs.push("bottom");
  if (hugs.length !== 1) {
    return {
      ok: false,
      reason: hugs.length ? `the shape covers ${hugs.join(" and ")} edges, not one` : "the shape does not sit along one edge"
    };
  }
  let side = hugs[0];
  const flip = mirrors(transform);
  if (flip.x && (side === "left" || side === "right")) side = side === "left" ? "right" : "left";
  if (flip.y && (side === "top" || side === "bottom")) side = side === "top" ? "bottom" : "top";

  // How many times the free edge changes direction: one bulge is a curve,
  // more is a wave.
  const across = side === "left" || side === "right";
  const free = norm
    .filter(([x, y]) => (across ? !near(x, 0) && !near(x, 100) : !near(y, 0) && !near(y, 100)))
    .map(([x, y]) => (across ? x : y));
  let turns = 0;
  for (let k = 2; k < free.length; k += 1) {
    const a = free[k - 1] - free[k - 2];
    const b = free[k] - free[k - 1];
    if (a * b < 0) turns += 1;
  }
  const shape: SectionShapeKind = curveCommands === 0 ? "slant" : turns > 2 ? "wave" : "curve";

  const opacity = Math.round(alpha * 100);
  return {
    ok: true,
    layer: { shape, side, color: colour.hex, opacity },
    note: `${shape} on the ${side}, ${colour.hex} at ${opacity}%`
  };
}
