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
import { THEME_PALETTE_ROLE_KEYS } from "../builder-client/builder-template";
import type { BuilderThemePaletteRole } from "../builder-client/builder-template";

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
  /** The theme's button style and corners (typography.treatments). */
  treatments?: { buttonStyle?: "outline"; buttonRadius?: number };
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

/** WCAG contrast ratio between two colours, 1 (identical) – 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text. Below this the import theme does not ship a
 *  surface/text pair (task 86bch6geu). */
export const READABLE_CONTRAST = 4.5;

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

/** The most common text colour across the site, as hex ("" if none measured). */
function measuredTextColor(ir: SiteIR): string {
  const texts = (ir.pages || [])
    .flatMap((p) => (p.sections || []).flatMap((s) => s.elements || []))
    .filter((e) => e.class === "text");
  return toHex(mode(texts.map((e) => (e.computedStyles || {}).color)));
}

/** The page surface and, when the obvious choice was refused, why.
 *
 *  The obvious choice is the most common page background — but that is the
 *  <body>, and a site with a black body behind a white content column reads
 *  as black there. With the site's text also black, the theme shipped black
 *  on black and every imported page looked blank (Strands Movie,
 *  2026-10-12, task 86bch6geu). So a surface must be readable against the
 *  measured text: else the biggest LIGHT painted area that is (the content
 *  column), else white. Only light ones: the mapper unsets every band painted
 *  the surface colour, so moving the surface onto a dark band — which is
 *  where white text usually sits — would strip that band's colour from the
 *  import. When nothing light reads, the surface stays and the text is
 *  replaced instead (deriveImportTheme). */
function pickSurface(ir: SiteIR): { surface: string; note: string } {
  const sum = ir.styleSummary;
  if (!sum) return { surface: "", note: "" };
  const measured = toHex(top(sum.pageBackgrounds));
  const text = measuredTextColor(ir);
  const readable = (hex: string) => !text || contrastRatio(hex, text) >= READABLE_CONTRAST;
  if (!measured) return { surface: "#ffffff", note: "" };
  if (readable(measured)) return { surface: measured, note: "" };
  const area = (sum.backgroundsByArea || [])
    .map((t) => toHex(t.value))
    .find((h) => h && luminance(h) >= 0.45 && readable(h));
  const surface = area || (readable("#ffffff") ? "#ffffff" : "");
  if (!surface) return { surface: measured, note: "" };
  const why = area ? "the biggest light area, which the text reads on" : "white, as no light area measured reads with it";
  return {
    surface,
    note: `surface: rejected the page background ${measured} — the site's text ${text} on it is ${contrastRatio(measured, text).toFixed(1)}:1, under ${READABLE_CONTRAST}:1 — using ${surface} (${why})`,
  };
}

/** The colour the import theme gives the page surface: the most common page
 *  background when the site's text reads on it, else a readable one (see
 *  pickSurface); white when backgrounds were measured but none was painted,
 *  "" when the capture predates the measurement. The mapper leaves a band or
 *  card of exactly this colour unset, so it follows the theme. */
export function importSurfaceColor(ir: SiteIR): string {
  return pickSurface(ir).surface;
}


/* ---------- the readability guard (task 86bctakh4) ---------- */

/** Every foreground/background pairing a theme palette paints, declared in
 *  ONE place. Checks used to be written one pair at a time, after each
 *  incident: black-on-black text (Strands, 10/12) got a surface check, white
 *  links got a link check — and white BUTTONS on a white page (Alphire,
 *  10/27) shipped because nobody had written that pair yet. Now a role that
 *  appears in no pair fails a test (PALETTE_PAIRS_COVER_EVERY_ROLE), so a new
 *  role cannot ship unchecked.
 *
 *  `min` is the contrast ratio: 4.5 (WCAG AA) for text, 2 for a button against the
 *  page (see that pair). `repair` names which side gets replaced.
 *
 *  A pair the SITE ITSELF painted together (its own button with its own
 *  label) is the site's design: Divi's white-on-#2ea3f2 is 2.6:1 and nobody
 *  wants the import to "fix" a brand. Those are held only to
 *  INVISIBLE_BELOW. A pair the IMPORT composed — two colours measured
 *  separately, a converted outline button, a copied or hardcoded text
 *  colour — is held to `min`, because no designer ever saw it. */
export type PalettePair = {
  fg: BuilderThemePaletteRole;
  bg: BuilderThemePaletteRole;
  min: number;
  repair: "fg";
  why: string;
};

