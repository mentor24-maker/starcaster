/**
 * Site Import — mapping engine: SiteIR → Builder draft page documents.
 * Spec: docs/site-import/02-mapping.md (ratified 2026-08-06).
 *
 * Pure, no I/O. The runner (scripts/site_import_map.mjs) supplies context
 * (project id, existing slugs, prior run state) and performs every write.
 * COMPLETENESS OVER FIDELITY carries over from Phase 1: every ElementIR
 * must end in exactly one disposition — mapped, placeholder, navConsumed,
 * or skipped-with-reason — and the report must reconcile
 * (total === mapped + placeholder + navConsumed + humanModified + skipped)
 * before the runner will ever --apply. humanModified is the runner's
 * bucket (it owns the section-hash clobber guard); the engine emits 0.
 *
 * Dispositions (ratified decisions 1–3):
 *   heading/text/link  → merged rich-text `text` modules, split ≤ 9,500
 *                        chars (oversize ladder: element boundaries →
 *                        top-level children → whitespace → placeholder)
 *   link matching a nav item → navConsumed (mapped only by --nav)
 *   image              → `image` module
 *   button             → `button` module
 *   video (direct src) → `video` module; otherwise placeholder
 *   form/table/embed/other → placeholder: `code` module carrying the
 *                        element's screenshot crop; source HTML in
 *                        settings.importSourceHtml (overflow → runner
 *                        uploads to Blob and sets importSourceHtmlUrl)
 */

import * as cheerio from "cheerio";
import { looksLikeHtmlUrl, sameSite } from "./crawl";
import type { AssetRef, ElementIR, NavItem, PageIR, SectionIR, SiteIR } from "./ir";
import { chooseLayout, columnKeys, planSectionGrid, type Cell } from "./columns";
import { importSurfaceColor } from "./theme";
import {
  hasPaint,
  keepCellFill,
  planBands,
  planCards,
  readSurface,
  type MappedBackground,
  type SurfaceLook,
} from "./surfaces";
export { mergeMappedSections } from "./columns";
export { deriveImportTheme, nextThemeName, siteNameFromUrl } from "./theme";

/** Keep merged text modules comfortably under the hard 10k normalizer cap. */
export const TEXT_MODULE_CHAR_BUDGET = 9500;
/** settings values (other than content keys) cap at 10k — stay under it. */
export const SOURCE_HTML_INLINE_BUDGET = 9000;

/* ---------------------------------------------------------------------------
 * Output shapes
 * ------------------------------------------------------------------------ */

export type MappedModule = {
  id: string;
  type: string;
  /** "main" in a single-column section; left/center/right/col4–col6 in a
   *  multi-column one (columns.ts). */
  column: string;
  name: string;
  text: string;
  settings: Record<string, string>;
};

/** Minimal section shape — createPage's document serializer fills every
 *  other BuilderTemplateSection field with defaults. */
export type MappedSection = {
  id: string;
  title: string;
  /** A Builder layout name — "single" unless column inference found a
   *  side-by-side row (columns.ts). */
  layout: string;
  widthMode: "contained";
  background: MappedBackground;
  modules: MappedModule[];
  /**
   * The source page's surfaces (surfaces.ts, task 86bce9wx3) — present only
   * when it measured some, so a capture without them maps exactly as before.
   * Row: the band's padding, frame and (with joinWithPrevious) one band
   * across every row an IR section was split into. Cell maps are keyed by
   * column: a card's fill, frame, corners, shadow and padding.
   */
  joinWithPrevious?: boolean;
  paddingTop?: string;
  paddingBottom?: string;
  rowBorderWidth?: string;
  rowBorderColor?: string;
  rowBorderStyle?: string;
  rowBorderRadius?: string;
  cellBackgrounds?: Record<string, MappedBackground>;
  cellBorderWidth?: Record<string, string>;
  cellBorderColor?: Record<string, string>;
  cellBorderStyle?: Record<string, string>;
  cellBorderRadius?: Record<string, string>;
  cellShadow?: Record<string, string>;
  cellPaddingTop?: Record<string, string>;
  cellPaddingRight?: Record<string, string>;
  cellPaddingBottom?: Record<string, string>;
  cellPaddingLeft?: Record<string, string>;
  /** Engine bookkeeping for the runner (stripped before write): */
  sourceElementIds: string[];
  /** How this section's elements were disposed — the runner moves these
   *  to humanModified when the hash guard protects the section. */
  dispositions: { mapped: number; placeholder: number; deduped: number };
};

export type MappedPage = {
  irPath: string;
  name: string;
  slug: string;
  sections: MappedSection[];
};

export type CropCopy = { sourceId: string; fromUrl: string; moduleId: string };
export type AssetPromotion = {
  assetId: string;
  fromUrl: string;
  originalUrl: string;
  altText: string;
  mimeType: string;
};
export type SourceOverflow = { sourceId: string; moduleId: string; html: string };

export type MapReport = {
  elements: {
    total: number;
    mapped: number;
    placeholder: number;
    navConsumed: number;
    /** Slideshow clone-slides and interior-page chrome runs represented by
     *  the homepage slideshow (ratified amendment, task 86bb9xt0y). */
    deduped: number;
    humanModified: number;
    skipped: number;
  };
  skipped: { sourceId: string; class: string; reason: string }[];
  pages: {
    path: string;
    slug: string;
    modules: number;
    placeholders: number;
    builderPageId: string | null;
  }[];
  assets: { promoted: number; cropsCopied: number; leftInNamespace: number };
  /**
   * What the placeholders actually CONTAIN, grouped by structural
   * signature and ranked. Placeholders are the importer admitting it has
   * no rule for something; grouping them turns "look at the site and
   * notice" into a repeatable signal. A large group with a simple shape
   * (e.g. "table: 1 image, no text") is a mapping rule waiting to be
   * written — that is exactly how image-only tables were found.
   */
  placeholderPatterns: { signature: string; count: number; sampleSourceId: string }[];
};

/** One consolidation the mapper performed — surfaced in the dry run so a
 *  wrong intent-guess is visible BEFORE anything is written. */
export type SlideshowPlan = {
  pagePath: string;
  slideCount: number;
  absorbedIds: string[];
};

/**
 * The card shape the Feature Cards module stores under its `cards` setting.
 *
 * Field names mirror BuilderCardItem in lib/builder-client/builder-card-items.ts
 * EXACTLY. They are re-declared rather than imported because that module is
 * client-side only — it pulls in builder-asset-url, which is stubbed in the
 * server bundle. Keep the two in step; a rename there is a silent data loss
 * here (the parser drops unknown keys).
 */
export type BuilderCardSeed = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  linkUrl: string;
  linkLabel: string;
  icon: string;
};

/** One card grid the mapper recognised — surfaced in the dry run for the
 *  same reason as SlideshowPlan: a wrong intent-guess must be visible
 *  BEFORE anything is written. */
export type CardGridPlan = {
  pagePath: string;
  cardCount: number;
  /** The repeating element-class signature that identified it, e.g.
   *  "text+image+heading+text+link" — the evidence for the guess. */
  signature: string;
  titles: string[];
  absorbedIds: string[];
};

