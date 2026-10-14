import { useEffect, useState } from "react";
import { googleFontFamily, googleFontKey, isGoogleFontKey } from "@/lib/builder-google-fonts";
import { isLibraryFontKey, libraryFontKey, libraryFontSlug } from "@/lib/builder-library-fonts";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import { BUILDER_HEADING_FONTS } from "./builder-utils";

const GOOGLE_OPTION = "__google__";
const LIBRARY_OPTION = "__library__";

export type LibraryFontChoice = { slug: string; family: string };

type LibraryState =
  | { status: "idle" | "loading" }
  | { status: "ready"; fonts: LibraryFontChoice[] }
  | { status: "error"; message: string };

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
          .map((font: { slug: string; family?: string }) => ({ slug: font.slug, family: String(font.family || font.slug) }));
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

function initialMode(value: string): "builtin" | "google" | "library" {
  if (isGoogleFontKey(value)) return "google";
  if (isLibraryFontKey(value)) return "library";
  return "builtin";
}

/**
 * Font picker: the ten built-in fonts, plus
 *   "Google font…"  — any Google Fonts family by name, stored "gf:<Family>"
 *                     (task 86bce9wwv);
 *   "Library font…" — a font from Starcaster's own font library, stored
 *                     "lf:<slug>" (Font Library 3/7, task 86bchyd46).
 * A Google name that is not a valid family is refused with a message rather
 * than saved — the normalizer would blank it anyway, which reads as the font
 * "not taking". An empty library says so, rather than offering an empty list.
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
  const isGoogle = isGoogleFontKey(value);
  const isLibrary = isLibraryFontKey(value);
  const [mode, setMode] = useState(initialMode(value));
  const [name, setName] = useState(googleFontFamily(value));
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<LibraryState>({ status: "idle" });

  useEffect(() => {
    setName(googleFontFamily(value));
    if (isGoogleFontKey(value)) setMode("google");
    else if (isLibraryFontKey(value)) setMode("library");
  }, [value]);

  // Read the library the first time "Library font" is showing. Depends on
  // `mode` alone: depending on the status too would make the "loading" update
  // cancel its own read, and the picker would say "Reading…" forever.
  useEffect(() => {
    if (mode !== "library") return;
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
  }, [mode]);

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

  const librarySlug = libraryFontSlug(value);
  const libraryFonts = library.status === "ready" ? library.fonts : [];
  const currentLibraryFont = libraryFonts.find((font) => font.slug === librarySlug);
  const libraryLabel = isLibrary
    ? `Library font: ${currentLibraryFont?.family ?? librarySlug}`
    : "Library font…";

  return (
    <div className="builder-font-select">
      <select
        aria-label={ariaLabel}
        value={mode === "google" ? GOOGLE_OPTION : mode === "library" ? LIBRARY_OPTION : value}
        onChange={(event) => {
          const next = event.target.value;
          setError("");
          if (next === GOOGLE_OPTION) {
            setMode("google");
            return;
          }
          if (next === LIBRARY_OPTION) {
            setMode("library");
            return;
          }
          setMode("builtin");
          onChange(next);
        }}
      >
        {BUILDER_HEADING_FONTS.map((font) => (
          <option key={font.key} value={font.key}>
            {font.label}
          </option>
        ))}
        <option value={GOOGLE_OPTION}>{isGoogle ? `Google font: ${googleFontFamily(value)}` : "Google font…"}</option>
        <option value={LIBRARY_OPTION}>{libraryLabel}</option>
      </select>
      {mode === "google" ? (
        <input
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
      {mode === "library" ? (
        library.status === "ready" && libraryFonts.length ? (
          <select
            className="builder-font-select-library"
            aria-label={ariaLabel ? `${ariaLabel}: library font` : "Library font"}
            value={librarySlug && currentLibraryFont ? librarySlug : ""}
            onChange={(event) => {
              const key = libraryFontKey(event.target.value);
              if (key && key !== value) onChange(key);
            }}
          >
            <option value="" disabled>
              {librarySlug && !currentLibraryFont
                ? `"${librarySlug}" is no longer in the font library — pick another`
                : "Pick a font from the library"}
            </option>
            {libraryFonts.map((font) => (
              <option key={font.slug} value={font.slug}>
                {font.family}
              </option>
            ))}
          </select>
        ) : (
          <p className="builder-font-select-note" role={library.status === "error" ? "alert" : undefined}>
            {library.status === "error"
              ? `The font library could not be read: ${library.message}`
              : library.status === "ready"
                ? "The font library has no fonts in it yet, so there is nothing to pick."
                : "Reading the font library…"}
          </p>
        )
      ) : null}
      {error ? <p className="builder-font-select-error" role="alert">{error}</p> : null}
    </div>
  );
}