export const PALETTE_PAIRS: PalettePair[] = [
  { fg: "surfaceText", bg: "surface", min: READABLE_CONTRAST, repair: "fg", why: "body text on the page" },
  { fg: "bandText", bg: "band", min: READABLE_CONTRAST, repair: "fg", why: "text on a light band" },
  { fg: "inverseText", bg: "inverse", min: READABLE_CONTRAST, repair: "fg", why: "text on a dark band" },
  { fg: "headerText", bg: "header", min: READABLE_CONTRAST, repair: "fg", why: "menu text in the header" },
  // The button must stand out from the page before its label matters, so
  // this pair runs first and the label is re-checked against the result.
  // 2:1, not WCAG's 3:1 for boundaries: the colour IS the site's brand
  // (Divi blue is 2.6:1 on white and plainly visible), and the defect this
  // exists for is a button that is not there at all — Alphire's white
  // outline buttons, filled white on a white page at 1.0:1.
  { fg: "button", bg: "surface", min: 2, repair: "fg", why: "a button against the page" },
  { fg: "buttonText", bg: "button", min: READABLE_CONTRAST, repair: "fg", why: "a button's label" },
];

/** Below this a pairing is not a style choice, it is invisible. */
export const INVISIBLE_BELOW = 1.5;

export const pairKey = (pair: Pick<PalettePair, "fg" | "bg">) => `${pair.fg}/${pair.bg}`;

/** Which roles the pairs above cover — the test compares this with
 *  THEME_PALETTE_ROLE_KEYS. */
export function uncoveredPaletteRoles(): BuilderThemePaletteRole[] {
  const covered = new Set(PALETTE_PAIRS.flatMap((p) => [p.fg, p.bg]));
  return THEME_PALETTE_ROLE_KEYS.filter((role) => !covered.has(role));
}

/** Checks every declared pair present in `palette` and repairs the ones that
 *  do not read, in place, naming each repair in `notes`. A pair with either
 *  side absent inherits the platform default and is not checked here.
 *
 *  Repair rules: a TEXT colour becomes white or near-black, whichever reads
 *  (pure black if neither does). A BUTTON that vanishes into the page takes
 *  the first of the site's own dark/brand colours (inverse, header, heading,
 *  body text) that stands out — the site's colour, not an invented one — and
 *  only then a neutral.
 *
 *  A site-painted pair stops being the site's design the moment the guard
 *  replaces either of its colours: a white button with a dark label, turned
 *  near-black because it vanished into a white page, now carries a label the
 *  site never put on it, so that label is held to the full `min`. */
