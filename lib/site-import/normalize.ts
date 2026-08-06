/**
 * Site Import — normalizer: CaptureResult → SiteIR.
 *
 * Pure functions, no I/O. The worker feeds it the persisted capture JSON;
 * it returns the IR plus the coverage numbers. Everything here follows the
 * COUNTING METHODOLOGY comment block in ir.ts — that block is the single
 * definition of what "one countable element" means, and walkCountables()
 * below is its single implementation. Both coverage counters and the
 * element extraction use that one walk, which is what structurally
 * guarantees captured == emitted; the counters still run independently
 * (raw HTML vs finished IR) so any future divergence in this file shows up
 * as a non-empty `dropped` instead of silent loss.
 *
 * HARD RULE (spec §1c): the normalizer must NEVER throw. Parsing uses
 * cheerio/parse5, which accepts arbitrarily broken HTML; walks are
 * iterative so pathological nesting cannot blow the stack; and every page
 * is additionally wrapped in a catch that degrades it to a single
 * class:"other" element carrying the raw HTML verbatim — visible as
 * dropped counts in coverage, never as an exception.
 */

import * as cheerio from "cheerio";
import {
  IR_VERSION,
  type AssetRef,
  type CaptureResult,
  type CapturedStyles,
  type Coverage,
  type CoverageCounts,
  type ElementClass,
  type ElementIR,
  type NavItem,
  type NavTree,
  type PageIR,
  type SectionIR,
  type SiteIR,
  type TokenCount,
} from "./ir";

/* ---------------------------------------------------------------------------
 * Minimal structural view of cheerio's DOM nodes. We type only what we
 * touch, so this file does not depend on cheerio's internal type surface.
 * ------------------------------------------------------------------------ */

type DomNode = {
  type: string; // "tag" | "text" | "script" | "style" | "comment" | ...
  name?: string;
  data?: string; // text nodes
  attribs?: Record<string, string>;
  children?: DomNode[];
  parent?: DomNode | null;
};

type CheerioApi = ReturnType<typeof cheerio.load>;

/** Serialize a node's outer HTML via cheerio (dom-serializer under the hood). */
function outerHtml($: CheerioApi, node: DomNode): string {
  return $.html(node as never) || "";
}

