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
import type { AssetRef, ElementIR, NavItem, NavTree, PageIR, SectionIR, SiteIR } from "./ir";
import { chooseLayout, columnKeys, planSectionGrid, type Cell } from "./columns";
import { importSurfaceColor } from "./theme";
import { isCreditLink } from "./normalize";
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
  /**
   * What the --apply write loop and `checkpoints.map.pageIds` key this page
   * by. The source path for the first capture of a path; `<path>#2`, `#3`…
   * for a later capture of the SAME path whose content differs. Keying by
   * irPath alone wrote every repeat capture of "/" onto one Builder page
   * (Strands Movie, 2026-10-12, task 86bch6ger). See pageWriteKey().
   */
  key: string;
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
    /** MappedPage.key — unique per page, unlike path. */
    key: string;
    slug: string;
    modules: number;
    placeholders: number;
    builderPageId: string | null;
  }[];
  assets: { promoted: number; cropsCopied: number; leftInNamespace: number };
  /**
   * Captures of a path already captured with the SAME content. Mapped once;
   * their elements are counted in elements.deduped so the report still
   * reconciles.
   */
  repeatCaptures: { path: string; url: string; elements: number }[];
  /**
   * What the placeholders actually CONTAIN, grouped by structural
   * signature and ranked. Placeholders are the importer admitting it has
   * no rule for something; grouping them turns "look at the site and
   * notice" into a repeatable signal. A large group with a simple shape
   * (e.g. "table: 1 image, no text") is a mapping rule waiting to be
   * written — that is exactly how image-only tables were found.
   */
  placeholderPatterns: { signature: string; count: number; sampleSourceId: string }[];
  /**
   * The menus --apply will build, in counts and plain words, so the dry run
   * and the Imports screen can say what is coming — and, when a part is
   * missing, why (task 86bchydp6).
   */
  menus: {
    top: { items: number; topLevel: number; logo: boolean } | null;
    footer: { items: number } | null;
    /** Why a part is absent: "no logo found in the header", … */
    notes: string[];
  };
};

/** One link in the navigation module's flat `navItems` shape. */
export type MenuNavItem = { id: string; label: string; href: string; parentId: string; target: string };

/** The site's logo as the Top Menu will show it. `url` is the copy the
 *  import makes (rewritten to the project's namespace on --apply). */
export type MenuLogo = { url: string; alt: string; width: number; height: number; assetId: string };

