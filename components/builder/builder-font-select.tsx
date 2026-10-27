import { useEffect, useRef, useState } from "react";
import { googleFontFamily, googleFontKey, isGoogleFontKey } from "@/lib/builder-google-fonts";
import { isLibraryFontKey, libraryFontKey, libraryFontSlug } from "@/lib/builder-library-fonts";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import { fontFaceCss, type FontStyleFile } from "../fonts/fonts-manager";
import {
  BuilderFontPickerModal,
  libraryPreviewFamily,
  type FontPick,
  type PickerLibraryFont,
  type PickerLibraryState,
} from "./builder-font-picker-modal";
import { BUILDER_HEADING_FONTS } from "./builder-utils";

/** isFavorite: the signed-in person starred it on the Fonts screen (Font Library 8). */
export type LibraryFontChoice = PickerLibraryFont;

type LibraryState = PickerLibraryState;

/** One read of GET /api/fonts per page load, shared by every picker on the
 *  screen (a theme has two). A failed read is forgotten so the next open
 *  tries again. */
let libraryRequest: Promise<LibraryFontChoice[]> | null = null;

export function loadLibraryFontChoices(fetchImpl: typeof fetch = fetch): Promise<LibraryFontChoice[]> {
  if (!libraryRequest) {
    libraryRequest = fetchImpl("/api/fonts", { headers: starcasterScopedHeaders(), credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          const message = body?.error?.message || body?.error || `the server answered ${response.status}`;
          throw new Error(String(message));
        }
        const fonts = Array.isArray(body?.data?.fonts) ? body.data.fonts : [];
        return fonts
          .filter((font: { slug?: unknown }) => Boolean(libraryFontKey(String(font?.slug ?? ""))))
          .map((font: { slug: string; family?: string; isFavorite?: unknown; id?: unknown; styles?: unknown }) => ({
            slug: font.slug,
            family: String(font.family || font.slug),
            isFavorite: font.isFavorite === true,
            // The files, so the picker window can draw each name in its own font.
            id: font.id ? String(font.id) : undefined,
            styles: Array.isArray(font.styles) ? (font.styles as FontStyleFile[]) : undefined,
          }));
      })
      .catch((err) => {
        libraryRequest = null;
        throw err;
      });
  }
  return libraryRequest;
}

/** Test seam: forget the shared read. */
export function resetLibraryFontChoicesForTest() {
  libraryRequest = null;
}

/**
 * Font picker: a button showing the current font, drawn in that font. It
 * opens a scrolling window of every font (BuilderFontPickerModal, task
 * 86bctd64g) — the built-ins, the person's favourites, and Starcaster's font
 * library (stored "lf:<slug>", Font Library 3/7) — and "Use a Google font by
 * name…", which shows a box for any Google Fonts family (stored
 * "gf:<Family>", task 86bce9wwv). A Google name that is not a valid family is
 * refused with a message rather than saved — the normalizer would blank it
 * anyway, which reads as the font "not taking".
 */
export function BuilderFontSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [googleMode, setGoogleMode] = useState(isGoogleFontKey(value));
  const [name, setName] = useState(googleFontFamily(value));
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<LibraryState>({ status: "idle" });
  const googleRef = useRef<HTMLInputElement | null>(null);
  const isLibrary = isLibraryFontKey(value);

  useEffect(() => {
    setName(googleFontFamily(value));
    if (isGoogleFontKey(value)) setGoogleMode(true);
  }, [value]);

  // Read the library when the window opens, or straight away when the saved
  // value is a library font (the button needs its name and files). Depends on
  // the trigger alone: depending on the status too would make the "loading"
  // update cancel its own read, and the picker would say "Reading…" forever.
  const needLibrary = open || isLibrary;
  useEffect(() => {
    if (!needLibrary) return;
    let live = true;
    setLibrary((current) => (current.status === "ready" ? current : { status: "loading" }));
    loadLibraryFontChoices()
      .then((fonts) => {
        if (live) setLibrary({ status: "ready", fonts });
      })
      .catch((err: unknown) => {
        if (live) setLibrary({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      live = false;
    };
  }, [needLibrary]);

  useEffect(() => {
    if (googleMode && !isGoogleFontKey(value)) googleRef.current?.focus();
  }, [googleMode, value]);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Type the font's name as Google Fonts shows it, e.g. Open Sans.");
      return;
    }
    const key = googleFontKey(trimmed);
    if (!key) {
      setError(`"${trimmed}" is not a font name — use letters, numbers and spaces only, e.g. Open Sans.`);
      return;
    }
    setError("");
    if (key !== value) onChange(key);
  }

  function pick(choice: FontPick) {
    setError("");
    if (choice.kind === "google") {
      setOpen(false);
      setGoogleMode(true);
      return;
    }
    const next = choice.kind === "library" ? libraryFontKey(choice.slug) : choice.key;
    setOpen(false);
    setGoogleMode(false);
    if (next !== null && next !== value) onChange(next);
  }

  const librarySlug = libraryFontSlug(value);
  const libraryFonts = library.status === "ready" ? library.fonts : [];
  const currentLibraryFont = libraryFonts.find((font) => font.slug === librarySlug);
  const builtin = BUILDER_HEADING_FONTS.find((font) => font.key === value);

  let label: string;
  let family = "inherit";
  if (googleMode) {
    label = isGoogleFontKey(value) ? `Google font: ${googleFontFamily(value)}` : "Google font…";
    if (isGoogleFontKey(value)) family = `"${googleFontFamily(value)}", inherit`;
  } else if (isLibrary) {
    label = currentLibraryFont
      ? currentLibraryFont.family
      : library.status === "ready"
        ? `"${librarySlug}" is no longer in the font library — pick another`
        : librarySlug;
    if (currentLibraryFont) family = libraryPreviewFamily(currentLibraryFont);
  } else {
    label = builtin?.label ?? "Default (theme)";
    family = builtin?.stack || "inherit";
  }
  const currentFace =
    currentLibraryFont?.id && currentLibraryFont.styles?.length
      ? fontFaceCss([{ id: currentLibraryFont.id, styles: currentLibraryFont.styles }])
      : "";

  return (
    <div className="builder-font-select">
      {currentFace ? <style>{currentFace}</style> : null}
      <button
        type="button"
        className="builder-font-select-trigger"
        aria-label={ariaLabel ? `${ariaLabel}: ${label}. Change font` : `Font: ${label}. Change font`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="builder-font-select-current" style={{ fontFamily: family }}>
          {label}
        </span>
        <span className="builder-font-select-change" aria-hidden="true">
          Change…
        </span>
      </button>
      {googleMode ? (
        <input
          ref={googleRef}
          type="text"
          className="builder-font-select-google"
          aria-label={ariaLabel ? `${ariaLabel}: Google font name` : "Google font name"}
          placeholder="Google font name, e.g. Open Sans"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      ) : null}
      {error ? <p className="builder-font-select-error" role="alert">{error}</p> : null}
      {open ? (
        <BuilderFontPickerModal
          title={ariaLabel ? `Choose the ${ariaLabel.toLowerCase()}` : "Choose a font"}
          value={value}
          library={library}
          onPick={pick}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