/** Iterative textContent — recursion-free so depth can't blow the stack. */
function getText(node: DomNode): string {
  let out = "";
  const stack: DomNode[] = [node];
  while (stack.length) {
    const n = stack.pop() as DomNode;
    if (n.type === "text") {
      out = (n.data || "") + out; // stack reverses order; prepend restores it
      continue;
    }
    const name = (n.name || "").toLowerCase();
    if (name === "script" || name === "style" || name === "template") continue;
    for (const child of n.children || []) stack.push(child);
  }
  return out;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The capture layer's element markers are internal plumbing — strip them
 *  from the verbatim HTML the IR carries. The attribute is machine-stamped
 *  in exactly this shape, so a regex is safe here. */
function stripScimMarkers(html: string): string {
  return html.replace(/\s+data-scim="[^"]*"/g, "");
}

/* ---------------------------------------------------------------------------
 * sourceId — stable element identity within a job
 * ------------------------------------------------------------------------ */

/** FNV-1a 32-bit, hex. Tiny, dependency-free, stable across runs. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * "<pageIdx>-<domPathHash>" per the ElementIR contract. The capture layer
 * uses this same function when keying per-element screenshot crops, so the
 * normalizer can join crops back onto elements. domPath is the tag/index
 * path from body, e.g. "body/div[0]/p[2]".
 */
export function computeSourceId(pageIdx: number, domPath: string): string {
  return `${pageIdx}-${fnv1a(domPath)}`;
}

/* ---------------------------------------------------------------------------
 * Classification + the countable walk (implements ir.ts methodology)
 * ------------------------------------------------------------------------ */

const SKIP_TAGS = new Set([
  "script", "style", "template", "noscript", "link", "meta",
  "base", "title", "head", "br", "hr", "wbr",
]);

const TEXT_ATOMS = new Set([
  "p", "blockquote", "pre", "dt", "dd", "figcaption", "address",
]);

/** Tag/role classification per the methodology table. null = container. */
function classifyTag(node: DomNode): ElementClass | null {
  const name = (node.name || "").toLowerCase();
  const attribs = node.attribs || {};
  if (/^h[1-6]$/.test(name)) return "heading";
  if (name === "img" || name === "picture") return "image";
  if (name === "form") return "form";
  if (name === "video") return "video";
  if (name === "iframe" || name === "embed" || name === "object") return "embed";
  if (name === "table") return "table";
  if (name === "svg" || name === "canvas" || name === "audio") return "other";
  if (name === "button") return "button";
  if (name === "input") {
    const t = (attribs.type || "").toLowerCase();
    return t === "submit" || t === "button" ? "button" : null;
  }
  if ((attribs.role || "").toLowerCase() === "button") return "button";
  if (TEXT_ATOMS.has(name)) return "text";
  if (name === "a" && attribs.href !== undefined) return "link";
  return null;
}

export type CountableVisit =
  | {
      kind: "element";
      node: DomNode;
      cls: ElementClass;
      domPath: string;
      depth: number;
      /** Nearest ancestor element, for section assignment. */
      parentNode: DomNode;
    }
  | {
      kind: "textRun";
      text: string;
      domPath: string;
      depth: number;
      parentNode: DomNode;
    };

/**
 * THE walk — see the COUNTING METHODOLOGY block in ir.ts. Iterative
 * (explicit frame stack) so pathological nesting depth cannot throw.
 * Visits arrive in document order.
 */
function walkCountables(body: DomNode, visit: (v: CountableVisit) => void): void {
  type Frame = {
    node: DomNode;
    path: string;
    depth: number;
    i: number; // next child index
    elemIdx: number; // element-child counter (all tags, incl. skipped)
    textIdx: number; // non-whitespace text-run counter
  };
  const frames: Frame[] = [
    { node: body, path: "body", depth: 0, i: 0, elemIdx: 0, textIdx: 0 },
  ];
  while (frames.length) {
    const f = frames[frames.length - 1];
    const kids = f.node.children || [];
    if (f.i >= kids.length) {
      frames.pop();
      continue;
    }
    const child = kids[f.i++];
    if (child.type === "text") {
      const text = child.data || "";
      if (text.trim()) {
        visit({
          kind: "textRun",
          text,
          domPath: `${f.path}/#text[${f.textIdx++}]`,
          depth: f.depth + 1,
          parentNode: f.node,
        });
      }
      continue;
    }
    // htmlparser2 marks <script>/<style> with their own node types.
    const isTagLike =
      child.type === "tag" || child.type === "script" || child.type === "style";
    if (!isTagLike) continue;
    const name = (child.name || "").toLowerCase();
    const childPath = `${f.path}/${name}[${f.elemIdx++}]`;
    if (SKIP_TAGS.has(name) || child.type === "script" || child.type === "style") {
      continue;
    }
    const cls = classifyTag(child);
    if (cls) {
      visit({
        kind: "element",
        node: child,
        cls,
        domPath: childPath,
        depth: f.depth + 1,
        parentNode: f.node,
      });
    } else {
      frames.push({
        node: child,
        path: childPath,
        depth: f.depth + 1,
        i: 0,
        elemIdx: 0,
        textIdx: 0,
      });
    }
  }
}

function parseBody(html: string): { $: CheerioApi; body: DomNode | null } {
  const $ = cheerio.load(String(html ?? ""));
  const body = ($("body")[0] as unknown as DomNode) || null;
  return { $, body };
}

/* ---------------------------------------------------------------------------
 * Coverage counters
 * ------------------------------------------------------------------------ */

function addCount(counts: CoverageCounts, cls: ElementClass, n = 1): void {
  counts[cls] = (counts[cls] || 0) + n;
}

function mergeCounts(into: CoverageCounts, from: CoverageCounts): void {
  for (const [cls, n] of Object.entries(from)) {
    addCount(into, cls as ElementClass, n as number);
  }
}

/**
 * Captured-side counter: walks RAW capture HTML. Never throws — a page
 * whose HTML defeats even parse5 counts as one "other" (mirroring the
 * degraded page the normalizer would emit for it).
 */
export function countCapturedByClass(html: string): CoverageCounts {
  const counts: CoverageCounts = {};
  try {
    const { body } = parseBody(html);
    if (!body) return counts;
    walkCountables(body, (v) => {
      addCount(counts, v.kind === "textRun" ? "text" : v.cls);
    });
  } catch {
    addCount(counts, "other");
  }
  return counts;
}

/** Emitted-side counter: tallies what the finished IR actually carries. */
export function tallyEmittedByClass(ir: SiteIR): CoverageCounts {
  const counts: CoverageCounts = {};
  for (const page of ir.pages || []) {
    for (const section of page.sections || []) {
      for (const el of section.elements || []) {
        addCount(counts, el.class);
      }
    }
  }
  return counts;
}

/** dropped = captured − emitted per class, only where positive. Any entry
 *  here is a bug (spec §1c) and the UI/worker must surface it loudly. */
export function computeCoverage(args: {
  captured: CoverageCounts;
  emitted: CoverageCounts;
  pages: { discovered: number; captured: number; failed: number };
  capsHit: string[];
}): Coverage {
  const dropped: CoverageCounts = {};
  for (const [cls, n] of Object.entries(args.captured)) {
    const missing = (n as number) - (args.emitted[cls as ElementClass] || 0);
    if (missing > 0) dropped[cls as ElementClass] = missing;
  }
  return {
    captured: args.captured,
    emitted: args.emitted,
    dropped,
    pages: args.pages,
    caps: { hit: args.capsHit },
  };
}

/* ---------------------------------------------------------------------------
 * Style compaction
 * ------------------------------------------------------------------------ */

/**
 * The curated property set the capture layer records per visible element —
 * exported so capture and normalizer share one list (single source).
 */
export const CAPTURE_STYLE_PROPS: string[] = [
  // typography
  "color", "font-family", "font-size", "font-weight", "font-style",
  "line-height", "letter-spacing", "text-align", "text-transform",
  "text-decoration-line",
  // surfaces
  "background-color", "background-image", "box-shadow", "opacity",
  "border-radius",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  // spacing
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  // layout essentials
  "display", "position", "gap", "flex-direction", "justify-content",
  "align-items",
];

const KEEP_SET = new Set(CAPTURE_STYLE_PROPS);

/** Values that are browser defaults per property — carrying them would just
 *  bloat the IR. Anything not listed is kept. */
const STYLE_DEFAULTS: Record<string, string[]> = {
  "font-weight": ["400", "normal"],
  "font-style": ["normal"],
  "line-height": ["normal"],
  "letter-spacing": ["normal"],
  "text-align": ["start", "left"],
  "text-transform": ["none"],
  "text-decoration-line": ["none"],
  "background-color": ["rgba(0, 0, 0, 0)", "transparent"],
  "background-image": ["none"],
  "box-shadow": ["none"],
  opacity: ["1"],
  "border-radius": ["0px"],
  "border-top-width": ["0px"], "border-right-width": ["0px"],
  "border-bottom-width": ["0px"], "border-left-width": ["0px"],
  "border-top-style": ["none"], "border-right-style": ["none"],
  "border-bottom-style": ["none"], "border-left-style": ["none"],
  position: ["static"],
  gap: ["normal", "0px", "normal normal"],
  "flex-direction": ["row"],
  "justify-content": ["normal", "flex-start"],
  "align-items": ["normal", "stretch"],
  "margin-top": ["0px"], "margin-right": ["0px"],
  "margin-bottom": ["0px"], "margin-left": ["0px"],
  "padding-top": ["0px"], "padding-right": ["0px"],
  "padding-bottom": ["0px"], "padding-left": ["0px"],
};

function compactStyles(raw: CapturedStyles | undefined): CapturedStyles {
  const out: CapturedStyles = {};
  if (!raw) return out;
  for (const [prop, value] of Object.entries(raw)) {
    if (!KEEP_SET.has(prop)) continue;
    if (typeof value !== "string" || value === "") continue;
    const defaults = STYLE_DEFAULTS[prop];
    if (defaults && defaults.includes(value)) continue;
    out[prop] = value;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Asset reference matching
 * ------------------------------------------------------------------------ */

type AssetLookup = Map<string, string>; // url (absolute or path-only) -> asset id

function pathOnly(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function buildAssetLookup(assets: AssetRef[]): AssetLookup {
  const lookup: AssetLookup = new Map();
  for (const a of assets) {
    if (!a || !a.originalUrl) continue;
    if (!lookup.has(a.originalUrl)) lookup.set(a.originalUrl, a.id);
    const p = pathOnly(a.originalUrl);
    if (p && !lookup.has(p)) lookup.set(p, a.id);
  }
  return lookup;
}

/** Pull candidate URLs out of an element's verbatim HTML + styles. Regex on
 *  serialized HTML is deliberate: it is approximate matching for cross-
 *  referencing, not parsing — a miss costs a link in assetRefs, never data. */
function extractUrlCandidates(html: string, styles: CapturedStyles): string[] {
  const out: string[] = [];
  const attrRe = /(?:src|href|poster)\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html))) out.push(m[1]);
  const srcsetRe = /srcset\s*=\s*"([^"]+)"/gi;
  while ((m = srcsetRe.exec(html))) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) out.push(url);
    }
  }
  const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  while ((m = urlRe.exec(html))) out.push(m[1]);
  const bg = styles["background-image"];
  if (bg) {
    while ((m = urlRe.exec(bg))) out.push(m[1]);
  }
  return out;
}

