/**
 * Site Search — search the content and metadata of every module on every page.
 *
 * The public site already downloads every published page's full layout
 * document (`GET /api/public/pages`, see components/BuilderPublicSitePage.tsx),
 * so search needs no new endpoint, no new auth exemption, and no server-side
 * index. It builds an index in the browser from the documents that are
 * already there.
 *
 * Two design decisions carry most of the weight:
 *
 * 1. **Indexing is open by default, not registered per module type.**
 *    Which settings hold prose is decided by the shape of the KEY and the
 *    shape of the VALUE, not by a table of the 52 module types. A per-type
 *    allowlist is the same trap as landmine #1 — the day someone adds a
 *    module and forgets to register it, its content silently stops being
 *    findable, and nothing fails loudly enough to notice. A heuristic that
 *    is occasionally too generous beats an allowlist that is silently stale.
 *
 * 2. **Results are grouped per page, not per module.** A site whose nav
 *    module sits on all 30 pages would otherwise answer every query with 30
 *    copies of the nav. Repeated content is detected and suppressed
 *    automatically (see BOILERPLATE_* below) rather than by naming the nav
 *    types, so footers, contact strips, and copied hero bands are covered by
 *    the same rule.
 *
 * Pure and data-only so it can be unit-tested without React or a DOM.
 */

/* ------------------------------------------------------------------ *
 * Input shapes — deliberately loose so this can take the raw records
 * from /api/public/pages without importing the full builder types.
 * ------------------------------------------------------------------ */

export type SiteSearchModuleInput = {
  id?: string;
  type?: string;
  name?: string;
  text?: string;
  column?: string;
  settings?: Record<string, unknown> | null;
};

export type SiteSearchSectionInput = {
  id?: string;
  title?: string;
  modules?: SiteSearchModuleInput[] | null;
  /** Per-column Public/Private access, keyed by column. */
  cellIsPrivate?: Record<string, string> | null;
};

export type SiteSearchPageInput = {
  id?: string;
  name?: string;
  slug?: string;
  updatedAt?: string;
  layoutSections?: SiteSearchSectionInput[] | null;
};

/* ------------------------------------------------------------------ *
 * Index shapes
 * ------------------------------------------------------------------ */

/**
 * Where a piece of text came from. This is the single strongest ranking
 * signal — a page CALLED "Pricing" is a better answer for "pricing" than a
 * page that mentions the word in a footnote, no matter how often.
 */
export type SiteSearchFieldKind = "pageName" | "title" | "body" | "meta";

export type SiteSearchFragment = {
  /** Plain text, HTML already stripped. */
  text: string;
  kind: SiteSearchFieldKind;
  /** Where it came from, for debugging and for the "matched in" label. */
  sourceKey: string;
  moduleId: string;
  moduleType: string;
  moduleName: string;
  /** 0-based index of the section on the page — earlier reads as more central. */
  sectionIndex: number;
  /** True when this exact text also appears on most other pages (nav, footer). */
  boilerplate: boolean;
};

export type SiteSearchIndexedPage = {
  pageId: string;
  pageName: string;
  slug: string;
  href: string;
  updatedAt: string;
  fragments: SiteSearchFragment[];
  /** Total indexed words, for length normalisation. */
  wordCount: number;
};

export type SiteSearchIndex = {
  pages: SiteSearchIndexedPage[];
};

export type SiteSearchHighlight = { start: number; end: number };

export type SiteSearchMatch = {
  kind: SiteSearchFieldKind;
  sourceKey: string;
  moduleType: string;
  moduleName: string;
  score: number;
  snippet: string;
  highlights: SiteSearchHighlight[];
};

export type SiteSearchResult = {
  pageId: string;
  pageName: string;
  slug: string;
  href: string;
  updatedAt: string;
  score: number;
  /** The match that earned the ranking — drives the snippet shown. */
  topMatch: SiteSearchMatch;
  /** Further matches on the same page, best first, already de-duplicated. */
  otherMatches: SiteSearchMatch[];
  /** Total matching fragments on this page, including the top one. */
  matchCount: number;
};

/* ------------------------------------------------------------------ *
 * What is content, and what is styling
 * ------------------------------------------------------------------ */

