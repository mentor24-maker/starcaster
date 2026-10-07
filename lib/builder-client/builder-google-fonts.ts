/**
 * Any Google Font, not only the ten built-in keys (task 86bce9wwv).
 *
 * A font slot has always stored a short key ("inter", "lora", …) from a fixed
 * list, and the normalizers blanked anything else — so a site imported in
 * Open Sans could not keep its font. A Google Font is now stored as
 * "gf:<Family Name>" ("gf:Open Sans") in the same slot. The ten keys are
 * untouched, so no saved page changes meaning.
 *
 * The renderer loads a stylesheet only for the "gf:" families a page actually
 * uses (collectGoogleFontFamilies → googleFontStylesheetHref). The ten
 * built-ins keep their one static <link> in the page shells.
 */

export const GOOGLE_FONT_PREFIX = "gf:";

/** Letters, digits and single spaces — every Google Fonts family name fits
 *  ("Open Sans", "IBM Plex Sans", "M PLUS 1p"). Anything else is refused,
 *  which also keeps the value safe inside a CSS string and a URL. The 37-char
 *  cap keeps "gf:" + name within the 40 chars a font slot stores. */
const FAMILY_RE = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
const MAX_FAMILY_LENGTH = 37;

/** "Open Sans" → "gf:Open Sans"; "" when the name is not a valid family. */
export function googleFontKey(familyName: string): string {
  const family = String(familyName ?? "").trim().replace(/\s+/g, " ");
  if (!family || family.length > MAX_FAMILY_LENGTH || !FAMILY_RE.test(family)) return "";
  return `${GOOGLE_FONT_PREFIX}${family}`;
}

export function isGoogleFontKey(key: unknown): key is string {
  if (typeof key !== "string" || !key.startsWith(GOOGLE_FONT_PREFIX)) return false;
  return googleFontKey(key.slice(GOOGLE_FONT_PREFIX.length)) === key;
}

/** "gf:Open Sans" → "Open Sans"; "" for anything that is not a Google key. */
export function googleFontFamily(key: unknown): string {
  return isGoogleFontKey(key) ? key.slice(GOOGLE_FONT_PREFIX.length) : "";
}

/** CSS font-family stack for a Google key; undefined otherwise. */
export function googleFontStack(key: unknown): string | undefined {
  const family = googleFontFamily(key);
  return family ? `'${family}', system-ui, sans-serif` : undefined;
}

/**
 * One stylesheet per family, on the v1 CSS API. v1 serves whichever of the
 * requested weights the family has and skips the rest; css2 rejects the
 * WHOLE request when one weight is missing, so a single family without a
 * 300 would have left the page with no font at all.
 */
export function googleFontStylesheetHref(family: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  return (
    `https://fonts.googleapis.com/css?family=${name}:` +
    "300,400,500,600,700,800,900,400italic,700italic&display=swap"
  );
}

/** At most this many families load on one page — a guard against a
 *  document that names dozens, not a design limit. */
export const MAX_PAGE_GOOGLE_FONTS = 8;

/**
 * Every Google family named anywhere in these values (a theme, a page's
 * sections, module settings), deep-walked, de-duplicated, in first-seen order.
 */
export function collectGoogleFontFamilies(...sources: unknown[]): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (found.size >= MAX_PAGE_GOOGLE_FONTS || depth > 12) return;
    if (typeof value === "string") {
      const family = googleFontFamily(value);
      if (family) found.add(family);
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