function matchAssetRefs(
  html: string,
  styles: CapturedStyles,
  pageUrl: string,
  lookup: AssetLookup
): string[] {
  const ids = new Set<string>();
  for (const candidate of extractUrlCandidates(html, styles)) {
    const direct = lookup.get(candidate);
    if (direct) {
      ids.add(direct);
      continue;
    }
    try {
      const resolved = new URL(candidate, pageUrl);
      const byAbs = lookup.get(resolved.href);
      if (byAbs) {
        ids.add(byAbs);
        continue;
      }
      const byPath = lookup.get(resolved.pathname + resolved.search);
      if (byPath) ids.add(byPath);
    } catch {
      // not a resolvable URL — fine, skip
    }
  }
  return Array.from(ids);
}

/* ---------------------------------------------------------------------------
 * Section splitting
 * ------------------------------------------------------------------------ */

const WRAPPER_TAGS = new Set(["div", "main", "section", "article", "span"]);

function elementChildren(node: DomNode): DomNode[] {
  return (node.children || []).filter((c) => {
    if (c.type !== "tag") return false;
    return !SKIP_TAGS.has((c.name || "").toLowerCase());
  });
}

function hasDirectText(node: DomNode): boolean {
  return (node.children || []).some(
    (c) => c.type === "text" && (c.data || "").trim() !== ""
  );
}

