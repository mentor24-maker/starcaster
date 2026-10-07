import { useEffect, useMemo } from "react";
import {
  collectGoogleFontFamilies,
  googleFontStylesheetHref,
} from "@/lib/builder-google-fonts";

/**
 * Load the Google Fonts a rendered page names ("gf:<Family>" — any family,
 * task 86bce9wwv): one <link rel="stylesheet"> per family in <head>, shared
 * by every renderer on the page and never removed, so switching pages in the
 * editor does not make text flash back to the fallback font. The ten built-in
 * fonts are not touched — the page shells load those with a static <link>.
 * Emails render elsewhere and cannot load web fonts anyway (pass disabled).
 */
export function useGoogleFontLinks(sources: unknown[], disabled = false): string[] {
  const families = useMemo(
    () => (disabled ? [] : collectGoogleFontFamilies(...sources)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, ...sources]
  );
  const signature = families.join("|");

  useEffect(() => {
    if (typeof document === "undefined" || !families.length) return;
    for (const family of families) {
      const id = `bx-google-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
      if (document.getElementById(id)) continue;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = googleFontStylesheetHref(family);
      link.setAttribute("data-builder-google-font", family);
      document.head.appendChild(link);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return families;
}
