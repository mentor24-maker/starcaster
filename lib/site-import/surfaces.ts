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
 * Pure, no I/O. normalize.ts records the boxes (SectionIR.containers, and each
 * element's `containers` chain); the mapper (map.ts) decides which box is the
 * row's band and which is a column's card, and calls readSurface for each.
 */

import type { CapturedStyles, ElementIR } from "./ir";
import { toHex } from "./theme";

export type MappedBackground = {
  mode: "none" | "color" | "image";
  color: string;
  color2: string;
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

export function readSurface(st: CapturedStyles | undefined, ctx: SurfaceContext): SurfaceLook {
  const look: SurfaceLook = { padding: {} };
  if (!st) return look;

  const fill = toHex(st["background-color"]);
  const color = fill && fill !== ctx.surface ? fill : "";
  const imageUrl = firstUrl(st["background-image"]) ? ctx.resolveImage(firstUrl(st["background-image"])) : "";
  if (imageUrl) {
    look.background = { mode: "image", color: fill, color2: "", imageUrl, styleKey: "" };
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

/**
 * Which painted boxes are the SECTION's (shared by every element in it — the
 * band) and which box each element's card is. A card is the outermost box
 * beyond the band whose contents all sit in ONE cell of the section's
 * provisional column grid: a panel holding the whole grid spans several
 * cells and is not a card; each tile inside it is.
 */
export function planCards(
  elements: ElementIR[],
  cellKey: (sourceId: string) => string
): { common: string[]; cardOf: Map<string, string> } {
  const chains = elements.map((el) => el.containers || []);
  const common = chains.length
    ? chains[0].filter((key) => chains.every((chain) => chain.includes(key)))
    : [];
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
    const card = chains[i].find(
      (key) => !common.includes(key) && (cellsByKey.get(key)?.size || 0) === 1
    );
    if (card) cardOf.set(el.sourceId, card);
  });
  return { common, cardOf };
}