/**
 * Module types never indexed.
 *
 * Two reasons, kept apart on purpose:
 * - **Admin surfaces** must not be searchable by the public. These mirror
 *   PRIVATE_ONLY_MODULE_TYPES in components/BuilderPublicSitePage.tsx plus
 *   every `admin-*` type, which is enforced by prefix below.
 * - **Site chrome** (nav, breadcrumb, table of contents, social bars) is on
 *   every page by design. The boilerplate detector would catch most of it,
 *   but a nav that genuinely differs per page would still flood results with
 *   link labels that lead nowhere useful — the page they name is already a
 *   better hit on its own name.
 */
const NEVER_INDEXED_MODULE_TYPES = new Set([
  "blog-post-create",
  "blog-post-manager",
  "blog-category-manager",
  "blog-card-manager",
  "navigation",
  "tractor-nav",
  "breadcrumb",
  "blog-toc",
  "social",
  "social-share",
  "confetti"
]);

/**
 * Setting keys whose values are presentation, not prose. Matched as
 * case-insensitive substrings of the key, so `cardBorderColor`,
 * `socialShadowBlur`, and `mobileFontSize` are all covered by three entries.
 *
 * A key that survives this list still has to survive the value-shape test
 * below, so the two together are what keep `#0f4f8f` and `24` out of the
 * index rather than either one alone.
 */
const STYLE_KEY_PATTERNS = [
  "color", "colour", "background", "bgcolor", "opacity", "shadow", "blur", "spread",
  "radius", "width", "height", "size", "gap", "padding", "margin", "offset", "inset",
  "align", "direction", "position", "sizing", "aspect", "ratio", "zindex", "columns",
  "font", "weight", "transform", "spacing", "lineheight", "letterspacing", "casing",
  "duration", "delay", "speed", "interval", "timeout", "ms", "fps",
  "layout", "variant", "transition", "style", "mode", "theme", "preset", "template",
  "count", "limit", "perpage", "rows", "index", "order", "sort", "step", "level",
  "hidden", "enabled", "disabled", "visible", "locked", "required", "readonly"
];

/**
 * Setting keys that are technical wiring — ids, routes, query parameters.
 * A page should not match "search" because it holds a module whose
 * `searchParam` is "search".
 */
const TECHNICAL_KEY_PATTERNS = [
  "url", "href", "src", "link", "path", "route", "slug", "param", "target",
  "redirect", "id", "ids", "key", "token", "class", "selector", "anchor", "field"
];

/**
 * Interface chrome — real prose, but the module's own furniture rather than
 * the operator's content. Indexing these makes every page with a form match
 * "submit" and every page with a search box match "search".
 */
const CHROME_KEYS = new Set([
  "placeholder", "submitlabel", "buttonlabel", "buttontext", "addbuttonlabel",
  "draftlabel", "alllabel", "emptymessage", "successmessage", "loadinglabel",
  "nextlabel", "previouslabel", "morelabel", "closelabel", "cancellabel",
  "searchlabel", "filterlabel", "prefix", "suffix"
]);

/**
 * Keys holding JSON collections (or comma-separated lists). Their string
 * leaves are walked with the same key rules, one level of nesting at a time.
 * This is the same set that Standard 6 exempts from the 10k settings cap —
 * if a key is big enough to need that exemption, it is big enough to hold
 * content worth finding.
 */
const COLLECTION_KEYS = new Set([
  "slides", "cards", "slideritems", "navitems", "socialitems", "tabledata",
  "tablecontents", "content", "headlines", "manualposts", "tags", "categories",
  "items", "features", "faqs", "steps", "testimonials"
]);

/**
 * Keys whose text is a title, and so ranks near a page name. Everything else
 * that survives the filters is body text.
 */
const TITLE_KEYS = new Set([
  "title", "headline", "heading", "name", "label", "producttitle", "posttitle",
  "formtitle", "tabletitle", "paneltitle", "historytitle", "contactheading",
  "productname", "videoname", "cardtitle", "slidetitle"
]);

