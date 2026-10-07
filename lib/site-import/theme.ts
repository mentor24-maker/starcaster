/**
 * Site Import — the import theme (task 86bce9wx0). Turns what the capture
 * measured about a source site into a Builder theme named after it
 * ("daneofearth 1"), so an import arrives in its own fonts, colours and
 * button style instead of the platform default.
 *
 * Dane's decisions (2026-10-06): every import creates a NEW numbered theme
 * (never overwriting one he has adjusted), it becomes the project's default,
 * and the site's real font is used (any Google Font — task 86bce9wwv).
 *
 * Pure, no I/O. The runner (scripts/site_import_map.mjs --apply) names it,
 * saves it and makes it the default. Every value is the MOST COMMON one of
 * its role across the whole site; a role with no evidence is left unset, so
 * the theme falls back to Builder's default for it rather than inventing one.
 */

import { googleFontKey } from "../builder-client/builder-google-fonts";
import type { ElementIR, SiteIR, TokenCount } from "./ir";

/** The ten built-in Builder fonts by family name → their stored key.
 *  Mirrors BUILDER_HEADING_FONTS in components/builder/builder-utils.ts. */
const BUILT_IN_FONTS: Record<string, string> = {
  inter: "inter",
  poppins: "poppins",
  montserrat: "montserrat",
  oswald: "oswald",
  archivo: "archivo",
  "space grotesk": "space-grotesk",
  "bebas neue": "bebas",
  "playfair display": "playfair",
  merriweather: "merriweather",
  lora: "lora",
};

/** Fonts every computer already has. Naming one as a Google Font would
 *  request a stylesheet that does not exist, so they map to "inherit". */
const SYSTEM_FONTS = new Set([
  "arial", "helvetica", "helvetica neue", "georgia", "times", "times new roman",
  "verdana", "tahoma", "trebuchet ms", "courier", "courier new", "segoe ui",
  "system-ui", "-apple-system", "blinkmacsystemfont", "sans-serif", "serif",
  "monospace", "cursive", "fantasy", "ui-sans-serif", "ui-serif", "inherit",
]);

export type ImportTheme = {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  accentColor: string;
  borderRadius?: number;
  contentWidth?: number;
  palette: Record<string, string>;
  typography: {
    fonts: { heading: string; body: string; mono: string };
    scale: Record<string, number>;
    colors: Record<string, string>;
    elements: Record<string, Record<string, unknown>>;
  };
  /** One plain line per decision, for the dry-run report. */
  notes: string[];
};

/* ---------- small helpers ---------- */

function mode(values: (string | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

const top = (list: TokenCount[] | undefined) => (list && list.length ? list[0].value : "");

/** "rgb(51, 51, 51)" / "rgba(…, 0.9)" / "#333" → "#333333"; "" if see-through. */
export function toHex(value: string | undefined): string {
  const v = String(value || "").trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1];
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }
  const m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (!m) return "";
  if (m[4] !== undefined) {
    const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 0.5) return "";
  }
  return `#${[m[1], m[2], m[3]]
    .map((c) => Math.max(0, Math.min(255, Math.round(parseFloat(c)))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Relative luminance 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black — whichever reads more clearly on this colour
 *  (WCAG contrast ratio). A plain luminance cut-off put white text on
 *  #2ea3f2 at 2.7:1; near-black there is 7:1. */
export function contrastText(hex: string): string {
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance("#111111") + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#111111";
}

const px = (value: string | undefined): number => {
  const n = parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : 0;
};

function firstFamily(stack: string | undefined): string {
  return String(stack || "").split(",")[0].trim().replace(/^['"]|['"]$/g, "").trim();
}

/** A captured font-family → a Builder font key: a built-in, a Google Font
 *  ("gf:Open Sans"), or "" (inherit) for system fonts and the unreadable. */
export function fontKeyFor(stack: string | undefined): string {
  const family = firstFamily(stack);
  const lower = family.toLowerCase();
  if (!family || SYSTEM_FONTS.has(lower)) return "";
  if (BUILT_IN_FONTS[lower]) return BUILT_IN_FONTS[lower];
  return googleFontKey(family);
}

function headingLevel(el: ElementIR): number {
  const m = String(el.html || "").match(/^\s*<h([1-6])\b/i);
  return m ? Number(m[1]) : 0;
}

/** Site name for the theme: the host's first label, without "www." —
 *  https://www.daneofearth.org/ → "daneofearth". */
export function siteNameFromUrl(sourceUrl: string): string {
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
    return host.split(".")[0] || host || "imported site";
  } catch {
    return "imported site";
  }
}

/** "daneofearth" + existing ["daneofearth 1", "Other"] → "daneofearth 2". */
export function nextThemeName(siteName: string, existingNames: string[]): string {
  const re = new RegExp(`^${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`, "i");
  let max = 0;
  for (const name of existingNames) {
    const m = String(name || "").trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${siteName} ${max + 1}`;
}

/* ---------- the derivation ---------- */

