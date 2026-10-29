/**
 * Site Import — the Phase 1 CaptureProvider: local Playwright/Chromium
 * (ratified decision 2). Runs off-Vercel only (Playwright cannot run
 * there — routes/platformScreenshots.js documents the same constraint).
 *
 * One capture() = one page at one viewport. Desktop (1440) is the full
 * capture: computed styles for every visible element, per-section and
 * per-element screenshot crops; tablet/mobile record rendered HTML + a
 * full-page screenshot only (spec §1b).
 *
 * Two contracts anchor everything this file measures in the browser:
 *  - data-scim stamping + the curated CAPTURE_STYLE_PROPS list join
 *    computed styles to elements (normalize.ts strips the markers).
 *  - domPath segments ("body/div[0]/p[2]", indexing ALL element siblings)
 *    must equal what walkCountables derives when it re-parses the
 *    serialized HTML — that is what lets the worker key element crops by
 *    computeSourceId(pageIdx, domPath) and have them join back on.
 */

import { chromium, type Browser } from "playwright";
import type { AssetUrlRef, CaptureOptions, CaptureProvider, CapturedDecoration, RawCapture } from "./ir";
import { CAPTURE_STYLE_PROPS, DECORATION_STYLE_PROPS } from "./normalize";

export const DEFAULT_USER_AGENT =
  "StarCaster-SiteImport/1.0 (+https://starcaster.pro)";

/** Spec §1b viewport widths; heights are common device values (full-page
 *  screenshots scroll, so height only affects initial layout). */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, label: "desktop" as const },
  tablet: { width: 768, height: 1024, label: "tablet" as const },
  mobile: { width: 390, height: 844, label: "mobile" as const },
};

/** Tags whose raw HTML the Builder embed sanitizer strips — their crops
 *  are the placeholder's primary payload (spec amendment A). */
const CROPPED_TAGS = ["form", "video", "table", "iframe", "embed", "object", "svg", "canvas", "audio"];

/** Sanity caps so a pathological page can't turn one capture into
 *  thousands of screenshots. Overflow is visible: elements past the cap
 *  simply have no crop in the UI. */
const MAX_SECTION_CROPS = 30;
const MAX_ELEMENT_CROPS = 40;

type PageScanResult = {
  html: string;
  styles: Record<string, Record<string, string>>;
  rects: Record<string, [number, number, number, number]>;
  pageBackground: string;
  decorations: CapturedDecoration[];
  /** Crop targets by their data-scim stamp — the provider screenshots them
   *  via locator('[data-scim=…]'), which scrolls each into view. A clip
   *  rect would NOT work: page.screenshot({clip}) only sees the current
   *  viewport, so anything below the fold fails (found the hard way on
   *  delraytennis.com — every table sat below 900px). */
  sectionTargets: { index: number; scim: string }[];
  elementCropTargets: { domPath: string; scim: string }[];
  assetUrls: AssetUrlRef[];
  fontFamilies: { value: string; count: number }[];
  meta: {
    title: string;
    metaDescription: string;
    ogTags: Record<string, string>;
    canonicalUrl: string;
    lang: string;
  };
};

type PageScanArgs = {
  styleProps: string[];
  decorationProps: string[];
  fullCapture: boolean;
  croppedTags: string[];
  maxSectionCrops: number;
  maxElementCrops: number;
};

/**
 * Runs INSIDE the page (Playwright serializes the function source, so it
 * must be fully self-contained — no references to module scope). Keep the
 * skip/wrapper tag lists and candidate rules in sync with normalize.ts;
 * both sides carry a SYNC POINT comment.
 */
