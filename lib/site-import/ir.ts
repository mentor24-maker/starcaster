/**
 * Site Import — the IR (intermediate representation) contract.
 *
 * This ONE file defines every data shape that flows between Site Import's
 * stages: what the capture layer produces (CaptureResult), what the
 * normalizer emits (SiteIR), and how coverage is counted (Coverage plus the
 * counting methodology below). Everything downstream — the worker, the
 * asset ingester, the UI, and the future Builder-mapping phase — depends on
 * these types, so treat any change here as a versioned event: bump
 * IR_VERSION and note the change in docs/site-import/01-capture-and-ir.md.
 *
 * Governing principle (spec §Context): COMPLETENESS OVER FIDELITY. Nothing
 * from the source site may be silently dropped. Every element keeps its
 * original HTML verbatim; anything unclassifiable degrades to class
 * "other", never to nothing.
 */

/** Bump on any breaking change to the shapes in this file. */
export const IR_VERSION = "1.0";

export type ViewportLabel = "desktop" | "tablet" | "mobile";

/* ---------------------------------------------------------------------------
 * Capture layer contract (spec §1b)
 * ------------------------------------------------------------------------ */

export type CaptureOptions = {
  viewport: { width: number; height: number; label: ViewportLabel };
  timeoutMs: number;
  /** Always identifies us: "StarCaster-SiteImport/1.0 (+https://starcaster.pro)" */
  userAgent: string;
};

/**
 * One interface; all downstream code sees only this. Phase 1 ships a local
 * Playwright implementation (capture-playwright.ts). A hosted browser
 * provider slots in later by implementing the same interface.
 */
export interface CaptureProvider {
  capture(url: string, opts: CaptureOptions): Promise<CaptureResult>;
  close(): Promise<void>;
}

/**
 * Computed styles for one element, as captured. Property names are CSS
 * property names ("font-size"), values are the browser's computed values.
 * The capture layer records the full curated set; the normalizer compacts
 * further by dropping browser defaults (see normalize.ts).
 */
export type CapturedStyles = Record<string, string>;

/**
 * How captured styles attach to elements: while walking the live DOM, the
 * capture layer stamps each visible element with a `data-scim="<n>"`
 * attribute BEFORE serializing the HTML, and records that element's
 * computed styles under the same key here. The normalizer joins the two by
 * that attribute. The attribute is an internal artifact — the normalizer
 * strips it from the verbatim HTML it emits.
 */
export type CapturedStylesById = Record<string, CapturedStyles>;

/** Where an asset URL was observed, for later debugging of odd references. */
export type AssetUrlSource =
  | "img"          // <img src>
  | "srcset"       // <img/source srcset> candidate
  | "css-background"
  | "video"        // <video src> / <source>
  | "poster"       // <video poster>
  | "font"         // @font-face / computed font URL
  | "pdf"          // <a href="*.pdf">
  | "favicon"
  | "other";

export type AssetUrlRef = {
  /** Absolute URL as resolved at capture time. */
  url: string;
  via: AssetUrlSource;
  /** data-scim key of the referencing element, when one exists. */
  elementKey?: string;
  /** alt text observed at the reference site (images). */
  alt?: string;
};

/**
 * The persisted output of capturing ONE page at ONE viewport — this exact
 * shape is what lands in Blob at SiteImport/<jobId>/capture/<slug>.<viewport>.json
 * and what the normalizer consumes. Screenshot fields hold Blob paths (the
 * worker uploads the PNG binaries first, then fills these in and persists).
 *
 * Per spec §1b, full capture happens at desktop (1440); tablet/mobile
 * capture rendered HTML + full-page screenshot only, so the style/crop
 * fields are empty objects there.
 */
