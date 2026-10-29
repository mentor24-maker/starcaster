/**
 * Site Import — the fidelity report's judgement (task 86bctde11): for one
 * captured section, which of the styles the ORIGINAL page had did the
 * imported Builder rows fail to reproduce?
 *
 * Before this, "what did the import lose?" was answered by putting two pages
 * side by side and squinting. The Alphire import (2026-10-27) came out
 * "bearing little resemblance" to the original, and nobody could say in a
 * list WHICH things were lost — so nobody could say whether a fix helped.
 * Every other ticket in the site-import-fidelity epic is measured with this.
 *
 * Pure, no I/O, so the node tests can feed it a fixture and break it.
 * scripts/site_import_fidelity.mjs loads the IR and the Builder pages,
 * photographs both sides, and calls `compareSection` / `unplacedAssets`.
 *
 * WHAT IT REFUSES TO DO
 *  - Fix anything. It measures.
 *  - Score. Each loss is named under its category; a "73% similar" would hide
 *    exactly which of the seven things went missing.
 *  - Say "no differences" about something it could not see. A capture made
 *    before task 86bctde48 recorded no ::before/::after layers, so on those
 *    decorative layers are reported as not measurable (`notMeasured`) rather
 *    than as none; a section with no imported row is CANNOT TELL, never clean.
 */

import type { CapturedStyles, DecorationIR, SectionIR, AssetRef } from "./ir";
import { LAYOUT_RATIOS } from "./columns";

export type FidelityCategory =
  | "background"
  | "decorative"
  | "shadow"
  | "shape"
  | "columns"
  | "text"
  | "asset";

/** In report order, with the words the report uses. */
export const FIDELITY_CATEGORIES: { key: FidelityCategory; label: string }[] = [
  { key: "background", label: "Background (colour / gradient / image)" },
  { key: "decorative", label: "Decorative layers" },
  { key: "shadow", label: "Shadows and glow" },
  { key: "shape", label: "Shapes and masks" },
  { key: "columns", label: "Column layout" },
  { key: "text", label: "Text styling" },
  { key: "asset", label: "Downloaded but never placed" },
];

export type FidelityFinding = {
  category: FidelityCategory;
  /** One plain sentence: what the original had. */
  what: string;
  /** What the import shows instead ("nothing", "a grey shadow", …). */
  imported: string;
};

/** The parts of a Builder section this reads — the stored page JSON's row. */
export type BuilderRow = {
  id: string;
  layout?: string;
  background?: { mode?: string; color?: string; color2?: string; imageUrl?: string };
  cellBackgrounds?: Record<string, { mode?: string; color?: string; color2?: string; imageUrl?: string }>;
  cellShadow?: Record<string, string>;
  cellBorderRadius?: Record<string, string>;
  rowBorderRadius?: string;
  modules?: { id?: string; type?: string; text?: string; settings?: Record<string, unknown> }[];
};

/** What the page's theme gives text that carries no style of its own. */
export type ThemeText = {
  /** Heading weights by level, "h1" → 700. */
  headingWeights: Record<string, number>;
  headingColor: string;
  textColor: string;
  linkColor: string;
};

/**
 * How busy each half of a picture is (`edgeDensity`) — `null` when that
 * picture could not be read. Only the column check uses it: a CSS-painted
 * picture is not an element, so the capture's boxes cannot see the column it
 * filled, but the screenshot can.
 */
export type SideBusyness = { left: number; right: number } | null;

export type SectionComparison = {
  sourceId: string;
  /** "compared": the findings are the list. "cannot-tell": they are not. */
  status: "compared" | "cannot-tell";
  reason: string;
  builderRowIds: string[];
  findings: FidelityFinding[];
  /** Categories this section could not be judged on, with why. */
  notMeasured: { category: FidelityCategory; why: string }[];
};

/** Above this mean edge strength (0–255 per pixel) a half holds a picture,
 *  text or pattern; a flat fill or a smooth gradient sits well under 1. */
export const BUSY_EDGE_THRESHOLD = 2.5;

export const DECORATIVE_NOT_CAPTURED =
  "this import was captured before the capture recorded ::before/::after layers, so a starfield, ring or line drawn by the stylesheet cannot be listed — re-import the site to list them (task 86bctde48)";

/** What the import shows for every decoration: the Builder has no way to
 *  draw one yet (rendering them is the follow-up to task 86bctde48). */
