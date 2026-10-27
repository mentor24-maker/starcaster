import { useEffect, useMemo, useRef, useState } from "react";
import { fontFaceCss, previewFamily, type FontStyleFile } from "../fonts/fonts-manager";
import { BuilderCenteredModal } from "./builder-centered-modal";
import { BUILDER_HEADING_FONTS } from "./builder-utils";

/** A library font as the picker needs it: its name, and the files to draw it. */
export type PickerLibraryFont = {
  slug: string;
  family: string;
  isFavorite?: boolean;
  /** Font row id — the private @font-face name is built from it. */
  id?: string;
  styles?: FontStyleFile[];
};

export type PickerLibraryState =
  | { status: "idle" | "loading" }
  | { status: "ready"; fonts: PickerLibraryFont[] }
  | { status: "error"; message: string };

/** What a click in the window chose. */
export type FontPick =
  | { kind: "builtin"; key: string }
  | { kind: "library"; slug: string }
  | { kind: "google" };

/** The CSS family a library font is drawn under in the picker. Without an id
 *  or files there is nothing to load, so it falls back to plain text. */
export function libraryPreviewFamily(font: PickerLibraryFont): string {
  return font.id && font.styles?.length ? `"${previewFamily({ id: font.id })}", var(--font-body, sans-serif)` : "inherit";
}

/** Case-insensitive name match; an empty query keeps everything. */
export function matchesFontQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}

/**
 * The font picker window (task 86bctd64g). Dane, 2026-10-27: "a modal dialog
 * of a set height with a scroll bar so you can scroll through the entire list
 * of font names, each one displayed in its own font. Clicking a font selects
 * them."
 *
 * The list is the built-ins, then the person's starred fonts, then the whole
 * library, each name drawn in its own lettering. Library fonts are drawn
 * through @font-face rules written ONLY for names that have scrolled near the
 * list's visible area (the Fonts screen's approach), so opening the window
 * does not download 288 fonts. Escape, Done and a click outside all close it
 * without changing anything.
 */
export function BuilderFontPickerModal({
  title,
  value,
  library,
  onPick,
  onClose,
}: {
  title: string;
  /** The stored value: a built-in key, "gf:<Family>" or "lf:<slug>". */
  value: string;
  library: PickerLibraryState;
  onPick: (pick: FontPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Library slugs whose row has come near the list's visible area. null = no
  // IntersectionObserver here, so every row counts as seen.
  const [seen, setSeen] = useState<Set<string> | null>(() =>
    typeof IntersectionObserver === "undefined" ? null : new Set()
  );

  const libraryFonts = library.status === "ready" ? library.fonts : [];
  const builtins = BUILDER_HEADING_FONTS.filter((font) => matchesFontQuery(font.label, query));
  const shownLibrary = libraryFonts.filter((font) => matchesFontQuery(font.family, query));
  const favourites = shownLibrary.filter((font) => font.isFavorite);
  const rest = shownLibrary.filter((font) => !font.isFavorite);
  const currentSlug = value.startsWith("lf:") ? value.slice(3) : "";

  useEffect(() => {
    searchRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Bring the current choice into view once the list has it.
  useEffect(() => {
    const chosen = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    chosen?.scrollIntoView?.({ block: "center" });
  }, [library.status]);

  useEffect(() => {
    const list = listRef.current;
    if (seen === null || !list || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const slugs = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => (entry.target as HTMLElement).dataset.fontSlug || "")
          .filter(Boolean);
        if (!slugs.length) return;
        setSeen((prev) => {
          if (!prev || slugs.every((slug) => prev.has(slug))) return prev;
          const next = new Set(prev);
          slugs.forEach((slug) => next.add(slug));
          return next;
        });
      },
      { root: list, rootMargin: "200px 0px" }
    );
    list.querySelectorAll<HTMLElement>("[data-font-slug]").forEach((row) => {
      if (!seen.has(row.dataset.fontSlug || "")) observer.observe(row);
    });
    return () => observer.disconnect();
  }, [seen, library.status, query]);

  const faces = useMemo(
    () =>
      fontFaceCss(
        libraryFonts
          .filter((font) => font.id && (seen === null || seen.has(font.slug)))
          .map((font) => ({ id: font.id as string, styles: font.styles || [] }))
      ),
    [libraryFonts, seen]
  );

  function libraryRow(font: PickerLibraryFont) {
    const selected = font.slug === currentSlug;
    return (
      <button
        key={font.slug}
        type="button"
        role="option"
        aria-selected={selected}
        data-font-slug={font.slug}
        className={`builder-font-picker-option${selected ? " is-selected" : ""}`}
        style={{ fontFamily: libraryPreviewFamily(font) }}
        onClick={() => onPick({ kind: "library", slug: font.slug })}
      >
        {font.family}
      </button>
    );
  }

  const nothingMatches = query.trim() && !builtins.length && !shownLibrary.length;

  return (
    <BuilderCenteredModal title={title} onClose={onClose}>
      <div className="builder-font-picker">
        {faces ? <style>{faces}</style> : null}
        <input
          ref={searchRef}
          type="search"
          className="builder-font-picker-search"
          aria-label="Search fonts by name"
          placeholder="Search fonts by name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div ref={listRef} className="builder-font-picker-list" role="listbox" aria-label={title}>
          {builtins.length ? <p className="builder-font-picker-group">Built-in fonts</p> : null}
          {builtins.map((font) => {
            const selected = font.key === value;
            return (
              <button
                key={font.key || "default"}
                type="button"
                role="option"
                aria-selected={selected}
                className={`builder-font-picker-option${selected ? " is-selected" : ""}`}
                style={{ fontFamily: font.stack || "inherit" }}
                onClick={() => onPick({ kind: "builtin", key: font.key })}
              >
                {font.label}
              </button>
            );
          })}
          {favourites.length ? <p className="builder-font-picker-group">Favourites</p> : null}
          {favourites.map(libraryRow)}
          {rest.length ? (
            <p className="builder-font-picker-group">{favourites.length ? "All library fonts" : "Font library"}</p>
          ) : null}
          {rest.map(libraryRow)}
          {library.status !== "ready" || !libraryFonts.length ? (
            <p className="builder-font-picker-note" role={library.status === "error" ? "alert" : undefined}>
              {library.status === "error"
                ? `The font library could not be read: ${library.message}`
                : library.status === "ready"
                  ? "The font library has no fonts in it yet."
                  : "Reading the font library…"}
            </p>
          ) : null}
          {nothingMatches ? (
            <p className="builder-font-picker-note">No font is called anything like "{query.trim()}".</p>
          ) : null}
        </div>
        <button type="button" className="secondary-button builder-font-picker-google" onClick={() => onPick({ kind: "google" })}>
          Use a Google font by name…
        </button>
      </div>
    </BuilderCenteredModal>
  );
}