export function guardPaletteReadability(
  palette: Record<string, string>,
  notes: string[],
  brandCandidates: string[] = [],
  sitePainted: Set<string> = new Set(),
): void {
  const repaired = new Set<string>();
  for (const pair of PALETTE_PAIRS) {
    const fg = palette[pair.fg];
    const bg = palette[pair.bg];
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    const asPainted = sitePainted.has(pairKey(pair)) && !repaired.has(pair.fg) && !repaired.has(pair.bg);
    const floor = asPainted ? INVISIBLE_BELOW : pair.min;
    if (ratio >= floor) continue;
    let next: string;
    if (pair.fg === "button") {
      const candidates = [palette.inverse, palette.header, ...brandCandidates, contrastText(bg), "#000000"];
      next = candidates.find((c) => c && contrastRatio(c, bg) >= pair.min) || "#000000";
    } else {
      const neutral = contrastText(bg);
      next = contrastRatio(neutral, bg) >= pair.min ? neutral : luminance(bg) > 0.18 ? "#000000" : "#ffffff";
    }
    palette[pair.fg] = next;
    repaired.add(pair.fg);
    notes.push(`${pair.why}: rejected ${pair.fg} ${fg} on ${pair.bg} ${bg} (${ratio.toFixed(1)}:1, under ${floor}:1) — using ${next}`);
  }
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
  const [buttonFill = "", buttonText = "", radius = ""] = top(sum?.buttons).split("|");
  // An OUTLINED button (no fill, coloured text + border) becomes an outline
  // theme: its colour is the button role (border + text at rest, fill on
  // hover) and the button text is whichever of white/near-black reads on
  // that hover fill. Until 2026-10-27 a theme could only describe a fill, so
  // these became solid blocks (task 86bctakhj).
  const outlined = !toHex(buttonFill) && Boolean(toHex(buttonText));
  const fill = toHex(buttonFill) || toHex(buttonText);
  let readableLink = link;
  const { surface, note: surfaceNote } = pickSurface(ir);
  if (surfaceNote) notes.push(surfaceNote);
  if (surface) {
    palette.surface = surface;
    const readsOnSurface = (hex: string) => contrastRatio(surface, hex) >= READABLE_CONTRAST;
    // Near-black tops out near 4.35:1 on a mid grey; pure black never
    // drops under 4.5:1 wherever white does.
    const fallback = readsOnSurface(contrastText(surface)) ? contrastText(surface) : "#000000";
    if (text && readsOnSurface(text)) palette.surfaceText = text;
    else if (text) {
      // No light surface reads with this text (white text, or a pale grey
      // one): keep the surface, give it text that reads. The page paints
      // body text from typography.colors.text, not palette.surfaceText
      // (--bx-text; --lp-surface-text is read by nothing), so replacing only
      // the palette left the page as blank as before while the note claimed
      // a fix (review round 1, task 86bch6geu).
      palette.surfaceText = fallback;
      colors.text = fallback;
      notes.push(`surface text: rejected ${text} on ${surface} (${contrastRatio(surface, text).toFixed(1)}:1) — using ${fallback}`);
    }
    // Headings paint from colors.heading, measured separately — or the
    // rejected text colour inherited above — so they get the same check
    // against whichever surface was chosen.
    if (colors.heading && !readsOnSurface(colors.heading)) {
      const was = colors.heading;
      colors.heading = colors.text && readsOnSurface(colors.text) ? colors.text : fallback;
      notes.push(`heading colour: rejected ${was} on ${surface} (${contrastRatio(surface, was).toFixed(1)}:1) — using ${colors.heading}`);
    }
    // Links in body text paint from colors.link (--bx-link) and the <a>
    // element override. On Strands the links were white on the black body;
    // once the surface moved to the white content column they were white on
    // white and the notes said nothing (review round 2, task 86bch6geu).
    // Only checked once this import has already overridden the page's own
    // colours (moved the surface, or replaced unreadable text): until then a
    // link sits where the site designed it to, and a brand blue at 2.8:1 on
    // white is the site's choice, not an import defect to rewrite. Prefer the
    // button colour — the site's own accent — when it reads.
    const overridden = Boolean(surfaceNote) || colors.text !== text;
    if (link && overridden && !readsOnSurface(link)) {
      readableLink = fill && readsOnSurface(fill) ? fill : fallback;
      colors.link = readableLink;
      colors.linkHover = readableLink;
      notes.push(`link colour: rejected ${link} on ${surface} (${contrastRatio(surface, link).toFixed(1)}:1) — using ${readableLink}`);
    }
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
  // The theme's general borderRadius rounds containers and never reached a
  // button, so the measured corners also go to the button radius.
  let borderRadius: number | undefined;
  const treatments: NonNullable<ImportTheme["treatments"]> = {};
  if (fill) {
    palette.button = fill;
    palette.buttonText = outlined ? contrastText(fill) : toHex(buttonText) || contrastText(fill);
    if (outlined) {
      treatments.buttonStyle = "outline";
      notes.push(`buttons: outlined in ${fill} on the original — the theme's buttons are outlines in ${fill}`);
    }
  }
  if (top(sum?.buttons)) borderRadius = Math.max(0, Math.min(60, Number(radius) || 0));
  if (borderRadius) treatments.buttonRadius = borderRadius;
  // The site painted its button and label together only when it had a real
  // fill and a real label colour; an outline conversion is the import's.
  const sitePainted = new Set<string>();
  if (fill && !outlined && toHex(buttonText)) sitePainted.add(pairKey({ fg: "buttonText", bg: "button" }));
  guardPaletteReadability(palette, notes, [colors.heading, colors.text].filter(Boolean), sitePainted);
  notes.push(`palette: ${Object.entries(palette).map(([k, v]) => `${k} ${v}`).join(", ") || "no backgrounds measured (capture predates it)"}`);

  const widthValue = Number(top(sum?.contentWidths));
  const contentWidth = widthValue >= 600 && widthValue <= 2000 ? widthValue : undefined;
  if (contentWidth) notes.push(`content width: ${contentWidth}px`);
  if (borderRadius !== undefined) notes.push(`button corners: ${borderRadius}px`);

  return {
    name,
    primaryColor: palette.button || fill || readableLink || "",
    secondaryColor: band || "",
    backgroundColor: surface || "",
    accentColor: readableLink || palette.button || fill || "",
    ...(borderRadius !== undefined ? { borderRadius } : {}),
    ...(contentWidth ? { contentWidth } : {}),
    palette,
    ...(Object.keys(treatments).length ? { treatments } : {}),
    typography: { fonts, scale, colors, elements: readableLink ? { a: { color: readableLink } } : {} },
    notes,
  };
}