function pageScan(args: PageScanArgs): PageScanResult {
  const SKIP_TAGS = [
    "script", "style", "template", "noscript", "link", "meta",
    "base", "title", "head", "br", "hr", "wbr",
  ];
  const WRAPPER_TAGS = ["div", "main", "section", "article", "span"];
  // Atoms the countable walk never descends into — an element nested in
  // one of these is never visited, so cropping it would be wasted work.
  const ATOM_TAGS = args.croppedTags.concat([
    "p", "blockquote", "pre", "dt", "dd", "figcaption", "address",
    "h1", "h2", "h3", "h4", "h5", "h6", "button", "a", "img", "picture",
  ]);

  const body = document.body;
  const styles: Record<string, Record<string, string>> = {};
  const rects: Record<string, [number, number, number, number]> = {};
  const fontTally: Record<string, number> = {};
  const assetUrls: AssetUrlRef[] = [];
  const seenAssets: Record<string, boolean> = {};
  const decorations: CapturedDecoration[] = [];

  function absolutize(raw: string): string | null {
    try {
      const u = new URL(raw, document.baseURI);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  }

  function pushAsset(raw: string, via: AssetUrlRef["via"], alt?: string): void {
    const url = absolutize(raw);
    if (!url || seenAssets[url]) return;
    seenAssets[url] = true;
    const ref: AssetUrlRef = { url, via };
    if (alt) ref.alt = alt;
    assetUrls.push(ref);
  }

  function isVisible(el: Element): boolean {
    const rects = el.getClientRects();
    if (!rects.length) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /**
   * True for the "sr-only" pattern: text hidden from sighted visitors but
   * left in the accessibility tree by clipping it to nothing. The element
   * keeps its layout box, so every geometry test calls it visible, and the
   * text rides into the import as ordinary body copy once the source CSS
   * is gone — every imported Delray page opened with "Skip to primary
   * navigation Skip to main content" (2026-08-09).
   *
   * Deliberately ONLY the clip techniques, matched on computed style so it
   * holds across themes (screen-reader-text, sr-only, visually-hidden,
   * screen-reader-shortcut…). `display:none` and off-screen positioning
   * are NOT included: that is how themes park dropdown submenus until
   * hover, and dropping those would delete the imported site's menu.
   */
  function isScreenReaderOnly(el: Element): boolean {
    const cs = getComputedStyle(el);
    const clip = (cs.clip || "").replace(/\s+/g, "");
    if (/^rect\((0(px)?|1px),/.test(clip)) return true;
    const clipPath = (cs.clipPath || "").replace(/\s+/g, "");
    return /^inset\((50|100)%/.test(clipPath);
  }

  function elementChildren(el: Element): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      if (SKIP_TAGS.indexOf(child.tagName.toLowerCase()) === -1) out.push(child);
    }
    return out;
  }

  function hasDirectText(el: Element): boolean {
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 3 && (n.textContent || "").trim() !== "") return true;
    }
    return false;
  }

  /** Tag/index path from body — MUST mirror walkCountables' childPath:
   *  the index counts ALL element siblings, including skip-listed tags. */
  function domPath(el: Element): string | null {
    const segments: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== body) {
      const parent: Element | null = cur.parentElement;
      if (!parent) return null;
      let idx = 0;
      let sib = cur.previousElementSibling;
      while (sib) {
        idx++;
        sib = sib.previousElementSibling;
      }
      segments.unshift(cur.tagName.toLowerCase() + "[" + idx + "]");
      cur = parent;
    }
    if (cur !== body) return null;
    return "body/" + segments.join("/");
  }

  // --- ::before / ::after layers (task 86bctde48) -------------------------
  // SYNC POINT: what "paints" means here must agree with decorationStyles()
  // in normalize.ts — a layer recorded here that normalizes to nothing would
  // be listed in the fidelity report as a decoration with no look at all.
  function clearColour(v: string): boolean {
    const t = (v || "").trim();
    return !t || t === "transparent" || /^rgba\([^)]*,\s*0(\.0+)?\)$/.test(t);
  }

  function layerPaints(cs: CSSStyleDeclaration): boolean {
    const content = cs.getPropertyValue("content");
    // No content, no box: the layer is not generated at all.
    if (!content || content === "none" || content === "normal") return false;
    if (cs.getPropertyValue("display") === "none") return false;
    if (cs.getPropertyValue("visibility") === "hidden" || cs.getPropertyValue("opacity") === "0") return false;
    if (/url\(/i.test(content)) return true;
    if (cs.getPropertyValue("background-image") !== "none") return true;
    if (!clearColour(cs.getPropertyValue("background-color"))) return true;
    if (cs.getPropertyValue("box-shadow") !== "none") return true;
    const sides = ["top", "right", "bottom", "left"];
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i];
      if (
        parseFloat(cs.getPropertyValue("border-" + side + "-width")) > 0 &&
        !/^(none|hidden)$/.test(cs.getPropertyValue("border-" + side + "-style")) &&
        !clearColour(cs.getPropertyValue("border-" + side + "-color"))
      ) return true;
    }
    return false;
  }

  /** The padding box a positioned layer is placed against, in page pixels:
   *  the nearest ancestor that is positioned (or transformed), else the
   *  initial containing block. The owner itself counts — for a pseudo-element
   *  the owner IS the first ancestor. */
  function containingBlock(el: Element, fixed: boolean): { x: number; y: number; w: number; h: number } {
    if (fixed) return { x: window.scrollX, y: window.scrollY, w: window.innerWidth, h: window.innerHeight };
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      if (cs.position !== "static" || cs.transform !== "none") {
        const r = cur.getBoundingClientRect();
        return {
          x: r.left + window.scrollX + cur.clientLeft,
          y: r.top + window.scrollY + cur.clientTop,
          w: cur.clientWidth,
          h: cur.clientHeight,
        };
      }
      cur = cur.parentElement;
    }
    return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  }

  /** Browsers give a pseudo-element no getBoundingClientRect, so its box is
   *  rebuilt from its computed offsets, size and 2D transform. */
  function layerBox(
    el: Element,
    cs: CSSStyleDeclaration,
    owner: [number, number, number, number]
  ): { box: [number, number, number, number]; size: [number, number]; boxFrom: "offsets" | "owner" } {
    const px = (v: string) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : NaN);
    let w = px(cs.getPropertyValue("width"));
    let h = px(cs.getPropertyValue("height"));
    // Computed width/height are the content box; the painted box includes
    // padding and border unless box-sizing already does.
    if (cs.getPropertyValue("box-sizing") !== "border-box") {
      const extra = (a: string, b: string) => (px(cs.getPropertyValue(a)) || 0) + (px(cs.getPropertyValue(b)) || 0);
      if (!isNaN(w)) w += extra("padding-left", "padding-right") + extra("border-left-width", "border-right-width");
      if (!isNaN(h)) h += extra("padding-top", "padding-bottom") + extra("border-top-width", "border-bottom-width");
    }
    const position = cs.getPropertyValue("position");
    let x = owner[0];
    let y = owner[1];
    let boxFrom: "offsets" | "owner" = "owner";
    if (position === "absolute" || position === "fixed") {
      const cb = containingBlock(el, position === "fixed");
      if (isNaN(w)) w = cb.w;
      if (isNaN(h)) h = cb.h;
      const left = px(cs.getPropertyValue("left"));
      const right = px(cs.getPropertyValue("right"));
      const top = px(cs.getPropertyValue("top"));
      const bottom = px(cs.getPropertyValue("bottom"));
      x = !isNaN(left) ? cb.x + left : !isNaN(right) ? cb.x + cb.w - right - w : cb.x;
      y = !isNaN(top) ? cb.y + top : !isNaN(bottom) ? cb.y + cb.h - bottom - h : cb.y;
      boxFrom = "offsets";
    }
    if (isNaN(w)) w = owner[2];
    if (isNaN(h)) h = owner[3];
    const size: [number, number] = [Math.round(w), Math.round(h)];
    // A 2D transform (translate(-50%,-50%) centring, a scale) moves the
    // painted box: map its corners through the matrix about the origin.
    const m = /^matrix\(([^)]+)\)$/.exec(cs.getPropertyValue("transform"));
    if (m) {
      const [a, b, c, d, e, f] = m[1].split(",").map((n) => parseFloat(n));
      const origin = cs.getPropertyValue("transform-origin").split(" ").map((n) => parseFloat(n) || 0);
      const ox = x + origin[0];
      const oy = y + (origin[1] || 0);
      const xs: number[] = [];
      const ys: number[] = [];
      const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
      for (let i = 0; i < corners.length; i++) {
        const dx = corners[i][0] - ox;
        const dy = corners[i][1] - oy;
        xs.push(ox + a * dx + c * dy + e);
        ys.push(oy + b * dx + d * dy + f);
      }
      x = Math.min.apply(null, xs);
      y = Math.min.apply(null, ys);
      w = Math.max.apply(null, xs) - x;
      h = Math.max.apply(null, ys) - y;
    }
    return { box: [Math.round(x), Math.round(y), Math.round(w), Math.round(h)], size, boxFrom };
  }

  function labelOf(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + el.id;
    const classes = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return classes.length ? tag + "." + classes.join(".") : tag;
  }

  function recordDecorations(el: Element, key: string, owner: [number, number, number, number]): void {
    const pseudos: ("before" | "after")[] = ["before", "after"];
    for (let i = 0; i < pseudos.length; i++) {
      const pseudo = pseudos[i];
      const cs = window.getComputedStyle(el, "::" + pseudo);
      if (!layerPaints(cs)) continue;
      const picked: Record<string, string> = {};
      for (let p = 0; p < args.decorationProps.length; p++) {
        const value = cs.getPropertyValue(args.decorationProps[p]);
        if (value) picked[args.decorationProps[p]] = value;
      }
      const placed = layerBox(el, cs, owner);
      decorations.push({
        owner: key,
        pseudo,
        label: labelOf(el),
        box: placed.box,
        size: placed.size,
        boxFrom: placed.boxFrom,
        zIndex: cs.getPropertyValue("z-index") || "auto",
        styles: picked,
      });
      // A picture painted by the layer is a file the import must download.
      const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
      const painted = (picked["background-image"] || "") + " " + (picked.content || "");
      let u: RegExpExecArray | null;
      while ((u = re.exec(painted))) pushAsset(u[1], "css-pseudo");
    }
  }

  // --- Drop screen-reader-only text ---------------------------------------
  // Before anything is stamped, pathed, or serialized, so data-scim keys,
  // domPaths and the emitted HTML all agree. Removing it cannot change a
  // screenshot: it was clipped to nothing on screen to begin with.
  {
    const all = body.querySelectorAll("*");
    const doomed: Element[] = [];
    for (let i = 0; i < all.length; i++) {
      if (isScreenReaderOnly(all[i])) doomed.push(all[i]);
    }
    for (let i = 0; i < doomed.length; i++) {
      const parent = doomed[i].parentNode;
      if (parent) parent.removeChild(doomed[i]);
    }
  }

  // --- Stamp + styles + fonts (desktop only) ------------------------------
  if (args.fullCapture) {
    let stamp = 0;
    const all = body.querySelectorAll("*");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.indexOf(tag) !== -1) continue;
      if (!isVisible(el)) continue;
      const key = String(stamp++);
      el.setAttribute("data-scim", key);
      const computed = window.getComputedStyle(el);
      const picked: Record<string, string> = {};
      for (let p = 0; p < args.styleProps.length; p++) {
        const prop = args.styleProps[p];
        const value = computed.getPropertyValue(prop);
        if (value) picked[prop] = value;
      }
      styles[key] = picked;
      // Page coordinates (the provider scrolls back to the top before this
      // scan, but scroll offsets are added anyway so a page that refuses to
      // scroll home still measures consistently). Column inference reads it.
      const r = el.getBoundingClientRect();
      rects[key] = [
        Math.round(r.left + window.scrollX),
        Math.round(r.top + window.scrollY),
        Math.round(r.width),
        Math.round(r.height),
      ];
      recordDecorations(el, key, rects[key]);
      const family = computed.getPropertyValue("font-family");
      if (family) fontTally[family] = (fontTally[family] || 0) + 1;
      const bg = computed.getPropertyValue("background-image");
      if (bg && bg !== "none") {
        const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(bg))) pushAsset(m[1], "css-background");
      }
    }
  }

  // --- Asset URL manifest -------------------------------------------------
  // SYNC POINT: mirrors splitSrcsetCandidates() in normalize.ts — split on
  // comma-followed-by-whitespace only, because image URLs may legally
  // contain commas (WP/Jetpack `?resize=993,994`), and drop bare-number
  // fragments. Naive comma-splitting fabricated 20 phantom 404s on the
  // delraytennis.com DoD run.
  function srcsetCandidates(value: string): string[] {
    const out: string[] = [];
    for (const part of String(value || "").split(/,\s+/)) {
      const candidate = part.trim().split(/\s+/)[0];
      if (candidate && !/^\d+w?$/.test(candidate)) out.push(candidate);
    }
    return out;
  }

  const imgs = document.querySelectorAll("img");
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i] as HTMLImageElement;
    pushAsset(img.currentSrc || img.src, "img", img.alt || undefined);
    for (const candidate of srcsetCandidates(img.getAttribute("srcset") || "")) {
      pushAsset(candidate, "srcset");
    }
  }
  const sources = document.querySelectorAll("source");
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const srcset = s.getAttribute("srcset") || s.getAttribute("src") || "";
    for (const candidate of srcsetCandidates(srcset)) {
      pushAsset(candidate, "srcset");
    }
  }
  const videos = document.querySelectorAll("video");
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i] as HTMLVideoElement;
    if (v.src) pushAsset(v.src, "video");
    if (v.poster) pushAsset(v.poster, "poster");
  }
  const anchors = document.querySelectorAll("a[href]");
  for (let i = 0; i < anchors.length; i++) {
    const href = anchors[i].getAttribute("href") || "";
    if (/\.pdf(\?|#|$)/i.test(href)) pushAsset(href, "pdf");
  }
  const icons = document.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon']");
  for (let i = 0; i < icons.length; i++) {
    const href = icons[i].getAttribute("href") || "";
    if (href) pushAsset(href, "favicon");
  }
  // Fonts actually loaded — the DOM never lists font FILES, but the
  // resource timing log does.
  try {
    const resources = performance.getEntriesByType("resource");
    for (let i = 0; i < resources.length; i++) {
      const entry = resources[i] as PerformanceResourceTiming;
      if (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(entry.name)) {
        pushAsset(entry.name, "font");
      }
    }
  } catch {
    /* resource timing unavailable — fonts just go unlisted */
  }

  // --- Section candidates + element crops (desktop only) ------------------
  // SYNC POINT: mirrors computeSectionCandidates() in normalize.ts.
  const sectionTargets: { index: number; scim: string }[] = [];
  const elementCropTargets: { domPath: string; scim: string }[] = [];
  if (args.fullCapture) {
    let root: Element = body;
    for (;;) {
      const kids = elementChildren(root);
      if (
        kids.length === 1 &&
        WRAPPER_TAGS.indexOf(kids[0].tagName.toLowerCase()) !== -1 &&
        !hasDirectText(root)
      ) {
        root = kids[0];
        continue;
      }
      break;
    }
    const candidates: Element[] = [];
    const expand = (node: Element): void => {
      const kids = elementChildren(node);
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        const role = (child.getAttribute("role") || "").toLowerCase();
        if (child.tagName.toLowerCase() === "main" || role === "main") expand(child);
        else candidates.push(child);
      }
    };
    expand(root);
    for (let i = 0; i < candidates.length && sectionTargets.length < args.maxSectionCrops; i++) {
      if (!isVisible(candidates[i])) continue;
      const scim = candidates[i].getAttribute("data-scim");
      if (scim !== null) sectionTargets.push({ index: i, scim });
    }

    const cropTargets = document.querySelectorAll(args.croppedTags.join(","));
    for (let i = 0; i < cropTargets.length && elementCropTargets.length < args.maxElementCrops; i++) {
      const el = cropTargets[i];
      if (!isVisible(el)) continue;
      // Skip elements nested inside an atom the countable walk never
      // enters — their crop could never join to an emitted element.
      let ancestor = el.parentElement;
      let swallowed = false;
      while (ancestor && ancestor !== body) {
        if (ATOM_TAGS.indexOf(ancestor.tagName.toLowerCase()) !== -1) {
          swallowed = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (swallowed) continue;
      const path = domPath(el);
      const scim = el.getAttribute("data-scim");
      if (!path || scim === null) continue;
      elementCropTargets.push({ domPath: path, scim });
    }
  }

  // --- Metadata -----------------------------------------------------------
  const ogTags: Record<string, string> = {};
  const metas = document.querySelectorAll("meta[property^='og:']");
  for (let i = 0; i < metas.length; i++) {
    const prop = metas[i].getAttribute("property") || "";
    const content = metas[i].getAttribute("content") || "";
    if (prop && content && !ogTags[prop]) ogTags[prop] = content;
  }
  if (ogTags["og:image"]) pushAsset(ogTags["og:image"], "other");
  const descEl = document.querySelector("meta[name='description']");
  const canonicalEl = document.querySelector("link[rel='canonical']");

  const fontFamilies = Object.keys(fontTally)
    .map((value) => ({ value, count: fontTally[value] }))
    .sort((a, b) => b.count - a.count);

  return {
    html: document.documentElement.outerHTML,
    styles,
    rects,
    // The page's own ground colour — <body>, else <html>. Neither is stamped
    // (the stamp loop walks body's DESCENDANTS), and it is the one colour the
    // import theme needs most (site-import theme.ts → palette.surface).
    pageBackground: (() => {
      const clear = (v: string) => !v || v === "transparent" || /rgba\([^)]*,\s*0\)$/.test(v);
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      if (!clear(bodyBg)) return bodyBg;
      const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
      return clear(htmlBg) ? "" : htmlBg;
    })(),
    decorations,
    sectionTargets,
    elementCropTargets,
    assetUrls,
    fontFamilies,
    meta: {
      title: document.title || "",
      metaDescription: descEl ? descEl.getAttribute("content") || "" : "",
      ogTags,
      canonicalUrl: canonicalEl ? canonicalEl.getAttribute("href") || "" : "",
      lang: document.documentElement.getAttribute("lang") || "",
    },
  };
}

export class PlaywrightCaptureProvider implements CaptureProvider {
  private browser: Browser | null = null;

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async capture(url: string, opts: CaptureOptions): Promise<RawCapture> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: opts.viewport.width, height: opts.viewport.height },
      userAgent: opts.userAgent,
    });
    const page = await context.newPage();
    try {
      page.setDefaultTimeout(opts.timeoutMs);
      await page.goto(url, { timeout: opts.timeoutMs, waitUntil: "domcontentloaded" });
      // Best-effort settle; JS-heavy sites that never go idle still capture.
      await page
        .waitForLoadState("networkidle", { timeout: Math.min(opts.timeoutMs, 15000) })
        .catch(() => {});

      // Walk the page once to trigger lazy-loaded content, then return to
      // the top so measured rects are in a scrolled-to-top coordinate frame.
      await page.evaluate(async () => {
        const step = window.innerHeight;
        const limit = Math.min(document.body.scrollHeight, step * 25);
        for (let y = 0; y < limit; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 350));
      });

      const scan = (await page.evaluate(pageScan, {
        styleProps: CAPTURE_STYLE_PROPS,
        decorationProps: DECORATION_STYLE_PROPS,
        fullCapture: opts.viewport.label === "desktop",
        croppedTags: CROPPED_TAGS,
        maxSectionCrops: MAX_SECTION_CROPS,
        maxElementCrops: MAX_ELEMENT_CROPS,
      })) as PageScanResult;

      const fullPage = await page.screenshot({ fullPage: true, type: "png" });

      // Element screenshots via the data-scim stamps — locator.screenshot()
      // scrolls the target into view, which a clip rect cannot do
      // (page.screenshot({clip}) only sees the current viewport, so
      // below-the-fold crops come back "outside the resulting image").
      const shoot = async (scim: string): Promise<Uint8Array | null> => {
        try {
          return await page
            .locator(`[data-scim="${scim}"]`)
            .screenshot({ type: "png", timeout: 5000, animations: "disabled" });
        } catch {
          // A crop that fails (element vanished, zero-size at shoot time)
          // is just a missing thumbnail — never fail the page for it.
          return null;
        }
      };

      const sections: RawCapture["screenshots"]["sections"] = [];
      for (const { index, scim } of scan.sectionTargets) {
        const png = await shoot(scim);
        if (png) sections.push({ index, png });
      }
      const elements: RawCapture["screenshots"]["elements"] = [];
      for (const { domPath, scim } of scan.elementCropTargets) {
        const png = await shoot(scim);
        if (png) elements.push({ domPath, png });
      }

      return {
        url,
        finalUrl: page.url(),
        viewport: opts.viewport.label,
        html: scan.html,
        styles: scan.styles,
        rects: scan.rects,
        pageBackground: scan.pageBackground,
        ...(opts.viewport.label === "desktop" ? { decorations: scan.decorations } : {}),
        assetUrls: scan.assetUrls,
        fontFamilies: scan.fontFamilies,
        meta: scan.meta,
        screenshots: { fullPage, sections, elements },
      };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