export type MenuPlan = {
  /** Null only when the site has neither a header menu nor a logo. */
  top: { items: MenuNavItem[]; logo: MenuLogo | null } | null;
  /** Null when the footer has no links. */
  footer: { items: MenuNavItem[] } | null;
  /** Why a part is absent, in plain words. */
  notes: string[];
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
  /** Header nav for --nav, in navigation-module navItems shape. The same
   *  list as menus.top.items (an empty list when there is no top menu). */
  navItems: MenuNavItem[];
  /** The Top Menu and Footer Menu saved sections --apply builds (task
   *  86bchydp6). */
  menus: MenuPlan;
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
  /**
   * Build the Top Menu / Footer Menu (default true; the script's --no-menus
   * and --nav turn it off). When on, a paragraph that is only a
   * theme/platform credit ("Designed by Elegant Themes | Powered by
   * WordPress") is dropped from the page — the same rule that keeps credits
   * out of the Footer Menu. When off, pages map exactly as before 86bchydp6.
   */
  menus?: boolean;
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

/**
 * The key a mapped page is written under. The first capture of a path keeps
 * the bare path, so every job applied before this existed still finds its
 * pages on a re-run; a later capture of the same path gets `#<n>`. A URL
 * path never carries a "#", so the suffix cannot collide with a real path.
 */
export function pageWriteKey(irPath: string, occurrence: number): string {
  return occurrence <= 1 ? irPath : `${irPath}#${occurrence}`;
}

/** The source path a write key (or a pre-86bch6ger irPath key) stands for. */
export function pathOfWriteKey(key: string): string {
  return String(key || "").replace(/#\d+$/, "");
}

/** What a capture SAYS, without the ids capture invents per visit. */
/**
 * The nav trees the mapping step matches page links against, and may fall
 * back to for the top menu. Footer trees built from plain link lists (source
 * "footer-links", task 86bchydp2) are left out: their links are still page
 * content, so they stay on the imported page and never become the top menu.
 * The Footer Menu reads them on purpose (task 86bchydp6, in mapSite).
 */
export function menuNavs(ir: SiteIR): NavTree[] {
  return (ir.taxonomy?.navs || []).filter((n) => n.source !== "footer-links");
}

function captureFingerprint(page: PageIR): string {
  return JSON.stringify(
    (page.sections || []).map((section) =>
      (section.elements || []).map((el) => [el.class, String(el.html || "").replace(/\s+/g, " ").trim()])
    )
  );
}

/**
 * Drop a capture whose path AND content repeat an earlier capture. Capture
 * can reach one page by several URLs (three "/" pages on the Strands Movie
 * job); mapping each would build the same page three times. A repeat whose
 * content differs is kept — it becomes its own page under its own key.
 */
export function dropRepeatCaptures(pages: PageIR[]): {
  kept: PageIR[];
  repeats: { path: string; url: string; elements: number }[];
} {
  const seen = new Set<string>();
  const kept: PageIR[] = [];
  const repeats: { path: string; url: string; elements: number }[] = [];
  for (const page of pages || []) {
    const fingerprint = `${page.path}\u0000${captureFingerprint(page)}`;
    if (seen.has(fingerprint)) {
      repeats.push({
        path: page.path,
        url: page.url,
        elements: (page.sections || []).reduce((n, s) => n + (s.elements || []).length, 0),
      });
      continue;
    }
    seen.add(fingerprint);
    kept.push(page);
  }
  return { kept, repeats };
}

export type PageWrite = { key: string; slug: string; pageId: string; action: "created" | "updated" };

/**
 * The --apply page write loop, with the store passed in so it can be tested
 * without a database. Each mapped page is looked up, and recorded, under its
 * OWN key: a page whose key has a prior id is merged into that page, any
 * other page is created.
 */
export async function writeMappedPages<S>(
  pages: MappedPage[],
  io: {
    priorPageIds: Record<string, string>;
    prepareSections: (page: MappedPage) => S[];
    getPage: (id: string) => Promise<{ id: string | number; layoutSections?: S[] } | null>;
    createPage: (page: MappedPage, sections: S[]) => Promise<{ id: string | number }>;
    updatePage: (page: MappedPage, current: { id: string | number; layoutSections?: S[] }, merged: S[]) => Promise<{ id: string | number }>;
    mergeSections: (existing: S[], incoming: S[]) => S[];
    onWrite?: (page: MappedPage, pageId: string, sections: S[], action: PageWrite["action"]) => void;
  }
): Promise<{ pageIds: Record<string, string>; writes: PageWrite[] }> {
  const pageIds: Record<string, string> = { ...io.priorPageIds };
  const writes: PageWrite[] = [];
  for (const page of pages) {
    const sections = io.prepareSections(page);
    const existingId = pageIds[page.key];
    // Read the page's CURRENT state at write time — a listing taken at
    // startup is stale by now, and merging against it reverts edits.
    const current = existingId ? await io.getPage(existingId) : null; // vanished page → recreate
    let saved: { id: string | number };
    let action: PageWrite["action"];
    if (current) {
      saved = await io.updatePage(page, current, io.mergeSections(current.layoutSections || [], sections));
      action = "updated";
    } else {
      saved = await io.createPage(page, sections);
      action = "created";
    }
    const pageId = String(saved.id);
    pageIds[page.key] = pageId;
    writes.push({ key: page.key, slug: page.slug, pageId, action });
    io.onWrite?.(page, pageId, sections, action);
  }
  return { pageIds, writes };
}

/**
 * Does what --apply wrote match what the report promised? One mapped page
 * must be one Builder page. Two pages written to one id is the 86bch6ger
 * failure: the report said 43 pages, 41 existed, and nothing said so.
 */
export function summarizePageWrites(expectedPages: number, writes: PageWrite[]): {
  created: number;
  updated: number;
  distinctPages: number;
  problems: string[];
} {
  const byId = new Map<string, PageWrite[]>();
  for (const write of writes) byId.set(write.pageId, [...(byId.get(write.pageId) || []), write]);
  const problems: string[] = [];
  for (const [pageId, shared] of byId) {
    if (shared.length > 1) {
      problems.push(`page ${pageId} was written ${shared.length} times: ${shared.map((w) => `/${w.slug}`).join(", ")}`);
    }
  }
  if (byId.size !== expectedPages) {
    problems.push(`the report lists ${expectedPages} page(s) but ${byId.size} distinct page(s) were written`);
  }
  return {
    created: writes.filter((w) => w.action === "created").length,
    updated: writes.filter((w) => w.action === "updated").length,
    distinctPages: byId.size,
    problems,
  };
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

/** A picture that was a link on the source site (normalize classifies an
 *  <a> holding only one picture as "image", task 86bcebrwp) keeps that link:
 *  its HTML starts with the anchor, so the first href is the anchor's own. */
function imageLink(el: ElementIR): { linkUrl: string; newTab?: "true" } | null {
  const html = String(el.html || "");
  if (!/^\s*<a\b/i.test(html)) return null;
  const linkUrl = attrFromHtml(html, "href").trim();
  if (!linkUrl) return null;
  const opening = html.slice(0, html.indexOf(">") + 1);
  return /target\s*=\s*"_blank"/i.test(opening) ? { linkUrl, newTab: "true" } : { linkUrl };
}

/** The asset an image element shows. A linked picture's href can itself
 *  name an asset (a thumbnail linking to its full-size file), and it comes
 *  first in the HTML — so prefer the asset that matches the picture's src. */
function shownAssetId(el: ElementIR, assetsById: Map<string, AssetRef>): string | undefined {
  const src = attrFromHtml(el.html, "src");
  if (src && el.assetRefs.length > 1) {
    const match = el.assetRefs.find((id) => assetsById.get(id)?.originalUrl === src);
    if (match) return match;
  }
  return el.assetRefs[0];
}

/**
 * How wide a picture was SHOWN on the source page, in px, or 0 when nothing
 * says. The `width` attribute of its <img> (what the author asked for) and its
 * measured desktop box (what the browser drew); when both exist the smaller
 * wins, because a linked picture's box is its anchor's, and an anchor styled
 * as a block is as wide as the column however small the icon inside it.
 */
function shownWidthPx(html: string, box?: { w: number } | null): number {
  const imgTag = /<img\b[^>]*>/i.exec(String(html || ""))?.[0] || "";
  const declared = /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(attrFromHtml(imgTag, "width"))
    ? Math.round(Number.parseFloat(attrFromHtml(imgTag, "width")))
    : 0;
  const measured = box && Number.isFinite(box.w) && box.w >= 2 ? Math.round(box.w) : 0;
  if (declared > 0 && measured > 0) return Math.min(declared, measured);
  return declared || measured;
}

/** A picture shown at less than this share of its column was meant to be
 *  small (an icon, a wordmark, a badge); at or above it, it fills the column.
 *  Half, not "nearly all": Delray's 791px clinic flyers sit in a ~1100px
 *  page and are the page's main content, so they keep filling the column as
 *  they always did. */
const SMALL_IMAGE_SHARE = 0.5;
/** The Builder's content column when nothing measured the source's — the
 *  same figure `CONTENT_WIDTH_PX` in lib/builder-client/image-renditions.ts
 *  uses (not imported: this file builds on its own, lib/site-import/dist). */
const ASSUMED_COLUMN_PX = 1200;

/**
 * The image module's `maxWidthPx` for an imported picture, or "" for none
 * (task 86bcebvg9). Every imported picture is Width 100% of its column; the
 * module already never draws a picture larger than its file, so this only
 * matters for a file with more pixels than the source page showed — Dane of
 * Earth's 1600px Substack/Medium/Patreon wordmarks, displayed small, arrived
 * filling the column. A pixel cap rather than a smaller Width %: a percentage
 * is a share of a column the Builder chooses, and the Width control only
 * offers 5–100% in fixed steps, so a 24px icon could not be expressed at all.
 *
 * Only small pictures get one — a photo shown at most of its column's width
 * keeps filling it, so the 1103px flyer behaves exactly as before.
 */
function importedImageCap(shownPx: number, columnPx: number, asset: AssetRef | null): string {
  if (!(shownPx > 0)) return "";
  const column = columnPx > 0 ? columnPx : ASSUMED_COLUMN_PX;
  if (shownPx >= column * SMALL_IMAGE_SHARE) return "";
  // The file is no bigger than it was shown: the module's own natural-size
  // cap already holds it there, and a setting would be noise in the panel.
  if (asset?.width && asset.width <= shownPx) return "";
  return String(shownPx);
}

function cappedAt(px: string): { maxWidthPx?: string } {
  return px ? { maxWidthPx: px } : {};
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
function imagesFromLayoutTable(
  el: ElementIR
): { src: string; alt: string; href: string; width: number }[] | null {
  if (el.class !== "table") return null;
  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(el.html);
  } catch {
    return null;
  }
  const text = $.root().text().replace(/\s+/g, " ").trim();
  if (text.length > 0) return null; // any real copy means it may be data
  const out: { src: string; alt: string; href: string; width: number }[] = [];
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
      width: shownWidthPx($.html(node)),
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

export function mapSite(sourceIr: SiteIR, opts: MapOptions): MapOutput {
  // Exact repeat captures are mapped once (task 86bch6ger); everything
  // below works on the remaining pages.
  const { kept: keptPages, repeats: repeatCaptures } = dropRepeatCaptures(sourceIr.pages || []);
  const ir: SiteIR = { ...sourceIr, pages: keptPages };
  const takenSlugs = new Set((opts.existingSlugs || []).map((s) => String(s).toLowerCase()));
  const assetsById = new Map<string, AssetRef>((ir.assets || []).map((a) => [a.id, a]));
  // The source page's content column (theme.ts reads the same tally); 0 when
  // the capture measured nothing.
  const siteContentPx = Number(ir.styleSummary?.contentWidths?.[0]?.value) || 0;

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
  for (const nav of menuNavs(ir)) collectNav(nav.items);
  const menusOn = opts.menus !== false;
  // The footer's own links stay on the page even with a Footer Menu: on a
  // site whose footer band is nothing but links, consuming them deletes the
  // band and its background (the Dane of Earth fixture's #222 footer).
  // Whether the menu should REPLACE the band is a separate decision.
  const footerLinkTrees = (ir.taxonomy?.navs || []).filter((n) => n.source === "footer-links");
  /** A paragraph that is nothing but "Designed by X | Powered by Y". */
  const isCreditOnly = (el: ElementIR): boolean => {
    if (!menusOn || !footerLinkTrees.length || !/<a\b/i.test(el.html)) return false;
    const $ = cheerio.load(el.html);
    const anchors = $("a").toArray();
    if (!anchors.length) return false;
    if (!anchors.every((a) => isCreditLink(collapse($(a).text()), $(a).attr("href") || "", ir.sourceUrl))) return false;
    $("a").remove();
    const glue = collapse($.root().text())
      .toLowerCase()
      .replace(/\b(proudly|designed|powered|built|made|created|developed|theme|by|with|and)\b/g, "")
      .replace(/[|·•,\-–—&]/g, "")
      .trim();
    return glue === "";
  };

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
    repeatCaptures,
    placeholderPatterns: [],
    menus: { top: null, footer: null, notes: [] },
  };
  for (const repeat of repeatCaptures) {
    report.elements.total += repeat.elements;
    report.elements.deduped += repeat.elements;
  }
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
      const imageAssetId = imageEl ? shownAssetId(imageEl, assetsById) : undefined;
      const asset = imageAssetId ? promoteAsset(imageAssetId) : null;
      const rawSrc = imageEl ? attrFromHtml(imageEl.html, "src") : "";
      cards.push({
        id: `card-${gi + 1}`,
        title: headingEl ? collapse(headingEl.textContent) : "",
        body: bodyEl ? collapse(bodyEl.textContent) : "",
        imageUrl: asset?.storageUrl || asset?.originalUrl || rawSrc,
        imageAlt: (imageEl ? attrFromHtml(imageEl.html, "alt") : "") || asset?.altText || "",
        linkUrl: linkEl
          ? attrFromHtml(linkEl.html, "href")
          : (imageEl && imageLink(imageEl)?.linkUrl) || "",
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

  const capturesOfPath = new Map<string, number>();
  for (const page of ir.pages || []) {
    const occurrence = (capturesOfPath.get(page.path) || 0) + 1;
    capturesOfPath.set(page.path, occurrence);
    const key = pageWriteKey(page.path, occurrence);
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
      // inward (round 2 of 86bce9wx3). Failing a band that shows, the plain
      // box with the spacing wins (round 3).
      const bandOf = planBands(
        sectionEls,
        section.containerBoxes,
        (key) => {
          const look = bandLookOf(key);
          return Boolean(look && hasPaint(look));
        },
        (key) => {
          const look = bandLookOf(key);
          return Boolean(look && (look.padding.top || look.padding.bottom));
        }
      );
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
      // How wide the source column holding a cell was, for sizing small
      // pictures (importedImageCap). A side-by-side column is its own extent;
      // a stacked one is the section's whole span, or the site's measured
      // content width when that is wider (a section holding only a logo
      // spans only the logo). 0 = unmeasured.
      const boxes = (section.elements || []).map((el) => el.box).filter((b) => b && b.w >= 2);
      const sectionSpanPx = boxes.length
        ? Math.max(...boxes.map((b) => b!.x + b!.w)) - Math.min(...boxes.map((b) => b!.x))
        : 0;
      const columnPxFor = (cell: Cell): number => {
        const band = grid.bands[cell.band];
        if (band && band.columns.length > 1) {
          const col = band.columns[cell.col];
          if (col && col.x1 - col.x0 > 1) return col.x1 - col.x0;
        }
        return Math.max(sectionSpanPx, siteContentPx);
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
          // The caption is a note for whoever rebuilds the page, so it rides
          // in a setting the renderer shows inside the Builder only. It used
          // to be written into `text`, which made it page content: it shipped
          // to visitors on 24 live pages (task 86bcgdm83).
          importPlaceholder: caption,
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
          text: cropImg,
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
          if (isCreditOnly(el)) {
            report.elements.skipped += 1;
            report.skipped.push({
              sourceId: el.sourceId,
              class: el.class,
              reason: `theme/platform credit ("${collapse(el.textContent).slice(0, 80)}") — the site builder's signature, not the client's content; dropped with the Footer Menu`,
            });
            continue;
          }
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
          const assetId = shownAssetId(el, assetsById);
          const asset = assetId ? promoteAsset(assetId) : null;
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
              ...(imageLink(el) || {}),
              ...cappedAt(importedImageCap(shownWidthPx(el.html, el.box), columnPxFor(currentCell), asset)),
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
                // A layout table's pictures have no box of their own (the
                // table has one); the <img> width attribute is the evidence.
                ...cappedAt(importedImageCap(img.width, columnPxFor(currentCell), asset)),
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
      key,
      name: collapse(page.title) || slug,
      slug,
      sections: mappedSections,
    });
    report.pages.push({
      path: page.path,
      key,
      slug,
      modules: pageModules,
      placeholders: pagePlaceholders,
      builderPageId: null,
    });
  }

  // Nav trees → the Top Menu and Footer Menu (task 86bchydp6). The header
  // tree is preferred for the top menu; the footer menu reads every footer
  // tree — including the plain link lists slice 1 records outside a <nav> —
  // except one already used as the top menu.
  const headerNav =
    menuNavs(ir).find((n) => n.location === "header") ||
    menuNavs(ir)[0] ||
    null;
  let navSeq = 0;
  const flattenNav = (items: NavItem[], prefix: string): MenuNavItem[] => {
    const out: MenuNavItem[] = [];
    const push = (list: NavItem[], parentId: string) => {
      for (const item of list || []) {
        const id = `${prefix}${navSeq++}`;
        out.push({ id, label: collapse(item.label), href: item.href || "#", parentId, target: "" });
        push(item.children || [], id);
      }
    };
    push(items, "");
    return out;
  };
  const navItems: MapOutput["navItems"] = headerNav ? flattenNav(headerNav.items, "impnav_") : [];

  const footerItems: MenuNavItem[] = [];
  const seenFooter = new Set<string>();
  const footerTrees = (ir.taxonomy?.navs || []).filter((n) => n.location === "footer" && n !== headerNav);
  const droppedFooter = new Set<string>();
  for (const tree of footerTrees) {
    for (const item of flattenNav(tree.items, "impfoot_")) {
      // The same top-level link in two footer lists is one menu item, and a
      // dropped item takes its children with it.
      const key = `${item.label.toLowerCase()}|${normalizeHref(item.href)}`;
      if (droppedFooter.has(item.parentId) || (!item.parentId && seenFooter.has(key))) {
        droppedFooter.add(item.id);
        continue;
      }
      seenFooter.add(key);
      footerItems.push(item);
    }
  }

  // The logo goes through the copy plan like any content image, so it lands
  // in the project's library and never points at the client's old server.
  // It is promoted here, on its own, so the repeating-header-image dedupe
  // above (slideshow chrome runs) can never drop it.
  const siteLogo = ir.taxonomy?.logo;
  let menuLogo: MenuLogo | null = null;
  if (siteLogo?.src) {
    const asset = siteLogo.assetId ? promoteAsset(siteLogo.assetId) : null;
    let url = asset ? asset.storageUrl || asset.originalUrl : "";
    if (!url) {
      // Not in the captured manifest: copy it straight from its source on
      // --apply. The page JSON only ever carries the copy.
      const ext = (siteLogo.src.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i) || [])[1] || "";
      if (!promotions.has("site-logo")) {
        promotions.set("site-logo", {
          assetId: "site-logo",
          fromUrl: siteLogo.src,
          originalUrl: siteLogo.src,
          altText: siteLogo.alt || "",
          mimeType: ext ? (ext.toLowerCase() === "svg" ? "image/svg+xml" : `image/${ext.toLowerCase() === "jpg" ? "jpeg" : ext.toLowerCase()}`) : "",
        });
      }
      url = siteLogo.src;
    }
    menuLogo = {
      url,
      alt: siteLogo.alt || asset?.altText || "",
      width: Number(siteLogo.width || asset?.width) || 0,
      height: Number(siteLogo.height || asset?.height) || 0,
      assetId: siteLogo.assetId || "site-logo",
    };
  }

  const menuNotes: string[] = [];
  if (!menuLogo) menuNotes.push("no logo found in the header — the Top Menu is one column, menu only");
  if (!headerNav) menuNotes.push("no header menu found — the Top Menu has no links");
  if (!footerTrees.length) menuNotes.push("no links found in the footer — no Footer Menu");
  else if (!footerItems.length) menuNotes.push("the footer has no links — no Footer Menu");
  if (!menuLogo && !navItems.length) menuNotes.push("no header menu and no logo — no Top Menu");
  const menus: MenuPlan = {
    top: menuLogo || navItems.length ? { items: navItems, logo: menuLogo } : null,
    footer: footerItems.length ? { items: footerItems } : null,
    notes: menuNotes,
  };

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
  for (const item of [...navItems, ...footerItems]) {
    item.href = localizeHref(item.href);
  }
  report.menus = {
    top: menus.top
      ? {
          items: menus.top.items.length,
          topLevel: menus.top.items.filter((i) => !i.parentId).length,
          logo: Boolean(menus.top.logo),
        }
      : null,
    footer: menus.footer ? { items: menus.footer.items.length } : null,
    notes: menus.notes,
  };

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
    menus,
    copyPlan: { crops, assets: Array.from(promotions.values()), sourceOverflows },
    report,
  };
}

/* ---------------------------------------------------------------------------
 * Top Menu + Footer Menu saved sections (task 86bchydp6)
 *
 * Pure, so the script's --apply step is a thin loop over store calls and
 * everything that decides WHAT is written is tested here. Header vs footer
 * is position only: a canonical instance at the front of a page reads as its
 * header, one at the end as its footer (builder-template-frame.ts).
 * ------------------------------------------------------------------------ */

export type MenuKind = "top" | "footer";
export const MENU_SECTION_NAMES: Record<MenuKind, string> = { top: "Top Menu", footer: "Footer Menu" };
/** How tall the logo sits in the Top Menu. The image module sizes by width,
 *  so this becomes a width cap from the logo's own proportions. */
export const TOP_MENU_LOGO_HEIGHT_PX = 80;

type MenuModule = { id: string; type: string; column: string; name: string; text: string; settings: Record<string, string> };
export type MenuSection = {
  id: string;
  title: string;
  layout: string;
  widthMode: string;
  background: { mode: string; color: string; color2: string; imageUrl: string; styleKey: string };
  modules: MenuModule[];
};

/** "https://www.strandsmovie.com/x" → "strandsmovie.com". */
export function menuSiteLabel(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "") || "imported site";
  } catch {
    return "imported site";
  }
}