export function deriveImportTheme(ir: SiteIR, name: string): ImportTheme {
  const elements = (ir.pages || []).flatMap((p) => (p.sections || []).flatMap((s) => s.elements || []));
  const texts = elements.filter((e) => e.class === "text");
  const headings = elements.filter((e) => e.class === "heading");
  const links = elements.filter((e) => e.class === "link");
  const notes: string[] = [];
  const style = (e: ElementIR, prop: string) => (e.computedStyles || {})[prop];

  // Fonts.
  const bodyStack = mode(texts.map((e) => style(e, "font-family")));
  const headingStack = mode(headings.map((e) => style(e, "font-family"))) || bodyStack;
  const fonts = { heading: fontKeyFor(headingStack), body: fontKeyFor(bodyStack), mono: "" };
  notes.push(`fonts: headings ${firstFamily(headingStack) || "(none measured)"} → ${fonts.heading || "theme default"}, body ${firstFamily(bodyStack) || "(none measured)"} → ${fonts.body || "theme default"}`);

  // Sizes, weights, line heights.
  const scale: Record<string, number> = {};
  const baseSize = Math.round(px(mode(texts.map((e) => style(e, "font-size")))));
  if (baseSize >= 10 && baseSize <= 32) scale.baseSize = baseSize;
  const lhRatio = (e: ElementIR) => {
    const size = px(style(e, "font-size"));
    const lh = px(style(e, "line-height"));
    return size && lh ? String(Math.round((lh / size) * 100) / 100) : undefined;
  };
  const baseLh = Number(mode(texts.map(lhRatio)));
  if (baseLh >= 1 && baseLh <= 2.5) scale.baseLineHeight = baseLh;
  for (let level = 1; level <= 6; level++) {
    const at = headings.filter((e) => headingLevel(e) === level);
    if (!at.length) continue;
    const size = Math.round(px(mode(at.map((e) => style(e, "font-size")))));
    if (size >= 10 && size <= 120) scale[`h${level}`] = size;
    const weight = Number(mode(at.map((e) => style(e, "font-weight") || "400")));
    if (weight >= 100 && weight <= 900) scale[`h${level}Fw`] = Math.round(weight / 100) * 100;
    const lh = Number(mode(at.map(lhRatio)));
    if (lh >= 0.8 && lh <= 2.5) scale[`h${level}Lh`] = lh;
  }
  notes.push(`sizes: body ${scale.baseSize ?? "default"}px; ${[1, 2, 3, 4, 5, 6].filter((l) => scale[`h${l}`]).map((l) => `H${l} ${scale[`h${l}`]}px`).join(", ") || "no headings measured"}`);

  // Text colours.
  const text = toHex(mode(texts.map((e) => style(e, "color"))));
  const heading = toHex(mode(headings.map((e) => style(e, "color")))) || text;
  const link = toHex(mode(links.map((e) => style(e, "color"))));
  const colors: Record<string, string> = {};
  if (text) colors.text = text;
  if (heading) colors.heading = heading;
  if (link) {
    colors.link = link;
    colors.linkHover = link;
  }

  // Palette, from the role-separated evidence (absent on old captures).
  const sum = ir.styleSummary;
  const palette: Record<string, string> = {};
  const surface = toHex(top(sum?.pageBackgrounds)) || (sum ? "#ffffff" : "");
  if (surface) {
    palette.surface = surface;
    if (text) palette.surfaceText = text;
  }
  const bands = (sum?.backgroundsByArea || []).map((t) => toHex(t.value)).filter((h) => h && h !== surface);
  const band = bands.find((h) => luminance(h) >= 0.45);
  if (band) {
    palette.band = band;
    if (text) palette.bandText = text;
  }
  const inverse = bands.find((h) => luminance(h) < 0.2);
  if (inverse) {
    palette.inverse = inverse;
    palette.inverseText = "#ffffff";
  }
  const header = toHex(top(sum?.headerBackgrounds));
  if (header) {
    palette.header = header;
    palette.headerText = contrastText(header) === "#ffffff" ? "#ffffff" : text || "#111111";
  }
  let borderRadius: number | undefined;
  const [buttonFill = "", buttonText = "", radius = ""] = top(sum?.buttons).split("|");
  // An OUTLINED button (no fill, coloured text + border) has no Builder
  // equivalent — the theme's button is a fill — so its colour becomes the
  // fill and the text is whichever of white/near-black reads better on it.
  const outlined = !toHex(buttonFill) && Boolean(toHex(buttonText));
  const fill = toHex(buttonFill) || toHex(buttonText);
  if (fill) {
    palette.button = fill;
    palette.buttonText = outlined ? contrastText(fill) : toHex(buttonText) || contrastText(fill);
    if (outlined) notes.push(`buttons: outlined in ${fill} on the original — Builder's button is filled, so it becomes ${fill} filled`);
  }
  if (top(sum?.buttons)) borderRadius = Math.max(0, Math.min(60, Number(radius) || 0));
  notes.push(`palette: ${Object.entries(palette).map(([k, v]) => `${k} ${v}`).join(", ") || "no backgrounds measured (capture predates it)"}`);

  const widthValue = Number(top(sum?.contentWidths));
  const contentWidth = widthValue >= 600 && widthValue <= 2000 ? widthValue : undefined;
  if (contentWidth) notes.push(`content width: ${contentWidth}px`);
  if (borderRadius !== undefined) notes.push(`button corners: ${borderRadius}px`);

  return {
    name,
    primaryColor: fill || link || "",
    secondaryColor: band || "",
    backgroundColor: surface || "",
    accentColor: link || fill || "",
    ...(borderRadius !== undefined ? { borderRadius } : {}),
    ...(contentWidth ? { contentWidth } : {}),
    palette,
    typography: { fonts, scale, colors, elements: link ? { a: { color: link } } : {} },
    notes,
  };
}
