/**
 * Site Import — section and card surfaces (task 86bce9wx3). Reads the styles
 * of the boxes that WRAPPED a source page's content — a coloured band, a
 * card's border, rounded corners and shadow, the room inside each — and turns
 * them into the Builder settings that carry them: a row's background, padding
 * and border, and a column's background, border, corners, shadow and padding.
 *
 * Before this the IR kept only the content, so daneofearth.org's coloured
 * bands and its 2x2 grid of cards arrived as plain boxes on white and were
 * restyled by hand.
 *
 * Pure, no I/O. normalize.ts records the boxes (SectionIR.containers and
 * containerBoxes, and each element's `containers` chain); planBands and
 * planCards decide which box is each element's band and which its card, and
 * the mapper (map.ts) calls readSurface for each.
 *
 * One imported section can hold MANY bands: a Divi/WordPress page puts its
 * whole main area in one wrapper, and daneofearth.org stacks six coloured
 * bands inside it (round-1 review of 86bce9wx3). So a band is decided per
 * element — the outermost painted box spanning the full width of the
 * section's content — never as the one box every element shares.
 */

import type { CapturedStyles, ElementIR } from "./ir";
import { toHex } from "./theme";

export type MappedBackground = {
  mode: "none" | "color" | "gradient" | "image";
  color: string;
  color2: string;
  /** Mode "gradient" only — CSS degrees, which Builder paints the same way. */
  gradientAngle?: number;
  imageUrl: string;
  styleKey: "";
};

export type SurfaceLook = {
  background?: MappedBackground;
  /** Only when all four sides draw one — a lone divider line is not a frame. */
  border?: { width: string; color: string; style: string };
  radius?: string;
  /** A Builder shadow preset: light | medium | heavy. */
  shadow?: string;
  /** Sides with room inside them, in px; a side with none is absent. */
  padding: { top?: string; right?: string; bottom?: string; left?: string };
};

export type SurfaceContext = {
  /** The import theme's surface colour — a band or card painted exactly this
   *  is left unset so it follows the theme (importSurfaceColor). */
  surface: string;
  /** Background picture URL → the URL to store ("" = leave it off). */
  resolveImage: (url: string) => string;
  /** Builder's cap for this kind of padding (row 160, cell 50). */
  maxPadding: number;
};

const SIDES = ["top", "right", "bottom", "left"] as const;

const px = (value: string | undefined): number => {
  const n = parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : 0;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Fills Builder reads as "no fill" on a COLUMN and wipes on save
 * (LIGHT_CELL_FILL_COLORS / sanitizeCellBackgroundForDrillDown in
 * lib/builder-client/builder-template.ts — SYNC POINT; scripts/site-import/
 * surfaces.test.js checks this list against the built template). A white card
 * on a coloured band would lose its white, so those fills are nudged one step
 * off, which no eye can tell apart.
 */
const WIPED_CELL_FILLS = [
  "#ffffff", "#eef6ff", "#ddeeff", "#bbddee", "#f8fdff", "#f6fbff",
  "#eaf4ff", "#e8f5e9", "#f0fdf4", "#ecfdf5",
];

export function keepCellFill(hex: string): string {
  if (!WIPED_CELL_FILLS.includes(hex)) return hex;
  const last = parseInt(hex.slice(5, 7), 16);
  return hex.slice(0, 5) + (last > 0 ? last - 1 : 1).toString(16).padStart(2, "0");
}

/** A computed box-shadow → light / medium / heavy, by how far it spreads
 *  (blur plus vertical drop). Inset and invisible shadows read as none. */
export function shadowPreset(value: string | undefined): string {
  const v = String(value || "").trim();
  if (!v || v === "none" || /\binset\b/.test(v)) return "";
  let strongest = -1;
  // Several shadows are comma-separated, but so are the numbers inside rgba().
  for (const one of v.split(/,(?![^(]*\))/)) {
    const color = (one.match(/(rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}/i) || [""])[0];
    if (color && !toHex(color)) {
      // rgba(…, 0.1) is a faint shadow, not an absent one — only a fully
      // see-through colour is nothing. toHex refuses alpha < 0.5, so look.
      const alpha = color.match(/,\s*([\d.]+)\s*\)$/);
      if (!alpha || parseFloat(alpha[1]) <= 0) continue;
    }
    const lengths = one.replace(color, "").match(/-?[\d.]+px/g) || [];
    const [, y = "0", blur = "0"] = lengths;
    const reach = Math.abs(px(y)) + px(blur);
    if (reach > 0) strongest = Math.max(strongest, reach);
  }
  if (strongest < 0) return "";
  if (strongest <= 12) return "light";
  if (strongest <= 28) return "medium";
  return "heavy";
}

function firstUrl(value: string | undefined): string {
  const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(String(value || ""));
  return m ? m[1] : "";
}

/** "rgba(0, 11, 140, 0.38)" → the solid colour it shows as over `under`. */
function solidOver(value: string, under: string): string {
  const m = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
  if (!m) return toHex(value);
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  const base = under.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const bg = base ? [1, 2, 3].map((i) => parseInt(base[i], 16)) : [255, 255, 255];
  return `#${[m[1], m[2], m[3]]
    .map((c, i) => Math.round(parseFloat(c) * a + bg[i] * (1 - a)))
    .map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0"))
    .join("")}`;
}

const GRADIENT_SIDES: Record<string, number> = {
  "to top": 0, "to right": 90, "to bottom": 180, "to left": 270,
  "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135,
  "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315,
};

/**
 * A computed `linear-gradient(...)` → Builder's two-colour gradient: its first
 * and last stops, and its direction (CSS's default, top to bottom, is 180°).
 * A see-through stop is flattened onto the box's own fill, which is what it
 * paints over — daneofearth.org's "Support" band fades white into
 * rgba(0, 11, 140, 0.38) on white. Middle stops, radial and repeating
 * gradients are not representable and read as no gradient.
 */