/** The logo's width cap, so it shows at TOP_MENU_LOGO_HEIGHT_PX tall (or its
 *  own height when smaller) instead of filling the column. */
export function topMenuLogoWidthPx(logo: MenuLogo): number {
  if (logo.width > 0 && logo.height > 0) {
    const shownHeight = Math.min(logo.height, TOP_MENU_LOGO_HEIGHT_PX);
    return Math.max(1, Math.round((logo.width * shownHeight) / logo.height));
  }
  return logo.width > 0 ? Math.min(logo.width, 240) : 240;
}

/**
 * The saved section for one menu, or null when the plan has nothing for it.
 * Top Menu: logo left + menu right ("one-three"); one column when either
 * half is missing. Footer Menu: one column, footer navigation.
 */
export function buildMenuSection(kind: MenuKind, plan: MenuPlan, idBase: string): MenuSection | null {
  const base = String(idBase || "import").replace(/[^a-zA-Z0-9_-]+/g, "");
  const section = (layout: string, modules: MenuModule[]): MenuSection => ({
    id: `impmenu_${kind}_${base}`,
    title: MENU_SECTION_NAMES[kind],
    layout,
    widthMode: "contained",
    background: { mode: "none", color: "", color2: "", imageUrl: "", styleKey: "" },
    modules,
  });
  const nav = (column: string, items: MenuNavItem[], extra: Record<string, string>): MenuModule => ({
    id: `impmenu_${kind}_nav_${base}`,
    type: "navigation",
    column,
    name: MENU_SECTION_NAMES[kind],
    text: "",
    settings: { navItems: JSON.stringify(items), navDirection: "horizontal", menuName: MENU_SECTION_NAMES[kind], ...extra },
  });

  if (kind === "footer") {
    if (!plan.footer?.items.length) return null;
    return section("single", [nav("main", plan.footer.items, { menuLocation: "footer", navAlignment: "center" })]);
  }

  const top = plan.top;
  if (!top) return null;
  const logo = top.logo;
  const logoModule = (column: string): MenuModule => ({
    id: `impmenu_top_logo_${base}`,
    type: "image",
    column,
    name: "Logo",
    text: "",
    settings: {
      url: logo!.url,
      alt: logo!.alt,
      linkUrl: "/",
      size: "100",
      maxWidthPx: String(topMenuLogoWidthPx(logo!)),
    },
  });
  if (logo && top.items.length) {
    return section("one-three", [
      logoModule("left"),
      nav("right", top.items, { menuLocation: "primary", navAlignment: "right" }),
    ]);
  }
  if (logo) return section("single", [logoModule("main")]);
  return section("single", [nav("main", top.items, { menuLocation: "primary", navAlignment: "center" })]);
}