export type CaptureResult = {
  /** URL requested. */
  url: string;
  /** URL after redirects — what the browser actually rendered. */
  finalUrl: string;
  viewport: ViewportLabel;

  /** Serialized post-JavaScript DOM, with data-scim markers (see above). */
  html: string;

  /** Computed styles keyed by data-scim id. Desktop capture only. */
  styles: CapturedStylesById;

  /** Blob path of the full-page screenshot. */
  fullPageScreenshot: string;
  /**
   * Blob paths of per-top-level-section crops, keyed by section index in
   * document order. Desktop capture only.
   */
  sectionScreenshots: Record<string, string>;
  /**
   * Blob paths of per-element crops, keyed by the element's sourceId —
   * captured for exactly the tags the Builder embed sanitizer strips
   * (form, video, table, iframe/embed, svg, canvas, audio), because for
   * those the screenshot is the placeholder's primary payload in the
   * mapping phase. The capture layer computes sourceIds with the SAME
   * computeSourceId() exported by normalize.ts, so keys line up.
   */
  elementScreenshots: Record<string, string>;

  /** Every asset URL observed on the page (images incl. CSS backgrounds
   *  and srcset candidates, PDFs, videos, fonts). */
  assetUrls: AssetUrlRef[];

  /** Computed font-family values seen on the page, with usage counts. */
  fontFamilies: { value: string; count: number }[];

  /** Page metadata. */
  meta: {
    title: string;
    metaDescription: string;
    ogTags: Record<string, string>;
    canonicalUrl: string;
    lang: string;
  };
};

/* ---------------------------------------------------------------------------
 * The IR itself (spec §1c)
 * ------------------------------------------------------------------------ */

/**
 * COUNTING METHODOLOGY — the single definition both coverage counters use.
 *
 * A "countable element" is what the coverage numbers count: one countable =
 * one unit of content we promise not to lose. Both counters — the
 * captured-side counter (which walks the RAW capture HTML) and the
 * emitted-side counter (which tallies ElementIR entries in the IR) — must
 * follow this walk exactly. It is implemented once, in normalize.ts
 * (walkCountables), and the normalizer builds exactly one ElementIR per
 * countable, which is what guarantees captured == emitted unless something
 * is genuinely lost.
 *
 * Walk the element tree depth-first from <body> (skip <script>, <style>,
 * <template>, <noscript>, <link>, <meta>, comments). At each element,
 * classify by tag/role:
 *
 *   heading  h1–h6                                   count, do not descend
 *   image    img, picture                            count, do not descend
 *   form     form                                    count, do not descend
 *   video    video                                   count, do not descend
 *   embed    iframe, embed, object                   count, do not descend
 *   table    table                                   count, do not descend
 *   other    svg, canvas, audio                      count, do not descend
 *   button   button, input[type=submit|button],
 *            [role=button]                           count, do not descend
 *   text     p, blockquote, pre, dt, dd,
 *            figcaption, address                     count, do not descend
 *   link     a[href] reached during descent          count, do not descend
 *   (else)   any other element (div, section, ul,
 *            li, span, …)                            do not count, DESCEND —
 *            and each direct non-whitespace TEXT RUN of the descended
 *            element counts as one "text" countable
 *
 * Three consequences worth spelling out:
 *   - A link inside a paragraph is NOT a separate countable — it is part of
 *     that text element's verbatim HTML, so it is preserved, just not
 *     double-counted. Links counted as "link" are the ones reached outside
 *     prose atoms: nav items, footer links, linked images, standalone CTAs.
 *   - <li> is a container, not a text atom, so menu markup like
 *     <li><a href=…>About</a></li> yields a "link", while
 *     <li>plain bullet text</li> yields its text run as "text".
 *   - The text-run rule is the completeness fallback: words sitting
 *     directly in a bare <div> (or any other container) are counted and
 *     emitted even though the div itself is not a countable. Content in
 *     weird markup must never fall through the walk.
 *
 * "Do not descend" atoms keep their entire subtree inside their verbatim
 * html field, so nothing under them is lost either — it is simply counted
 * as one unit.
 */
export type ElementClass =
  | "text"
  | "heading"
  | "image"
  | "link"
  | "button"
  | "form"
  | "video"
  | "embed"
  | "table"
  | "other";

export const ELEMENT_CLASSES: ElementClass[] = [
  "text", "heading", "image", "link", "button",
  "form", "video", "embed", "table", "other",
];