export type MapOutput = {
  pages: MappedPage[];
  /** Slideshows this run will create (empty when vetoed). */
  slideshows: SlideshowPlan[];
  /** Card grids this run will create (empty when none qualify). */
  cardGrids: CardGridPlan[];
  /** Header nav for --nav, in navigation-module navItems shape. */
  navItems: { id: string; label: string; href: string; parentId: string; target: string }[];
  copyPlan: {
    crops: CropCopy[];
    assets: AssetPromotion[];
    sourceOverflows: SourceOverflow[];
  };
  report: MapReport;
};

export type MapOptions = {
  /** Slugs already taken by pages the import does NOT own. */
  existingSlugs: string[];
  /**
   * Slideshow detection is an inference about INTENT — a run of images
   * might be a slideshow, or a deliberate gallery. These vetoes let the
   * operator keep the images as images (ratified 2026-08-06: automatic
   * with vetoes, not opt-in).
   */
  skipAllSlideshows?: boolean;
  /** IR page paths ("/", "/gallery/") to leave as plain images. */
  skipSlideshowPaths?: string[];
  /**
   * Card-grid detection is the same kind of intent guess: a repeated block
   * might be a feature-card row, or six things that merely look alike. Same
   * veto shape as slideshows, for the same reason.
   */
  skipAllCardGrids?: boolean;
  /** IR page paths to leave as separate modules. */
  skipCardGridPaths?: string[];
};

/* ---------------------------------------------------------------------------
 * Slug normalization (decision 4 — verified platform facts)
 * ------------------------------------------------------------------------ */

/** Slugs the platform treats as auto-private or reserved — an import must
 *  never emit them (lib/builder-client/public-site-page-slugs.js).
 *  "home" is deliberately NOT here: it is the platform's own home-page
 *  slug, explicitly public, and the only slug besides "" that gets served
 *  at the site root. Prefixing it stranded the imported home page at
 *  /imported-home, a URL nothing links to (the Delray import, 2026-08-09). */
const RESERVED_SLUG_RE = /^(admin|admin-.*|blog-post-edit|blog-create-post|blog-post-manager|blog-category-manager|event-manager|crm)$/;

/** Builder slugs are single-segment (middleware rewrites /{slug}) and
 *  lowercase. Flatten path separators, ascii-fold, strip the rest. */
