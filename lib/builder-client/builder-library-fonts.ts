/**
 * Fonts from Starcaster's own font library (Font Library 3/7, task 86bchyd46).
 *
 * The library (1/7) keeps font files Starcaster stores itself — fonts that are
 * not on Google Fonts. A font slot stores one as "lf:<slug>" ("lf:orbitron"),
 * beside the ten built-in keys and "gf:<Family>" (builder-google-fonts.ts).
 *
 * The browser knows a library font by a name derived from its SLUG, not its
 * family: the @font-face rule is declared as "lf-orbitron", and the stack asks
 * for "lf-orbitron". That keeps the stack a pure function of the stored key —
 * it needs no database read to render — and it means a project's own upload
 * called "Inter" can never take over the built-in Inter on the same page.
 *
 * The renderer loads files only for the "lf:" fonts a page actually names
 * (collectLibraryFontSlugs → GET /api/public/fonts → libraryFontFaceCss). A page
 * naming none makes no request at all.
 */

export const LIBRARY_FONT_PREFIX = "lf:";

/** Slugs as lib/slugify.js writes them: lowercase letters, digits, single
 *  dashes. The 37-char cap keeps "lf:" + slug within the 40 chars a font slot
 *  stores, the same cap Google keys live under. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 37;

/** "orbitron" → "lf:orbitron"; "" when the slug is not a valid slug. */
export function libraryFontKey(slug: string): string {
  const value = String(slug ?? "").trim();
  if (!value || value.length > MAX_SLUG_LENGTH || !SLUG_RE.test(value)) return "";
  return `${LIBRARY_FONT_PREFIX}${value}`;
}

export function isLibraryFontKey(key: unknown): key is string {
  if (typeof key !== "string" || !key.startsWith(LIBRARY_FONT_PREFIX)) return false;
  return libraryFontKey(key.slice(LIBRARY_FONT_PREFIX.length)) === key;
}

/** "lf:orbitron" → "orbitron"; "" for anything that is not a library key. */
export function libraryFontSlug(key: unknown): string {
  return isLibraryFontKey(key) ? key.slice(LIBRARY_FONT_PREFIX.length) : "";
}

/** The name the browser knows a library font by: "orbitron" → "lf-orbitron". */
export function libraryFontFaceName(slug: string): string {
  return `lf-${slug}`;
}

/** CSS font-family stack for a library key; undefined otherwise. */
export function libraryFontStack(key: unknown): string | undefined {
  const slug = libraryFontSlug(key);
  return slug ? `'${libraryFontFaceName(slug)}', system-ui, sans-serif` : undefined;
}

/** At most this many library fonts load on one page — a guard against a
 *  document that names dozens, not a design limit. */
export const MAX_PAGE_LIBRARY_FONTS = 8;

/**
 * Every library slug named anywhere in these values (a theme, a page's
 * sections, module settings), deep-walked, de-duplicated, in first-seen order.
 */
export function collectLibraryFontSlugs(...sources: unknown[]): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (found.size >= MAX_PAGE_LIBRARY_FONTS || depth > 12) return;
    if (typeof value === "string") {
      const slug = libraryFontSlug(value);
      if (slug) found.add(slug);
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const child of children) walk(child, depth + 1);
  };
  for (const source of sources) walk(source, 0);
  return Array.from(found);
}

/** The public read that returns these fonts' files. Slugs sorted, so the same
 *  set of fonts is the same URL (and the same browser cache entry). */
export function libraryFontsRequestUrl(slugs: string[], projectId = ""): string {
  const list = Array.from(new Set(slugs.filter((slug) => libraryFontKey(slug)))).sort();
  const params = new URLSearchParams({ slugs: list.join(",") });
  if (projectId) params.set("projectId", projectId);
  return `/api/public/fonts?${params.toString()}`;
}

/** One file of a library font, as GET /api/public/fonts returns it. */
export type LibraryFontStyle = { weight: number; style: string; url: string; format?: string };
export type LibraryFont = { slug: string; family: string; category?: string; styles: LibraryFontStyle[] };

const FORMAT_HINT: Record<string, string> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  otf: "opentype",
};

/** A URL safe to put inside url("…"): http(s), or a same-origin path, with no
 *  character that could close the string or the rule. */
function safeFontUrl(url: unknown): string {
  const value = String(url ?? "").trim();
  if (!/^(https?:\/\/|\/)/i.test(value)) return "";
  if (/["'\\()\s<>;{}]/.test(value)) return "";
  return value;
}

/**
 * The @font-face rules for one library font: one rule per file, declared under
 * libraryFontFaceName(slug). A file whose URL, weight or style is unusable is
 * skipped rather than written as a rule the browser would choke on.
 */
export function libraryFontFaceCss(font: LibraryFont): string {
  const slug = libraryFontSlug(`${LIBRARY_FONT_PREFIX}${font?.slug ?? ""}`);
  if (!slug || !Array.isArray(font.styles)) return "";
  const name = libraryFontFaceName(slug);
  const rules: string[] = [];
  for (const file of font.styles) {
    const url = safeFontUrl(file?.url);
    const weight = Math.round(Number(file?.weight));
    const style = file?.style === "italic" ? "italic" : file?.style === "normal" ? "normal" : "";
    if (!url || !Number.isFinite(weight) || weight < 1 || weight > 1000 || !style) continue;
    const hint = FORMAT_HINT[String(file?.format || "").toLowerCase()];
    rules.push(
      `@font-face{font-family:'${name}';src:url("${url}")${hint ? ` format("${hint}")` : ""};` +
        `font-weight:${weight};font-style:${style};font-display:swap;}`
    );
  }
  return rules.join("\n");
}