export type MenuTarget = { action: "create" | "update"; id: string; name: string };

/**
 * Which saved section a menu is written to. A section this job created
 * before (its id is in the job's map checkpoint and it still exists) is
 * updated, under whatever name it carries now. Otherwise a NEW one is
 * created under the first name nobody is using — "Top Menu", then
 * "Top Menu (strandsmovie.com)", then "… 2" — so a section the project
 * already has is never written to.
 */
export function planMenuTarget(
  kind: MenuKind,
  existing: { id: string; name: string }[],
  priorId: string,
  siteLabel: string
): MenuTarget {
  const mine = priorId ? existing.find((s) => String(s.id) === String(priorId)) : null;
  if (mine) return { action: "update", id: String(mine.id), name: mine.name || MENU_SECTION_NAMES[kind] };
  const taken = new Set(existing.map((s) => String(s.name || "").trim().toLowerCase()));
  const base = MENU_SECTION_NAMES[kind];
  const candidates = [base, `${base} (${siteLabel})`];
  for (let n = 2; n < 1000; n++) candidates.push(`${base} (${siteLabel}) ${n}`);
  const name = candidates.find((c) => !taken.has(c.toLowerCase())) || `${base} (${siteLabel}) ${Date.now()}`;
  return { action: "create", id: "", name };
}

