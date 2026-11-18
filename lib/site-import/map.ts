/**
 * Site Import — mapping engine: SiteIR → Builder draft page documents.
 * Spec: docs/site-import/02-mapping.md (ratified 2026-08-06).
 *
 * Pure, no I/O. The runner (scripts/site_import_map.mjs) supplies context
 * (project id, existing slugs, prior run state) and performs every write.
 * COMPLETENESS OVER FIDELITY carries over from Phase 1: every ElementIR
 * must end in exactly one disposition — mapped, placeholder, form,
 * navConsumed, or skipped-with-reason — and the report must reconcile
 * (total === mapped + placeholder + form + navConsumed + humanModified + skipped)
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
 *   form that collects something (forms.ts says data-capture) → form: a
 *                        `crm-form` module carrying an import key; the
 *                        runner builds the Starcaster form and fills its id
 *                        in (task 86bcynjx2). Search/sign-in/payment forms
 *                        stay placeholders, captioned with the reason.
 *   form/table/embed/other → placeholder: `code` module carrying the
 *                        element's screenshot crop; source HTML in
 *                        settings.importSourceHtml (overflow → runner
 *                        uploads to Blob and sets importSourceHtmlUrl)
 */

import * as cheerio from "cheerio";
import { looksLikeHtmlUrl, sameSite } from "./crawl";
import type { AssetRef, ElementIR, NavItem, NavTree, PageIR, SectionIR, SiteIR } from "./ir";
import { readSourceForm, type DataCaptureForm, type FormField } from "./forms";
import { chooseLayout, columnKeys, planSectionGrid, type Cell, type GridKind, type Lockup } from "./columns";
import { contrastRatio, deriveImportTheme, importSurfaceColor, pageTextColors, toHex } from "./theme";
import { isCreditLink } from "./normalize";
import { makePageLink, normalizeAnchorName } from "../builder-client/page-link";
import { matchSectionShape, type SectionShapeLayer } from "../builder-client/section-shape-layer";
import {
  buttonGlowSettings,
  hasPaint,
  imageGlowSettings,
  keepCellFill,
  planBands,
  planCards,
  readSurface,
  type MappedBackground,
  type SurfaceLook,
} from "./surfaces";
export { mergeMappedSections, dropStaleImportSections } from "./columns";
export { deriveImportTheme, nextThemeName, siteNameFromUrl, guardPaletteReadability, uncoveredPaletteRoles, PALETTE_PAIRS } from "./theme";

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
  /**
   * A band that stood much taller than its content (a hero photo with one
   * line of text near its foot): its measured height, in px, and where the
   * content sat in it (task SC-849). Without these the row shrinks to fit the
   * text and the picture behind it becomes a strip.
   */
  minHeight?: string;
  cellVAlign?: Record<string, string>;
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
  /**
   * The section's anchor name (SC-852): rendered as its `id`, so a jump link
   * lands on it. Set only on a section some imported link points at, from
   * the original's own id (task SC-854).
   */
  anchorName?: string;
  /**
   * A curve, wave or slant painted over the band (task SC-859): the
   * original's background mask, matched to the nearest built-in shape.
   */
  shapeLayer?: SectionShapeLayer;
  /** Engine bookkeeping for the runner (stripped before write): */
  sourceElementIds: string[];
  /** How this section's elements were disposed — the runner moves these
   *  to humanModified when the hash guard protects the section. */
  dispositions: { mapped: number; placeholder: number; deduped: number; form: number };
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
  /**
   * The page's own background, when it differs from the import theme's
   * surface — Alphire's near-black home on a site whose theme is white
   * (task 86bctde6u). Absent = the page follows the theme, as before.
   */
  pageBackground?: MappedBackground;
  /** Text colours that read on `pageBackground`; present exactly when it is. */
  textColors?: { text: string; heading: string; link: string };
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

/* ---------------------------------------------------------------------------
 * Downloaded but never placed (task 86bctde7n)
 *
 * The import downloads every picture and document it sees, but only the ones
 * a page actually uses were promoted into the project's Assets. The rest sat
 * in SiteImport/<jobId>/, where no screen shows them: Alphire downloaded 48
 * files and Assets showed 10 (2026-10-27), hero_banner.png among the missing.
 *
 * This picks which leftovers deserve a library row. Fonts are not among them
 * (the font library owns those), nor are failed downloads. WordPress-style
 * size variants ("photo-480x360.jpg" beside "photo.jpg") collapse to ONE row,
 * the largest — and a family any member of which is already promoted gets no
 * row at all, because it is already in Assets once.
 * ------------------------------------------------------------------------- */

const SIZE_SUFFIX = /-(\d+)x(\d+)(?=\.[a-z0-9]+$)/i;

