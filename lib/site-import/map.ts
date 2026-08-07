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
  column: "main";
  name: string;
  text: string;
  settings: Record<string, string>;
};

/** Minimal section shape — createPage's document serializer fills every
 *  other BuilderTemplateSection field with defaults. */
export type MappedSection = {
  id: string;
  title: string;
  layout: "single";
  widthMode: "contained";
  background: { mode: "none" | "color"; color: string; color2: string; imageUrl: string; styleKey: "" };
  modules: MappedModule[];
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

export type MapOutput = {
  pages: MappedPage[];
  /** Slideshows this run will create (empty when vetoed). */
  slideshows: SlideshowPlan[];
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
};

/* ---------------------------------------------------------------------------
 * Slug normalization (decision 4 — verified platform facts)
 * ------------------------------------------------------------------------ */

/** Slugs the platform treats as auto-private or reserved — an import must
 *  never emit them (lib/builder-client/public-site-page-slugs.js). */
const RESERVED_SLUG_RE = /^(admin|admin-.*|blog-post-edit|blog-create-post|blog-post-manager|blog-category-manager|crm|home)$/;

/** Builder slugs are single-segment (middleware rewrites /{slug}) and
 *  lowercase. Flatten path separators, ascii-fold, strip the rest. */
export function normalizeImportSlug(irPath: string): string {
  const path = String(irPath || "").trim();
  if (path === "" || path === "/") return "imported-home";
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

function attrFromHtml(html: string, attr: string): string {
  const m = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i").exec(String(html || ""));
  return m ? m[1] : "";
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
      const dispositions = { mapped: 0, placeholder: 0, deduped: 0 };
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

      for (const el of section.elements || []) {
        report.elements.total += 1;
        sourceElementIds.push(el.sourceId);
        if (el.class === "heading" && !firstHeading) firstHeading = collapse(el.textContent);

        const slideshowLead = slideshowLeads.get(el.sourceId);
        if (slideshowLead) {
          flushProse();
          modules.push({
            id: nextModuleId(el.sourceId),
            type: "slideshow",
            column: "main",
            name: "Imported slideshow",
            text: "",
            settings: {
              slides: JSON.stringify(slideshowLead.slides),
              intervalMs: "5000",
              transition: "slide",
              heightPx: "",
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

      if (!modules.length) continue; // nothing mappable (e.g. nav-only section)
      // The first module of every import-owned section carries the section
      // source marker (spec: idempotency + provenance).
      modules[0].settings.importSectionSourceId = section.sourceId;
      mappedSections.push({
        id: `imps_${String(section.sourceId).replace(/[^a-zA-Z0-9]+/g, "")}`,
        title: `Imported: ${firstHeading.slice(0, 60) || "section"}`,
        layout: "single",
        widthMode: "contained",
        background: { mode: "none", color: "", color2: "", imageUrl: "", styleKey: "" },
        modules,
        sourceElementIds,
        dispositions,
      });
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
  for (const irPage of ir.pages || []) {
    const mapped = pages.find((p) => p.irPath === irPage.path);
    if (!mapped) continue;
    const local = `/${mapped.slug}`;
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