export function normalizeImportSlug(irPath: string): string {
  const path = String(irPath || "").trim();
  if (path === "" || path === "/") return "home";
  const flattened = path
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics after NFKD
    .replace(/[/\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!flattened) return "imported-page";
  // Reserved/auto-private slugs get the imported- prefix so pages cannot
  // silently vanish from the public list or shadow platform screens.
  if (RESERVED_SLUG_RE.test(flattened)) return `imported-${flattened}`;
  return flattened;
}

function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let candidate = `${base}-imported`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}-imported-${n++}`;
  taken.add(candidate);
  return candidate;
}

/* ---------------------------------------------------------------------------
 * Oversize prose splitting (decision 2's ladder)
 * ------------------------------------------------------------------------ */

type DomNode = {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
};

/**
 * Split one HTML fragment into pieces each ≤ budget:
 * 1. at its top-level child boundaries, recursively;
 * 2. an atomic text run hard-splits at the nearest whitespace (a seam may
 *    break inline formatting — recorded in the spec as acceptable);
 * 3. returns null only when there is no split point at all (caller
 *    demotes to placeholder).
 */
export function splitOversizeHtml(html: string, budget: number): string[] | null {
  const value = String(html || "");
  if (value.length <= budget) return [value];

  const $ = cheerio.load(value, null, false); // fragment mode
  const rootChildren = ($.root()[0] as unknown as DomNode).children || [];
  const pieces: string[] = [];
  if (rootChildren.length > 1) {
    for (const child of rootChildren) {
      const childHtml = $.html(child as never) || "";
      if (!childHtml) continue;
      const sub = splitOversizeHtml(childHtml, budget);
      if (sub === null) return null;
      pieces.push(...sub);
    }
    return pieces;
  }

  const only = rootChildren[0];
  if (!only) return null;
  if (only.type === "text") {
    return hardSplitText(only.data || "", budget);
  }
  const inner = only.children || [];
  if (inner.length === 0) return null; // one huge unsplittable atom
  // Recurse into the single element's children; its own tag is dropped at
  // the seam (a <div> wrapper contributes no content).
  const innerHtml = inner.map((c) => $.html(c as never) || "").join("");
  return splitOversizeHtml(innerHtml, budget);
}

function hardSplitText(text: string, budget: number): string[] | null {
  if (!/\s/.test(text.trim())) return null;
  const out: string[] = [];
  let rest = text;
  while (rest.length > budget) {
    let cut = rest.lastIndexOf(" ", budget);
    if (cut <= 0) cut = rest.indexOf(" ", budget);
    if (cut <= 0) return null;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1);
  }
  if (rest) out.push(rest);
  return out;
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

/**
 * HTML attribute values are entity-encoded in the source markup, so a raw
 * read hands downstream code the literal text "Ladies Teams &amp; Leagues".
 * Element TEXT arrives already decoded (textContent), which is why this only
 * ever bit attributes — alt text and query-string hrefs (`?a=1&amp;b=2`).
 *
 * Found 2026-08-08 while importing blazefish.com's card grid: two of the six
 * cards carried "&amp;" in their alt text. The same read feeds slideshow alt
 * text, so the fix belongs here rather than in the card path alone.
 */
function decodeEntities(value: string): string {
  return String(value || "")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, code: string) => {
      if (code[0] === "#") {
        const cp =
          code[1] === "x" || code[1] === "X"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : whole;
      }
      const named: Record<string, string> = {
        amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
      };
      return Object.prototype.hasOwnProperty.call(named, code) ? named[code] : whole;
    });
}

/** Column count for an imported card grid: the largest of 4/3/2 that divides
 *  the card count evenly, else 3 (the Feature Cards module's own default). */
export function pickCardColumns(cardCount: number): number {
  for (const cols of [4, 3, 2]) {
    if (cardCount >= cols && cardCount % cols === 0) return cols;
  }
  return 3;
}

function attrFromHtml(html: string, attr: string): string {
  const m = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i").exec(String(html || ""));
  return m ? decodeEntities(m[1]) : "";
}

function normalizeHref(href: string): string {
  return String(href || "").trim().replace(/\/+$/, "").toLowerCase();
}

function collapse(s: string): string {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Compact structural description of an element, for grouping the things
 *  the importer had no rule for. */
function structuralSignature(el: ElementIR): string {
  try {
    const $ = cheerio.load(el.html);
    const imgs = $("img").length;
    const links = $("a").length;
    const cells = $("td,th").length;
    const rows = $("tr").length;
    const text = $.root().text().replace(/\s+/g, " ").trim();
    const textBucket = text.length === 0 ? "no text" : text.length < 40 ? "short text" : "long text";
    const parts = [`${el.class}:`];
    if (imgs) parts.push(`${imgs} img`);
    if (links) parts.push(`${links} link`);
    if (rows) parts.push(`${rows} row`);
    if (cells) parts.push(`${cells} cell`);
    parts.push(textBucket);
    return parts.join(" ");
  } catch {
    return `${el.class}: unparseable`;
  }
}

/**
 * Images inside a table that carries no real text — a layout table, not
 * data. Sites built in page builders wrap single photos in tables
 * constantly (13 of delraytennis.com's 16 "tables" are exactly this), and
 * turning them into screenshot placeholders buries the actual picture and
 * asks a human to rebuild something that was never a table.
 *
 * Returns the images to emit, or null when the element is a real table.
 */
function imagesFromLayoutTable(el: ElementIR): { src: string; alt: string; href: string }[] | null {
  if (el.class !== "table") return null;
  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(el.html);
  } catch {
    return null;
  }
  const text = $.root().text().replace(/\s+/g, " ").trim();
  if (text.length > 0) return null; // any real copy means it may be data
  const out: { src: string; alt: string; href: string }[] = [];
  const seen = new Set<string>();
  $("img").each((_i, node) => {
    const $img = $(node);
    const src = String($img.attr("src") || "").trim();
    if (!src || seen.has(src)) return;
    seen.add(src);
    // A link wrapping the image usually points at the full-size file
    // (lightbox); that is not a destination worth keeping.
    const href = String($img.closest("a").attr("href") || "").trim();
    out.push({
      src,
      alt: String($img.attr("alt") || "").trim(),
      href: href && href !== src ? href : "",
    });
  });
  return out.length ? out : null;
}

const PLACEHOLDER_CLASSES = new Set(["form", "table", "embed", "other"]);
const PROSE_CLASSES = new Set(["heading", "text", "link"]);
const DIRECT_MEDIA_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

/* ---------------------------------------------------------------------------
 * The engine
 * ------------------------------------------------------------------------ */

/** Modules that lay out their own columns: a row holding one stays a
 *  single full-width column, or the module would be squeezed into a cell. */
const SELF_COLUMNED_TYPES = new Set(["feature-cards", "carousel"]);

type Dispositions = { mapped: number; placeholder: number; deduped: number };

/**
 * A band onto each Builder row of the run it became (planBands decides each
 * element's band; a run is consecutive rows in one band). Every row carries
 * the background, and rows after the first JOIN the first, so a band split
 * into several rows still reads as one band (Builder paints a
 * joined run with its first row's background). Padding goes on the band's
 * outer edges only — top of the first row, bottom of the last — or a split
 * band would gain the gap between every row. A frame (and the corners, which
 * Builder draws only with a frame) is applied to a band that stayed one row:
 * on a split band it would outline each row separately.
 */
function applyBand(
  row: MappedSection,
  look: SurfaceLook | null,
  at: { first: boolean; last: boolean; rows: number }
): void {
  if (!look) return;
  if (look.background) {
    row.background = { ...look.background };
    if (!at.first) row.joinWithPrevious = true;
  }
  if (at.first && look.padding.top) row.paddingTop = look.padding.top;
  if (at.last && look.padding.bottom) row.paddingBottom = look.padding.bottom;
  if (at.rows === 1 && look.border) {
    row.rowBorderWidth = look.border.width;
    row.rowBorderColor = look.border.color;
    row.rowBorderStyle = look.border.style;
    if (look.radius) row.rowBorderRadius = look.radius;
  }
}

function setCell<K extends keyof MappedSection>(
  row: MappedSection,
  key: K,
  column: string,
  value: string
): void {
  const map = ((row[key] as Record<string, string> | undefined) || {}) as Record<string, string>;
  map[column] = value;
  (row as Record<string, unknown>)[key] = map;
}

/** One card's look onto one Builder column. */
function applyCard(row: MappedSection, column: string, look: SurfaceLook): void {
  if (look.background) {
    const background = { ...look.background };
    if (background.mode === "color") background.color = keepCellFill(background.color);
    row.cellBackgrounds = { ...(row.cellBackgrounds || {}), [column]: background };
  }
  if (look.border) {
    setCell(row, "cellBorderWidth", column, look.border.width);
    setCell(row, "cellBorderColor", column, look.border.color);
    setCell(row, "cellBorderStyle", column, look.border.style);
  }
  if (look.radius) setCell(row, "cellBorderRadius", column, look.radius);
  if (look.shadow) setCell(row, "cellShadow", column, look.shadow);
  if (look.padding.top) setCell(row, "cellPaddingTop", column, look.padding.top);
  if (look.padding.right) setCell(row, "cellPaddingRight", column, look.padding.right);
  if (look.padding.bottom) setCell(row, "cellPaddingBottom", column, look.padding.bottom);
  if (look.padding.left) setCell(row, "cellPaddingLeft", column, look.padding.left);
}

/**
 * Split one IR section's modules into Builder sections, one per row that
 * column inference found (columns.ts). With no side-by-side rows this
 * returns exactly what the mapper always emitted: one single-column section
 * under the section's own id — so pre-2026-10-06 captures, which carry no
 * positions, import unchanged. The first row keeps that id (a re-import
 * replaces it in place); later rows are `<id>b<band>`.
 */
function splitIntoRows(args: {
  section: SectionIR;
  baseId: string;
  fallbackHeading: string;
  modules: MappedModule[];
  moduleCells: Cell[];
  grid: ReturnType<typeof planSectionGrid>;
  cellOf: (sourceId: string) => Cell;
  sourceElementIds: string[];
  dispositionsFor: (band: number) => Dispositions;
  /** Element sourceId → the painted band it sits in ("" for none). */
  bandOf: (sourceId: string) => string;
  /** A band's look, by its container key. */
  bandLookOf: (key: string) => SurfaceLook | null;
  /** The section root's spacing, for a section with no band anywhere. */
  rootLook: SurfaceLook | null;
  /** Element sourceId → the look of the card it sits in; `onBand` when the
   *  row is painted, so a card the page's colour still shows against it. */
  cardLookOf: (sourceId: string, onBand: boolean) => { key: string; look: SurfaceLook } | null;
}): MappedSection[] {
  const { section, baseId, modules, moduleCells, grid, cellOf } = args;
  const bands = Array.from(new Set(moduleCells.map((c) => c.band))).sort((a, b) => a - b);
  const out: MappedSection[] = [];

  // Each Builder row's band: the one band every element in it sits in. Rows
  // never merge across a band (columns.ts, GridItem.group), so a mixed row
  // only happens where an element has no band of its own — it gets none.
  const rowBand = bands.map((band) => {
    const keys = new Set(
      args.sourceElementIds.filter((id) => cellOf(id).band === band).map((id) => args.bandOf(id))
    );
    return keys.size === 1 ? Array.from(keys)[0] : "";
  });
  const anyBand = rowBand.some(Boolean);

  bands.forEach((band, i) => {
    const idx = modules.map((_, k) => k).filter((k) => moduleCells[k].band === band);
    const rowModules = idx.map((k) => modules[k]);
    const cols = Array.from(new Set(idx.map((k) => moduleCells[k].col))).sort((a, b) => a - b);

    let layout = "single";
    if (cols.length > 1 && !rowModules.some((m) => SELF_COLUMNED_TYPES.has(m.type))) {
      const plan = grid.bands[band];
      const widths = cols.map((c) => {
        const col = plan?.columns[c];
        return col ? col.x1 - col.x0 : 1;
      });
      layout = chooseLayout(widths);
      const keys = columnKeys(cols.length);
      for (const k of idx) modules[k].column = keys[cols.indexOf(moduleCells[k].col)];
    }

    const heading = (section.elements || []).find(
      (el) => el.class === "heading" && cellOf(el.sourceId).band === band
    );
    const title = (heading ? collapse(heading.textContent) : args.fallbackHeading).slice(0, 60);
    // Every import-owned section carries the section source marker (spec:
    // idempotency + provenance) — each row of a split section too.
    rowModules[0].settings.importSectionSourceId = section.sourceId;
    const row: MappedSection = {
      id: i === 0 ? baseId : `${baseId}b${band}`,
      title: `Imported: ${title || "section"}`,
      layout,
      widthMode: "contained",
      background: { mode: "none", color: "", color2: "", imageUrl: "", styleKey: "" },
      modules: rowModules,
      sourceElementIds: args.sourceElementIds.filter((id) => cellOf(id).band === band),
      dispositions: { ...args.dispositionsFor(band) },
    };
    // Consecutive rows in one band are one run: joined, padded at its ends.
    const key = rowBand[i];
    if (anyBand) {
      if (key) {
        let start = i;
        while (start > 0 && rowBand[start - 1] === key) start--;
        let end = i;
        while (end < bands.length - 1 && rowBand[end + 1] === key) end++;
        applyBand(row, args.bandLookOf(key), { first: i === start, last: i === end, rows: end - start + 1 });
      }
    } else {
      applyBand(row, args.rootLook, { first: i === 0, last: i === bands.length - 1, rows: bands.length });
    }
    const onBand = Boolean(row.background.mode !== "none");
    // A column wears a card only when everything in it sat in that one card.
    const byColumn = new Map<string, Set<string>>();
    const lookByKey = new Map<string, SurfaceLook>();
    const cellKeys = layout === "single" ? ["main"] : columnKeys(cols.length);
    for (const id of row.sourceElementIds) {
      const at = layout === "single" ? 0 : cols.indexOf(cellOf(id).col);
      if (at < 0) continue; // a cell that built no module (nav links)
      const card = args.cardLookOf(id, onBand);
      const set = byColumn.get(cellKeys[at]) || new Set<string>();
      set.add(card ? card.key : "");
      byColumn.set(cellKeys[at], set);
      if (card) lookByKey.set(card.key, card.look);
    }
    for (const [column, keys] of byColumn) {
      const [only] = Array.from(keys);
      if (keys.size === 1 && only) applyCard(row, column, lookByKey.get(only) as SurfaceLook);
    }
    out.push(row);
  });

  // Rows that produced no module (nav links, deduped repeats) still have to
  // be accounted for — fold their elements and tallies into the first row.
  const first = out[0];
  const kept = new Set(bands);
  const orphanBands = new Set<number>();
  for (const id of args.sourceElementIds) {
    const band = cellOf(id).band;
    if (!kept.has(band)) {
      first.sourceElementIds.push(id);
      orphanBands.add(band);
    }
  }
  for (const band of orphanBands) {
    const d = args.dispositionsFor(band);
    first.dispositions.mapped += d.mapped;
    first.dispositions.placeholder += d.placeholder;
    first.dispositions.deduped += d.deduped;
  }
  return out;
}

export function mapSite(ir: SiteIR, opts: MapOptions): MapOutput {
  const takenSlugs = new Set((opts.existingSlugs || []).map((s) => String(s).toLowerCase()));
  const assetsById = new Map<string, AssetRef>((ir.assets || []).map((a) => [a.id, a]));

  // Nav lookup: label+href pairs from every extracted nav tree; matching
  // standalone link elements are navConsumed (decision 6: default runs
  // leave nav alone; --nav maps the tree itself).
  const navPairs = new Set<string>();
  const collectNav = (items: NavItem[]) => {
    for (const item of items || []) {
      navPairs.add(`${collapse(item.label).toLowerCase()}|${normalizeHref(item.href)}`);
      collectNav(item.children || []);
    }
  };
  for (const nav of ir.taxonomy?.navs || []) collectNav(nav.items);

  const surfaceColor = importSurfaceColor(ir);
  const assetByUrl = new Map<string, AssetRef>();
  for (const a of ir.assets || []) if (a.originalUrl && !assetByUrl.has(a.originalUrl)) assetByUrl.set(a.originalUrl, a);
  /** A background picture → the promoted asset's URL (copied on --apply),
   *  else the original, the way image modules fall back to their src. */
  const resolveBackgroundImage = (url: string): string => {
    const asset = assetByUrl.get(url);
    if (!asset) return url;
    promoteAsset(asset.id);
    return asset.storageUrl || asset.originalUrl;
  };

  const report: MapReport = {
    elements: { total: 0, mapped: 0, placeholder: 0, navConsumed: 0, deduped: 0, humanModified: 0, skipped: 0 },
    skipped: [],
    pages: [],
    assets: { promoted: 0, cropsCopied: 0, leftInNamespace: 0 },
    placeholderPatterns: [],
  };
  const patternTally = new Map<string, { count: number; sampleSourceId: string }>();
  const crops: CropCopy[] = [];
  const promotions = new Map<string, AssetPromotion>();
  const sourceOverflows: SourceOverflow[] = [];
  const pages: MappedPage[] = [];

  let moduleSeq = 0;
  const nextModuleId = (sourceId: string) =>
    `impm_${String(sourceId).replace(/[^a-zA-Z0-9]+/g, "")}_${moduleSeq++}`;

  const promoteAsset = (assetId: string): AssetRef | null => {
    const asset = assetsById.get(assetId);
    if (!asset) return null;
    if (!promotions.has(assetId)) {
      promotions.set(assetId, {
        assetId,
        fromUrl: asset.storageUrl || asset.originalUrl,
        originalUrl: asset.originalUrl,
        altText: asset.altText || "",
        mimeType: asset.mimeType || "",
      });
    }
    return asset;
  };

  // --- Slideshow detection (ratified spec, task 86bb9xt0y) ---------------
  // A consecutive same-depth run of >=4 images qualifies as a slideshow
  // when it contains duplicate srcs (clone-for-looping signal) OR its
  // deduplicated src-set recurs on >=60% of pages (chrome fingerprint).
  // Ratified amendment: ONE slideshow module on the homepage; interior
  // runs and clone-duplicates land in the `deduped` bucket.
  type SlideshowRun = { pageIdx: number; elements: ElementIR[]; key: string; hasDupes: boolean; uniqueCount: number };
  const slideshowRuns: SlideshowRun[] = [];
  (ir.pages || []).forEach((irPage, pageIdx) => {
    for (const section of irPage.sections || []) {
      let current: ElementIR[] = [];
      const flushRun = () => {
        if (current.length >= 4) {
          const srcs = current.map((e) => attrFromHtml(e.html, "src")).filter(Boolean);
          const unique = Array.from(new Set(srcs));
          slideshowRuns.push({
            pageIdx,
            elements: current,
            key: unique.slice().sort().join("|"),
            hasDupes: unique.length < srcs.length,
            uniqueCount: unique.length,
          });
        }
        current = [];
      };
      for (const el of section.elements || []) {
        if (el.class === "image") {
          if (current.length && current[current.length - 1].depth !== el.depth) flushRun();
          current.push(el);
        } else {
          flushRun();
        }
      }
      flushRun();
    }
  });
  const totalPages = (ir.pages || []).length;
  const pagesByKey = new Map<string, Set<number>>();
  for (const run of slideshowRuns) {
    const set = pagesByKey.get(run.key) || new Set<number>();
    set.add(run.pageIdx);
    pagesByKey.set(run.key, set);
  }
  // A show needs at least 3 distinct slides: a run of one repeated image
  // is a lazy-load placeholder artifact (seen on delraytennis), not a
  // slideshow — it stays as ordinary images.
  const qualifies = (run: SlideshowRun) =>
    run.uniqueCount >= 3 &&
    (run.hasDupes ||
      (totalPages >= 3 && (pagesByKey.get(run.key)?.size || 0) / totalPages >= 0.6));
  const homeIdx = Math.max(0, (ir.pages || []).findIndex((p) => String(p.path || "").trim() === "/" || String(p.path || "").trim() === ""));
  type SlideshowLead = { slides: { id: string; url: string; alt: string }[]; allIds: string[] };
  const slideshowLeads = new Map<string, SlideshowLead>();
  /** Per page: image srcs the page's slideshow now displays. */
  const slideshowSrcByPage = new Map<number, Set<string>>();
  const slideshowConsumed = new Map<string, "member" | "dupe" | "interior">();
  // A marquee-style source duplicates its whole strip as sibling tracks —
  // same fingerprint, two runs. One module per distinct fingerprint; the
  // duplicate track dedupes (found on the real delraytennis homepage).
  const homeKeysDone = new Set<string>();
  const skipPaths = new Set((opts.skipSlideshowPaths || []).map((p) => String(p || "").trim()));
  const pageSkipped = (pageIdx: number) => {
    if (opts.skipAllSlideshows) return true;
    if (!skipPaths.size) return false;
    const path = String((ir.pages || [])[pageIdx]?.path || "").trim();
    return skipPaths.has(path) || (path === "/" && skipPaths.has(""));
  };
  const slideshowPlans: SlideshowPlan[] = [];
  for (const run of slideshowRuns) {
    if (!qualifies(run)) continue;
    if (pageSkipped(run.pageIdx)) continue; // vetoed: images stay images
    if (run.pageIdx !== homeIdx || homeKeysDone.has(run.key)) {
      for (const el of run.elements) slideshowConsumed.set(el.sourceId, "interior");
      continue;
    }
    homeKeysDone.add(run.key);
    const seenSrcs = new Set<string>();
    const slides: SlideshowLead["slides"] = [];
    let lead: ElementIR | null = null;
    for (const el of run.elements) {
      const srcAttr = attrFromHtml(el.html, "src");
      if (srcAttr && seenSrcs.has(srcAttr)) {
        slideshowConsumed.set(el.sourceId, "dupe");
        continue;
      }
      if (srcAttr) seenSrcs.add(srcAttr);
      const asset = el.assetRefs[0] ? promoteAsset(el.assetRefs[0]) : null;
      slides.push({
        id: `slide-${slides.length + 1}`,
        url: asset?.storageUrl || asset?.originalUrl || srcAttr,
        alt: attrFromHtml(el.html, "alt") || asset?.altText || "",
      });
      if (!lead) lead = el;
      else slideshowConsumed.set(el.sourceId, "member");
    }
    if (lead) {
      slideshowLeads.set(lead.sourceId, { slides, allIds: run.elements.map((e) => e.sourceId) });
      const absorbed = slideshowSrcByPage.get(run.pageIdx) || new Set<string>();
      for (const s of seenSrcs) absorbed.add(s);
      slideshowSrcByPage.set(run.pageIdx, absorbed);
      slideshowPlans.push({
        pagePath: String((ir.pages || [])[run.pageIdx]?.path || ""),
        slideCount: slides.length,
        absorbedIds: run.elements.map((e) => e.sourceId),
      });
    }
  }

  // --- Card-grid detection (2026-08-08) ---------------------------------
  // A "card grid" is a run of sibling blocks that repeat the SAME sequence
  // of element classes — the shape every marketing site uses for a row of
  // feature tiles. Before this, the Feature Cards module existed but the
  // importer could not emit it, so every imported site needed its card rows
  // reassembled by hand (MODULE_STANDARDS rule 12).
  //
  // The rule is deliberately strict, and the strictness is empirical. A
  // first draft required only "a repeating sequence containing a heading or
  // text, plus an image or link". Run against the real blazefish.com
  // capture it matched the correct 6-card grid — and ALSO the mega-menu
  // (link+link+link+heading+link x4) and a text-only list. Turning a site's
  // navigation into feature cards is a far worse failure than declining to
  // detect a card grid, so every group must now carry BOTH a heading and an
  // image. With that added, the detector finds exactly one grid on
  // blazefish and ZERO across all three existing fixtures (the real
  // delraytennis WordPress site, jsframework, tablelayout) — no regression
  // on any reference site.
  //
  // Anything not claimed here maps exactly as it did before, so a missed
  // grid degrades to the old behaviour rather than to nothing (IR governing
  // principle: completeness over fidelity).
  const CARD_MIN_GROUPS = 3;
  const CARD_MAX_GROUP_SIZE = 8;
  type CardGridRun = { pageIdx: number; groups: ElementIR[][]; signature: string };

  const findCardRun = (els: ElementIR[]): { start: number; size: number; reps: number } | null => {
    let best: { start: number; size: number; reps: number } | null = null;
    for (let size = 2; size <= CARD_MAX_GROUP_SIZE; size++) {
      let i = 0;
      while (i + size * CARD_MIN_GROUPS <= els.length) {
        const sig = els.slice(i, i + size).map((e) => e.class);
        let reps = 1;
        let j = i + size;
        while (
          j + size <= els.length &&
          els.slice(j, j + size).every((e, k) => e.class === sig[k])
        ) {
          reps++;
          j += size;
        }
        const classes = new Set(sig);
        if (reps >= CARD_MIN_GROUPS && classes.has("heading") && classes.has("image")) {
          if (!best || reps * size > best.reps * best.size) best = { start: i, size, reps };
          i = j;
        } else {
          i++;
        }
      }
    }
    return best;
  };

  const cardSkipPaths = new Set((opts.skipCardGridPaths || []).map((p) => String(p || "").trim()));
  const cardsVetoed = (pageIdx: number) => {
    if (opts.skipAllCardGrids) return true;
    if (!cardSkipPaths.size) return false;
    const path = String((ir.pages || [])[pageIdx]?.path || "").trim();
    return cardSkipPaths.has(path) || (path === "/" && cardSkipPaths.has(""));
  };

  const cardGridRuns: CardGridRun[] = [];
  (ir.pages || []).forEach((irPage, pageIdx) => {
    if (cardsVetoed(pageIdx)) return; // vetoed: blocks stay as separate modules
    for (const section of irPage.sections || []) {
      const els = (section.elements || []).filter(
        (e) => !slideshowConsumed.has(e.sourceId) && !slideshowLeads.has(e.sourceId)
      );
      const found = findCardRun(els);
      if (!found) continue;
      const groups: ElementIR[][] = [];
      for (let g = 0; g < found.reps; g++) {
        groups.push(els.slice(found.start + g * found.size, found.start + (g + 1) * found.size));
      }
      cardGridRuns.push({
        pageIdx,
        groups,
        signature: groups[0].map((e) => e.class).join("+"),
      });
    }
  });

  type CardGridLead = { cards: BuilderCardSeed[]; allIds: string[] };
  const cardGridLeads = new Map<string, CardGridLead>();
  const cardGridConsumed = new Set<string>();
  const cardGridPlans: CardGridPlan[] = [];

  for (const run of cardGridRuns) {
    const cards: BuilderCardSeed[] = [];
    const allIds: string[] = [];
    for (const [gi, group] of run.groups.entries()) {
      for (const el of group) allIds.push(el.sourceId);
      const imageEl = group.find((e) => e.class === "image") || null;
      const headingEl = group.find((e) => e.class === "heading") || null;
      const linkEl = group.find((e) => e.class === "link") || null;
      const texts = group.filter((e) => e.class === "text");
      // An "icon badge" is a text node holding a single glyph ("▦", "★").
      // Anything longer is body copy.
      const iconEl = texts.find((e) => collapse(e.textContent).length <= 3) || null;
      const bodyEl = texts.find((e) => e !== iconEl) || null;
      const asset = imageEl?.assetRefs[0] ? promoteAsset(imageEl.assetRefs[0]) : null;
      const rawSrc = imageEl ? attrFromHtml(imageEl.html, "src") : "";
      cards.push({
        id: `card-${gi + 1}`,
        title: headingEl ? collapse(headingEl.textContent) : "",
        body: bodyEl ? collapse(bodyEl.textContent) : "",
        imageUrl: asset?.storageUrl || asset?.originalUrl || rawSrc,
        imageAlt: (imageEl ? attrFromHtml(imageEl.html, "alt") : "") || asset?.altText || "",
        linkUrl: linkEl ? attrFromHtml(linkEl.html, "href") : "",
        linkLabel: linkEl ? collapse(linkEl.textContent) : "",
        icon: iconEl ? collapse(iconEl.textContent) : "",
      });
    }
    const lead = run.groups[0][0];
    cardGridLeads.set(lead.sourceId, { cards, allIds });
    for (const id of allIds) if (id !== lead.sourceId) cardGridConsumed.add(id);
    cardGridPlans.push({
      pagePath: String((ir.pages || [])[run.pageIdx]?.path || ""),
      cardCount: cards.length,
      signature: run.signature,
      titles: cards.map((c) => c.title),
      absorbedIds: allIds,
    });
  }

  // Duplicate-image cleanup (2026-08-06, operator-reported): a photo the
  // page's slideshow already shows must not ALSO appear as standalone
  // image modules, and a run of the same image repeated over and over is
  // a lazy-load artifact, not content. Delray's homepage carried 15 copies
  // of one photo that was already slide 2 — the slideshow rendered
  // correctly and was then followed by fifteen identical pictures.
  for (const run of slideshowRuns) {
    if (run.uniqueCount !== 1 || run.elements.length < 2) continue;
    if (pageSkipped(run.pageIdx)) continue;
    // Keep the first occurrence unless the slideshow already covers it.
    for (const [i, el] of run.elements.entries()) {
      if (slideshowLeads.has(el.sourceId) || slideshowConsumed.has(el.sourceId)) continue;
      const src = attrFromHtml(el.html, "src");
      const coveredBySlideshow = Boolean(src && slideshowSrcByPage.get(run.pageIdx)?.has(src));
      if (i > 0 || coveredBySlideshow) slideshowConsumed.set(el.sourceId, "dupe");
    }
  }
  // Any remaining standalone image already carried by this page's
  // slideshow is redundant too, wherever it sits on the page.
  (ir.pages || []).forEach((irPage, pageIdx) => {
    if (pageSkipped(pageIdx)) return;
    const absorbed = slideshowSrcByPage.get(pageIdx);
    if (!absorbed || !absorbed.size) return;
    for (const section of irPage.sections || []) {
      for (const el of section.elements || []) {
        if (el.class !== "image") continue;
        if (slideshowLeads.has(el.sourceId) || slideshowConsumed.has(el.sourceId)) continue;
        const src = attrFromHtml(el.html, "src");
        if (src && absorbed.has(src)) slideshowConsumed.set(el.sourceId, "dupe");
      }
    }
  });

  for (const page of ir.pages || []) {
    const mappedSections: MappedSection[] = [];
    let pageModules = 0;
    let pagePlaceholders = 0;

    for (const section of page.sections || []) {
      const modules: MappedModule[] = [];
      const sourceElementIds: string[] = [];
      // Column inference (columns.ts): which row and column each element sat
      // in on the source page. Prose never merges across a cell boundary, and
      // every module is tagged with the cell it was built in, so the section
      // can be split into Builder rows once the modules exist.
      // Bands and cards (surfaces.ts). Each element's band is decided on its
      // own, so a page whose whole main area is one wrapper still keeps every
      // band inside it; rows never merge across a band. A first plan grouped
      // by band says which boxes hold one cell's worth of content (cards);
      // the real plan then refuses to pour two different cards into one cell
      // (columns.ts, GridItem.group).
      const sectionEls = section.elements || [];
      const containerStyles = section.containers || {};
      const rowCtx = { surface: surfaceColor, resolveImage: resolveBackgroundImage, maxPadding: 160 };
      const bandLooks = new Map<string, SurfaceLook>();
      const bandLookOf = (key: string): SurfaceLook | null => {
        if (!bandLooks.has(key)) bandLooks.set(key, readSurface(containerStyles[key], rowCtx));
        return bandLooks.get(key) || null;
      };
      // A wrapper painted the page's own colour is not a band — keep looking
      // inward (round 2 of 86bce9wx3).
      const bandOf = planBands(sectionEls, section.containerBoxes, (key) => {
        const look = bandLookOf(key);
        return Boolean(look && hasPaint(look));
      });
      const draft = planSectionGrid(
        sectionEls.map((el) => ({ id: el.sourceId, box: el.box, group: bandOf.get(el.sourceId) }))
      );
      const cardOf = planCards(sectionEls, bandOf, (id) => {
        const c = draft.cells.get(id);
        return c ? `${c.band}:${c.col}` : "";
      });
      const grid = planSectionGrid(
        sectionEls.map((el) => ({
          id: el.sourceId,
          box: el.box,
          group: `${bandOf.get(el.sourceId) || ""}\u0001${cardOf.get(el.sourceId) || ""}`,
        }))
      );
      // No painted band anywhere: the section root may still carry the spacing.
      const rootLook = (() => {
        const root = readSurface(section.rootStyles, rowCtx);
        return root.padding.top || root.padding.bottom ? { padding: root.padding } : null;
      })();
      // A card the colour of the page vanishes against the page — but not
      // against a painted band, so it keeps its fill there.
      const cardLooks = new Map<string, SurfaceLook>();
      const cardLookOf = (sourceId: string, onBand: boolean) => {
        const key = cardOf.get(sourceId);
        if (!key) return null;
        const memo = `${onBand ? "band" : "page"}\u0001${key}`;
        if (!cardLooks.has(memo)) {
          cardLooks.set(
            memo,
            readSurface(containerStyles[key], {
              surface: onBand ? "" : surfaceColor,
              resolveImage: resolveBackgroundImage,
              maxPadding: 50,
            })
          );
        }
        const look = cardLooks.get(memo) as SurfaceLook;
        return hasPaint(look) ? { key, look } : null;
      };
      const moduleCells: Cell[] = [];
      const bandDispositions = new Map<number, { mapped: number; placeholder: number; deduped: number }>();
      const dispositionsFor = (band: number) => {
        const found = bandDispositions.get(band);
        if (found) return found;
        const fresh = { mapped: 0, placeholder: 0, deduped: 0 };
        bandDispositions.set(band, fresh);
        return fresh;
      };
      let currentCell: Cell = { band: 0, col: 0 };
      let dispositions = dispositionsFor(0);
      let prose: { html: string; sourceIds: string[] } = { html: "", sourceIds: [] };
      let firstHeading = "";

      const flushProse = () => {
        if (!prose.html.trim()) {
          prose = { html: "", sourceIds: [] };
          return;
        }
        modules.push({
          id: nextModuleId(prose.sourceIds[0] || section.sourceId),
          type: "text",
          column: "main",
          name: "Imported text",
          text: prose.html,
          settings: { importSourceIds: prose.sourceIds.join(",") },
        });
        prose = { html: "", sourceIds: [] };
      };

      const pushPlaceholder = (el: ElementIR, reasonNote?: string) => {
        const moduleId = nextModuleId(el.sourceId);
        const caption = reasonNote || `Imported ${el.class} — rebuild with a real module.`;
        const cropImg = el.screenshot
          ? `<img src="${el.screenshot}" alt="Screenshot of imported ${el.class}" style="max-width:100%" />`
          : `<p><em>(No screenshot was captured for this element.)</em></p>`;
        const settings: Record<string, string> = {
          snippetMode: "html",
          label: `Imported ${el.class}`,
          importClass: el.class,
          importSourceId: el.sourceId,
        };
        if (el.html.length <= SOURCE_HTML_INLINE_BUDGET) {
          settings.importSourceHtml = el.html;
        } else {
          // Runner uploads the full source to Blob and sets
          // settings.importSourceHtmlUrl on this module.
          sourceOverflows.push({ sourceId: el.sourceId, moduleId, html: el.html });
        }
        modules.push({
          id: moduleId,
          type: "code",
          column: "main",
          name: `Imported ${el.class}`,
          text: `${cropImg}<p><em>${escapeHtml(caption)}</em></p>`,
          settings,
        });
        if (el.screenshot) crops.push({ sourceId: el.sourceId, fromUrl: el.screenshot, moduleId });
        const signature = structuralSignature(el);
        const tallied = patternTally.get(signature) || { count: 0, sampleSourceId: el.sourceId };
        tallied.count += 1;
        patternTally.set(signature, tallied);
        report.elements.placeholder += 1;
        dispositions.placeholder += 1;
        pagePlaceholders += 1;
      };

      const tagNewModules = () => {
        while (moduleCells.length < modules.length) moduleCells.push(currentCell);
      };

      for (const el of section.elements || []) {
        const cell = grid.cells.get(el.sourceId) || currentCell;
        if (cell.band !== currentCell.band || cell.col !== currentCell.col) {
          flushProse();
          tagNewModules();
          currentCell = cell;
          dispositions = dispositionsFor(cell.band);
        }
        report.elements.total += 1;
        sourceElementIds.push(el.sourceId);
        if (el.class === "heading" && !firstHeading) firstHeading = collapse(el.textContent);

        const slideshowLead = slideshowLeads.get(el.sourceId);
        if (slideshowLead) {
          flushProse();
          modules.push({
            id: nextModuleId(el.sourceId),
            // The `carousel` module in its slideshow format — `slideshow`
            // was its own type until the 2026-08-16 merge. Written in the
            // new shape directly rather than relying on the normalizer's
            // migration, so an import produces the same document a hand-built
            // page does.
            type: "carousel",
            column: "main",
            name: "Imported slideshow",
            text: "",
            settings: {
              format: "slideshow",
              items: JSON.stringify(
                slideshowLead.slides.map((slide) => ({
                  id: slide.id,
                  title: "",
                  body: "",
                  imageUrl: slide.url,
                  imageAlt: slide.alt,
                  linkUrl: "",
                  linkLabel: "",
                  icon: "",
                  iconImageUrl: "",
                }))
              ),
              intervalMs: "5000",
              transition: "slide",
              heightPx: "0",
              importSourceIds: slideshowLead.allIds.join(","),
            },
          });
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }
        const slideshowRole = slideshowConsumed.get(el.sourceId);
        if (slideshowRole === "member") {
          // Represented by the homepage slideshow module it belongs to.
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }
        if (slideshowRole) {
          report.elements.deduped += 1;
          dispositions.deduped += 1;
          continue;
        }

        const cardGridLead = cardGridLeads.get(el.sourceId);
        if (cardGridLead) {
          flushProse();
          modules.push({
            id: nextModuleId(el.sourceId),
            type: "feature-cards",
            column: "main",
            name: "Imported feature cards",
            text: "",
            settings: {
              cards: JSON.stringify(cardGridLead.cards),
              // Prefer a column count the cards divide into evenly, so the
              // last row is full: 6 cards read as 3+3, not 4+2. Falls back to
              // the module's own default of 3.
              cardColumns: String(pickCardColumns(cardGridLead.cards.length)),
              importSourceIds: cardGridLead.allIds.join(","),
            },
          });
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }
        if (cardGridConsumed.has(el.sourceId)) {
          // Represented by the feature-cards module its group belongs to.
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }

        if (PROSE_CLASSES.has(el.class)) {
          if (el.class === "link") {
            const pair = `${collapse(el.textContent).toLowerCase()}|${normalizeHref(attrFromHtml(el.html, "href"))}`;
            if (navPairs.has(pair)) {
              report.elements.navConsumed += 1;
              continue;
            }
          }
          // Oversize ladder before merging.
          if (el.html.length > TEXT_MODULE_CHAR_BUDGET) {
            flushProse();
            const split = splitOversizeHtml(el.html, TEXT_MODULE_CHAR_BUDGET);
            if (split === null) {
              pushPlaceholder(el, `Imported ${el.class} too large to split — rebuild manually.`);
              continue;
            }
            for (const piece of split) {
              modules.push({
                id: nextModuleId(el.sourceId),
                type: "text",
                column: "main",
                name: "Imported text",
                text: piece,
                settings: { importSourceIds: el.sourceId },
              });
            }
            report.elements.mapped += 1;
            dispositions.mapped += 1;
            continue;
          }
          if (prose.html.length + el.html.length > TEXT_MODULE_CHAR_BUDGET) flushProse();
          prose.html += el.html;
          prose.sourceIds.push(el.sourceId);
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }

        if (el.class === "image") {
          flushProse();
          const asset = el.assetRefs[0] ? promoteAsset(el.assetRefs[0]) : null;
          const url = asset?.storageUrl || asset?.originalUrl || attrFromHtml(el.html, "src");
          modules.push({
            id: nextModuleId(el.sourceId),
            type: "image",
            column: "main",
            name: "Imported image",
            text: "",
            settings: {
              url,
              alt: attrFromHtml(el.html, "alt") || asset?.altText || "",
              size: "100",
              importSourceIds: el.sourceId,
            },
          });
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }

        if (el.class === "button") {
          flushProse();
          modules.push({
            id: nextModuleId(el.sourceId),
            type: "button",
            column: "main",
            name: "Imported button",
            text: collapse(el.textContent) || "Imported button",
            settings: {
              href: attrFromHtml(el.html, "href"),
              importSourceIds: el.sourceId,
            },
          });
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }

        if (el.class === "video") {
          flushProse();
          const src = attrFromHtml(el.html, "src");
          if (DIRECT_MEDIA_RE.test(src)) {
            modules.push({
              id: nextModuleId(el.sourceId),
              type: "video",
              column: "main",
              name: "Imported video",
              text: "",
              settings: { url: src, importSourceIds: el.sourceId },
            });
            report.elements.mapped += 1;
            dispositions.mapped += 1;
          } else {
            pushPlaceholder(el);
          }
          continue;
        }

        const layoutTableImages = imagesFromLayoutTable(el);
        if (layoutTableImages) {
          flushProse();
          for (const img of layoutTableImages) {
            // The IR already resolved this element's assets; pick the one
            // whose original URL is this image (srcset variants mean an
            // element often carries several).
            const match = el.assetRefs
              .map((id) => assetsById.get(id))
              .find((a) => a && a.originalUrl === img.src);
            const asset = match ? promoteAsset(match.id) : null;
            modules.push({
              id: nextModuleId(el.sourceId),
              type: "image",
              column: "main",
              name: "Imported image",
              text: "",
              settings: {
                url: asset?.storageUrl || asset?.originalUrl || img.src,
                alt: img.alt,
                // Percent of the container, matching what a hand-created
                // image module gets. Without it the module renders at the
                // file's natural size — a 1103px flyer overflowed the page.
                size: "100",
                ...(img.href ? { linkUrl: img.href, newTab: "true" } : {}),
                importSourceIds: el.sourceId,
                importFromLayoutTable: "true",
              },
            });
          }
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }

        if (PLACEHOLDER_CLASSES.has(el.class)) {
          flushProse();
          pushPlaceholder(el);
          continue;
        }

        // Unreachable by the IR's closed class set — but completeness over
        // fidelity says account for it rather than trust the assumption.
        report.elements.skipped += 1;
        report.skipped.push({
          sourceId: el.sourceId,
          class: el.class,
          reason: `unknown element class "${el.class}"`,
        });
      }
      flushProse();
      tagNewModules();

      if (!modules.length) continue; // nothing mappable (e.g. nav-only section)
      const built = splitIntoRows({
        section,
        baseId: `imps_${String(section.sourceId).replace(/[^a-zA-Z0-9]+/g, "")}`,
        fallbackHeading: firstHeading,
        modules,
        moduleCells,
        grid,
        cellOf: (id) => grid.cells.get(id) || { band: 0, col: 0 },
        sourceElementIds,
        dispositionsFor,
        bandOf: (id) => bandOf.get(id) || "",
        bandLookOf,
        rootLook,
        cardLookOf,
      });
      mappedSections.push(...built);
      pageModules += modules.length;
    }

    const slug = uniqueSlug(normalizeImportSlug(page.path), takenSlugs);
    pages.push({
      irPath: page.path,
      name: collapse(page.title) || slug,
      slug,
      sections: mappedSections,
    });
    report.pages.push({
      path: page.path,
      slug,
      modules: pageModules,
      placeholders: pagePlaceholders,
      builderPageId: null,
    });
  }

  // Nav tree → navigation-module items (header tree preferred).
  const headerNav =
    (ir.taxonomy?.navs || []).find((n) => n.location === "header") ||
    (ir.taxonomy?.navs || [])[0] ||
    null;
  const navItems: MapOutput["navItems"] = [];
  if (headerNav) {
    let navSeq = 0;
    const push = (items: NavItem[], parentId: string) => {
      for (const item of items || []) {
        const id = `impnav_${navSeq++}`;
        navItems.push({
          id,
          label: collapse(item.label),
          href: item.href || "#",
          parentId,
          target: "",
        });
        push(item.children || [], id);
      }
    };
    push(headerNav.items, "");
  }

  // --- Localize links between imported pages (nav + in-content) ----------
  // A link that points at a page we ALSO imported should navigate the
  // imported site, not the client's live one. Exact href-attribute
  // matching only: substring URL replacement would corrupt asset URLs
  // that share the site root as a prefix.
  const localHrefBySource = new Map<string, string>();
  /** The site root is served at "/", never at the home page's slug — link
   *  there directly so the menu's Home item works no matter what that
   *  page's slug ends up being. */
  const isRootPath = (p: string): boolean => {
    const t = String(p || "").trim();
    return t === "" || t === "/";
  };
  for (const irPage of ir.pages || []) {
    const mapped = pages.find((p) => p.irPath === irPage.path);
    if (!mapped) continue;
    const local = isRootPath(irPage.path) ? "/" : `/${mapped.slug}`;
    const variants = new Set<string>();
    const abs = String(irPage.url || "").trim();
    if (abs) {
      variants.add(abs);
      variants.add(abs.endsWith("/") ? abs.slice(0, -1) : `${abs}/`);
    }
    const irPath = String(irPage.path || "").trim();
    if (irPath) {
      variants.add(irPath);
      variants.add(irPath.endsWith("/") ? irPath.slice(0, -1) : `${irPath}/`);
    }
    for (const v of variants) if (v) localHrefBySource.set(v, local);
  }
  /**
   * Rewrite one href for the imported site.
   *  - a page we imported  → its Builder slug
   *  - any other page on the SAME site → the slug that page would get,
   *    kept relative. An imported staging site must never send visitors
   *    back to the client's live site; a dead internal link is a redesign
   *    to-do, and it starts working by itself once that page exists.
   *  - asset files (PDFs, images) and external links → untouched
   */
  const localizeHref = (href: string): string => {
    const raw = String(href || "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) return raw;
    const direct =
      localHrefBySource.get(raw) ||
      localHrefBySource.get(raw.endsWith("/") ? raw.slice(0, -1) : `${raw}/`);
    if (direct) return direct;
    try {
      const abs = new URL(raw, ir.sourceUrl);
      if (!sameSite(abs.href, ir.sourceUrl)) return raw; // external
      if (!looksLikeHtmlUrl(abs.href)) return raw; // an asset file, not a page
      if (isRootPath(abs.pathname)) return "/";
      return `/${normalizeImportSlug(abs.pathname)}`;
    } catch {
      return raw;
    }
  };

  const localizeHtml = (html: string): string =>
    html.replace(/href="([^"]*)"/g, (whole, href) => {
      const next = localizeHref(String(href));
      return next === href ? whole : `href="${next}"`;
    });
  for (const page of pages) {
    for (const section of page.sections) {
      for (const module of section.modules) {
        if (module.type === "text" && module.text.includes("href=")) {
          module.text = localizeHtml(module.text);
        }
        if (module.type === "button" && module.settings.href) {
          module.settings.href = localizeHref(module.settings.href);
        }
        if (module.type === "image" && module.settings.linkUrl) {
          module.settings.linkUrl = localizeHref(module.settings.linkUrl);
        }
      }
    }
  }
  for (const item of navItems) {
    item.href = localizeHref(item.href);
  }

  report.placeholderPatterns = Array.from(patternTally.entries())
    .map(([signature, v]) => ({ signature, count: v.count, sampleSourceId: v.sampleSourceId }))
    .sort((a, b) => b.count - a.count);
  report.assets.promoted = promotions.size;
  report.assets.cropsCopied = crops.length;
  report.assets.leftInNamespace = Math.max(0, (ir.assets || []).length - promotions.size);

  return {
    pages,
    slideshows: slideshowPlans,
    cardGrids: cardGridPlans,
    navItems,
    copyPlan: { crops, assets: Array.from(promotions.values()), sourceOverflows },
    report,
  };
}

/** The reconciliation rule (spec: refuse --apply unless this holds). */
export function reportReconciles(report: MapReport): boolean {
  const e = report.elements;
  return (
    e.total === e.mapped + e.placeholder + e.navConsumed + e.deduped + e.humanModified + e.skipped &&
    report.skipped.length === e.skipped &&
    report.skipped.every((s) => Boolean(s.reason))
  );
}