export function readGradient(
  value: string | undefined,
  under: string
): { color: string; color2: string; gradientAngle: number } | null {
  const m = /^linear-gradient\((.*)\)$/i.exec(String(value || "").trim());
  if (!m) return null;
  const parts = m[1].split(/,(?![^(]*\))/).map((p) => p.trim());
  let angle = 180;
  const deg = /^(-?[\d.]+)deg$/i.exec(parts[0]);
  if (deg) {
    angle = ((Math.round(parseFloat(deg[1])) % 360) + 360) % 360;
    parts.shift();
  } else if (/^to\s/i.test(parts[0])) {
    const side = GRADIENT_SIDES[parts[0].toLowerCase().replace(/\s+/g, " ")];
    if (side === undefined) return null;
    angle = side;
    parts.shift();
  }
  if (parts.length < 2) return null;
  const stop = (p: string) => (p.match(/^((?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)/i) || [""])[0];
  const color = solidOver(stop(parts[0]), under);
  const color2 = solidOver(stop(parts[parts.length - 1]), under);
  if (!color || !color2) return null;
  return { color, color2, gradientAngle: angle };
}

export function readSurface(st: CapturedStyles | undefined, ctx: SurfaceContext): SurfaceLook {
  const look: SurfaceLook = { padding: {} };
  if (!st) return look;

  const fill = toHex(st["background-color"]);
  const color = fill && fill !== ctx.surface ? fill : "";
  const imageUrl = firstUrl(st["background-image"]) ? ctx.resolveImage(firstUrl(st["background-image"])) : "";
  const gradient = imageUrl ? null : readGradient(st["background-image"], fill || "#ffffff");
  if (imageUrl) {
    look.background = { mode: "image", color: fill, color2: "", imageUrl, styleKey: "" };
  } else if (gradient) {
    look.background = { mode: "gradient", ...gradient, imageUrl: "", styleKey: "" };
  } else if (color) {
    look.background = { mode: "color", color, color2: "", imageUrl: "", styleKey: "" };
  }

  const framed = SIDES.every(
    (side) =>
      px(st[`border-${side}-width`]) > 0 &&
      !/^(none|hidden)$/.test(st[`border-${side}-style`] || "none") &&
      Boolean(toHex(st[`border-${side}-color`]))
  );
  if (framed) {
    const style = st["border-top-style"] || "solid";
    look.border = {
      width: String(clamp(Math.max(...SIDES.map((s) => px(st[`border-${s}-width`]))), 1, 20)),
      color: toHex(st["border-top-color"]),
      style: ["solid", "dashed", "dotted"].includes(style) ? style : "solid",
    };
  }

  const radius = clamp(px(st["border-radius"]), 0, 60);
  if (radius > 0) look.radius = String(radius);

  const shadow = shadowPreset(st["box-shadow"]);
  if (shadow) look.shadow = shadow;

  for (const side of SIDES) {
    const n = clamp(px(st[`padding-${side}`]), 0, ctx.maxPadding);
    if (n > 0) look.padding[side] = String(n);
  }
  return look;
}

/** True when a look carries anything a Builder row or column can show. */
export function hasPaint(look: SurfaceLook): boolean {
  return Boolean(look.background || look.border || look.radius || look.shadow);
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Each element's BAND: the outermost painted box in its chain that spans the
 * full width the section's content occupies (2% slack for rounding). A box
 * narrower than that is a card or a panel, never a band. A box with no
 * recorded position counts as a band only when every element in the section
 * sits in it — the rule before positions were recorded.
 */
export function planBands(
  elements: ElementIR[],
  boxes: Record<string, Box> | undefined
): Map<string, string> {
  const placed = elements.map((el) => el.box).filter((b): b is Box => Boolean(b && b.w > 0));
  const left = placed.length ? Math.min(...placed.map((b) => b.x)) : 0;
  const right = placed.length ? Math.max(...placed.map((b) => b.x + b.w)) : 0;
  const contentWidth = right - left;
  const chains = elements.map((el) => el.containers || []);
  const shared = (key: string) => chains.every((chain) => chain.includes(key));
  const isBand = (key: string): boolean => {
    const box = boxes?.[key];
    if (!box || contentWidth <= 0) return shared(key);
    return box.w >= contentWidth * 0.98;
  };
  const bandOf = new Map<string, string>();
  elements.forEach((el, i) => {
    const band = chains[i].find(isBand);
    if (band) bandOf.set(el.sourceId, band);
  });
  return bandOf;
}

/**
 * Each element's CARD: the outermost painted box INSIDE its band whose
 * contents all sit in ONE cell of the section's provisional column grid. A
 * panel holding the whole grid spans several cells and is not a card; each
 * tile inside it is.
 */
export function planCards(
  elements: ElementIR[],
  bandOf: Map<string, string>,
  cellKey: (sourceId: string) => string
): Map<string, string> {
  const chains = elements.map((el) => el.containers || []);
  const cellsByKey = new Map<string, Set<string>>();
  elements.forEach((el, i) => {
    for (const key of chains[i]) {
      const cells = cellsByKey.get(key) || new Set<string>();
      cells.add(cellKey(el.sourceId));
      cellsByKey.set(key, cells);
    }
  });
  const cardOf = new Map<string, string>();
  elements.forEach((el, i) => {
    const band = bandOf.get(el.sourceId);
    const inside = band ? chains[i].slice(chains[i].indexOf(band) + 1) : chains[i];
    const card = inside.find((key) => (cellsByKey.get(key)?.size || 0) === 1);
    if (card) cardOf.set(el.sourceId, card);
  });
  return cardOf;
}