/** Keys whose text is supporting metadata — findable, but never the headline answer. */
const META_KEYS = new Set([
  "alt", "alttext", "caption", "credit", "author", "tags", "categories",
  "keywords", "linklabel", "linktext", "badge", "eyebrow"
]);

/** Module types whose `text` field IS a title. */
const TITLE_MODULE_TYPES = new Set(["heading", "headline-rotator"]);

/* ------------------------------------------------------------------ *
 * Text extraction
 * ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", times: "×", middot: "·"
};

/**
 * HTML to plain text. Script and style bodies go first — a rich-text or code
 * module carrying an embed would otherwise put its JavaScript in the index,
 * where a search for "function" matches every page with a widget on it.
 */
export function htmlToPlainText(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "";
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Block-level tags become a space so "</p><p>" never welds two words.
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The `#` is required, and that is the whole point: `[0-9a-f]{3,8}` without it
 * also matches "cafe", "fee", "added", "decade", and "deface" — so a café's
 * own website could not find the word "cafe". Settings keys that hold colours
 * are already dropped by name (STYLE_KEY_PATTERNS), so a bare six-digit hex
 * reaching this test is rare; a common English word reaching it is not.
 */
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const CSS_FUNC = /^(rgba?|hsla?|var|calc|url|linear-gradient|radial-gradient)\s*\(/i;
const NUMERIC = /^-?\d+(\.\d+)?\s*(px|%|em|rem|vh|vw|pt|deg|s|ms|fr)?$/i;
const BOOLEANISH = /^(true|false|yes|no|on|off|none|auto|inherit|initial|default)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URLISH = /^((https?:)?\/\/|\/|mailto:|tel:|data:|#)/i;
const HAS_LETTERS = /[a-z]/i;

/**
 * Is this VALUE prose a visitor could plausibly be searching for?
 *
 * Runs after the key test, and catches what key names cannot: an operator
 * naming a setting `intro` and pasting a hex code into it, or a collection
 * whose leaves mix labels and colours under the same field name.
 */
export function isIndexableValue(value: string): boolean {
  const text = value.trim();
  if (text.length < 2) return false;
  if (!HAS_LETTERS.test(text)) return false;
  if (HEX_COLOR.test(text)) return false;
  if (CSS_FUNC.test(text)) return false;
  if (NUMERIC.test(text)) return false;
  if (BOOLEANISH.test(text)) return false;
  if (UUID.test(text)) return false;
  if (URLISH.test(text)) return false;
  // A bare token with no spaces that looks like a slug or a css class.
  if (!/\s/.test(text) && /^[a-z0-9]+([-_][a-z0-9]+)+$/i.test(text)) return false;
  return true;
}

function keyMatchesAny(lowerKey: string, patterns: string[]): boolean {
  return patterns.some((pattern) => lowerKey.includes(pattern));
}

/**
 * Classify a settings key. `null` means "not content — leave it out".
 *
 * Order matters: an explicit title/meta name wins over the pattern lists, so
 * `productName` stays indexed even though `name` also appears in a technical
 * key pattern, and `linkLabel` stays indexed despite containing "link".
 */
export function classifySettingKey(key: string): SiteSearchFieldKind | null {
  const lower = key.trim().toLowerCase();
  if (!lower) return null;
  if (CHROME_KEYS.has(lower)) return null;
  if (TITLE_KEYS.has(lower)) return "title";
  if (META_KEYS.has(lower)) return "meta";
  // `show*` settings are booleans without exception across the palette.
  if (/^(show|is|has|use|enable|allow|hide)[A-Z]/.test(key.trim())) return null;
  if (keyMatchesAny(lower, STYLE_KEY_PATTERNS)) return null;
  if (keyMatchesAny(lower, TECHNICAL_KEY_PATTERNS)) return null;
  return "body";
}

/**
 * Pull the string leaves out of a collection setting. Depth is bounded
 * because these come from user data and a cyclic or absurdly deep structure
 * should cost a shrug, not the browser tab.
 */
function collectFromJson(
  node: unknown,
  depth: number,
  out: { key: string; kind: SiteSearchFieldKind; text: string }[],
  path: string
): void {
  if (depth > 4 || out.length > 500) return;

  if (typeof node === "string") {
    const text = htmlToPlainText(node);
    if (isIndexableValue(text)) out.push({ key: path, kind: "body", text });
    return;
  }
  if (Array.isArray(node)) {
    node.slice(0, 200).forEach((entry, i) => collectFromJson(entry, depth + 1, out, `${path}[${i}]`));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
      const kind = classifySettingKey(key);
      if (kind === null) continue;
      if (typeof raw === "string") {
        const text = htmlToPlainText(raw);
        if (isIndexableValue(text)) out.push({ key: `${path}.${key}`, kind, text });
      } else {
        collectFromJson(raw, depth + 1, out, `${path}.${key}`);
      }
    }
  }
}

function parseCollection(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Standard 5: malformed settings fall back to empty, never throw.
      return null;
    }
  }
  // Comma or newline separated lists (tags, categories) are the other shape.
  const parts = trimmed.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

/**
 * Every searchable fragment of one module, in no particular order.
 * Exported so a settings editor could one day show "what this module
 * contributes to search".
 */
export function collectModuleFragments(
  module: SiteSearchModuleInput
): { kind: SiteSearchFieldKind; sourceKey: string; text: string }[] {
  const out: { kind: SiteSearchFieldKind; sourceKey: string; text: string }[] = [];
  const type = String(module.type || "text").trim().toLowerCase();

  // The operator's own label for the module — often the most human name for
  // what is on the page ("Spring Pricing Table").
  const name = htmlToPlainText(module.name);
  if (isIndexableValue(name)) out.push({ kind: "title", sourceKey: "name", text: name });

  const text = htmlToPlainText(module.text);
  if (isIndexableValue(text)) {
    out.push({
      kind: TITLE_MODULE_TYPES.has(type) ? "title" : "body",
      sourceKey: "text",
      text
    });
  }

  const settings = module.settings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    for (const [key, raw] of Object.entries(settings)) {
      if (typeof raw !== "string") continue;
      const lower = key.trim().toLowerCase();

      if (COLLECTION_KEYS.has(lower)) {
        const parsed = parseCollection(raw);
        if (parsed !== null) {
          const leaves: { key: string; kind: SiteSearchFieldKind; text: string }[] = [];
          collectFromJson(parsed, 0, leaves, key);
          // A collection's leaves are content, but `tags`/`categories` stay
          // metadata however deep they sit.
          const forced = META_KEYS.has(lower) ? "meta" : null;
          for (const leaf of leaves) {
            out.push({ kind: forced ?? leaf.kind, sourceKey: leaf.key, text: leaf.text });
          }
          continue;
        }
        // Not parseable as a collection — fall through and treat as plain text.
      }

      const kind = classifySettingKey(key);
      if (kind === null) continue;
      const value = htmlToPlainText(raw);
      if (isIndexableValue(value)) out.push({ kind, sourceKey: key, text: value });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Index building
 * ------------------------------------------------------------------ */

/** A fragment repeated on at least this SHARE of pages is site chrome... */
const BOILERPLATE_PAGE_SHARE = 0.6;
/** ...but only once there are enough pages for the share to mean anything. */
const BOILERPLATE_MIN_PAGES = 4;

function pageHref(slug: string): string {
  const clean = String(slug || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean || clean.toLowerCase() === "home") return "/";
  return `/${clean}`;
}

function isPrivateColumn(section: SiteSearchSectionInput, column: unknown): boolean {
  const map = section.cellIsPrivate;
  if (!map || typeof map !== "object") return false;
  const key = String(column ?? "").trim();
  if (!key) return false;
  return String(map[key] ?? "").trim().toLowerCase() === "true";
}

export function buildSiteSearchIndex(pagesInput: SiteSearchPageInput[]): SiteSearchIndex {
  const rawPages = Array.isArray(pagesInput) ? pagesInput : [];

  // Pass 1 — extract everything, and count how many distinct pages carry each
  // exact piece of text.
  const pageCountByText = new Map<string, Set<string>>();

  const pages: SiteSearchIndexedPage[] = rawPages.map((page, pageOrdinal) => {
    const pageId = String(page.id ?? `page-${pageOrdinal}`);
    const pageName = htmlToPlainText(page.name);
    const slug = String(page.slug ?? "").trim();
    const fragments: SiteSearchFragment[] = [];

    if (isIndexableValue(pageName)) {
      fragments.push({
        text: pageName,
        kind: "pageName",
        sourceKey: "page.name",
        moduleId: "",
        moduleType: "",
        moduleName: "",
        sectionIndex: 0,
        boilerplate: false
      });
    }

    const sections = Array.isArray(page.layoutSections) ? page.layoutSections : [];
    sections.forEach((section, sectionIndex) => {
      const modules = Array.isArray(section?.modules) ? section.modules : [];
      for (const module of modules) {
        const type = String(module?.type || "text").trim().toLowerCase();
        if (NEVER_INDEXED_MODULE_TYPES.has(type)) continue;
        if (type.startsWith("admin-")) continue;
        // A column marked Private in the cell settings is not public content.
        if (isPrivateColumn(section, module?.column)) continue;

        const moduleName = htmlToPlainText(module?.name);
        for (const piece of collectModuleFragments(module || {})) {
          fragments.push({
            text: piece.text,
            kind: piece.kind,
            sourceKey: piece.sourceKey,
            moduleId: String(module?.id ?? ""),
            moduleType: type,
            moduleName,
            sectionIndex,
            boilerplate: false
          });
        }
      }
    });

    for (const fragment of fragments) {
      const key = fragment.text.toLowerCase();
      let set = pageCountByText.get(key);
      if (!set) {
        set = new Set<string>();
        pageCountByText.set(key, set);
      }
      set.add(pageId);
    }

    const wordCount = fragments.reduce((sum, f) => sum + f.text.split(/\s+/).length, 0);

    return {
      pageId,
      pageName,
      slug,
      href: pageHref(slug),
      updatedAt: String(page.updatedAt ?? ""),
      fragments,
      wordCount
    };
  });

  // Pass 2 — flag repeated text. A page's own NAME is never boilerplate, even
  // on a site where two pages share a name.
  if (pages.length >= BOILERPLATE_MIN_PAGES) {
    const threshold = pages.length * BOILERPLATE_PAGE_SHARE;
    for (const page of pages) {
      for (const fragment of page.fragments) {
        if (fragment.kind === "pageName") continue;
        const seen = pageCountByText.get(fragment.text.toLowerCase());
        if (seen && seen.size > threshold) fragment.boilerplate = true;
      }
    }
  }

  return { pages };
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * How much each kind of field is worth. This is the ranking, more than any
 * other number here: a page named "Shipping" beats a page whose body mentions
 * shipping once, and both beat an image whose alt text happens to say it.
 */
export const FIELD_WEIGHT: Record<SiteSearchFieldKind, number> = {
  pageName: 10,
  title: 6,
  body: 3,
  meta: 1.5
};

/** Multiplier applied to a fragment that also appears on most other pages. */
const BOILERPLATE_MULTIPLIER = 0.05;

/** How fast a match loses value as it sinks down the page. */
const SECTION_DECAY = 0.12;

/** A page whose match count is high gets at most this much of a lift. */
const BREADTH_SHARE = 0.25;

/** Small nudges. Deliberately small — they break ties, they do not rank. */
const HOME_PAGE_BOOST = 1.04;
const RECENCY_BOOST_MAX = 1.05;
const RECENCY_WINDOW_DAYS = 90;

export function normalizeSiteSearchQuery(query: string): string {
  return String(query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How well one piece of text answers the query, 0 (no match) to 1 (it IS the
 * query). The tiers mirror `builder-module-search.ts` so the two searches in
 * this product rank by the same intuition.
 */
export function matchQuality(query: string, text: string): number {
  if (!query || !text) return 0;
  const haystack = text.toLowerCase();
  if (haystack === query) return 1;
  if (haystack.startsWith(query)) return 0.8;
  if (new RegExp(`\\b${escapeRegExp(query)}`).test(haystack)) return 0.6;
  if (haystack.includes(query)) return 0.4;
  return 0;
}

/**
 * Singular/plural forms of the query, best form first.
 *
 * Live-fire against a real 60-page site: searching "lessons" did not find the
 * page called "Lesson Prices", because nothing in it contains the exact string
 * "lessons". A visitor does not know or care which form the operator typed, so
 * the near form is tried too — scored lower, so the exact wording always wins
 * when both are present.
 *
 * Only the LAST word is inflected ("junior lessons" → "junior lesson"), and
 * only for English. This is deliberately a small rule rather than a stemmer:
 * a full stemmer also maps "universe" to "univers" and "tennis" to "tenni",
 * which costs more precision here than the plural case buys.
 */
export function siteSearchQueryVariants(query: string): string[] {
  const words = query.split(" ").filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (words.length === 0 || last.length < 4) return [query];

  const swap = (form: string) => [...words.slice(0, -1), form].join(" ");
  const variants: string[] = [];

  // Order matters: "classes" must reach the strip rule before "class" reaches
  // the add rule, or the two would disagree about which is the other's form.
  if (/ies$/.test(last)) {
    variants.push(swap(`${last.slice(0, -3)}y`));
  } else if (/(ch|sh|ss|x|z)es$/.test(last)) {
    variants.push(swap(last.slice(0, -2)));
  } else if (/ss$/.test(last)) {
    variants.push(swap(`${last}es`));
  } else if (/(us|is)$/.test(last)) {
    // "tennis", "chassis", "campus" — not plurals, and not pluralisable by
    // any rule this small. Pluralising them invents a form no page contains.
  } else if (/s$/.test(last)) {
    variants.push(swap(last.slice(0, -1)));
  } else if (/[^aeiou]y$/.test(last)) {
    variants.push(swap(`${last.slice(0, -1)}ies`));
  } else if (/(ch|sh|x|z)$/.test(last)) {
    variants.push(swap(`${last}es`));
  } else {
    variants.push(swap(`${last}s`));
  }

  return [query, ...variants.filter((form) => form !== query)];
}

/** A near form (plural for singular, or the reverse) never beats the exact one. */
const VARIANT_PENALTY = 0.7;

/**
 * Best score for this fragment, and the exact substring that earned it — the
 * snippet needs to highlight what actually matched, not what was typed.
 */
function fragmentScore(
  variants: string[],
  fragment: SiteSearchFragment
): { score: number; needle: string } {
  const weight = FIELD_WEIGHT[fragment.kind];
  const positional = 1 / (1 + SECTION_DECAY * Math.max(0, fragment.sectionIndex));
  const chrome = fragment.boilerplate ? BOILERPLATE_MULTIPLIER : 1;

  let best = 0;
  let needle = variants[0] ?? "";
  variants.forEach((variant, i) => {
    const quality = matchQuality(variant, fragment.text) * (i === 0 ? 1 : VARIANT_PENALTY);
    if (quality > best) {
      best = quality;
      needle = variant;
    }
  });

  return { score: best > 0 ? weight * best * positional * chrome : 0, needle };
}

function daysSince(iso: string): number {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 86_400_000;
}

function buildSnippet(text: string, query: string, radius = 90): { snippet: string; highlights: SiteSearchHighlight[] } {
  const haystack = text.toLowerCase();
  const at = haystack.indexOf(query);

  if (at < 0 || text.length <= radius * 2) {
    return { snippet: text, highlights: at < 0 ? [] : [{ start: at, end: at + query.length }] };
  }

  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + query.length + radius);
  // Don't cut a word in half.
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > at + query.length) end = space;
  }

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
  const offset = prefix.length - start;
  return { snippet, highlights: [{ start: at + offset, end: at + query.length + offset }] };
}

export type SiteSearchOptions = {
  /** Maximum pages returned. */
  limit?: number;
  /** Extra matches carried per page beyond the top one. */
  otherMatchLimit?: number;
  /** Treat this slug's page as home for the tie-break boost. */
  now?: number;
};

/**
 * Rank every page against the query.
 *
 * A page's score is its BEST match plus a bounded bonus for having several —
 * "how well does this page answer the question" first, "how much does it have
 * to say" second. The alternative (summing every match) hands the top slot to
 * whichever page is longest, which is how naive site search ends up putting
 * the terms-of-service page above the product page.
 */
export function searchSite(
  rawQuery: string,
  index: SiteSearchIndex,
  options: SiteSearchOptions = {}
): SiteSearchResult[] {
  const query = normalizeSiteSearchQuery(rawQuery);
  if (!query) return [];

  const limit = Math.max(1, options.limit ?? 50);
  const otherMatchLimit = Math.max(0, options.otherMatchLimit ?? 3);
  const phraseVariants = siteSearchQueryVariants(query);
  const terms = query.split(" ").filter(Boolean);

  const results: SiteSearchResult[] = [];

  for (const page of index.pages) {
    const scored: { fragment: SiteSearchFragment; score: number; needle: string }[] = [];

    for (const fragment of page.fragments) {
      const hit = fragmentScore(phraseVariants, fragment);
      if (hit.score > 0) scored.push({ fragment, score: hit.score, needle: hit.needle });
    }

    // Multi-word fallback: no single fragment holds the whole phrase, but
    // every term appears somewhere on the page. Worth finding, worth ranking
    // below any page that has the phrase intact.
    if (!scored.length && terms.length > 1) {
      const termVariants = terms.map((term) => siteSearchQueryVariants(term));
      const covered = new Set<number>();
      const perTerm: { fragment: SiteSearchFragment; score: number; needle: string }[] = [];
      for (const fragment of page.fragments) {
        let best = 0;
        let needle = "";
        termVariants.forEach((variants, i) => {
          const hit = fragmentScore(variants, fragment);
          if (hit.score > 0) {
            covered.add(i);
            if (hit.score > best) {
              best = hit.score;
              needle = hit.needle;
            }
          }
        });
        if (best > 0) perTerm.push({ fragment, score: best, needle });
      }
      if (covered.size === terms.length) {
        perTerm.sort((a, b) => b.score - a.score);
        for (const entry of perTerm) {
          // Scaled down so a scattered match never outranks a phrase match.
          scored.push({ ...entry, score: entry.score * 0.3 });
        }
      }
    }

    if (!scored.length) continue;

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    const rest = scored.slice(1).reduce((sum, entry) => sum + entry.score, 0);

    // Breadth helps, but can never do more than add a quarter of the best hit.
    let score = best.score + Math.min(rest, best.score * BREADTH_SHARE);

    if (page.href === "/") score *= HOME_PAGE_BOOST;

    const age = daysSince(page.updatedAt);
    if (age < RECENCY_WINDOW_DAYS) {
      score *= 1 + (RECENCY_BOOST_MAX - 1) * (1 - age / RECENCY_WINDOW_DAYS);
    }

    const toMatch = (entry: { fragment: SiteSearchFragment; score: number; needle: string }): SiteSearchMatch => {
      const { snippet, highlights } = buildSnippet(entry.fragment.text, entry.needle);
      return {
        kind: entry.fragment.kind,
        sourceKey: entry.fragment.sourceKey,
        moduleType: entry.fragment.moduleType,
        moduleName: entry.fragment.moduleName,
        score: entry.score,
        snippet,
        highlights
      };
    };

    // De-duplicate the "other matches" by snippet — a table that repeats a
    // word in six cells is one thing worth showing, not six.
    const seenSnippets = new Set<string>();
    const topMatch = toMatch(best);
    seenSnippets.add(topMatch.snippet.toLowerCase());

    const otherMatches: SiteSearchMatch[] = [];
    for (const entry of scored.slice(1)) {
      if (otherMatches.length >= otherMatchLimit) break;
      const match = toMatch(entry);
      const key = match.snippet.toLowerCase();
      if (seenSnippets.has(key)) continue;
      seenSnippets.add(key);
      otherMatches.push(match);
    }

    results.push({
      pageId: page.pageId,
      pageName: page.pageName || page.slug || "Untitled page",
      slug: page.slug,
      href: page.href,
      updatedAt: page.updatedAt,
      score,
      topMatch,
      otherMatches,
      matchCount: scored.length
    });
  }

  return results
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.pageName.localeCompare(right.pageName, undefined, { sensitivity: "base" });
    })
    .slice(0, limit);
}