/**
 * Top-level section candidates: direct children of body after descending
 * page-wrapper chains (WordPress's div#page > div#content etc.), with
 * <main> expanded to its own children so real content sections don't all
 * collapse into one giant candidate. Approximate is fine (spec §1c); the
 * "loose" fallback section in normalizePage guarantees nothing escapes.
 *
 * SYNC POINT: the capture layer keys its per-section screenshot crops by
 * index into this same candidate list, computed over the live DOM with the
 * same rules. If these rules change, change them there too.
 */
function computeSectionCandidates(body: DomNode): DomNode[] {
  let root = body;
  // Descend single-wrapper chains: exactly one element child, wrapper tag,
  // no direct text of its own.
  for (;;) {
    const kids = elementChildren(root);
    if (
      kids.length === 1 &&
      WRAPPER_TAGS.has((kids[0].name || "").toLowerCase()) &&
      !hasDirectText(root)
    ) {
      root = kids[0];
      continue;
    }
    break;
  }
  const out: DomNode[] = [];
  const expand = (node: DomNode): void => {
    for (const child of elementChildren(node)) {
      const name = (child.name || "").toLowerCase();
      const role = ((child.attribs || {}).role || "").toLowerCase();
      if (name === "main" || role === "main") expand(child);
      else out.push(child);
    }
  };
  expand(root);
  return out;
}