const DECORATION_NOT_REBUILT = "nothing — the import does not rebuild stylesheet layers yet";

/* ---------------------------------------------------------------------------
 * Small readers
 * ------------------------------------------------------------------------ */

/** Split on top-level commas (not the ones inside rgba(…) or a gradient). */
export function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(value || "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

type Layer = { kind: "linear" | "radial" | "conic" | "repeating" | "image" | "other"; css: string };

export function backgroundLayers(value: string | undefined): Layer[] {
  const v = String(value || "").trim();
  if (!v || v === "none") return [];
  return splitLayers(v).map((css) => {
    if (/^repeating-/i.test(css)) return { kind: "repeating", css };
    if (/^linear-gradient\(/i.test(css)) return { kind: "linear", css };
    if (/^radial-gradient\(/i.test(css)) return { kind: "radial", css };
    if (/^conic-gradient\(/i.test(css)) return { kind: "conic", css };
    if (/^url\(/i.test(css)) return { kind: "image", css };
    return { kind: "other", css };
  });
}

/** [r, g, b, alpha] of a computed colour, any alpha — unlike theme.ts toHex,
 *  which refuses faint colours, because a faint glow is still a glow. */
export function rgba(value: string): [number, number, number, number] | null {
  const v = String(value || "").trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{6})$/);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
  const m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
}

export function hexOf(value: string): string {
  const c = rgba(value);
  if (!c) return "";
  return `#${c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

/** A colour a person would call a colour, not black / grey / white. */
function isTinted(value: string): boolean {
  const c = rgba(value);
  if (!c) return false;
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) > 40;
}

type Shadow = { color: string; x: number; y: number; blur: number; inset: boolean };

export function parseShadows(value: string | undefined): Shadow[] {
  const v = String(value || "").trim();
  if (!v || v === "none") return [];
  const out: Shadow[] = [];
  for (const one of splitLayers(v)) {
    const color = (one.match(/(rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}/i) || [""])[0];
    const c = rgba(color);
    if (c && c[3] <= 0) continue;
    const n = (one.replace(color, "").match(/-?[\d.]+px|\b0\b/g) || []).map((s) => parseFloat(s));
    out.push({ color, x: n[0] || 0, y: n[1] || 0, blur: n[2] || 0, inset: /\binset\b/.test(one) });
  }
  return out;
}

/** A glow: a tinted shadow that spreads evenly round the box. */
function isGlow(s: Shadow): boolean {
  return isTinted(s.color) && Math.abs(s.x) <= 2 && Math.abs(s.y) <= 2 && s.blur > 0;
}

const collapse = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
const quote = (s: string, n = 40) => {
  const t = collapse(s);
  return `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"`;
};

function weightOf(value: string | undefined): number {
  const v = String(value || "").trim().toLowerCase();
  if (v === "bold") return 700;
  if (v === "normal" || v === "") return 400;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 400;
}

function tagOf(html: string): string {
  return (String(html || "").match(/^\s*<([a-z0-9]+)/i) || ["", ""])[1].toLowerCase();
}

/** Every inline value of `prop` in some HTML, lower-cased. */
function inlineValues(html: string, prop: string): string[] {
  const re = new RegExp(`${prop}\\s*:\\s*([^;"']+)`, "gi");
  return Array.from(String(html || "").matchAll(re)).map((m) => m[1].trim().toLowerCase());
}

function settingValues(settings: Record<string, unknown> | undefined, keyPattern: RegExp): string[] {
  return Object.entries(settings || {})
    .filter(([k, v]) => keyPattern.test(k) && v !== "" && v !== null && v !== undefined && v !== "none" && v !== "0")
    .map(([, v]) => String(v).toLowerCase());
}

const LIST_LIMIT = 3;
function listOf(names: string[]): string {
  const shown = names.slice(0, LIST_LIMIT).join(", ");
  return names.length > LIST_LIMIT ? `${shown} and ${names.length - LIST_LIMIT} more` : shown;
}

/* ---------------------------------------------------------------------------
 * The rows an IR section became
 * ------------------------------------------------------------------------ */

/**
 * The mapper names each row after the IR section: `imps_<sourceId>` for the
 * first and `imps_<sourceId>b<band>` for every further band (map.ts,
 * splitIntoRows). That id survives a save — it is the row's own id.
 */
export function rowsForSection(sourceId: string, rows: BuilderRow[]): BuilderRow[] {
  const base = `imps_${String(sourceId).replace(/[^a-zA-Z0-9]+/g, "")}`;
  const band = new RegExp(`^${base}b\\d+$`);
  return (rows || []).filter((r) => r && (r.id === base || band.test(String(r.id))));
}

function columnsOf(layout: string | undefined): number {
  return (LAYOUT_RATIOS[String(layout || "single")] || [1]).length;
}

/* ---------------------------------------------------------------------------
 * The checks
 * ------------------------------------------------------------------------ */

function importedBackgrounds(rows: BuilderRow[]) {
  const all: { mode: string; color: string; color2: string; imageUrl: string }[] = [];
  for (const r of rows) {
    const push = (b: BuilderRow["background"]) => {
      if (b && b.mode && b.mode !== "none") {
        all.push({ mode: b.mode, color: String(b.color || ""), color2: String(b.color2 || ""), imageUrl: String(b.imageUrl || "") });
      }
    };
    push(r.background);
    for (const b of Object.values(r.cellBackgrounds || {})) push(b);
  }
  return all;
}

function describeImportedBackground(bgs: ReturnType<typeof importedBackgrounds>): string {
  if (!bgs.length) return "no background (the page's plain surface)";
  return bgs
    .map((b) => (b.mode === "gradient" ? `a two-colour gradient ${b.color} → ${b.color2}` : b.mode === "image" ? "a background picture" : `a flat ${b.color}`))
    .join("; ");
}

function checkBackgrounds(section: SectionIR, rows: BuilderRow[], surfaces: Set<string>): FidelityFinding[] {
  const out: FidelityFinding[] = [];
  const imported = importedBackgrounds(rows);
  const paints: { where: string; st: CapturedStyles }[] = [];
  if (section.rootStyles) paints.push({ where: "the section", st: section.rootStyles });
  for (const [key, st] of Object.entries(section.containers || {})) {
    // The root is often also listed as a container; report it once.
    if (section.rootStyles && JSON.stringify(st) === JSON.stringify(section.rootStyles)) continue;
    const box = section.containerBoxes?.[key];
    paints.push({ where: box ? `a ${Math.round(box.w)}×${Math.round(box.h)} box` : "a box", st });
  }
  const seen = new Set<string>();
  for (const { where, st } of paints) {
    const layers = backgroundLayers(st["background-image"]);
    const sig = `${st["background-image"] || ""}|${st["background-color"] || ""}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const has = (mode: string) => imported.some((b) => b.mode === mode);
    if (layers.length > 1) {
      const kinds = layers.map((l) => (l.kind === "image" ? "picture" : `${l.kind} gradient`));
      out.push({
        category: "background",
        what: `${where} paints ${layers.length} layered backgrounds (${kinds.join(" + ")}); Builder keeps at most one`,
        imported: describeImportedBackground(imported),
      });
      continue;
    }
    const [layer] = layers;
    if (layer && (layer.kind === "radial" || layer.kind === "conic" || layer.kind === "repeating")) {
      out.push({ category: "background", what: `${where} paints a ${layer.kind} gradient`, imported: describeImportedBackground(imported) });
    } else if (layer && layer.kind === "linear" && !has("gradient")) {
      out.push({ category: "background", what: `${where} paints a linear gradient`, imported: describeImportedBackground(imported) });
    } else if (layer && layer.kind === "image" && !has("image")) {
      out.push({ category: "background", what: `${where} has a background picture`, imported: describeImportedBackground(imported) });
    }
    const fill = rgba(st["background-color"] || "");
    const fillHex = hexOf(st["background-color"] || "");
    if (!layer && fill && fill[3] >= 0.5 && fillHex && !surfaces.has(fillHex)) {
      const matched = imported.some((b) => [b.color, b.color2].map((c) => c.toLowerCase()).includes(fillHex));
      if (!matched) {
        out.push({ category: "background", what: `${where} is filled ${fillHex}`, imported: describeImportedBackground(imported) });
      }
    }
  }
  return out;
}

function checkShadowsAndShapes(section: SectionIR, rows: BuilderRow[]): FidelityFinding[] {
  const out: FidelityFinding[] = [];
  const importedShadows = rows.flatMap((r) => Object.values(r.cellShadow || {}).filter((v) => v && v !== "none"));
  const moduleShadows = rows.flatMap((r) => (r.modules || []).flatMap((m) => settingValues(m.settings, /shadow/i)));
  const importedRadii = rows.flatMap((r) => [
    ...Object.values(r.cellBorderRadius || {}).filter((v) => Number(v) > 0),
    ...(Number(r.rowBorderRadius) > 0 ? [r.rowBorderRadius as string] : []),
    ...(r.modules || []).flatMap((m) => settingValues(m.settings, /radius/i).filter((v) => parseFloat(v) > 0)),
  ]);

  // Group by the shadow itself: "a cyan glow on 4 boxes" reads better than 4 lines.
  const glows = new Map<string, string[]>();
  const shadows = new Map<string, string[]>();
  const shapes: { name: string; kind: "circle" | "pill" | "rounded" }[] = [];
  const visit = (name: string, st: CapturedStyles, box?: { w: number; h: number }) => {
    for (const s of parseShadows(st["box-shadow"])) {
      if (s.inset) continue;
      const key = `${hexOf(s.color) || s.color} ${s.x}px ${s.y}px ${s.blur}px`;
      const into = isGlow(s) ? glows : shadows;
      into.set(key, [...(into.get(key) || []), name]);
    }
    const r = String(st["border-radius"] || "");
    const n = parseFloat(r);
    if (n > 0) {
      // Fully rounded ends: a circle when the box is square, a pill when not.
      const full = r.endsWith("%") ? n >= 50 : Boolean(box && n * 2 >= Math.min(box.w, box.h) - 1);
      const square = Boolean(box && Math.abs(box.w - box.h) <= 0.1 * Math.max(box.w, box.h));
      shapes.push({ name, kind: full ? (square || !box ? "circle" : "pill") : "rounded" });
    }
  };
  for (const el of section.elements || []) {
    if (!el.computedStyles) continue;
    visit(el.textContent ? quote(el.textContent, 30) : `an ${el.class}`, el.computedStyles, el.box);
  }
  for (const [key, st] of Object.entries(section.containers || {})) {
    const box = section.containerBoxes?.[key];
    visit(box ? `a ${Math.round(box.w)}×${Math.round(box.h)} box` : "a box", st, box);
  }

  const importedShadowWords = importedShadows.length || moduleShadows.length
    ? `only grey shadow presets (${Array.from(new Set([...importedShadows, ...moduleShadows])).join(", ")})`
    : "no shadow";
  for (const [shadow, names] of glows) {
    out.push({ category: "shadow", what: `a coloured glow (${shadow}) round ${names.length} item(s): ${listOf(names)}`, imported: importedShadowWords });
  }
  const greyCount = Array.from(shadows.values()).reduce((n, l) => n + l.length, 0);
  if (greyCount > importedShadows.length + moduleShadows.length) {
    for (const [shadow, names] of shadows) {
      out.push({ category: "shadow", what: `a shadow (${shadow}) under ${names.length} item(s): ${listOf(names)}`, imported: importedShadowWords });
    }
  }

  if (shapes.length > importedRadii.length) {
    const importedWords = importedRadii.length ? `${importedRadii.length} rounded-corner setting(s) across the rows` : "square corners";
    const words = { circle: "circle(s)", pill: "pill shape(s)", rounded: "rounded box(es)" } as const;
    for (const kind of ["circle", "pill", "rounded"] as const) {
      const these = shapes.filter((s) => s.kind === kind);
      if (these.length) {
        out.push({ category: "shape", what: `${these.length} ${words[kind]}: ${listOf(these.map((s) => s.name))}`, imported: importedWords });
      }
    }
  }
  return out;
}

/** The most colourful colour in some CSS, else the first opaque one. */
function tintOf(css: string): string {
  const colours = (String(css || "").match(/rgba?\([^)]*\)|#[0-9a-f]{6}\b/gi) || []).filter((c) => (rgba(c)?.[3] ?? 0) > 0);
  const tinted = colours.find(isTinted);
  return hexOf(tinted || colours[0] || "");
}

function clearOrNone(value: string | undefined): boolean {
  const c = rgba(String(value || ""));
  return !value || value === "transparent" || (c !== null && c[3] <= 0);
}

/**
 * A decoration in the words a person would use: "a pattern of 9 dots",
 * "a ring in #00e5ff with a #00e5ff glow", "a gradient line in #00d9ff".
 * Built from what it paints, not from its class name.
 */
export function describeDecoration(d: DecorationIR): string {
  const st = d.styles || {};
  const parts: string[] = [];
  const layers = backgroundLayers(st["background-image"]);
  const radials = layers.filter((l) => l.kind === "radial");
  const linears = layers.filter((l) => l.kind === "linear" || l.kind === "repeating");
  const pictures = layers.filter((l) => l.kind === "image").length + (/url\(/i.test(st.content || "") ? 1 : 0);
  // Thin by its OWN size: a 1px line rotated 17° covers a 664×204 box.
  const own = d.size || d.box;
  const thin = Math.min(own.w, own.h) <= 4;
  // A tile size with repeat on: three dots tiled every 400px is a whole starfield.
  const tile = st["background-size"] && !/no-repeat/.test(st["background-repeat"] || "") ? ` tiled every ${st["background-size"].split(",")[0].trim()}` : "";
  if (radials.length >= 3) parts.push(`a pattern of ${radials.length} dots (radial gradients)${tile}`);
  else if (radials.length) {
    const tint = tintOf(radials.map((l) => l.css).join(" "));
    parts.push(`a radial glow${tint ? ` in ${tint}` : ""}`);
  }
  if (linears.length) {
    const tint = tintOf(linears.map((l) => l.css).join(" "));
    const noun = linears.length > 1 ? `${linears.length} linear gradients` : thin ? "a gradient line" : "a linear gradient";
    parts.push(`${noun}${tint ? ` in ${tint}` : ""}`);
  }
  if (pictures) parts.push(pictures > 1 ? `${pictures} pictures` : "a picture");
  if (!clearOrNone(st["background-color"])) parts.push(`a ${thin ? "line" : "fill"} of ${hexOf(st["background-color"]) || st["background-color"]}`);
  const border = ["top", "right", "bottom", "left"].find((side) => parseFloat(st[`border-${side}-width`] || "0") > 0);
  if (border) {
    const r = String(st["border-radius"] || "");
    const round = r.endsWith("%") ? parseFloat(r) >= 50 : parseFloat(r) * 2 >= Math.min(own.w, own.h) - 1;
    const colour = hexOf(st[`border-${border}-color`] || "");
    parts.push(`${round ? "a ring" : "an outline"}${colour ? ` in ${colour}` : ""}`);
  }
  const shadows = parseShadows(st["box-shadow"]).filter((sh) => !sh.inset);
  if (shadows.length) {
    const glow = shadows.find(isGlow);
    parts.push(glow ? `a ${hexOf(glow.color)} glow` : "a shadow");
  }
  return parts.length ? parts.join(" with ") : "a painted layer";
}

/**
 * Every decoration is a loss today — the Builder draws none of them — so the
 * finding is the list itself, grouped so four identical card fades read as
 * one line. `undefined` (an older capture) is not "none": compareSection
 * reports it as not measured instead.
 */
export function decorationFindings(decorations: DecorationIR[] | undefined): FidelityFinding[] {
  const groups = new Map<string, { words: string; on: string; where: string[] }>();
  for (const d of decorations || []) {
    const words = describeDecoration(d);
    const on = `${d.owner}::${d.pseudo}`;
    const key = `${words}|${on}`;
    const g = groups.get(key) || { words, on, where: [] };
    g.where.push(`${Math.round(d.box.w)}×${Math.round(d.box.h)} at (${Math.round(d.box.x)}, ${Math.round(d.box.y)})`);
    groups.set(key, g);
  }
  return Array.from(groups.values()).map((g) => ({
    category: "decorative" as const,
    what:
      `${g.words}, drawn by the stylesheet on ${g.on}` +
      (g.where.length > 1 ? ` — ${g.where.length} copies: ${listOf(g.where)}` : `, ${g.where[0]}`),
    imported: DECORATION_NOT_REBUILT,
  }));
}

function checkColumns(
  section: SectionIR,
  rows: BuilderRow[],
  sides: { original: SideBusyness; imported: SideBusyness },
  sectionWidth: number
): { findings: FidelityFinding[]; notMeasured: string } {
  const findings: FidelityFinding[] = [];
  const boxes = (section.elements || []).map((e) => e.box).filter(Boolean) as { x: number; y: number; w: number; h: number }[];
  if (!boxes.length) return { findings, notMeasured: "the capture recorded no positions for this section" };
  const importedCols = Math.max(1, ...rows.map((r) => columnsOf(r.layout)));
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const half = sectionWidth / 2;
  const contentSide = maxX <= half * 1.1 ? "left" : minX >= half * 0.9 ? "right" : "";
  if (!contentSide) return { findings, notMeasured: "" };
  const other = contentSide === "left" ? "right" : "left";
  if (!sides.original) {
    return { findings, notMeasured: `the content sits in the ${contentSide} half only, and the original screenshot could not be read to say what filled the ${other} half` };
  }
  if (sides.original[other] < BUSY_EDGE_THRESHOLD) return { findings, notMeasured: "" };
  const importedOther = sides.imported ? sides.imported[other] : null;
  if (importedOther !== null && importedOther >= BUSY_EDGE_THRESHOLD) return { findings, notMeasured: "" };
  findings.push({
    category: "columns",
    what:
      `a two-column layout: the captured content sits in the ${contentSide} half (x ${Math.round(minX)}–${Math.round(maxX)} of ${sectionWidth}), ` +
      `and the ${other} half shows something the capture has no element for — a picture painted by the stylesheet, usually`,
    imported:
      importedOther === null
        ? `${importedCols} column(s); the imported ${other} half was not photographed`
        : `the ${other} half is empty — the layout came out as one column (stacked)`,
  });
  return { findings, notMeasured: "" };
}

function checkText(section: SectionIR, rows: BuilderRow[], theme: ThemeText | null): FidelityFinding[] {
  const out: FidelityFinding[] = [];
  const modules = rows.flatMap((r) => r.modules || []);
  const moduleFor = (sid: string) =>
    modules.find((m) => String(m.settings?.importSourceIds || "").split(",").map((s) => s.trim()).includes(sid));
  const groups = new Map<string, { what: string; imported: string; names: string[] }>();
  const add = (what: string, imported: string, name: string) => {
    const key = `${what}|${imported}`;
    const g = groups.get(key) || { what, imported, names: [] };
    g.names.push(name);
    groups.set(key, g);
  };

  for (const el of section.elements || []) {
    if (!["heading", "text", "link", "button"].includes(el.class) || !collapse(el.textContent)) continue;
    const st = el.computedStyles || {};
    const mod = moduleFor(el.sourceId);
    if (!mod) continue; // a nav link the menu took, or a deduped repeat — the map report owns those
    const html = String(mod.text || "");
    const name = quote(el.textContent);
    const tag = tagOf(el.html);
    const isHeading = /^h[1-6]$/.test(tag);

    // Weight: inline in the imported HTML, else the theme's for that heading level.
    const wanted = weightOf(st["font-weight"]);
    const inline = inlineValues(html, "font-weight").map(weightOf);
    const themeWeight = isHeading ? theme?.headingWeights?.[tag] : undefined;
    const got = inline.length ? inline[0] : themeWeight ?? (isHeading ? 700 : 400);
    if (!inline.includes(wanted) && got !== wanted) {
      add(`font weight ${wanted}`, `weight ${got}${inline.length ? " (inline)" : themeWeight !== undefined ? ` (the theme's ${tag})` : " (the browser default)"}`, name);
    }

    const spacing = st["letter-spacing"];
    if (spacing && !inlineValues(html, "letter-spacing").length && !settingValues(mod.settings, /letterspacing/i).length) {
      add(`letter-spacing ${spacing}`, "normal spacing", name);
    }

    if (st["font-style"] === "italic" && !/<(em|i)\b/i.test(html) && !inlineValues(html, "font-style").includes("italic")) {
      add("italic", "upright", name);
    }
    if (st["text-transform"] && st["text-transform"] !== "none" && !inlineValues(html, "text-transform").length && !settingValues(mod.settings, /transform/i).length) {
      add(`text-transform ${st["text-transform"]}`, "as typed", name);
    }

    const colour = hexOf(st.color || "");
    if (colour) {
      const inlineColours = inlineValues(html, "(?<![-a-z])color").map(hexOf).filter(Boolean);
      const settingColours = settingValues(mod.settings, /color/i).map((v) => (v.startsWith("#") ? v : hexOf(v)));
      const themeColour = !theme ? "" : el.class === "link" ? theme.linkColor : isHeading ? theme.headingColor : theme.textColor;
      const effective = inlineColours[0] || settingColours[0] || themeColour || "";
      if (![...inlineColours, ...settingColours].includes(colour) && effective.toLowerCase() !== colour) {
        add(`text colour ${colour}`, effective ? `${effective}${inlineColours.length || settingColours.length ? "" : " (the theme's)"}` : "the theme's default", name);
      }
    }
  }
  for (const g of groups.values()) {
    out.push({ category: "text", what: `${g.what} on ${listOf(g.names)}`, imported: g.imported });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Public entry points
 * ------------------------------------------------------------------------ */

export type CompareOptions = {
  /** Every Builder row on the imported page; the section's are picked out. */
  rows: BuilderRow[];
  theme: ThemeText | null;
  /** Hex fills that ARE the page surface — the mapper deliberately leaves
   *  those unset so they follow the theme, so they are not losses. */
  surfaceColors?: string[];
  /** Edge busyness of each half of the original section screenshot and of the
   *  imported section's photograph; null when that picture was not read. */
  sides?: { original: SideBusyness; imported: SideBusyness };
  /** Width of the captured section in page pixels (1440 for desktop). */
  sectionWidth?: number;
};

export function compareSection(section: SectionIR, opts: CompareOptions): SectionComparison {
  const rows = rowsForSection(section.sourceId, opts.rows);
  const base: SectionComparison = {
    sourceId: section.sourceId,
    status: "compared",
    reason: "",
    builderRowIds: rows.map((r) => r.id),
    findings: [],
    notMeasured: section.decorations ? [] : [{ category: "decorative", why: DECORATIVE_NOT_CAPTURED }],
  };
  if (!rows.length) {
    // Not "no differences": nothing was there to compare against. A nav-only
    // header becomes the Top Menu; anything else here was deleted or dropped.
    const allNav = (section.elements || []).every((e) => e.class === "link" || e.class === "button");
    return {
      ...base,
      status: "cannot-tell",
      reason: allNav
        ? "no imported row carries this section's id — it is all links, so it most likely became the Top Menu"
        : "no imported row carries this section's id — it was deleted from the page by hand, or the import built nothing for it",
    };
  }
  const surfaces = new Set((opts.surfaceColors || []).map((c) => c.toLowerCase()));
  const sides = opts.sides || { original: null, imported: null };
  const columns = checkColumns(section, rows, sides, opts.sectionWidth || 1440);
  if (columns.notMeasured) base.notMeasured.push({ category: "columns", why: columns.notMeasured });
  base.findings = [
    ...checkBackgrounds(section, rows, surfaces),
    ...decorationFindings(section.decorations),
    ...checkShadowsAndShapes(section, rows),
    ...columns.findings,
    ...checkText(section, rows, opts.theme),
  ];
  return base;
}

/** Fonts and site icons are downloaded too, but no page ever "places" them —
 *  the theme carries the font and the browser tab the icon. */
function isSiteChrome(asset: AssetRef): boolean {
  const name = String(asset.originalUrl || "").replace(/[#?].*$/, "").split("/").pop() || "";
  if (/^font\//i.test(asset.mimeType || "") || /\.(woff2?|ttf|otf|eot)$/i.test(name)) return true;
  return /favicon|apple-touch-icon|site-icon/i.test(name);
}

/**
 * Downloaded files nothing on the imported page shows. Matched on the asset's
 * id (the applied copy is named after it), its stored URL and its original
 * URL — a file reachable by any of those is placed.
 *
 * `pageUrl` limits it to files the capture saw on THIS page; an asset with a
 * blank sourceId was seen on the page but on no element (a CSS-painted
 * picture — Alphire's hero_banner.png).
 */
export function unplacedAssets(assets: AssetRef[], pageUrl: string, pageJson: string): { asset: AssetRef; finding: FidelityFinding }[] {
  const strip = (u: string) => String(u || "").replace(/[#?].*$/, "").replace(/\/+$/, "");
  const here = strip(pageUrl);
  const out: { asset: AssetRef; finding: FidelityFinding }[] = [];
  for (const asset of assets || []) {
    if (asset.status !== "downloaded" || isSiteChrome(asset)) continue;
    const refs = (asset.referencedBy || []).filter((r) => strip(r.pageUrl) === here);
    if (!refs.length) continue;
    const placed = [asset.id, asset.storageUrl, asset.originalUrl].some((needle) => needle && pageJson.includes(needle));
    if (placed) continue;
    const file = strip(asset.originalUrl).split("/").pop() || asset.id;
    const onElement = refs.some((r) => r.sourceId);
    out.push({
      asset,
      finding: {
        category: "asset",
        what: `${file} was downloaded${onElement ? "" : " (seen on the page but on no element — a picture the stylesheet paints, usually)"}`,
        imported: "not on the imported page",
      },
    });
  }
  return out;
}

/**
 * Mean edge strength of one rectangle of a raw RGB(A) buffer — how "busy" it
 * is. Horizontal and vertical neighbour differences of the grey value. A flat
 * fill or a smooth gradient scores well under 1; text, pictures and patterns
 * score several. The caller downsizes first so noise and dithering do not
 * count.
 */
export function edgeDensity(
  img: { data: Uint8Array | Buffer; width: number; height: number; channels: number },
  rect: { x: number; y: number; w: number; h: number }
): number {
  const { data, width, height, channels } = img;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width - 1, Math.floor(rect.x + rect.w) - 1);
  const y1 = Math.min(height - 1, Math.floor(rect.y + rect.h) - 1);
  const grey = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const g = grey(x, y);
      total += Math.abs(g - grey(x + 1, y)) + Math.abs(g - grey(x, y + 1));
      count++;
    }
  }
  return count ? total / count : 0;
}

/** Left and right halves of a picture, scored by `edgeDensity`. */
export function sideBusyness(img: { data: Uint8Array | Buffer; width: number; height: number; channels: number }): { left: number; right: number } {
  const half = Math.floor(img.width / 2);
  return {
    left: edgeDensity(img, { x: 0, y: 0, w: half, h: img.height }),
    right: edgeDensity(img, { x: half, y: 0, w: img.width - half, h: img.height }),
  };
}

/** The theme's text defaults, from a builder_themes record (rowToTheme). */
export function themeTextOf(theme: { typography?: unknown } | null | undefined): ThemeText | null {
  const t = (theme && (theme.typography as Record<string, any>)) || null;
  if (!t) return null;
  const scale = (t.scale || {}) as Record<string, unknown>;
  const headingWeights: Record<string, number> = {};
  for (let i = 1; i <= 6; i++) {
    const w = Number(scale[`h${i}Fw`]);
    if (Number.isFinite(w) && w > 0) headingWeights[`h${i}`] = w;
  }
  const colors = (t.colors || {}) as Record<string, string>;
  return {
    headingWeights,
    headingColor: String(colors.heading || "").toLowerCase(),
    textColor: String(colors.text || "").toLowerCase(),
    linkColor: String(colors.link || t.elements?.a?.color || "").toLowerCase(),
  };
}

/** Findings counted per category, every category present (zeros included). */
export function countByCategory(findings: FidelityFinding[]): Record<FidelityCategory, number> {
  const out = Object.fromEntries(FIDELITY_CATEGORIES.map((c) => [c.key, 0])) as Record<FidelityCategory, number>;
  for (const f of findings) out[f.category] += 1;
  return out;
}


/**
 * A page's verdict. Anything short of "found, and at least one section
 * photographed" is CANNOT TELL with the reason — never a clean page, because
 * a page nobody looked at has no differences only in the sense that nobody
 * looked (acceptance criterion 3, task 86bctde11).
 */
export function pageVerdict(p: {
  builderPageId: string | undefined;
  builderPageFound: boolean;
  cameraError: string;
  sectionsWithRows: number;
  photographed: number;
}): { status: "compared" | "cannot-tell"; reason: string } {
  if (!p.builderPageId) return { status: "cannot-tell", reason: "the import wrote no Builder page for it" };
  if (!p.builderPageFound) {
    return { status: "cannot-tell", reason: `Builder page ${p.builderPageId} could not be read (deleted since the import?)` };
  }
  if (p.cameraError) return { status: "cannot-tell", reason: `not photographed: ${p.cameraError}` };
  if (!p.sectionsWithRows) return { status: "cannot-tell", reason: "no section of the original has an imported row to compare with" };
  if (!p.photographed) return { status: "cannot-tell", reason: "the browser could not photograph any of its sections" };
  return { status: "compared", reason: "" };
}
