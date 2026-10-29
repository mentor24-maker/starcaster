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
 *
 * The provider returns a RawCapture — screenshot BINARIES, with element
 * crops keyed by domPath — because the provider knows neither the job's
 * Blob namespace nor the page index that sourceIds embed. The worker
 * uploads the PNGs, re-keys element crops via computeSourceId(pageIdx,
 * domPath), and persists the result as the CaptureResult below. (Spec §1b
 * shows capture() returning CaptureResult directly; this split is the
 * implementation-discovered refinement noted in the spec's deviations.)
 */
export interface CaptureProvider {
  capture(url: string, opts: CaptureOptions): Promise<RawCapture>;
  close(): Promise<void>;
}

export type RawScreenshots = {
  fullPage: Uint8Array;
  /** Per-top-level-section crops, by candidate index in document order. */
  sections: { index: number; png: Uint8Array }[];
  /** Per-element crops for sanitizer-stripped tags, keyed by the element's
   *  domPath (tag/index path from body — see computeSourceId). */
  elements: { domPath: string; png: Uint8Array }[];
};

/** What CaptureProvider.capture() returns: everything in CaptureResult
 *  except the Blob paths, plus the raw screenshot binaries. */
export type RawCapture = Omit<
  CaptureResult,
  "fullPageScreenshot" | "sectionScreenshots" | "elementScreenshots"
> & {
  screenshots: RawScreenshots;
};

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
  | "css-pseudo"   // url() painted by a ::before/::after layer
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

  /**
   * Each stamped element's desktop box, keyed by data-scim id, as
   * [x, y, width, height] in page pixels (scrolled-to-top frame). Desktop
   * capture only; absent on captures made before 2026-10-06, which then
   * import single-column as they always did (see columns.ts).
   */
  rects?: Record<string, [number, number, number, number]>;

  /** Computed background colour of <body> (else <html>); "" when both are
   *  transparent. Desktop only; absent before 2026-10-07. */
  pageBackground?: string;

  /**
   * The ::before / ::after layers that paint something, in stamp order.
   * Desktop only; absent on captures made before task 86bctde48 — a reader
   * must treat that as "not recorded", never as "there were none".
   */
  decorations?: CapturedDecoration[];

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

/**
 * One ::before / ::after layer that visibly paints (task 86bctde48). These
 * are how a stylesheet draws a starfield, a glow ring or a thin line around
 * an element with no element of its own — Alphire's hero is three of them —
 * so the DOM walk never sees them. A pseudo-element that paints nothing (the
 * clearfix `content:""`) is never recorded.
 */
export type CapturedDecoration = {
  /** data-scim key of the element it belongs to. */
  owner: string;
  pseudo: "before" | "after";
  /** The owner as a reader would name it: "section.alphire-hero". */
  label: string;
  /** [x, y, width, height] in page pixels, after any 2D transform — the
   *  area it paints over. */
  box: [number, number, number, number];
  /** [width, height] of the layer itself, before any transform. Differs from
   *  the box only when transformed: Alphire's cyan line is 1px tall, rotated
   *  17°, and its box is 664×204. */
  size: [number, number];
  /**
   * How the box was found. "offsets": a positioned layer, placed from its
   * own top/left/width/height against its containing block — exact for the
   * usual absolute/fixed decoration. "owner": an in-flow layer, which the
   * browser gives no position for, so the box starts at the owner's corner
   * and borrows the owner's size where its own is auto — an approximation.
   */
  boxFrom: "offsets" | "owner";
  /** Computed z-index ("auto" or an integer). With `pseudo` this says
   *  whether it paints under the owner's content (before) or over it. */
  zIndex: string;
  /** The painting properties (DECORATION_STYLE_PROPS), as computed. */
  styles: CapturedStyles;
};

/** A captured decoration, normalized: defaults dropped, pictures joined to
 *  the asset manifest. */
export type DecorationIR = {
  /** Stable within the job, like an element's sourceId. */
  id: string;
  pseudo: "before" | "after";
  /** "section.alphire-hero" — the owner, for a person reading a report. */
  owner: string;
  /** True when the owner is the section's own root box. */
  onSectionRoot: boolean;
  box: { x: number; y: number; w: number; h: number };
  /** The layer's own size before any transform (see CapturedDecoration). */
  size: { w: number; h: number };
  boxFrom: "offsets" | "owner";
  zIndex: string;
  /** Painting properties with browser defaults dropped. */
  styles: CapturedStyles;
  /** AssetRef ids of url() pictures it paints. */
  assetRefs: string[];
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
 *   image    img, picture, and an a[href] whose only
 *            visible content is ONE picture          count, do not descend
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
 * One exception to "(else) … do not count, DESCEND", and the only rule that
 * needs the captured styles: a container whose subtree holds no text and
 * nothing countable, but which paints a background url() over a box of at
 * least 40x40px, counts as one "image" and is not descended. Without it the
 * picture had no element to belong to — Alphire's hero banner was
 * downloaded and never placed (task 86bctde3p). Both counters apply it by
 * passing the desktop styles and rects to the walk.
 *
 * Three consequences worth spelling out:
 *   - A link inside a paragraph is NOT a separate countable — it is part of
 *     that text element's verbatim HTML, so it is preserved, just not
 *     double-counted. Links counted as "link" are the ones reached outside
 *     prose atoms: nav items, footer links, standalone CTAs. A link holding
 *     nothing but one picture is an "image" instead (its link travels with
 *     its HTML) — as a "link" it became a text module that rendered empty
 *     (task 86bcebrwp).
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
  /**
   * Desktop position in page pixels — what column inference (columns.ts)
   * reads. Absent when the capture predates it or the element had no box.
   * A bare text run carries its parent container's box.
   */
  box?: { x: number; y: number; w: number; h: number };
  /**
   * The styled boxes this element sits inside, OUTERMOST first, as keys into
   * its section's `containers` — a band's background, a card's border and
   * shadow. Only ancestors from the section root down that visibly paint
   * something are listed (see normalize.ts paintsSurface). Absent when there
   * are none, and on IRs normalized before 2026-10-07 (task 86bce9wx3).
   */
  containers?: string[];
  /**
   * Set on an "image" that was an EMPTY box painting a background picture
   * (no text, nothing countable inside, at least 40x40px) — how the source
   * site drew its picture, kept for a later fit setting. Its html is the
   * box, not an <img>; the picture is its first assetRef. Absent on real
   * pictures and on IRs normalized before 2026-10-29 (task 86bctde3p).
   */
  backgroundImage?: { size: string; position: string };
};

export type SectionIR = {
  sourceId: string;
  /** NO section-type inference in Phase 1 — always "unknown". */
  type: "unknown";
  /** Blob path of the 1440px section crop ("" when capture had none). */
  screenshot: string;
  elements: ElementIR[];
  /**
   * Surface styles (background, border, radius, shadow, padding — see
   * CONTAINER_STYLE_PROPS) of every container an element's `containers`
   * names, keyed the same way. Absent when the section has none.
   */
  containers?: Record<string, CapturedStyles>;
  /** Where each of those containers sat on the 1440px desktop page, keyed the
   *  same way — how the mapper tells a full-width band from a card. Absent
   *  when the capture recorded no rects. */
  containerBoxes?: Record<string, { x: number; y: number; w: number; h: number }>;
  /** The section root's own surface styles, painted or not — where its
   *  padding comes from when no container paints. Absent when empty. */
  rootStyles?: CapturedStyles;
  /**
   * The ::before/::after layers painted by this section's root or anything
   * inside it. An empty array means the capture looked and found none;
   * ABSENT means it never looked (a capture made before task 86bctde48).
   */
  decorations?: DecorationIR[];
  /**
   * The colour this section showed through to, as captured ("rgb(…)"), when
   * its root paints nothing AND that colour differs from its page's
   * `background` — a transparent section sitting on a painted wrapper the
   * page as a whole does not wear. Absent otherwise, and on IRs normalized
   * before 2026-10-29 (task 86bctde6u).
   */
  ground?: string;
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
  /** Decorations whose owner sits outside every emitted section (a page
   *  wrapper, or a box holding nothing countable). Absent when there are
   *  none, or the capture predates task 86bctde48. */
  decorations?: DecorationIR[];
  /**
   * What this page's content sits on, as captured ("rgb(3, 5, 10)"): the
   * ground under the most content that sits in no painted box of its own —
   * the nearest painted box above its section, else <body>/<html>. Content
   * on a band or card does not vote. The site theme picks ONE surface for every page, so a dark
   * page on a mostly white site (Alphire's home, 2026-10-27) needs its own.
   * Absent when nothing was painted, and on IRs normalized before 2026-10-29
   * (task 86bctde6u).
   */
  background?: string;
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
  /**
   * Set to "footer-links" on a footer tree built from plain link lists
   * outside any <nav> (task 86bchydp2). The mapping step and the reconcile
   * runner skip marked trees: before this slice those links were page
   * content, and reading them as a menu would drop them from the imported
   * page (navConsumed) or promote them to the site's top menu. Slice 2
   * reads them on purpose. Absent on every tree that came from a real <nav>.
   */
  source?: "footer-links";
};

/**
 * The site's logo, as found in its header (task 86bchydp2). `src` is resolved
 * to an absolute URL; `assetId` joins it to the captured asset manifest the
 * way content images join, so a later stage can copy the file into the
 * project. Absent when no header image looked like a logo.
 */
export type SiteLogo = {
  src: string;
  alt: string;
  /** Where the logo's wrapping link points ("" when it has none). */
  href: string;
  width?: number;
  height?: number;
  assetId?: string;
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
    /** The site's header logo. Absent on IRs normalized before 2026-10-13,
     *  and on sites where no header image looked like a logo. */
    logo?: SiteLogo;
    /** Crawl/sitemap order of page paths — the original site's ordering. */
    pageOrder: string[];
  };
  rawTokens: {
    colors: TokenCount[];
    fontSizes: TokenCount[];
    fontFamilies: TokenCount[];
    spacing: TokenCount[];
  };
  /**
   * Role-separated style evidence for the import theme (theme.ts, task
   * 86bce9wx0). rawTokens mixes every colour together; these say WHAT each
   * colour was for. Absent on IRs normalized before 2026-10-07, or when the
   * capture carried no positions — the theme then falls back to rawTokens.
   */
  styleSummary?: StyleSummary;
};

export type StyleSummary = {
  /** <body>/<html> background per page, counted once per page. */
  pageBackgrounds: TokenCount[];
  /** Background colours weighted by the screen area they cover (thousands
   *  of px²) — the big bands of a site, not its badges. */
  backgroundsByArea: TokenCount[];
  /** Background of the site header (<header>, role=banner, *header* near the top). */
  headerBackgrounds: TokenCount[];
  /** Button looks as "fill|text colour|radius px", counted per button. */
  buttons: TokenCount[];
  /** Button looks with what each one sat on, as "fill|text colour|ground
   *  colour" — the ground being the nearest painted ancestor, else the page.
   *  Absent on captures made before task 86bctakk0. */
  buttonsByGround?: TokenCount[];
  /** Widths (px, nearest 10) of content containers — the page column. */
  contentWidths: TokenCount[];
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
