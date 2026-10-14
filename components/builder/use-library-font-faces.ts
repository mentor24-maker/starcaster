import { useEffect, useMemo } from "react";
import {
  collectLibraryFontSlugs,
  libraryFontFaceCss,
  libraryFontsRequestUrl,
  type LibraryFont,
} from "@/lib/builder-library-fonts";

/** Slugs already asked for on this page (asked, not necessarily found), so
 *  re-renders and page switches in the editor never ask twice. */
const requested = new Set<string>();

function styleId(slug: string): string {
  return `bx-library-font-${slug}`;
}

/**
 * Load the font-library fonts ("lf:<slug>", Font Library 3/7, task 86bchyd46)
 * a rendered page names: ONE request to GET /api/public/fonts for the slugs not
 * loaded yet, then one <style> of @font-face rules per font in <head>. Like the
 * Google links, they are shared by every renderer on the page and never
 * removed, so switching pages does not make text flash back to the fallback.
 *
 * A page naming no library font makes no request at all. A font the library
 * does not have (deleted, or never there) is not an error: its text renders in
 * the fallback stack, exactly as it did before the font was chosen.
 * Emails render elsewhere and cannot load web fonts anyway (pass disabled).
 */
export function useLibraryFontFaces(sources: unknown[], projectId = "", disabled = false): string[] {
  const slugs = useMemo(
    () => (disabled ? [] : collectLibraryFontSlugs(...sources)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, ...sources]
  );
  const signature = slugs.join("|");

  useEffect(() => {
    if (typeof document === "undefined" || typeof fetch !== "function") return;
    const missing = slugs.filter((slug) => !requested.has(slug) && !document.getElementById(styleId(slug)));
    if (!missing.length) return;
    for (const slug of missing) requested.add(slug);
    fetch(libraryFontsRequestUrl(missing, projectId), { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`fonts read answered ${response.status}`);
        return response.json();
      })
      .then((body: { data?: { fonts?: LibraryFont[] } } | null) => {
        const fonts = Array.isArray(body?.data?.fonts) ? body!.data!.fonts! : [];
        for (const font of fonts) {
          if (!missing.includes(font.slug) || document.getElementById(styleId(font.slug))) continue;
          const css = libraryFontFaceCss(font);
          if (!css) continue;
          const style = document.createElement("style");
          style.id = styleId(font.slug);
          style.setAttribute("data-builder-library-font", font.slug);
          style.textContent = css;
          document.head.appendChild(style);
        }
      })
      .catch(() => {
        // A failed read is retried on the next page that names the font, not
        // in a loop here; until then the text renders in the fallback stack.
        for (const slug of missing) requested.delete(slug);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, projectId]);

  return slugs;
}

/** Test seam: forget which fonts were already asked for. */
export function resetLibraryFontFacesForTest() {
  requested.clear();
}