function assetFileUrl(asset: AssetRef): string {
  return String(asset.originalUrl || "").replace(/[#?].*$/, "");
}

function isFontAsset(asset: AssetRef): boolean {
  return /font/i.test(asset.mimeType || "") || /\.(woff2?|ttf|otf|eot)$/i.test(assetFileUrl(asset));
}

function isLibraryKind(asset: AssetRef): boolean {
  const mime = String(asset.mimeType || "").toLowerCase();
  if (mime.startsWith("image/") || mime === "application/pdf") return true;
  return !mime && /\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(assetFileUrl(asset));
}

/** "…/photo-480x360.jpg" and "…/photo.jpg" share one family key. */
export function sizeVariantFamily(originalUrl: string): string {
  return String(originalUrl || "").replace(/[#?].*$/, "").replace(SIZE_SUFFIX, "").toLowerCase();
}

/** Pixel area, from the capture's measurement or the "-WxH" in the name.
 *  The unsuffixed original counts as the largest: it is what the variants
 *  were cut from. */
function variantArea(asset: AssetRef): number {
  if (!SIZE_SUFFIX.test(assetFileUrl(asset))) return Number.POSITIVE_INFINITY;
  if (asset.width && asset.height) return asset.width * asset.height;
  const m = assetFileUrl(asset).match(SIZE_SUFFIX);
  return m ? Number(m[1]) * Number(m[2]) : 0;
}

export function planUnplacedAssets(assets: AssetRef[], promoted: Iterable<AssetPromotion>): AssetPromotion[] {
  const promotedIds = new Set<string>();
  const promotedFamilies = new Set<string>();
  for (const p of promoted) {
    promotedIds.add(p.assetId);
    promotedFamilies.add(sizeVariantFamily(p.originalUrl));
  }
  const families = new Map<string, AssetRef[]>();
  for (const asset of assets || []) {
    if (asset.status !== "downloaded" || !asset.storageUrl) continue;
    if (isFontAsset(asset) || !isLibraryKind(asset)) continue;
    const family = sizeVariantFamily(asset.originalUrl);
    if (promotedIds.has(asset.id) || promotedFamilies.has(family)) continue;
    const members = families.get(family) || [];
    members.push(asset);
    families.set(family, members);
  }
  return Array.from(families.keys()).sort().map((family) => {
    const best = families.get(family)!.slice().sort((a, b) =>
      variantArea(b) - variantArea(a) || (b.byteSize || 0) - (a.byteSize || 0) || a.id.localeCompare(b.id)
    )[0];
    return {
      assetId: best.id,
      fromUrl: best.storageUrl,
      originalUrl: best.originalUrl,
      altText: best.altText || "",
      mimeType: best.mimeType || "",
    };
  });
}

export type MapReport = {
  elements: {
    total: number;
    mapped: number;
    placeholder: number;
    /** Source forms rebuilt as a working Form module (task 86bcynjx2). */
    form: number;
    navConsumed: number;
    /** Slideshow clone-slides and interior-page chrome runs represented by
     *  the homepage slideshow (ratified amendment, task 86bb9xt0y). */
    deduped: number;
    humanModified: number;
    skipped: number;
  };
  skipped: { sourceId: string; class: string; reason: string }[];
  /**
   * Background masks and dividers matched onto a section's shape layer
   * (task SC-859). Present only when a page had one, so a site without any
   * reports exactly as before. Unmatched ones are in `skipped`, with why.
   */
  shapes?: { pagePath: string; sourceId: string; shape: string; what: string }[];
  pages: {
    path: string;
    /** MappedPage.key — unique per page, unlike path. */
    key: string;
    slug: string;
    modules: number;
    placeholders: number;
    builderPageId: string | null;
    /** The page's own background colour, when it wears one (86bctde6u). */
    background?: string;
  }[];
  /** unplaced: downloaded files no page uses, given a library row anyway
   *  (task 86bctde7n). leftInNamespace is what is still only in the job's
   *  namespace after both — fonts, failed downloads, smaller size variants. */
  assets: { promoted: number; unplaced: number; cropsCopied: number; leftInNamespace: number };
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
   * Every form on the source site and what became of it (task 86bcynjx2):
   * rebuilt as a Starcaster form, or left as a picture with the reason.
   * `kept`/`dropped`/`notes` are the reader's (forms.ts) in plain words.
   * The runner fills `outcome` on --apply.
   */
  forms: {
    rebuilt: {
      key: string;
      name: string;
      questions: number;
      pages: string[];
      kept: string[];
      dropped: string[];
      notes: string[];
      outcome?: string;
      formId?: string;
    }[];
    pictures: { pagePath: string; sourceId: string; reason: string }[];
  };
  /**
   * The original's jump links (`#contact-us`) and what became of them (task
   * SC-854): `linked` now point at an imported section, `skipLinks` were
   * "skip to content" links left out on purpose, and `unresolved` lists the
   * rest with the reason, one entry per page and address.
   */
  jumpLinks: {
    linked: number;
    skipLinks: number;
    unresolved: UnresolvedJumpLink[];
    /**
     * Set when the IR predates jump-link capture (SiteIR.anchorsRecorded
     * absent and no element carrying anchors): the ids were never looked for,
     * so `links` same-site jump links could not be matched, and `why` says so
     * and how to refresh it. Those links are NOT in `unresolved` — a per-id
     * "missing" reason there would be false (review of SC-854).
     */
    notRecorded?: { links: number; why: string };
  };
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

/**
 * One source form to rebuild as a Starcaster form (task 86bcynjx2). A form
 * that appears on several pages — a footer sign-up — is ONE plan used on
 * each, because its key is read from what it asks, not where it sits.
 */
export type ImportFormPlan = {
  /** "impform_<hash of the questions and button>" — stable across runs. */
  key: string;
  /** "<page title> form (<source host>)", from the first page it is on. */
  name: string;
  heading: string;
  submitLabel: string;
  fields: FormField[];
  kept: DataCaptureForm["kept"];
  dropped: DataCaptureForm["dropped"];
  notes: DataCaptureForm["notes"];
  /** Button looks read off the source, only where it said: CRM form style keys. */
  styles: { buttonBackgroundColor?: string; buttonTextColor?: string; buttonTextSize?: string; labelPosition?: "above" | "beside" };
  uses: { pageKey: string; pagePath: string; moduleId: string; sourceId: string }[];
};

export type MapOutput = {
  pages: MappedPage[];
  /** Source forms the runner rebuilds before it writes pages. */
  forms: ImportFormPlan[];
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
  /**
   * Every jump link the mapper turned into a link to one imported section
   * (task SC-854), by the address it wrote ("/#contact-us"). Page ids do not
   * exist until --apply writes the pages, so the runner swaps each such
   * address for a stored reference afterwards (referenceSectionLinks).
   */
  sectionLinks: SectionLinkTarget[];
  copyPlan: {
    crops: CropCopy[];
    assets: AssetPromotion[];
    /** Downloaded, placed on no page, still owed an Assets row. */
    unplaced: AssetPromotion[];
    sourceOverflows: SourceOverflow[];
  };
  report: MapReport;
};

/** One imported section a jump link points at. `fallback` is the address the
 *  mapper wrote for it, the page's path plus the section's anchor name. */
export type SectionLinkTarget = {
  fallback: string;
  pageKey: string;
  sectionId: string;
  /** Each link the mapper pointed here, as the original wrote it — so the
   *  runner can list them as leftovers if the section turns out to be one a
   *  person edited (demoteEditedSectionLinks). */
  uses: { page: string; href: string; label: string }[];
};

/** A jump link the import could not point at a section, and why — the
 *  build's leftovers list, so it is never dropped quietly. */
export type UnresolvedJumpLink = { page: string; href: string; label: string; why: string };

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

/**
 * Recognise sections an import built under the OLD naming (task 86bcyrt21).
 *
 * A section id used to start with the page's place in the crawl order
 * (`imps_3<dom>`); it now starts with a hash of the page's address
 * (`imps_p<addr><dom>`). A job built before the change and then normalized
 * again would otherwise see none of its own sections and add a second copy
 * of each. The page is already matched by its write key, so within it a
 * section is the same section when the element-path half — the part that
 * never depended on crawl order — and the band suffix agree. Each mapped
 * section reads its source id off its first module's
 * `importSectionSourceId`, which every import-owned row carries.
 *
 * Returns the live sections with matched ids renamed to the new ones (a
 * copy; nothing else about a section changes) and the old→new map. A
 * section matching more than one old id is left alone rather than guessed.
 */
export function adoptLegacySectionIds<T extends { id: string }>(
  live: T[],
  mapped: { id: string; modules?: { settings?: Record<string, unknown> }[] }[]
): { sections: T[]; renames: Map<string, string> } {
  const strip = (v: string) => v.replace(/[^a-zA-Z0-9]+/g, "");
  const liveIds = new Set(live.map((s) => s.id));
  const mappedIds = new Set(mapped.map((s) => s.id));
  const claimed = new Set<string>();
  const renames = new Map<string, string>();
  for (const m of mapped) {
    if (liveIds.has(m.id)) continue; // already under its new name
    const sourceId = m.modules?.[0]?.settings?.importSectionSourceId;
    if (typeof sourceId !== "string") continue;
    const parts = /^p[0-9a-f]{8}(?:~\d+)?-(.+)$/.exec(sourceId);
    if (!parts) continue;
    const base = `imps_${strip(sourceId)}`;
    if (!m.id.startsWith(base)) continue;
    const tail = strip(parts[1]) + m.id.slice(base.length); // "<dom>" or "<dom>b<band>"
    const candidates = live.filter((s) => {
      if (claimed.has(s.id) || mappedIds.has(s.id)) return false;
      if (!s.id.startsWith("imps_") || !s.id.endsWith(tail)) return false;
      return /^\d+$/.test(s.id.slice(5, s.id.length - tail.length));
    });
    if (candidates.length !== 1) continue;
    claimed.add(candidates[0].id);
    renames.set(candidates[0].id, m.id);
  }
  const sections = renames.size
    ? live.map((s) => (renames.has(s.id) ? { ...s, id: renames.get(s.id) as string } : s))
    : live;
  return { sections, renames };
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
/** A page an earlier build of this import made that has since been deleted. */
export type LeftOutPage = { key: string; slug: string; pageId: string };

/**
 * The --apply page write loop, with the store passed in so it can be tested
 * without a database. Each mapped page is looked up, and recorded, under its
 * OWN key: a page whose key has a prior id is merged into that page, any
 * other page is created.
 *
 * A page the import built that is gone now (`getPage` returns null — only a
 * clean "not found", never a failed read) was deleted by somebody, so it is
 * LEFT OUT, not made again (SC-850: Bayside's author page came back on every
 * rebuild and was deleted by hand each time). Its id stays in `pageIds`, so
 * the next rebuild still knows it was deleted rather than never built.
 * `recreateDeleted` makes them again, on request.
 */
export async function writeMappedPages<S>(
  pages: MappedPage[],
  io: {
    priorPageIds: Record<string, string>;
    prepareSections: (page: MappedPage) => S[];
    getPage: (id: string) => Promise<{ id: string | number; layoutSections?: S[] } | null>;
    createPage: (page: MappedPage, sections: S[]) => Promise<{ id: string | number }>;
    updatePage: (page: MappedPage, current: { id: string | number; layoutSections?: S[] }, merged: S[]) => Promise<{ id: string | number }>;
    mergeSections: (existing: S[], incoming: S[], page: MappedPage) => S[];
    onWrite?: (page: MappedPage, pageId: string, sections: S[], action: PageWrite["action"]) => void;
    recreateDeleted?: boolean;
  }
): Promise<{ pageIds: Record<string, string>; writes: PageWrite[]; leftOut: LeftOutPage[] }> {
  const pageIds: Record<string, string> = { ...io.priorPageIds };
  const writes: PageWrite[] = [];
  const leftOut: LeftOutPage[] = [];
  for (const page of pages) {
    const sections = io.prepareSections(page);
    const existingId = pageIds[page.key];
    // Read the page's CURRENT state at write time — a listing taken at
    // startup is stale by now, and merging against it reverts edits.
    const current = existingId ? await io.getPage(existingId) : null;
    if (existingId && !current && !io.recreateDeleted) {
      leftOut.push({ key: page.key, slug: page.slug, pageId: String(existingId) });
      continue;
    }
    let saved: { id: string | number };
    let action: PageWrite["action"];
    if (current) {
      saved = await io.updatePage(page, current, io.mergeSections(current.layoutSections || [], sections, page));
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
  return { pageIds, writes, leftOut };
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

/**
 * True when a repeated run's blocks sit one above another rather than side by
 * side (SC-858): no block starts before the one above it ends. A row of cards
 * always has two blocks sharing a line — six cards are 3 + 3, never 1 x 6.
 * A block with no recorded position means the answer is unknown, and the run
 * stays a card grid as it always did.
 */
export function blocksStack(groups: { box?: { y: number; h: number } | null }[][]): boolean {
  if (groups.length < 2) return false;
  const spans: { top: number; bottom: number }[] = [];
  for (const group of groups) {
    const boxes = group
      .map((e) => e.box)
      .filter((b): b is { y: number; h: number } => !!b && Number.isFinite(b.y) && Number.isFinite(b.h) && b.h > 0);
    if (!boxes.length) return false;
    spans.push({
      top: Math.min(...boxes.map((b) => b.y)),
      bottom: Math.max(...boxes.map((b) => b.y + b.h)),
    });
  }
  const TOLERANCE_PX = 2;
  return spans.every((span, i) => i === 0 || span.top >= spans[i - 1].bottom - TOLERANCE_PX);
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

/* ---------------------------------------------------------------------------
 * Picture shape (task 86bctde2b)
 * ------------------------------------------------------------------------ */

type ImageShapeSettings = { borderRadius?: string; imageShape?: string; imageShapeRadii?: string };

/** One computed corner length, tidied for the Image module's Custom shape:
 *  whole pixels, percentages to two places. null = not a px/% length. */
function shapeLength(token: string): string | null {
  const m = /^(\d+(?:\.\d+)?)(px|%)$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "px") return `${Math.min(Math.round(n), 9999)}px`;
  return `${Math.min(Math.round(n * 100) / 100, 100)}%`;
}

/**
 * The Image module settings that reproduce a picture's computed
 * `border-radius` (the browser's own value, so `50% 45% 52% 48% / 48% 52%
 * 48% 52%` arrives exactly as alphire.agency wrote its hero blob).
 *
 * - no radius            → Radius 0. Without it the module's 18px default
 *                          rounded every square picture an import brought in.
 * - one small px value   → Rounded, Radius in px (what the panel already had)
 * - fully rounded square → Circle
 * - anything else        → Custom, with the radii carried as written —
 *                          elliptical, per-corner, percentage, pill
 * - unreadable           → nothing (the module's default stands)
 *
 * Exported for the tests, and for whatever places a picture the source
 * painted onto a box (that box's radius is the picture's shape too).
 */
export function importedImageShape(radius: string | undefined, box?: { w: number; h: number } | null): ImageShapeSettings {
  const text = String(radius || "").trim();
  if (!text) return { borderRadius: "0" };
  const halves = text.split("/").map((half) => half.trim().split(/\s+/).filter(Boolean));
  if (halves.length > 2 || halves.some((h) => h.length < 1 || h.length > 4)) return {};
  const tidy = halves.map((h) => h.map(shapeLength));
  if (tidy.some((h) => h.some((t) => t === null))) return {};
  const tokens = tidy.flat() as string[];
  if (tokens.every((t) => parseFloat(t) === 0)) return { borderRadius: "0" };

  const square = Boolean(box && box.w > 0 && Math.abs(box.w - box.h) <= 0.05 * Math.max(box.w, box.h));
  if (tokens.length === 1) {
    const only = tokens[0];
    const n = parseFloat(only);
    const full = only.endsWith("%") ? n >= 50 : Boolean(box && n * 2 >= Math.min(box.w, box.h) - 1);
    if (full && square) return { imageShape: "circle" };
    if (only.endsWith("px") && !full && n <= 80) return { borderRadius: String(n) };
  }
  return { imageShape: "custom", imageShapeRadii: (tidy as string[][]).map((h) => h.join(" ")).join(" / ") };
}

/**
 * Where a picture's shape comes from: the <img> itself, or failing that the
 * box it sits in when that box IS its frame (the same size, give or take a
 * border) — the common `.frame { border-radius; overflow: hidden }` wrapper.
 * A card the picture merely sits inside is a different size and is skipped;
 * its corners are the cell's, not the picture's.
 */
function imageShapeFor(el: ElementIR, section: SectionIR): ImageShapeSettings {
  const own = el.computedStyles?.["border-radius"];
  if (own) return importedImageShape(own, el.box);
  const box = el.box;
  if (box && el.containers?.length) {
    for (const key of [...el.containers].reverse()) {
      const frame = section.containerBoxes?.[key];
      const radius = section.containers?.[key]?.["border-radius"];
      if (!frame || !radius) continue;
      const slack = Math.max(6, 0.03 * Math.max(frame.w, frame.h));
      const fits = Math.abs(frame.w - box.w) <= slack && Math.abs(frame.h - box.h) <= slack;
      if (fits) return importedImageShape(radius, frame);
    }
  }
  return importedImageShape("", box);
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

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/**
 * A logo lockup as one text module's HTML: the picture on the left, its words
 * on the right, centred on each other (task 86bcv0fhh). Builder has no rows
 * inside a column, so this is the only shape in which a logo can sit beside
 * its brand name inside a hero's column. The picture must be one the text
 * module will show — Site Import's own durable copy (rich-text-image.ts,
 * decision A1) — which is why the caller only builds one for a promoted asset.
 */
export function lockupHtml(args: {
  src: string;
  alt: string;
  widthPx: number;
  gapPx: number;
  wordsHtml: string;
  link?: { linkUrl: string; newTab?: "true" } | null;
}): string {
  const w = Math.max(8, Math.round(args.widthPx));
  const gap = Math.min(48, Math.max(4, Math.round(args.gapPx)));
  let img = `<img src="${escapeAttr(args.src)}" alt="${escapeAttr(args.alt)}" width="${w}" style="width:${w}px;max-width:${w}px;height:auto;flex:none;display:block">`;
  if (args.link?.linkUrl) {
    const target = args.link.newTab ? ` target="_blank"` : "";
    img = `<a href="${escapeAttr(args.link.linkUrl)}"${target} style="flex:none;display:block">${img}</a>`;
  }
  return (
    `<div style="display:flex;align-items:center;gap:${gap}px">` +
    img +
    `<div style="min-width:0">${args.wordsHtml}</div>` +
    `</div>`
  );
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

/** What the import theme already says about text — the yardstick for which
 *  text styling the original applied by hand (task 86bctde5z). */
export type ProseThemeLook = {
  /** Heading weight per level, as the theme will paint it. */
  headingWeights: Record<number, number>;
  /** The theme's link colour (hex), or "" when it sets none. */
  linkColor: string;
  /** The theme's heading and body text colours (hex), or "" for none. */
  headingColor?: string;
  textColor?: string;
  /** The page surface the theme paints (hex), or "" when it names none. Text
   *  with no band of its own sits on this, so its own colour is checked
   *  against it (SC-861). */
  surface?: string;
};

/** Below this an element's own colour on a painted band is not trusted to be
 *  readable there (WCAG's large-text floor; headings are what this is for). */
const BAND_TEXT_CONTRAST = 3;
/** Body text on the plain page surface is held to WCAG's normal-text floor,
 *  the same one the theme holds its own text colour to. */
const SURFACE_TEXT_CONTRAST = 4.5;

/** A heading level the theme names no weight for paints at the browser's
 *  own heading weight. */
const DEFAULT_HEADING_WEIGHT = 700;

export function proseThemeLook(theme: { typography?: { scale?: Record<string, number>; colors?: Record<string, string> }; palette?: Record<string, string> }): ProseThemeLook {
  const scale = theme.typography?.scale || {};
  const headingWeights: Record<number, number> = {};
  for (let level = 1; level <= 6; level++) headingWeights[level] = Number(scale[`h${level}Fw`]) || DEFAULT_HEADING_WEIGHT;
  return {
    headingWeights,
    linkColor: toHex(theme.typography?.colors?.link),
    headingColor: toHex(theme.typography?.colors?.heading),
    textColor: toHex(theme.typography?.colors?.text),
    surface: toHex(theme.palette?.surface),
  };
}

/**
 * The element's own colour, when the band it sits on came along and the
 * colour reads on it (task SC-849) — or, with no band, when it reads on the
 * theme's page surface (SC-861; held to 3:1 for a heading, 4.5:1 for text). Bayside Partners' hero heading is white
 * over a photo; the import reproduced the photo, then dropped the white, and
 * the theme painted the heading dark on the dark picture. A picture is
 * trusted as the source showed it; a fill or gradient must clear
 * BAND_TEXT_CONTRAST against every colour it paints. "" otherwise — and
 * always when the colour is the theme's own for that element.
 */
export function ownColorOnBand(el: ElementIR, look: ProseThemeLook, band: MappedBackground | null | undefined): string {
  const own = toHex(el.computedStyles?.color);
  if (!own) return "";
  const isHeading = /^\s*<h[1-6]\b/i.test(String(el.html || "")) || el.class === "heading";
  const isLink = el.class === "link" || /^\s*<a\b/i.test(String(el.html || ""));
  const themeColor = (isHeading ? look.headingColor || look.textColor : isLink ? look.linkColor || look.textColor : look.textColor) || "";
  if (themeColor && own === themeColor) return "";
  if (!band || band.mode === "none") {
    // No band came along: the text sits on the theme's page surface. Its own
    // colour is kept where it reads there (SC-861) — Bayside's black section
    // headings and its blue LinkedIn line had come out in the theme's grey.
    const surface = look.surface || "";
    if (!surface) return "";
    return contrastRatio(own, surface) >= (isHeading ? BAND_TEXT_CONTRAST : SURFACE_TEXT_CONTRAST) ? own : "";
  }
  if (band.mode === "image") return own;
  const fills = [band.color, band.mode === "gradient" ? band.color2 : ""]
    .concat((band.gradientLayers || []).flatMap((layer) => (layer.stops || []).map((s) => s.color)))
    .map((c) => toHex(c))
    .filter(Boolean);
  if (!fills.length) return "";
  return fills.every((fill) => contrastRatio(own, fill) >= BAND_TEXT_CONTRAST) ? own : "";
}

function weightOf(value: string | undefined): number {
  const v = String(value || "").trim().toLowerCase();
  if (v === "bold") return 700;
  const n = Number(v);
  return v && v !== "normal" && Number.isFinite(n) ? n : 400;
}

/** "-3.3696px" → "-3.37px"; "" for normal or a value it cannot read. */
function spacingOf(value: string | undefined): string {
  const m = String(value || "").trim().match(/^(-?[\d.]+)px$/);
  if (!m) return "";
  const n = Math.round(parseFloat(m[1]) * 100) / 100;
  return n ? `${n}px` : "";
}

function withStyle(existing: string | undefined, decls: string[]): string {
  const base = String(existing || "").trim().replace(/;\s*$/, "");
  return [base, ...decls].filter(Boolean).join(";");
}

/**
 * A heading or paragraph's html with the text styling the original applied by
 * hand written inline — so a thin heading on a site whose headings are mostly
 * bold stays thin, and a cyan word stays cyan (task 86bctde5z). The theme
 * carries what is typical; this carries what differs from it.
 *
 * - The element's OWN weight and letter spacing, where they differ from what
 *   the theme paints for that element. Its own colour is kept where it reads
 *   on what it will sit on (ownColorOnBand): the band that came along, else
 *   the theme's page surface (SC-861). The theme rejects colours that cannot
 *   be read on the page's surface, and a white heading from a dark band the
 *   import did not reproduce would otherwise arrive invisible. Links inside
 *   that matched the block take the same colour.
 * - Each word's recorded difference from its parent (`inlineStyles`), except
 *   a link's colour where it is the theme's own link colour.
 *
 * Returns the html unchanged, byte for byte, when nothing differs.
 */
export function styleProseHtml(el: ElementIR, look: ProseThemeLook, band?: MappedBackground | null): string {
  const own = el.computedStyles || {};
  const level = Number((String(el.html || "").match(/^\s*<h([1-6])\b/i) || [])[1]) || 0;
  const rootDecls: string[] = [];
  const bandColor = ownColorOnBand(el, look, band);
  if (bandColor) rootDecls.push(`color:${bandColor}`);
  const weight = weightOf(own["font-weight"]);
  const themeWeight = level ? look.headingWeights[level] || DEFAULT_HEADING_WEIGHT : 400;
  if (weight !== themeWeight) rootDecls.push(`font-weight:${weight}`);
  const spacing = spacingOf(own["letter-spacing"]);
  if (spacing) rootDecls.push(`letter-spacing:${spacing}`);
  const runs = el.inlineStyles || [];
  if (!rootDecls.length && !runs.length) return el.html;

  // Words captured with no tag of their own (a blog excerpt, "on" between two
  // links) have nowhere to carry a weight or colour, so they get an inline
  // <span> — inline, so nothing moves (SC-861: Bayside's excerpts lost their
  // 500 weight). Recorded runs index the element's descendants, which the
  // span wraps unchanged.
  // Wrapped whenever it starts with words, so a run's index counts from the
  // element itself rather than from its first tag.
  const bare = !/^\s*</.test(String(el.html || ""));
  const $ = cheerio.load(bare ? `<span>${el.html}</span>` : el.html, null, false); // fragment mode
  const root = $.root().children().first();
  if (!root.length) return el.html;
  let changed = false;
  if (rootDecls.length) {
    root.attr("style", withStyle(root.attr("style"), rootDecls));
    changed = true;
  }
  const descendants = root.find("*").toArray();
  for (const run of runs) {
    const node = descendants[run.index];
    // Re-parsing the fragment can shift the list (a <div> inside a <p>);
    // a word that is not where the record says is left alone.
    if (!node || ((node as { name?: string }).name || "").toLowerCase() !== run.tag) continue;
    const decls: string[] = [];
    const color = toHex(run.styles.color);
    if (color && !(run.tag === "a" && color === look.linkColor)) decls.push(`color:${color}`);
    if (run.styles["font-weight"]) decls.push(`font-weight:${weightOf(run.styles["font-weight"])}`);
    if (run.styles["font-style"]) decls.push(`font-style:${run.styles["font-style"]}`);
    if (run.styles["letter-spacing"]) decls.push(`letter-spacing:${spacingOf(run.styles["letter-spacing"]) || "normal"}`);
    if (!decls.length) continue;
    $(node).attr("style", withStyle($(node).attr("style"), decls));
    changed = true;
  }
  // A link recorded no colour of its own because it matched its block. When
  // the block's own colour is written inline, the link needs it too: the
  // stylesheet paints every link with the theme's link colour, not the
  // block's (SC-861 — Bayside's blue "Joshua Barrow – LinkedIn" line came out
  // a link in the theme's black, or plain grey where no theme was named).
  if (bandColor) {
    const coloured = new Set(runs.filter((r) => r.tag === "a" && toHex(r.styles.color)).map((r) => r.index));
    descendants.forEach((node, index) => {
      if (((node as { name?: string }).name || "").toLowerCase() !== "a" || coloured.has(index)) return;
      if (/(?:^|;)\s*color\s*:/i.test(String($(node).attr("style") || ""))) return;
      $(node).attr("style", withStyle($(node).attr("style"), [`color:${bandColor}`]));
      changed = true;
    });
  }
  return changed ? $.html() : el.html;
}

const PLACEHOLDER_CLASSES = new Set(["form", "table", "embed", "other"]);

/** FNV-1a 32-bit, hex — the same tiny stable hash normalize.ts uses. */
function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A source form's identity: what it asks and what its button says. Two
 * copies of one footer sign-up hash alike wherever they sit; the markup's own
 * ids (which plugins number per page) play no part (task 86bcynjx2).
 */
export function importFormKey(reading: DataCaptureForm): string {
  const shape = reading.fields.map((f) => [f.key, f.type, f.required ? 1 : 0, f.label, f.options.join("|")].join("~")).join("\n");
  return `impform_${fnv1aHex(`${shape}\n${reading.submitLabel}`)}`;
}

/** A colour the CRM form styles accept (#rrggbb); "" for anything else. */
function formColor(raw: string): string {
  return toHex(raw);
}

/** The submit button's own inline look, where the source wrote one. */
export function submitButtonLook(html: string): ImportFormPlan["styles"] {
  const $ = cheerio.load(html || "");
  const btn = $("input[type=submit], button[type=submit], button:not([type])").first();
  const style = String(btn.attr("style") || "");
  const decl = (name: string): string => {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(style);
    return m ? m[1].replace(/!important/i, "").trim() : "";
  };
  const out: ImportFormPlan["styles"] = {};
  const bg = formColor(decl("background-color")) || formColor(decl("background"));
  if (bg) out.buttonBackgroundColor = bg;
  const fg = formColor(decl("color"));
  if (fg) out.buttonTextColor = fg;
  const size = decl("font-size");
  if (/^\d+(\.\d+)?(px|rem|em)$/.test(size)) out.buttonTextSize = size;
  return out;
}

/** The site's most common button look ("fill|text colour|radius px"), as a fallback. */
function siteButtonLook(ir: SiteIR): ImportFormPlan["styles"] {
  const top = ir.styleSummary?.buttons?.[0]?.value;
  if (!top) return {};
  const [fill, text] = top.split("|");
  const out: ImportFormPlan["styles"] = {};
  const bg = formColor(fill);
  if (bg) out.buttonBackgroundColor = bg;
  const fg = formColor(text);
  if (fg) out.buttonTextColor = fg;
  return out;
}
const PROSE_CLASSES = new Set(["heading", "text", "link"]);

/** An element as the column planner's lockup rule sees it (columns.ts). */
function gridKind(el: ElementIR): GridKind {
  if (el.class === "image") return "image";
  return PROSE_CLASSES.has(el.class) ? "prose" : "other";
}
const DIRECT_MEDIA_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

/* ---------------------------------------------------------------------------
 * The engine
 * ------------------------------------------------------------------------ */

/** Modules that lay out their own columns: a row holding one stays a
 *  single full-width column, or the module would be squeezed into a cell. */
const SELF_COLUMNED_TYPES = new Set(["feature-cards", "carousel"]);

type Dispositions = { mapped: number; placeholder: number; deduped: number; form: number };

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
  at: { first: boolean; last: boolean; rows: number; joinPlain?: boolean }
): void {
  if (!look) return;
  if (look.background) {
    row.background = { ...look.background };
    if (!at.first) row.joinWithPrevious = true;
  } else if (at.joinPlain && !at.first) {
    // One source band split over several rows stays one band even with no
    // paint of its own (SC-849): unjoined, the theme's alternating bands gave
    // Bayside Partners' Services heading row grey and its cards row white.
    row.joinWithPrevious = true;
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

/** Builder's ceiling for a row's minimum height (builder-template.ts). */
const MAX_ROW_MIN_HEIGHT = 1200;

/**
 * A band's measured height, when it stood clearly taller than its content
 * plus padding, and where in it the content sat (task SC-849). Bayside
 * Partners' hero photo is 750px tall with one line of text near its foot;
 * keeping only the band's 54px padding shrank it to a 200px strip. Null when
 * the band was content-sized, or when nothing was measured.
 */
export function bandHeightFor(
  bandBox: { y: number; h: number } | undefined,
  contentBoxes: Array<{ y: number; h: number } | undefined>,
  padTop: number,
  padBottom: number
): { minHeight: string; vAlign: "top" | "center" | "bottom" } | null {
  if (!bandBox || !(bandBox.h > 0)) return null;
  const boxes = contentBoxes.filter((b): b is { y: number; h: number } => Boolean(b && b.h > 0));
  if (!boxes.length) return null;
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const natural = bottom - top + padTop + padBottom;
  // Room for measuring noise and ordinary spacing between modules: only a
  // band with real empty space in it keeps its height.
  if (bandBox.h < natural + 80 || bandBox.h < natural * 1.3) return null;
  const gapTop = top - (bandBox.y + padTop);
  const gapBottom = bandBox.y + bandBox.h - padBottom - bottom;
  const vAlign = gapTop > 2 * gapBottom ? "bottom" : gapBottom > 2 * gapTop ? "top" : "center";
  return { minHeight: String(Math.min(Math.round(bandBox.h), MAX_ROW_MIN_HEIGHT)), vAlign };
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
  /** What a transparent section showed through to, when that is not the
   *  page's own background (SectionIR.ground) — painted on every row no
   *  band paints. */
  ground: MappedBackground | null;
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
        const look = args.bandLookOf(key);
        applyBand(row, look, { first: i === start, last: i === end, rows: end - start + 1, joinPlain: true });
        // A band that is this one row keeps its height (SC-849). A band split
        // over several rows is left content-sized: which row would take the
        // empty space is a guess.
        if (start === end) {
          const byId = new Map((section.elements || []).map((el) => [el.sourceId, el]));
          const tall = bandHeightFor(
            section.containerBoxes?.[key],
            row.sourceElementIds.map((id) => byId.get(id)?.box),
            Number(look?.padding.top) || 0,
            Number(look?.padding.bottom) || 0
          );
          if (tall) {
            row.minHeight = tall.minHeight;
            if (tall.vAlign !== "top") {
              const keys = layout === "single" ? ["main"] : columnKeys(cols.length);
              row.cellVAlign = Object.fromEntries(keys.map((k) => [k, tall.vAlign]));
            }
          }
        }
      }
    } else {
      applyBand(row, args.rootLook, { first: i === 0, last: i === bands.length - 1, rows: bands.length });
    }
    if (row.background.mode === "none" && args.ground) row.background = { ...args.ground };
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
    first.dispositions.form += d.form;
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
  // The header menu's own pairs, to recognise the section the Top Menu is
  // built from (setAside below).
  const headerNavPairs = new Set<string>();
  for (const nav of menuNavs(ir).filter((n) => n.location === "header")) {
    const walk = (items: NavItem[]) => {
      for (const item of items || []) {
        headerNavPairs.add(`${collapse(item.label).toLowerCase()}|${normalizeHref(item.href)}`);
        walk(item.children || []);
      }
    };
    walk(nav.items);
  }
  const linkPair = (el: ElementIR) =>
    `${collapse(el.textContent).toLowerCase()}|${normalizeHref(attrFromHtml(el.html, "href"))}`;
  const logoTaxonomy = ir.taxonomy?.logo;

  /**
   * A CSS-painted box that is a site builder's background mask (task SC-859):
   * Divi's `et_pb_background_mask` and anything like it — an SVG drawing as
   * the box's background, covering the whole band. Matched onto the band's
   * shape layer when it can be; when it cannot, still set aside, with a
   * reason naming the mask so the report says what was lost.
   *
   * A box much smaller than its band is a divider along one edge, not a
   * full-band shape, and a full-band shape would paint it far too big, so it
   * is named rather than guessed.
   *
   * Null when the box is not an SVG background at all — the caller then
   * skips it as "nothing to show", exactly as before.
   */
  const readShapeMask = (section: SectionIR, el: ElementIR): Aside | null => {
    const styles = (el.computedStyles || {}) as Record<string, string>;
    const bg = String(styles["background-image"] || "");
    if (!/data:image\/svg\+xml/i.test(bg)) return null;
    const containers = el.containers || [];
    const container = containers[containers.length - 1] || "";
    const band = container ? section.containerBoxes?.[container] : undefined;
    const lost = (why: string): Aside => ({
      navConsumed: false,
      reason: `a background shape (a mask drawn by CSS) that was not carried over — ${why}`,
    });
    // Without both boxes there is no telling a full-band mask from a thin
    // divider along one edge, and guessing "full band" paints a divider over
    // the whole row — so refuse, and say why.
    if (!el.box || !(el.box.w > 0) || !(el.box.h > 0) || !band || !(band.w > 0) || !(band.h > 0)) {
      return lost("its size or its band's size was not measured, so it cannot be told apart from a divider along one edge");
    }
    const cover = (el.box.w * el.box.h) / (band.w * band.h);
    if (cover < 0.9) {
      return lost(`it covers ${Math.round(cover * 100)}% of its band, so it is a divider along an edge, and only full-band shapes are matched`);
    }
    const match = matchSectionShape(bg, String(styles.transform || ""));
    if (!match.ok) return lost(match.reason);
    return { navConsumed: false, reason: "", shape: { layer: match.layer, container, note: match.note } };
  };

  /**
   * Elements that must not reach the page and must not shape its layout,
   * decided before columns are read (task SC-849, Bayside Partners):
   *
   * - The header the Top Menu is built from. Its links were already consumed;
   *   its logo picture and its hidden phone-menu leftovers were poured as
   *   content too, so the page showed the logo twice and Divi's "Select Page"
   *   label. With menus on, a section holding header-menu links gives up the
   *   site logo (the Top Menu shows it) and any short text the capture saw no
   *   position for — hidden on a desktop screen, which in a header is the
   *   phone menu. Visible header text that is not the menu stays.
   * - An "image" with nothing to show: a box painted only by CSS (Divi's
   *   `et_pb_background_mask`, an SVG drawn as a background). It became an
   *   image module with an empty address, and because it spanned the whole
   *   band it stopped the contact text and form being read as two columns.
   * - Prose that is nothing but markup (`<p><!-- /divi:paragraph --></p>`),
   *   which was merged into the heading before it. Not `<p>&nbsp;</p>`: that
   *   blank line is spacing the author typed (the Delray fixture has 46).
   *
   * Each is accounted: the logo as navConsumed, the rest skipped with a reason.
   */
  type Aside = { navConsumed: boolean; reason: string; shape?: { layer: SectionShapeLayer; container: string; note: string } };
  const setAside = (section: SectionIR): Map<string, Aside> => {
    const out = new Map<string, Aside>();
    const els = section.elements || [];
    const measured = els.some((el) => el.box && el.box.w > 0);
    const isHeader =
      menusOn && headerNavPairs.size > 0 && els.some((el) => el.class === "link" && headerNavPairs.has(linkPair(el)));
    for (const el of els) {
      if (isHeader && el.class === "image" && logoTaxonomy?.src) {
        const assetId = shownAssetId(el, assetsById);
        const src = attrFromHtml(el.html, "src");
        if ((logoTaxonomy.assetId && assetId === logoTaxonomy.assetId) || (src && src === logoTaxonomy.src)) {
          out.set(el.sourceId, { navConsumed: true, reason: "" });
          continue;
        }
      }
      if (isHeader && measured && !el.box && PROSE_CLASSES.has(el.class) && el.class !== "link") {
        const words = collapse(el.textContent);
        if (words.length <= 40) {
          out.set(el.sourceId, {
            navConsumed: false,
            reason: `hidden in the header on a desktop screen ("${words}") — the site's phone-menu chrome; the Top Menu replaces that menu`,
          });
          continue;
        }
      }
      // Elementor's shape divider (`<div class="elementor-shape …"><svg>`):
      // its colour lives in the site's stylesheet, which the capture does
      // not record, so a match would guess the colour. Named, not guessed
      // (SC-859); poured as content it was a stray picture over the band.
      if (/^\s*<div\b[^>]*\bclass\s*=\s*"[^"]*\belementor-shape\b/i.test(String(el.html || ""))) {
        out.set(el.sourceId, {
          navConsumed: false,
          reason:
            "a background shape (an Elementor shape divider) that was not carried over — its colour is set by the site's stylesheet, which the capture does not record",
        });
        continue;
      }
      if (
        el.class === "image" &&
        !shownAssetId(el, assetsById) &&
        !attrFromHtml(el.html, "src") &&
        !/<(img|svg|picture|video|canvas)\b/i.test(el.html)
      ) {
        const shape = readShapeMask(section, el);
        if (shape) {
          out.set(el.sourceId, shape);
          continue;
        }
        out.set(el.sourceId, {
          navConsumed: false,
          reason: "an image box with no picture in it — painted only by CSS (a background layer or mask), nothing to show",
        });
        continue;
      }
      // Nothing at all between the tags once comments are gone. A deliberate
      // blank line (`<p>&nbsp;</p>`) is spacing its author typed, and stays.
      const bare = String(el.html || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
      if (PROSE_CLASSES.has(el.class) && /^[ \t\r\n]*$/.test(bare) && !/<(img|svg|picture|video|iframe|br)\b/i.test(el.html)) {
        out.set(el.sourceId, { navConsumed: false, reason: "nothing but markup — empty markup the site builder left behind" });
      }
    }
    return out;
  };
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
  // The same theme --apply creates from this capture: text that matches it
  // needs nothing inline, text that does not keeps its own look.
  const proseLook = proseThemeLook(deriveImportTheme(sourceIr, ""));
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
    elements: { total: 0, mapped: 0, placeholder: 0, form: 0, navConsumed: 0, deduped: 0, humanModified: 0, skipped: 0 },
    skipped: [],
    pages: [],
    assets: { promoted: 0, unplaced: 0, cropsCopied: 0, leftInNamespace: 0 },
    repeatCaptures,
    placeholderPatterns: [],
    forms: { rebuilt: [], pictures: [] },
    jumpLinks: { linked: 0, skipLinks: 0, unresolved: [] },
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
  /** MappedPage.key → the IR page it was mapped from (jump links, SC-854). */
  const irPageOfKey = new Map<string, PageIR>();

  let moduleSeq = 0;
  const nextModuleId = (sourceId: string) =>
    `impm_${String(sourceId).replace(/[^a-zA-Z0-9]+/g, "")}_${moduleSeq++}`;

  // Source forms → one plan per distinct form (task 86bcynjx2).
  const formPlans = new Map<string, ImportFormPlan>();
  const sourceHost = menuSiteLabel(ir.sourceUrl || "");
  const siteButton = siteButtonLook(ir);
  const planFor = (reading: DataCaptureForm, el: ElementIR, page: PageIR): ImportFormPlan => {
    const key = importFormKey(reading);
    const found = formPlans.get(key);
    if (found) return found;
    const title = collapse(page.title || "") || (page.path === "/" ? "Home" : page.path);
    const plan: ImportFormPlan = {
      key,
      name: `${title} form (${sourceHost})`,
      heading: reading.heading || "",
      submitLabel: reading.submitLabel || "Submit",
      fields: reading.fields,
      kept: reading.kept,
      dropped: reading.dropped,
      notes: reading.notes,
      // Where the labels sit is read off the form itself (SC-860); a form
      // read before it existed has no answer and keeps the form's default.
      styles: { ...siteButton, ...submitButtonLook(el.html), ...(reading.labelPosition ? { labelPosition: reading.labelPosition } : {}) },
      uses: [],
    };
    formPlans.set(key, plan);
    return plan;
  };

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
  /** Elements of a run declined because its blocks stack (SC-858) → which
   *  block they belong to, so the column planner keeps one row per block. */
  const stackedRowOf = new Map<string, string>();
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
      // A row of cards sits side by side. Blocks that sit one above another
      // are a list — Bayside's Services, four icon-beside-text rows, came out
      // as four squeezed tall cards (SC-858). Each block keeps its own row.
      if (blocksStack(groups)) {
        groups.forEach((group, gi) => {
          for (const el of group) stackedRowOf.set(el.sourceId, `${groups[0][0].sourceId}#${gi}`);
        });
        continue;
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
    // A page whose content sits on a colour other than the theme's surface
    // wears that colour itself, with text that reads on it (task 86bctde6u).
    // Bands and cards on it are then judged against IT: a band painted the
    // page's colour is redundant, a white one on a dark page is not.
    const pageGround = toHex(page.background);
    const ownGround = Boolean(pageGround && surfaceColor && pageGround !== surfaceColor);
    const pageSurface = ownGround ? pageGround : surfaceColor;

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
      // Set-aside elements (setAside) are accounted in the loop below but
      // play no part in bands, cards or columns.
      const asideOf = setAside(section);
      const sectionEls = (section.elements || []).filter((el) => !asideOf.has(el.sourceId));
      const containerStyles = section.containers || {};
      const rowCtx = { surface: pageSurface, resolveImage: resolveBackgroundImage, maxPadding: 160 };
      const sectionGround = toHex(section.ground);
      const ground: MappedBackground | null =
        sectionGround && sectionGround !== pageSurface
          ? { mode: "color", color: sectionGround, color2: "", imageUrl: "", styleKey: "" }
          : null;
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
      /** What paints behind an element once imported: its band's background,
       *  else the section's ground — for keeping its own colour (SC-849). */
      const backdropOf = (sourceId: string): MappedBackground | null => {
        const key = bandOf.get(sourceId);
        const look = key ? bandLookOf(key) : null;
        return look?.background || ground;
      };
      const draft = planSectionGrid(
        sectionEls.map((el) => ({ id: el.sourceId, box: el.box, group: bandOf.get(el.sourceId), kind: gridKind(el) }))
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
          row: stackedRowOf.get(el.sourceId),
          kind: gridKind(el),
        }))
      );
      // Logo lockups inside a cell (task 86bcv0fhh): every member → its lockup.
      const lockupOf = new Map<string, Lockup>();
      for (const lockup of grid.lockups) {
        for (const id of [lockup.image, ...lockup.texts]) lockupOf.set(id, lockup);
      }
      /** Lockups already poured into a module, and ones that could not be. */
      const lockupsPoured = new Set<Lockup>();
      const lockupsRefused = new Set<Lockup>();
      const elementById = new Map((section.elements || []).map((el) => [el.sourceId, el]));
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
              surface: onBand ? "" : pageSurface,
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
      const boxes = sectionEls.map((el) => el.box).filter((b) => b && b.w >= 2);
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
      const bandDispositions = new Map<number, Dispositions>();
      const dispositionsFor = (band: number) => {
        const found = bandDispositions.get(band);
        if (found) return found;
        const fresh = { mapped: 0, placeholder: 0, deduped: 0, form: 0 };
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

      const pendingShapes: { el: ElementIR; shape: NonNullable<Aside["shape"]> }[] = [];
      for (const el of section.elements || []) {
        const cell = grid.cells.get(el.sourceId) || currentCell;
        if (cell.band !== currentCell.band || cell.col !== currentCell.col) {
          flushProse();
          tagNewModules();
          currentCell = cell;
          dispositions = dispositionsFor(cell.band);
        }
        report.elements.total += 1;
        // Set aside: counted in the report, never filed under a row — it has
        // no cell, and a row it was filed under would read its box and band.
        const aside = asideOf.get(el.sourceId);
        if (!aside) sourceElementIds.push(el.sourceId);
        if (aside) {
          if (aside.shape) {
            // Counted only once a row actually takes it (below) — a band with
            // nothing carried over has no row to hold it, and reporting it as
            // landed then would be a success line over a dropped shape.
            pendingShapes.push({ el, shape: aside.shape });
          } else if (aside.navConsumed) {
            report.elements.navConsumed += 1;
          } else {
            report.elements.skipped += 1;
            report.skipped.push({ sourceId: el.sourceId, class: el.class, reason: aside.reason });
          }
          continue;
        }
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

        const lockup = lockupOf.get(el.sourceId);
        if (lockup && lockupsPoured.has(lockup)) {
          // Represented by the lockup module its first member became.
          report.elements.mapped += 1;
          dispositions.mapped += 1;
          continue;
        }
        if (lockup && !lockupsRefused.has(lockup)) {
          const members = [lockup.image, ...lockup.texts].map((id) => elementById.get(id));
          const pic = members[0];
          const words = members.slice(1);
          const special = (id: string) =>
            slideshowLeads.has(id) || slideshowConsumed.has(id) || cardGridLeads.has(id) || cardGridConsumed.has(id);
          const assetId = pic && pic.class === "image" ? shownAssetId(pic, assetsById) : undefined;
          const asset = assetId ? assetsById.get(assetId) : undefined;
          const plain =
            pic &&
            words.every((w) => w && PROSE_CLASSES.has(w.class) && !isCreditOnly(w)) &&
            ![lockup.image, ...lockup.texts].some(special);
          // Only a picture the text module will show: one Site Import copies
          // into its own folder. Anything else stays a separate image module,
          // stacked above the words as before — never a logo silently dropped.
          if (plain && asset?.storageUrl) {
            flushProse();
            promoteAsset(assetId as string);
            modules.push({
              id: nextModuleId(pic.sourceId),
              type: "text",
              column: "main",
              name: "Imported logo and name",
              text: lockupHtml({
                src: asset.storageUrl,
                alt: attrFromHtml(pic.html, "alt") || asset.altText || "",
                widthPx: Math.min(shownWidthPx(pic.html, pic.box) || pic.box?.w || 64, 160),
                gapPx: lockup.gapPx,
                wordsHtml: words.map((w) => styleProseHtml(w as ElementIR, proseLook, backdropOf((w as ElementIR).sourceId))).join(""),
                link: imageLink(pic),
              }),
              settings: { importSourceIds: [lockup.image, ...lockup.texts].join(",") },
            });
            lockupsPoured.add(lockup);
            report.elements.mapped += 1;
            dispositions.mapped += 1;
            continue;
          }
          lockupsRefused.add(lockup);
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
          const html = styleProseHtml(el, proseLook, backdropOf(el.sourceId));
          // Oversize ladder before merging.
          if (html.length > TEXT_MODULE_CHAR_BUDGET) {
            flushProse();
            const split = splitOversizeHtml(html, TEXT_MODULE_CHAR_BUDGET);
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
          if (prose.html.length + html.length > TEXT_MODULE_CHAR_BUDGET) flushProse();
          prose.html += html;
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
              ...imageGlowSettings(el.computedStyles),
              ...imageShapeFor(el, section),
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
              ...buttonGlowSettings(el.computedStyles),
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

        if (el.class === "form") {
          flushProse();
          const reading = readSourceForm(el.html);
          if (reading.kind === "data-capture" && reading.fields.length) {
            const plan = planFor(reading, el, page);
            const moduleId = nextModuleId(el.sourceId);
            modules.push({
              id: moduleId,
              type: "crm-form",
              column: "main",
              name: "Imported form",
              text: "",
              // crmFormId is filled by the runner once the form exists (link
              // by id, landmine 19); importFormKey is how it finds which one.
              settings: { crmFormId: "", importFormKey: plan.key, importSourceId: el.sourceId },
            });
            plan.uses.push({ pageKey: key, pagePath: page.path, moduleId, sourceId: el.sourceId });
            report.elements.form += 1;
            dispositions.form += 1;
            continue;
          }
          const why = reading.kind === "not-data-capture"
            ? reading.reason
            : "no question in it could be read";
          report.forms.pictures.push({ pagePath: page.path, sourceId: el.sourceId, reason: why });
          const search = /search box/.test(why) ? "; rebuild it with the Site Search module" : "";
          pushPlaceholder(el, `Imported form left as a picture — ${why}${search}.`);
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

      const skipShape = (el: ElementIR, why: string) => {
        report.elements.skipped += 1;
        report.skipped.push({
          sourceId: el.sourceId,
          class: el.class,
          reason: `a background shape (a mask drawn by CSS) that was not carried over — ${why}`,
        });
      };
      if (!modules.length) {
        // nothing mappable (e.g. nav-only section)
        for (const { el } of pendingShapes) skipShape(el, "nothing else in its band was carried over, so there is no row to put it on");
        continue;
      }
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
        ground,
        cardLookOf,
      });
      // A matched background mask (SC-859) goes on the row holding the
      // elements of the band it painted. A band split into several rows gets
      // it on the FIRST: one shape over the top row reads as the original far
      // better than the same curve repeated on every row. A row holds one
      // shape, so a second mask landing on a row that already has one is
      // reported as not carried over rather than quietly overwriting it.
      for (const { el, shape } of pendingShapes) {
        const inBand = new Set(
          (section.elements || [])
            .filter((e) => (e.containers || []).includes(shape.container))
            .map((e) => e.sourceId)
        );
        const row = built.find((r) => r.sourceElementIds.some((id) => inBand.has(id))) || built[0];
        if (!row) {
          skipShape(el, "no row was built to put it on");
          continue;
        }
        if (row.shapeLayer) {
          skipShape(el, `the row it belongs on already carries another shape (${row.shapeLayer.shape}), and a row holds one`);
          continue;
        }
        row.shapeLayer = shape.layer;
        report.elements.mapped += 1;
        row.dispositions.mapped += 1;
        (report.shapes ||= []).push({
          pagePath: page.path,
          sourceId: el.sourceId,
          shape: shape.layer.shape,
          what: shape.note,
        });
      }
      mappedSections.push(...built);
      pageModules += modules.length;
    }

    const slug = uniqueSlug(normalizeImportSlug(page.path), takenSlugs);
    irPageOfKey.set(key, page);
    pages.push({
      irPath: page.path,
      key,
      name: collapse(page.title) || slug,
      slug,
      sections: mappedSections,
      ...(ownGround
        ? {
            pageBackground: { mode: "color" as const, color: pageGround, color2: "", imageUrl: "", styleKey: "" as const },
            textColors: pageTextColors(page, pageGround),
          }
        : {}),
    });
    report.pages.push({
      path: page.path,
      key,
      slug,
      modules: pageModules,
      placeholders: pagePlaceholders,
      builderPageId: null,
      ...(ownGround ? { background: pageGround } : {}),
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
  /** Menu item id → the page its menu was captured on, which a bare
   *  "#about-us" in it is relative to (SC-854). */
  const navBaseUrl = new Map<string, string>();
  const flattenNav = (items: NavItem[], prefix: string, pageUrl = ""): MenuNavItem[] => {
    const out: MenuNavItem[] = [];
    const push = (list: NavItem[], parentId: string) => {
      for (const item of list || []) {
        const id = `${prefix}${navSeq++}`;
        if (pageUrl) navBaseUrl.set(id, pageUrl);
        out.push({ id, label: collapse(item.label), href: item.href || "#", parentId, target: "" });
        push(item.children || [], id);
      }
    };
    push(items, "");
    return out;
  };
  const navItems: MapOutput["navItems"] = headerNav ? flattenNav(headerNav.items, "impnav_", headerNav.pageUrl) : [];

  const footerItems: MenuNavItem[] = [];
  const seenFooter = new Set<string>();
  const footerTrees = (ir.taxonomy?.navs || []).filter((n) => n.location === "footer" && n !== headerNav);
  const droppedFooter = new Set<string>();
  for (const tree of footerTrees) {
    for (const item of flattenNav(tree.items, "impfoot_", tree.pageUrl)) {
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

  // --- Jump links (task SC-854) -------------------------------------------
  // A link to "#contact-us" — or "/about#team" from another page — points at
  // the imported section the original's id landed on (ElementIR.anchors).
  // That section is given the id as its anchor name and the link becomes
  // "<page path>#<anchor name>"; the runner then stores it by reference once
  // page ids exist. A link the import cannot point anywhere is listed in
  // report.jumpLinks.unresolved, never dropped quietly. "Skip to content"
  // links are left out: the site-wide skip link is its own ticket.
  type PageAnchors = { mapped: MappedPage; local: string; byId: Map<string, MappedSection> };
  const anchorsByAddress = new Map<string, PageAnchors>();
  for (const mapped of pages) {
    const irPage = irPageOfKey.get(mapped.key);
    if (!irPage) continue;
    const sectionOf = new Map<string, MappedSection>();
    for (const section of mapped.sections) {
      for (const id of section.sourceElementIds) if (!sectionOf.has(id)) sectionOf.set(id, section);
    }
    const elements = (irPage.sections || [])
      .flatMap((s) => s.elements || [])
      .sort((a, b) => a.documentPosition - b.documentPosition);
    const byId = new Map<string, MappedSection>();
    // An id that landed on something the import did not place (a menu link
    // the Top Menu consumed, a skipped label) lands on the next thing it did.
    let pending: string[] = [];
    for (const el of elements) {
      if (el.anchors?.length) pending.push(...el.anchors);
      const section = sectionOf.get(el.sourceId);
      if (!section || !pending.length) continue;
      for (const id of pending) if (!byId.has(id)) byId.set(id, section);
      pending = [];
    }
    const entry: PageAnchors = { mapped, local: isRootPath(irPage.path) ? "/" : `/${mapped.slug}`, byId };
    for (const raw of [irPage.url, irPage.path]) {
      const v = String(raw || "").trim();
      if (!v) continue;
      for (const variant of [v, v.endsWith("/") ? v.slice(0, -1) : `${v}/`]) {
        if (variant && !anchorsByAddress.has(variant)) anchorsByAddress.set(variant, entry);
      }
    }
  }
  const pageAnchorsFor = (abs: URL): PageAnchors | undefined => {
    const bare = new URL(abs.href);
    bare.hash = "";
    for (const v of [bare.href, bare.pathname]) {
      const hit = anchorsByAddress.get(v) || anchorsByAddress.get(v.endsWith("/") ? v.slice(0, -1) : `${v}/`);
      if (hit) return hit;
    }
    return undefined;
  };
  /** A section's anchor name, given on first use and unique on its page. */
  const anchorNameFor = (entry: PageAnchors, section: MappedSection, id: string): string => {
    if (section.anchorName) return section.anchorName;
    const taken = new Set(entry.mapped.sections.map((s) => s.anchorName).filter(Boolean));
    const base = normalizeAnchorName(id) || "section";
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    section.anchorName = name;
    return name;
  };
  const sectionLinks = new Map<string, SectionLinkTarget>();
  /** Did the normalizer look for ids at all? An IR from before SC-854 has
   *  neither the flag nor a single filed anchor. */
  const anchorsLooked =
    ir.anchorsRecorded === true ||
    (ir.pages || []).some((p) => (p.sections || []).some((s) => (s.elements || []).some((el) => el.anchors?.length)));
  let notRecordedLinks = 0;
  const unresolvedSeen = new Set<string>();
  const leftUnresolved = (onPage: string, href: string, label: string, why: string) => {
    const key = `${onPage}\u0000${href}`;
    if (unresolvedSeen.has(key)) return;
    unresolvedSeen.add(key);
    report.jumpLinks.unresolved.push({ page: onPage, href, label: collapse(label).slice(0, 80), why });
  };
  /**
   * One link, rewritten for the imported site. `baseUrl` is the original page
   * the link sat on; `onPage` names that page in the leftovers list. `drop`
   * means leave the link out (a skip link) — the caller keeps its text.
   */
  const localizeLink = (href: string, baseUrl: string, label: string, onPage: string): { href: string; drop?: boolean } => {
    const raw = String(href || "").trim();
    const at = raw.indexOf("#");
    if (at === -1) return { href: localizeHref(raw) };
    const hash = raw.slice(at + 1);
    // A text fragment ("#:~:text=…") highlights words; it is not a place.
    if (hash.startsWith(":~:")) return { href: localizeHref(raw) };
    // "#" alone is a menu toggle, "#!/x" a script's route: not a place.
    if (!hash || hash.startsWith("!") || hash.startsWith("/")) return { href: at === 0 ? raw : localizeHref(raw.slice(0, at)) };
    let abs: URL;
    try {
      abs = new URL(raw, baseUrl || ir.sourceUrl);
    } catch {
      return { href: raw };
    }
    if (!sameSite(abs.href, ir.sourceUrl)) return { href: raw };
    // "/files/menu.pdf#page=3" opens a file at a page: an asset, left alone
    // exactly as before jump links were read.
    if (!looksLikeHtmlUrl(abs.href)) return { href: localizeHref(raw) };
    let id = hash;
    try {
      id = decodeURIComponent(hash);
    } catch {
      /* keep it as written */
    }
    // Read by its words first: "Skip to content" is a skip link wherever it
    // jumps. By its id ("#main", "#content") only when nothing the import
    // built carries that id — a designed link to a section named "content"
    // is a real link (review of SC-854).
    if (isSkipLabel(label)) {
      report.jumpLinks.skipLinks += 1;
      return { href: "", drop: true };
    }
    // Every browser scrolls "#top" to the top of the page by itself.
    if (id.toLowerCase() === "top") return { href: at === 0 ? "#top" : `${localizeHref(raw.slice(0, at))}#top` };
    const entry = pageAnchorsFor(abs);
    if (isSkipLinkId(id) && !entry?.byId.has(id)) {
      report.jumpLinks.skipLinks += 1;
      return { href: "", drop: true };
    }
    if (!entry) {
      const bare = new URL(abs.href);
      bare.hash = "";
      leftUnresolved(onPage, raw, label, `the page it jumps to (${bare.pathname}) was not imported`);
      return { href: `${localizeHref(bare.href)}#${hash}` };
    }
    const section = entry.byId.get(id);
    if (!section && !anchorsLooked) {
      // Nobody looked for the ids on this IR: never call one missing.
      notRecordedLinks += 1;
      return { href: `${entry.local}#${hash}` };
    }
    if (!section) {
      leftUnresolved(onPage, raw, label, `nothing the import built on ${entry.local} carries the id "${id}"`);
      return { href: `${entry.local}#${hash}` };
    }
    const fallback = `${entry.local}#${anchorNameFor(entry, section, id)}`;
    const target = sectionLinks.get(fallback) || { fallback, pageKey: entry.mapped.key, sectionId: section.id, uses: [] };
    target.uses.push({ page: onPage, href: raw, label: collapse(label).slice(0, 80) });
    sectionLinks.set(fallback, target);
    report.jumpLinks.linked += 1;
    return { href: fallback };
  };

  /** Marks an href the whole-<a> pass already rewrote, so the plain pass
   *  below leaves it alone; stripped before the text is stored. */
  const DONE = "\u0001";
  const localizeHtml = (html: string, baseUrl: string, onPage: string): string =>
    html
      // Jump links first, a whole <a> at a time: a skip link loses its tag
      // and keeps its words.
      .replace(/<a\b([^>]*?)\bhref="([^"]*#[^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi, (whole, pre, href, post, inner) => {
        const next = localizeLink(String(href), baseUrl, String(inner).replace(/<[^>]+>/g, " "), onPage);
        if (next.drop) return inner;
        return `<a${pre}${DONE}href="${next.href}"${post}>${inner}</a>`;
      })
      // Every other href — including one with "#" the pass above could not
      // match (an attribute holding ">") — is still localized, so no link
      // keeps pointing at the client's LIVE site. Here a skip link keeps its
      // address as written: without its whole tag it cannot be unwrapped.
      .replace(new RegExp(`(${DONE}?)href="([^"]*)"`, "g"), (whole, done, href) => {
        if (done) return `href="${href}"`;
        const raw = String(href);
        const next = raw.includes("#") ? localizeLink(raw, baseUrl, "", onPage) : { href: localizeHref(raw) };
        const out = next.drop ? raw : next.href;
        return out === raw ? whole : `href="${out}"`;
      });
  for (const page of pages) {
    const irPage = irPageOfKey.get(page.key);
    const baseUrl = irPage?.url || ir.sourceUrl;
    const onPage = irPage ? (isRootPath(irPage.path) ? "/" : `/${page.slug}`) : `/${page.slug}`;
    for (const section of page.sections) {
      for (const module of section.modules) {
        if (module.type === "text" && module.text.includes("href=")) {
          module.text = localizeHtml(module.text, baseUrl, onPage);
        }
        if (module.type === "button" && module.settings.href) {
          const next = localizeLink(module.settings.href, baseUrl, module.settings.label || module.text || "", onPage);
          module.settings.href = next.drop ? "" : next.href;
        }
        if (module.type === "image" && module.settings.linkUrl) {
          const next = localizeLink(module.settings.linkUrl, baseUrl, module.settings.alt || "", onPage);
          module.settings.linkUrl = next.drop ? "" : next.href;
        }
      }
    }
  }
  // Menus: a skip link leaves the menu, with any items under it.
  for (const [list, where] of [[navItems, "Top Menu"], [footerItems, "Footer Menu"]] as const) {
    const dropped = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.parentId && dropped.has(item.parentId)) {
        dropped.add(item.id);
        list.splice(i--, 1);
        continue;
      }
      const next = localizeLink(item.href, navBaseUrl.get(item.id) || ir.sourceUrl, item.label, where);
      if (next.drop) {
        dropped.add(item.id);
        list.splice(i--, 1);
        continue;
      }
      item.href = next.href;
    }
  }
  if (notRecordedLinks) {
    report.jumpLinks.notRecorded = {
      links: notRecordedLinks,
      why:
        `this import was prepared before the import recorded where jump links land, so its ids were never looked for. ` +
        `The capture already holds them, so no fresh capture is needed: ask an agent session to re-run the normalize stage on it ` +
        `(doppler run --config prd -- node scripts/site_import_worker.mjs --stage normalize --job ${ir.jobId || "<job id>"}), then Preview Build again.`,
    };
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
  const unplaced = planUnplacedAssets(ir.assets || [], promotions.values());
  report.assets.promoted = promotions.size;
  report.assets.unplaced = unplaced.length;
  report.assets.cropsCopied = crops.length;
  report.assets.leftInNamespace = Math.max(0, (ir.assets || []).length - promotions.size - unplaced.length);

  report.forms.rebuilt = Array.from(formPlans.values()).map((plan) => ({
    key: plan.key,
    name: plan.name,
    questions: plan.fields.length,
    pages: Array.from(new Set(plan.uses.map((u) => u.pagePath))),
    kept: plan.kept.map((k) => `kept "${k.name}" = "${k.value}" — ${k.why}`),
    dropped: plan.dropped.map((d) => `dropped ${d.what} — ${d.why}`),
    notes: plan.notes.map((n) => `${n.what} — ${n.why}`),
  }));

  return {
    pages,
    forms: Array.from(formPlans.values()),
    slideshows: slideshowPlans,
    cardGrids: cardGridPlans,
    navItems,
    menus,
    sectionLinks: Array.from(sectionLinks.values()),
    copyPlan: { crops, assets: Array.from(promotions.values()), unplaced, sourceOverflows },
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

/* ---------------------------------------------------------------------------
 * Jump links stored by reference (task SC-854)
 * ------------------------------------------------------------------------ */

/** The ids themes give the main content box, that a "skip to content" link
 *  jumps to — Genesis's `#genesis-content`, WordPress's `#main`/`#content`. */
const SKIP_LINK_IDS = /^(main|content|main-content|maincontent|primary|site-content|page-content|genesis-content|skip|skip-content|skip-to-content|skip-link|start-of-content|wp--skip-link--target)$/i;

/**
 * True for a "skip to content" link: an accessibility shortcut over the menu,
 * not a place on the page anybody designed. Copied, it is a dead link; the
 * site-wide skip link is its own ticket. Read by its words first ("Skip to
 * content"), then by the id it jumps to.
 */
export function isSkipLink(id: string, label = ""): boolean {
  return isSkipLabel(label) || isSkipLinkId(id);
}

/** "Skip to content", "Skip navigation", "Jump to main content". */
export function isSkipLabel(label = ""): boolean {
  return /\bskip\s+(to|navigation|the\s+nav)|\bjump\s+to\s+(main\s+)?content\b/i.test(String(label));
}

/** An id themes give the main content box (#main, #genesis-content). The
 *  mapper treats it as a skip link only when nothing it built carries it. */
export function isSkipLinkId(id: string): boolean {
  return SKIP_LINK_IDS.test(String(id || "").trim());
}

/**
 * A section somebody edited since the last build is kept exactly as they
 * left it (the clobber guard), so it never receives the anchor name the
 * mapper gave its fresh copy. A link pointed at it would then jump to a name
 * nothing carries: a dead link reported as working (review of SC-854). For
 * each such target — unless the kept copy already wears that very name —
 * take its links out of `linked`, list each as a leftover saying why, and
 * leave the target out so the runner does not store it by reference. The
 * link keeps the plain address it was written with. `editedLive` maps a
 * protected section's id to the copy on the page now. Returns the targets
 * still safe to reference.
 */
export function demoteEditedSectionLinks(
  report: MapReport,
  targets: SectionLinkTarget[],
  editedLive: Map<string, { anchorName?: unknown } | null | undefined>
): SectionLinkTarget[] {
  const kept: SectionLinkTarget[] = [];
  for (const t of targets || []) {
    if (!editedLive.has(t.sectionId)) {
      kept.push(t);
      continue;
    }
    const name = t.fallback.slice(t.fallback.indexOf("#") + 1);
    const live = editedLive.get(t.sectionId);
    if (live && String(live.anchorName || "") === name) {
      kept.push(t);
      continue;
    }
    for (const use of t.uses || []) {
      report.jumpLinks.linked = Math.max(0, report.jumpLinks.linked - 1);
      const seen = report.jumpLinks.unresolved.some((u) => u.page === use.page && u.href === use.href);
      if (!seen) {
        report.jumpLinks.unresolved.push({
          page: use.page,
          href: use.href,
          label: use.label,
          why: `the section it jumps to was edited by hand since the last build, so it was not given the anchor name "${name}"`,
        });
      }
    }
  }
  return kept;
}

type LinkModule = { type?: string; text?: string; settings?: Record<string, string> };
type LinkSection = { id?: string; modules?: LinkModule[] };

/**
 * Swap every jump-link address the mapper wrote ("/#contact-us") for the
 * stored reference "page:<pageId>#<sectionId>|/#contact-us" (SC-852's shape),
 * now that page ids exist. The section's anchor name is then looked up each
 * time the page is shown, so renaming it never breaks the link. A link whose
 * page has no id yet keeps its plain address, which still works by itself.
 * Rich text keeps its href and gains `data-page-link` beside it, the way the
 * text editor stores a picked page. Pure; returns new sections only when
 * something changed, and how many links it referenced.
 */
export function referenceSectionLinks<S extends LinkSection>(
  sections: S[],
  targets: SectionLinkTarget[],
  pageIds: Record<string, string | number>
): { sections: S[]; referenced: number } {
  const byFallback = new Map<string, string>();
  for (const t of targets || []) {
    const pageId = pageIds?.[t.pageKey];
    if (pageId !== undefined && pageId !== null && String(pageId)) {
      byFallback.set(t.fallback, makePageLink(String(pageId), t.fallback, t.sectionId));
    }
  }
  let referenced = 0;
  if (!byFallback.size) return { sections, referenced };
  const refFor = (href: unknown): string | null => {
    const ref = typeof href === "string" ? byFallback.get(href.trim()) : undefined;
    return ref || null;
  };
  const html = (text: string): string =>
    text.replace(/<a\b[^>]*>/gi, (tag) => {
      if (/\sdata-page-link=/i.test(tag)) return tag;
      const m = /\shref="([^"]*)"/i.exec(tag);
      const ref = m ? refFor(m[1]) : null;
      if (!ref) return tag;
      referenced += 1;
      return tag.replace(/^<a\b/i, `<a data-page-link="${ref.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
    });
  const next = (sections || []).map((section) => {
    let changed = false;
    const modules = (section.modules || []).map((module) => {
      const settings = { ...(module.settings || {}) };
      let text = module.text;
      let touched = false;
      for (const key of ["href", "linkUrl"]) {
        const ref = refFor(settings[key]);
        if (ref) {
          settings[key] = ref;
          referenced += 1;
          touched = true;
        }
      }
      if (typeof settings.navItems === "string" && settings.navItems.includes("#")) {
        try {
          const items = JSON.parse(settings.navItems);
          if (Array.isArray(items)) {
            let any = false;
            for (const item of items) {
              const ref = item && refFor(item.href);
              if (ref) {
                item.href = ref;
                referenced += 1;
                any = true;
              }
            }
            if (any) {
              settings.navItems = JSON.stringify(items);
              touched = true;
            }
          }
        } catch {
          /* not a list: leave it */
        }
      }
      if (typeof text === "string" && text.includes("#")) {
        const swapped = html(text);
        if (swapped !== text) {
          text = swapped;
          touched = true;
        }
      }
      if (!touched) return module;
      changed = true;
      return { ...module, text, settings };
    });
    return changed ? { ...section, modules } : section;
  });
  return { sections: referenced ? next : sections, referenced };
}

/** The reconciliation rule (spec: refuse --apply unless this holds). */
export function reportReconciles(report: MapReport): boolean {
  const e = report.elements;
  return (
    e.total === e.mapped + e.placeholder + (e.form || 0) + e.navConsumed + e.deduped + e.humanModified + e.skipped &&
    report.skipped.length === e.skipped &&
    report.skipped.every((s) => Boolean(s.reason))
  );
}