/** Nearest candidate ancestor (or the node itself). null = loose content. */
function candidateFor(
  node: DomNode,
  candidateIndex: Map<DomNode, number>
): number | null {
  let cur: DomNode | null | undefined = node;
  while (cur) {
    const idx = candidateIndex.get(cur);
    if (idx !== undefined) return idx;
    cur = cur.parent;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Navigation extraction
 * ------------------------------------------------------------------------ */

function navLocation(node: DomNode): string {
  let cur: DomNode | null | undefined = node;
  while (cur) {
    const name = (cur.name || "").toLowerCase();
    if (name === "header") return "header";
    if (name === "footer") return "footer";
    cur = cur.parent;
  }
  return "other";
}

function parseNavItems($: CheerioApi, scope: DomNode): NavItem[] {
  const lists = elementChildren(scope).filter(
    (c) => (c.name || "").toLowerCase() === "ul" || (c.name || "").toLowerCase() === "ol"
  );
  if (lists.length === 0) {
    // No list markup — fall back to direct links, one flat level.
    const items: NavItem[] = [];
    const stack: DomNode[] = [scope];
    while (stack.length) {
      const n = stack.shift() as DomNode;
      for (const child of elementChildren(n)) {
        const name = (child.name || "").toLowerCase();
        if (name === "a" && (child.attribs || {}).href !== undefined) {
          items.push({
            label: collapseWhitespace(getText(child)),
            href: (child.attribs || {}).href || "",
            children: [],
          });
        } else {
          stack.push(child);
        }
      }
    }
    return items;
  }
  const fromList = (list: DomNode): NavItem[] => {
    const items: NavItem[] = [];
    for (const li of elementChildren(list)) {
      if ((li.name || "").toLowerCase() !== "li") continue;
      const kids = elementChildren(li);
      const link = kids.find(
        (k) => (k.name || "").toLowerCase() === "a" && (k.attribs || {}).href !== undefined
      );
      const sublist = kids.find((k) => {
        const n = (k.name || "").toLowerCase();
        return n === "ul" || n === "ol";
      });
      const label = collapseWhitespace(link ? getText(link) : getText(li));
      if (!label && !sublist) continue;
      items.push({
        label,
        href: link ? (link.attribs || {}).href || "" : "",
        children: sublist ? fromList(sublist) : [],
      });
    }
    return items;
  };
  return lists.flatMap(fromList);
}

function extractNavs($: CheerioApi, pageUrl: string): NavTree[] {
  const navs: NavTree[] = [];
  $("nav").each((_i, el) => {
    const node = el as unknown as DomNode;
    const items = parseNavItems($, node);
    if (items.length) {
      navs.push({ location: navLocation(node), pageUrl, items });
    }
  });
  return navs;
}

/* ---------------------------------------------------------------------------
 * Raw design tokens
 * ------------------------------------------------------------------------ */

type TokenTally = Map<string, number>;

function tally(map: TokenTally, value: string, count = 1): void {
  const v = value.trim();
  if (!v) return;
  map.set(v, (map.get(v) || 0) + count);
}

function tallyToTokens(map: TokenTally): TokenCount[] {
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

const COLOR_PROPS = new Set([
  "color", "background-color",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
]);
const IGNORED_COLORS = new Set(["rgba(0, 0, 0, 0)", "transparent"]);
const SPACING_PROPS = new Set([
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
]);

/* ---------------------------------------------------------------------------
 * The normalizer
 * ------------------------------------------------------------------------ */

export type NormalizePageCaptures = {
  desktop: CaptureResult;
  tablet?: CaptureResult | null;
  mobile?: CaptureResult | null;
};

export type NormalizeInput = {
  jobId: string;
  sourceUrl: string;
  /** ISO timestamp of the capture run — supplied by the worker (scripts may
   *  not call Date.now(); the run stamps it once at job start). */
  capturedAt: string;
  /** Crawl order — becomes taxonomy.pageOrder. */
  pages: NormalizePageCaptures[];
  /** Asset manifest from the ingestion stage; referencedBy is (re)computed
   *  here, where sourceIds are known. */
  assets: AssetRef[];
  pageStats?: { discovered: number; captured: number; failed: number };
  capsHit?: string[];
};

export type NormalizeOutput = { ir: SiteIR; coverage: Coverage };

type PageBuild = {
  page: PageIR;
  captured: CoverageCounts;
  /** sourceId -> asset ids, for referencedBy augmentation. */
  assetUses: { sourceId: string; assetIds: string[] }[];
};

function pagePath(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p === "" ? "/" : p;
  } catch {
    return url || "/";
  }
}

/** The never-give-up fallback: the whole page as one "other" element with
 *  the raw HTML preserved verbatim. Coverage will show the difference as
 *  dropped counts — loud by design, because reaching this path means the
 *  normalizer itself has a bug worth seeing. */
function degradedPage(
  pageIdx: number,
  captures: NormalizePageCaptures
): PageBuild {
  const desktop = captures.desktop || ({} as CaptureResult);
  const rawHtml = String(desktop.html ?? "");
  const url = desktop.finalUrl || desktop.url || "";
  const meta = desktop.meta || {
    title: "", metaDescription: "", ogTags: {}, canonicalUrl: "", lang: "",
  };
  let captured: CoverageCounts;
  try {
    captured = countCapturedByClass(rawHtml);
  } catch {
    captured = { other: 1 };
  }
  const element: ElementIR = {
    sourceId: computeSourceId(pageIdx, "body"),
    class: "other",
    html: stripScimMarkers(rawHtml),
    textContent: "",
    textLength: 0,
    computedStyles: {},
    documentPosition: 0,
    depth: 0,
    assetRefs: [],
  };
  return {
    page: {
      url,
      path: pagePath(url),
      title: meta.title || "",
      metaDescription: meta.metaDescription || "",
      ogTags: meta.ogTags || {},
      canonicalUrl: meta.canonicalUrl || "",
      lang: meta.lang || "",
      sections: [
        {
          sourceId: `${pageIdx}-degraded`,
          type: "unknown",
          screenshot: desktop.fullPageScreenshot || "",
          elements: [element],
        },
      ],
      screenshots: {
        desktop: desktop.fullPageScreenshot || "",
        tablet: captures.tablet?.fullPageScreenshot || "",
        mobile: captures.mobile?.fullPageScreenshot || "",
      },
    },
    captured,
    assetUses: [],
  };
}

function normalizePage(
  pageIdx: number,
  captures: NormalizePageCaptures,
  assetLookup: AssetLookup,
  tokens: {
    colors: TokenTally;
    fontSizes: TokenTally;
    fontFamilies: TokenTally;
    spacing: TokenTally;
  },
  navSink: NavTree[]
): PageBuild {
  const desktop = captures.desktop;
  const url = desktop.finalUrl || desktop.url || "";
  const styles = desktop.styles || {};

  const { $, body } = parseBody(desktop.html);
  if (!body) return degradedPage(pageIdx, captures);

  // Raw-side count: independent invocation over the same HTML ("counted
  // twice" per spec §1c — this one never sees the IR).
  const captured = countCapturedByClass(desktop.html);

  // Section candidates + index for ancestor lookup.
  const candidates = computeSectionCandidates(body);
  const candidateIndex = new Map<DomNode, number>();
  candidates.forEach((node, i) => candidateIndex.set(node, i));

  // One walk builds every element, assigned to its candidate section.
  const perCandidate = new Map<number, ElementIR[]>();
  const loose: ElementIR[] = [];
  const usedIds = new Set<string>();
  const assetUses: PageBuild["assetUses"] = [];
  let position = 0;

  walkCountables(body, (v) => {
    let sourceId = computeSourceId(pageIdx, v.domPath);
    if (usedIds.has(sourceId)) sourceId = `${sourceId}-${position}`;
    usedIds.add(sourceId);

    let el: ElementIR;
    if (v.kind === "textRun") {
      // A bare text run has no outer HTML of its own — carry the text,
      // escaped, so `html` stays renderable.
      const textContent = collapseWhitespace(v.text);
      el = {
        sourceId,
        class: "text",
        html: escapeHtml(v.text.trim()),
        textContent,
        textLength: textContent.length,
        computedStyles: compactStyles(styles[(v.parentNode.attribs || {})["data-scim"] || ""]),
        documentPosition: position++,
        depth: v.depth,
        assetRefs: [],
      };
    } else {
      const html = stripScimMarkers(outerHtml($, v.node));
      const textContent = collapseWhitespace(getText(v.node));
      const scimKey = (v.node.attribs || {})["data-scim"] || "";
      const computedStyles = compactStyles(styles[scimKey]);
      const assetRefs = matchAssetRefs(html, computedStyles, url, assetLookup);
      const crop = (desktop.elementScreenshots || {})[sourceId];
      el = {
        sourceId,
        class: v.cls,
        html,
        textContent,
        textLength: textContent.length,
        computedStyles,
        documentPosition: position++,
        depth: v.depth,
        ...(crop ? { screenshot: crop } : {}),
        assetRefs,
      };
      if (assetRefs.length) assetUses.push({ sourceId, assetIds: assetRefs });
    }

    const target =
      v.kind === "element"
        ? candidateFor(v.node, candidateIndex)
        : candidateFor(v.parentNode, candidateIndex);
    if (target === null) {
      loose.push(el);
    } else {
      const list = perCandidate.get(target) || [];
      list.push(el);
      perCandidate.set(target, list);
    }
  });

  // Sections in candidate document order; only candidates that actually
  // received content become sections. Loose content (rare: text sitting
  // directly in <body>) gets a trailing catch-all section — completeness
  // over tidiness.
  const sectionShots = desktop.sectionScreenshots || {};
  const sections: SectionIR[] = [];
  candidates.forEach((node, i) => {
    const elements = perCandidate.get(i);
    if (!elements || elements.length === 0) return;
    let sectionPath = `section[${i}]`;
    sections.push({
      sourceId: computeSourceId(pageIdx, sectionPath),
      type: "unknown",
      screenshot: sectionShots[String(i)] || "",
      elements,
    });
  });
  if (loose.length) {
    sections.push({
      sourceId: `${pageIdx}-loose`,
      type: "unknown",
      screenshot: "",
      elements: loose,
    });
  }

  // Raw design tokens from this page's captured styles.
  for (const styleMap of Object.values(styles)) {
    for (const [prop, value] of Object.entries(styleMap || {})) {
      if (COLOR_PROPS.has(prop) && !IGNORED_COLORS.has(value)) {
        tally(tokens.colors, value);
      } else if (prop === "font-size") {
        tally(tokens.fontSizes, value);
      } else if (SPACING_PROPS.has(prop) && value !== "0px") {
        tally(tokens.spacing, value);
      }
    }
  }
  for (const f of desktop.fontFamilies || []) {
    tally(tokens.fontFamilies, f.value, f.count || 1);
  }

  navSink.push(...extractNavs($, url));

  const meta = desktop.meta || {
    title: "", metaDescription: "", ogTags: {}, canonicalUrl: "", lang: "",
  };
  return {
    page: {
      url,
      path: pagePath(url),
      title: meta.title || "",
      metaDescription: meta.metaDescription || "",
      ogTags: meta.ogTags || {},
      canonicalUrl: meta.canonicalUrl || "",
      lang: meta.lang || "",
      sections,
      screenshots: {
        desktop: desktop.fullPageScreenshot || "",
        tablet: captures.tablet?.fullPageScreenshot || "",
        mobile: captures.mobile?.fullPageScreenshot || "",
      },
    },
    captured,
    assetUses,
  };
}

/** Same-items navs repeat on every page (headers, footers). Keep the first
 *  occurrence of each distinct tree. */
function dedupeNavs(navs: NavTree[]): NavTree[] {
  const seen = new Set<string>();
  const out: NavTree[] = [];
  for (const nav of navs) {
    const key = nav.location + " " + JSON.stringify(nav.items);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(nav);
  }
  return out;
}

/**
 * CaptureResult[] → { ir, coverage }. Pure; never throws. Coverage's page
 * stats and cap list come from the worker via input (the normalizer only
 * knows element classes).
 */
export function normalizeSite(input: NormalizeInput): NormalizeOutput {
  const pagesIn = Array.isArray(input?.pages) ? input.pages : [];
  const assetsIn = Array.isArray(input?.assets) ? input.assets : [];
  const assetLookup = buildAssetLookup(assetsIn);

  const tokens = {
    colors: new Map<string, number>(),
    fontSizes: new Map<string, number>(),
    fontFamilies: new Map<string, number>(),
    spacing: new Map<string, number>(),
  };
  const navs: NavTree[] = [];
  const captured: CoverageCounts = {};
  const pages: PageIR[] = [];
  const usesByAsset = new Map<string, { pageUrl: string; sourceId: string }[]>();

  pagesIn.forEach((captures, pageIdx) => {
    if (!captures || !captures.desktop) return;
    let build: PageBuild;
    try {
      build = normalizePage(pageIdx, captures, assetLookup, tokens, navs);
    } catch {
      build = degradedPage(pageIdx, captures);
    }
    pages.push(build.page);
    mergeCounts(captured, build.captured);
    for (const use of build.assetUses) {
      for (const assetId of use.assetIds) {
        const list = usesByAsset.get(assetId) || [];
        list.push({ pageUrl: build.page.url, sourceId: use.sourceId });
        usesByAsset.set(assetId, list);
      }
    }
  });

  // Augment the asset manifest with where each asset is used, now that
  // sourceIds exist. Existing entries (e.g. from the capture stage's
  // element keys) are replaced by the normalized ones.
  const assets: AssetRef[] = assetsIn.map((a) => ({
    ...a,
    referencedBy: usesByAsset.get(a.id) || a.referencedBy || [],
  }));

  const ir: SiteIR = {
    irVersion: IR_VERSION,
    jobId: String(input?.jobId ?? ""),
    sourceUrl: String(input?.sourceUrl ?? ""),
    capturedAt: String(input?.capturedAt ?? ""),
    pages,
    assets,
    taxonomy: {
      navs: dedupeNavs(navs),
      pageOrder: pages.map((p) => p.path),
    },
    rawTokens: {
      colors: tallyToTokens(tokens.colors),
      fontSizes: tallyToTokens(tokens.fontSizes),
      fontFamilies: tallyToTokens(tokens.fontFamilies),
      spacing: tallyToTokens(tokens.spacing),
    },
  };

  const coverage = computeCoverage({
    captured,
    emitted: tallyEmittedByClass(ir),
    pages:
      input?.pageStats || {
        discovered: pagesIn.length,
        captured: pages.length,
        failed: 0,
      },
    capsHit: Array.isArray(input?.capsHit) ? input.capsHit : [],
  });

  return { ir, coverage };
}