/**
 * A page's sections with the menus attached as canonical instances: the Top
 * Menu first, the Footer Menu last. A page already carrying an instance of a
 * menu is left as it is for that menu, wherever the instance sits.
 */
export function attachMenuInstances<S extends { id?: string; savedSectionId?: string }>(
  sections: S[],
  pageId: string,
  menus: { top?: { savedSectionId: string; section: MenuSection } | null; footer?: { savedSectionId: string; section: MenuSection } | null }
): { sections: (S | MenuSection & { savedSectionId: string; canonical: true })[]; changed: boolean } {
  const list: (S | (MenuSection & { savedSectionId: string; canonical: true }))[] = [...(sections || [])];
  const has = (id: string) => list.some((s) => (s as { savedSectionId?: string }).savedSectionId === id);
  const pid = String(pageId).replace(/[^a-zA-Z0-9_-]+/g, "");
  let changed = false;
  if (menus.top && !has(menus.top.savedSectionId)) {
    list.unshift({ ...menus.top.section, id: `impmenu_top_inst_${pid}`, savedSectionId: menus.top.savedSectionId, canonical: true });
    changed = true;
  }
  if (menus.footer && !has(menus.footer.savedSectionId)) {
    list.push({ ...menus.footer.section, id: `impmenu_footer_inst_${pid}`, savedSectionId: menus.footer.savedSectionId, canonical: true });
    changed = true;
  }
  return { sections: list, changed };
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
