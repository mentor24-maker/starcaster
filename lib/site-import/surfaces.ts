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
import { hexOf, isGlow, parseShadows, rgba } from "./fidelity";
import {
  BUILDER_GRADIENT_LAYER_LIMIT,
  BUILDER_GRADIENT_STOP_LIMIT,
  normalizeBuilderGradientLayers,
  normalizeRadialSize,
} from "../builder-client/builder-gradient-layers";
import type { BuilderGradientLayer, BuilderGradientStop } from "../builder-client/builder-gradient-layers";

export type MappedBackground = {
  mode: "none" | "color" | "gradient" | "image";
  color: string;
  color2: string;
  /** Mode "gradient" only — CSS degrees, which Builder paints the same way. */
  gradientAngle?: number;
  /** Mode "gradient" only, and only when two colours cannot say it: stacked,
   *  radial, see-through or many-stop gradients (task 86bctde1m). */
  gradientLayers?: BuilderGradientLayer[];
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

/** A coloured glow: the colour, how far it reaches (px) and how strong it is
 *  (the colour's opacity, 1–100). */
export type GlowLook = { color: string; size: number; strength: number };

/**
 * A computed box-shadow → the glow it draws, or null (task 86bctde3a).
 * A glow is a tinted shadow with no offset (fidelity.ts isGlow); a grey or
 * offset shadow is a drop shadow and stays with shadowPreset. Inner glows are
 * skipped — nothing in Builder draws one yet. Of several glows, the one that
 * reaches furthest wins: Alphire's buttons wear a 22px outer glow over a
 * faint 18px inner one, and the outer is the haze a visitor sees.
 */
export function readGlow(value: string | undefined): GlowLook | null {
  let best: GlowLook | null = null;
  for (const s of parseShadows(value)) {
    if (s.inset || !isGlow(s)) continue;
    const c = rgba(s.color);
    const color = hexOf(s.color);
    if (!c || !color) continue;
    const look = { color, size: Math.round(s.blur), strength: clamp(c[3] * 100, 1, 100) };
    if (!best || look.size > best.size) best = look;
  }
  return best;
}

/** A glow → the Button's Glow settings (lib/builder-client/builder-button-glow.ts). */
export function buttonGlowSettings(st: CapturedStyles | undefined): Record<string, string> {
  const glow = readGlow(st?.["box-shadow"]);
  if (!glow) return {};
  return {
    buttonGlow: "true",
    buttonGlowColor: glow.color,
    buttonGlowSize: String(clamp(glow.size, 1, 80)),
    buttonGlowStrength: String(glow.strength),
  };
}

/** A glow → a picture's own coloured shadow, centred (the image module's
 *  imageShadow* keys, builder-carousel-image-frame.ts), which already draws
 *  any colour at any opacity — a picture needed no new setting. */
export function imageGlowSettings(st: CapturedStyles | undefined): Record<string, string> {
  const glow = readGlow(st?.["box-shadow"]);
  if (!glow) return {};
  return {
    imageShadow: "true",
    imageShadowColor: glow.color,
    imageShadowX: "0",
    imageShadowY: "0",
    imageShadowBlur: String(clamp(glow.size, 0, 80)),
    imageShadowSpread: "0",
    imageShadowOpacity: String(glow.strength),
  };
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

/** Split on the commas at the TOP level only — never inside rgba(...) or a layer. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

const COLOR_TOKEN = /^((?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b|transparent\b|[a-z]+\b)/i;

/** A captured colour → #rrggbb plus its alpha (0–100), or null if it is not one. */
function readColorAlpha(token: string): { color: string; alpha: number } | null {
  const v = token.trim().toLowerCase();
  if (v === "transparent") return { color: "#000000", alpha: 0 };
  const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec(v);
  if (hex8) return { color: `#${hex8[1]}`, alpha: Math.round((parseInt(hex8[2], 16) / 255) * 100) };
  const m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const color = `#${[m[1], m[2], m[3]]
      .map((c) => Math.max(0, Math.min(255, Math.round(parseFloat(c)))).toString(16).padStart(2, "0"))
      .join("")}`;
    return { color, alpha: Math.round(Math.max(0, Math.min(1, a)) * 10000) / 100 };
  }
  const color = toHex(v);
  return color ? { color, alpha: 100 } : null;
}

/**
 * The stops of one layer. A stop with no position, or one given in px (which
 * cannot be turned into a percentage without the box's size), is placed the
 * way CSS places a missing one: first at 0, last at 100, the rest evenly
 * between their positioned neighbours.
 */
function readStops(parts: string[]): BuilderGradientStop[] | null {
  const raw: Array<{ color: string; alpha: number; position: number | null }> = [];
  for (const part of parts) {
    const token = (part.match(COLOR_TOKEN) || [""])[0];
    const color = token ? readColorAlpha(token) : null;
    if (!color) return null;
    const rest = part.slice(token.length).trim().split(/\s+/).filter(Boolean);
    // "red 10% 30%" is two stops of one colour.
    const positions = rest.map((p) => (/^-?[\d.]+%$/.test(p) ? parseFloat(p) : /^0(px)?$/.test(p) ? 0 : null));
    if (!positions.length) raw.push({ ...color, position: null });
    for (const position of positions.slice(0, 2)) raw.push({ ...color, position });
  }
  if (raw.length < 2) return null;
  if (raw[0].position === null) raw[0].position = 0;
  if (raw[raw.length - 1].position === null) raw[raw.length - 1].position = 100;
  for (let i = 1; i < raw.length - 1; i += 1) {
    if (raw[i].position !== null) continue;
    let j = i;
    while (raw[j].position === null) j += 1;
    const from = raw[i - 1].position as number;
    const to = raw[j].position as number;
    for (let k = i; k < j; k += 1) raw[k].position = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  return raw.slice(0, BUILDER_GRADIENT_STOP_LIMIT).map((stop) => ({
    color: stop.color,
    alpha: stop.alpha,
    position: Math.round(Math.max(0, Math.min(100, stop.position as number)) * 100) / 100,
  }));
}

const POSITION_WORDS: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

/** "80% 20%", "right top", "center" → percentages; anything else centres. */
function readPosition(text: string): { x: number; y: number } {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const one = (word: string | undefined): number | null => {
    if (word === undefined) return 50;
    if (/^-?[\d.]+%$/.test(word)) return Math.max(0, Math.min(100, parseFloat(word)));
    return word in POSITION_WORDS ? POSITION_WORDS[word] : null;
  };
  if (words.length === 1 && (words[0] === "top" || words[0] === "bottom")) {
    return { x: 50, y: POSITION_WORDS[words[0]] };
  }
  // Keywords may come y-first ("top right"); percentages never do.
  if (words.length === 2 && (words[0] === "top" || words[0] === "bottom" || words[1] === "left" || words[1] === "right")) {
    words.reverse();
  }
  const x = one(words[0]);
  const y = one(words[1]);
  return { x: x ?? 50, y: y ?? 50 };
}

function readLayer(value: string): BuilderGradientLayer | null {
  const m = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/i.exec(value.trim());
  // A repeating gradient tiles; painting it once would be a different picture.
  if (!m || m[1]) return null;
  const parts = m[3].split(/,(?![^(]*\))/).map((p) => p.trim());
  const kind = m[2].toLowerCase() === "radial" ? "radial" : "linear";
  const layer: BuilderGradientLayer = { kind, angle: 180, shape: "ellipse", size: "", x: 50, y: 50, stops: [] };
  const first = parts[0] || "";
  const leadsWithColor = Boolean(readColorAlpha((first.match(COLOR_TOKEN) || [""])[0]));
  if (kind === "linear" && !leadsWithColor) {
    const deg = /^(-?[\d.]+)deg$/i.exec(first);
    const turn = /^(-?[\d.]+)turn$/i.exec(first);
    if (deg) layer.angle = ((Math.round(parseFloat(deg[1])) % 360) + 360) % 360;
    else if (turn) layer.angle = ((Math.round(parseFloat(turn[1]) * 360) % 360) + 360) % 360;
    else if (/^to\s/i.test(first)) {
      const side = GRADIENT_SIDES[first.toLowerCase().replace(/\s+/g, " ")];
      if (side === undefined) return null;
      layer.angle = side;
    } else return null;
    parts.shift();
  } else if (kind === "radial" && !leadsWithColor) {
    const [shapeSize, at = ""] = first.toLowerCase().split(/\s*\bat\b\s*/);
    const words = shapeSize.split(/\s+/).filter(Boolean);
    if (words.includes("circle")) layer.shape = "circle";
    const sizeWords = words.filter((w) => w !== "circle" && w !== "ellipse");
    layer.size = normalizeRadialSize(sizeWords.join(" "));
    // A circle with no size given is still a circle; one with two lengths is not.
    if (!words.includes("circle") && !words.includes("ellipse") && sizeWords.length === 1 && /px$/.test(sizeWords[0])) {
      layer.shape = "circle";
    }
    Object.assign(layer, readPosition(at));
    parts.shift();
  }
  const stops = readStops(parts);
  if (!stops) return null;
  layer.stops = stops;
  return layer;
}

/**
 * EVERY gradient layer of a computed `background-image`, top first — linear
 * and radial, with their stops, positions and see-through colours. Layers the
 * Builder cannot paint (repeating gradients, pictures) are left out and the
 * rest kept; null when none is left.
 *
 * The BOTTOM layer paints over the box's own fill, so its see-through stops
 * are flattened onto that fill the way readGradient does. The layers above
 * keep their transparency — a glow that fades to nothing is the whole point
 * of one.
 */
export function readGradientLayers(value: string | undefined, under: string): BuilderGradientLayer[] | null {
  const text = String(value || "").trim();
  if (!/gradient\(/i.test(text)) return null;
  const layers = splitTopLevel(text)
    .map(readLayer)
    .filter((layer): layer is BuilderGradientLayer => layer !== null)
    .slice(0, BUILDER_GRADIENT_LAYER_LIMIT);
  if (!layers.length) return null;
  const bottom = layers[layers.length - 1];
  bottom.stops = bottom.stops.map((stop) => {
    if (stop.alpha >= 100) return stop;
    const n = parseInt(stop.color.slice(1), 16);
    const flat = solidOver(`rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${stop.alpha / 100})`, under);
    return { ...stop, color: flat, alpha: 100 };
  });
  const clean = normalizeBuilderGradientLayers(layers);
  return clean.length ? clean : null;
}

/** True when two colours and an angle paint exactly what these layers do. */
function twoColoursSayIt(layers: BuilderGradientLayer[]): boolean {
  if (layers.length !== 1) return false;
  const [layer] = layers;
  return (
    layer.kind === "linear" &&
    layer.stops.length === 2 &&
    layer.stops[0].position === 0 &&
    layer.stops[1].position === 100 &&
    layer.stops.every((stop) => stop.alpha >= 100)
  );
}

/**
 * The Builder gradient a computed `background-image` becomes. A plain two-stop
 * linear gradient comes out exactly as readGradient always gave it, so every
 * import that already worked is unchanged; anything richer also carries its
 * layers, with the two colours mirroring the bottom one for the surfaces that
 * only know two.
 */
export function readGradientBackground(
  value: string | undefined,
  under: string
): { color: string; color2: string; gradientAngle: number; gradientLayers?: BuilderGradientLayer[] } | null {
  const simple = readGradient(value, under);
  const layers = readGradientLayers(value, under);
  if (!layers || twoColoursSayIt(layers)) return simple;
  const bottom = layers[layers.length - 1];
  return {
    color: bottom.stops[0].color,
    color2: bottom.stops[bottom.stops.length - 1].color,
    gradientAngle: bottom.kind === "linear" ? bottom.angle : 180,
    gradientLayers: layers,
  };
}

export function readSurface(st: CapturedStyles | undefined, ctx: SurfaceContext): SurfaceLook {
  const look: SurfaceLook = { padding: {} };
  if (!st) return look;

  const fill = toHex(st["background-color"]);
  const color = fill && fill !== ctx.surface ? fill : "";
  const imageUrl = firstUrl(st["background-image"]) ? ctx.resolveImage(firstUrl(st["background-image"])) : "";
  const gradient = imageUrl ? null : readGradientBackground(st["background-image"], fill || "#ffffff");
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
 *
 * `shows` says whether a box looks like anything once the page's own surface
 * is taken away. Divi, Elementor and most WordPress themes paint their main
 * wrapper the page's white; that wrapper is full-width and outermost, so it
 * used to win and pour every coloured band inside it into single cells
 * (round 2 of 86bce9wx3). A box that shows nothing is skipped and the search
 * keeps going inward. White WITH a picture or a gradient still shows. Only
 * when nothing inward shows does a plain box stand as the band, for its
 * padding alone — the outermost plain box that HAS padding, because the
 * outermost plain box is usually that same unpadded white wrapper, and Divi's
 * 54px lives on the white section inside it (round 3 of 86bce9wx3). Outermost
 * rather than innermost so a padded Divi row inside the section does not
 * stand in for it. No padded plain box: the outermost plain one, as before.
 */
export function planBands(
  elements: ElementIR[],
  boxes: Record<string, Box> | undefined,
  shows: (key: string) => boolean = () => true,
  padded: (key: string) => boolean = () => false
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
    // Failing a band that shows, the plain one still carries the room around
    // the content — Divi's white sections pad every row by 54px.
    const band =
      chains[i].find((key) => isBand(key) && shows(key)) ||
      chains[i].find((key) => isBand(key) && padded(key)) ||
      chains[i].find(isBand);
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