export type ElementIR = {
  /**
   * Stable within the job: "<pageIdx>-<domPathHash>", where domPathHash is
   * an FNV-1a hash of the element's tag/index path from <body>. Computed by
   * computeSourceId() in normalize.ts; the capture layer uses the same
   * function so element-screenshot keys match.
   */
  sourceId: string;
  class: ElementClass;
  /** Original outer HTML, verbatim (data-scim markers stripped). */
  html: string;
  textContent: string;
  /**
   * REQUIRED — Builder's module.text caps at 10,000 chars; the mapping
   * phase needs this to know when to split (invariant iii).
   */
  textLength: number;
  /** Compacted computed styles (curated properties, defaults dropped). */
  computedStyles: CapturedStyles;
  /** Index in the page's normalized flow (0-based, page-wide). */
  documentPosition: number;
  /** Nesting depth in the ORIGINAL DOM (body = 0). */
  depth: number;
  /**
   * Blob path of this element's screenshot crop — present for the
   * sanitizer-stripped classes (form, video, embed, table, and svg/canvas/
   * audio "other"s), where the crop is the placeholder's primary payload.
   */
  screenshot?: string;
  /** AssetRef ids this element references (by URL match). */
  assetRefs: string[];
};

export type SectionIR = {
  sourceId: string;
  /** NO section-type inference in Phase 1 — always "unknown". */
  type: "unknown";
  /** Blob path of the 1440px section crop ("" when capture had none). */
  screenshot: string;
  elements: ElementIR[];
};

export type PageIR = {
  url: string;
  /** Path component of url ("/about-us"). Home is "/". */
  path: string;
  title: string;
  metaDescription: string;
  ogTags: Record<string, string>;
  canonicalUrl: string;
  lang: string;
  sections: SectionIR[];
  /** Blob paths of the full-page screenshots per viewport ("" if missing). */
  screenshots: { desktop: string; tablet: string; mobile: string };
};

/** Mirrors an app_site_import_assets row — the IR carries the manifest so
 *  the mapping phase never needs a DB join to resolve an assetRef. */
export type AssetRef = {
  id: string;
  originalUrl: string;
  storageUrl: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  altText: string;
  referencedBy: { pageUrl: string; sourceId: string }[];
  status: "pending" | "downloaded" | "failed" | "skipped_cap";
  error: string;
};

/** One navigation link, possibly with children (nested menus). */
export type NavItem = {
  label: string;
  href: string;
  children: NavItem[];
};

/** One <nav> (or equivalent) found on the site. */
export type NavTree = {
  /** Where it was found: "header" | "footer" | "other". */
  location: string;
  /** Page the tree was extracted from. */
  pageUrl: string;
  items: NavItem[];
};

/** A CSS value with how many elements carry it — raw material for the
 *  theme-extraction stage; no interpretation happens in Phase 1. */
export type TokenCount = { value: string; count: number };

export type SiteIR = {
  irVersion: string;
  jobId: string;
  sourceUrl: string;
  /** ISO timestamp of the capture run (supplied by the worker). */
  capturedAt: string;
  pages: PageIR[];
  assets: AssetRef[];
  taxonomy: {
    navs: NavTree[];
    /** Crawl/sitemap order of page paths — the original site's ordering. */
    pageOrder: string[];
  };
  rawTokens: {
    colors: TokenCount[];
    fontSizes: TokenCount[];
    fontFamilies: TokenCount[];
    spacing: TokenCount[];
  };
};

/* ---------------------------------------------------------------------------
 * Coverage accounting (spec §1c, amendment C)
 * ------------------------------------------------------------------------ */

/** Per-class counts. Classes with zero occurrences are omitted. */
export type CoverageCounts = Partial<Record<ElementClass, number>>;

/**
 * Stored on the job row as `coverage`. "captured" is counted from the raw
 * capture HTML, "emitted" from the IR, both via the counting methodology
 * above. ANY non-empty "dropped" is a bug and must be loudly visible in
 * the UI and the worker log.
 */
export type Coverage = {
  captured: CoverageCounts;
  emitted: CoverageCounts;
  /** captured minus emitted, per class, only where positive. */
  dropped: CoverageCounts;
  pages: { discovered: number; captured: number; failed: number };
  caps: { hit: string[] };
};
