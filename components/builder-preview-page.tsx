"use client";

import { useEffect, useState } from "react";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import {
  BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
  BUILDER_PREVIEW_STORAGE_KEY,
  createDefaultBackgroundSettings,
  createDefaultTheme,
  normalizeBuilderDocument,
  resolveRenderTheme
} from "@/lib/builder-template";

import type { BuilderThemeStyles, CrmThemePalette, ThemeShellBackgroundSource } from "@/components/builder/builder-utils";
import {
  builderThemeToCrmPalette,
  buildBuilderThemeStyles,
  mergeCrmThemePalette,
} from "@/components/builder/builder-utils";
import { BuilderViewportShellLayout } from "@/components/builder/builder-viewport-shell-layout";
import { starcasterScopedHeaders, unwrapEnvelope } from "@/lib/adapters/starcaster-app";
import { isPrivateSiteSlug } from "@/lib/public-site-page-slugs";
import { filterPublicSections } from "@/lib/public-site-sections";

type PreviewDraft = {
  name: string;
  pageBackground: ReturnType<typeof createDefaultBackgroundSettings>;
  theme: ReturnType<typeof normalizeBuilderDocument>["theme"];
  layoutSections: ReturnType<typeof normalizeBuilderDocument>["layoutSections"];
  themePalette?: CrmThemePalette;
  themeStyles?: BuilderThemeStyles;
  themeId?: string;
  themeShellBackground?: ThemeShellBackgroundSource;
  themeRecord?: BuilderThemeRecord | null;
};

type BuilderThemeRecord = {
  id?: string;
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  pageBackground?: unknown;
  borderThickness?: number;
  borderRadius?: number;
  containerBlur?: number;
  contrastLevel?: number;
  topMargin?: number;
  bottomMargin?: number;
  sideMargins?: number;
  typography?: unknown;
};

function hasCrmPaletteColors(palette: CrmThemePalette | undefined): boolean {
  if (!palette) return false;
  return Boolean(
    palette.primaryColor ||
    palette.secondaryColor ||
    palette.backgroundColor ||
    palette.accentColor
  );
}

async function fetchBuilderTheme(themeId?: string): Promise<{
  palette?: CrmThemePalette;
  styles?: BuilderThemeStyles;
  shellBackground?: ThemeShellBackgroundSource;
  /** The raw record, so typography resolves live like the colours already do. */
  record?: BuilderThemeRecord | null;
}> {
  try {
    const res = await fetch("/api/builder/themes", {
      credentials: "include",
      headers: starcasterScopedHeaders(),
    });
    if (!res.ok) return {};
    const data = await res.json() as Record<string, unknown>;
    const themes = (unwrapEnvelope<BuilderThemeRecord[]>(data, "themes") ?? []) as BuilderThemeRecord[];
    const theme = themeId
      ? themes.find((entry) => String(entry.id || "") === themeId) || themes[0]
      : themes[0];
    return {
      palette: builderThemeToCrmPalette(theme),
      styles: buildBuilderThemeStyles(theme),
      shellBackground: theme as ThemeShellBackgroundSource,
      record: theme ?? null,
    };
  } catch {
    return {};
  }
}

function slugFromPathname(pathname: string): string {
  // /about.html → "about", /blog/posts.html → "blog/posts", / → ""
  const withoutExt = pathname.replace(/\.html$/, "");
  return withoutExt.replace(/^\//, "").replace(/\/$/, "");
}

async function fetchPageBySlug(slug: string): Promise<PreviewDraft | null> {
  try {
    const res = await fetch("/api/builder/landing-pages", {
      credentials: "include",
      headers: starcasterScopedHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json() as { pages?: unknown[] };
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const match = pages.find((p: unknown) => {
      const page = p as Record<string, unknown>;
      return String(page.slug || "") === slug || String(page.id || "") === slug;
    }) as Record<string, unknown> | undefined;
    if (!match) return null;
    const doc = normalizeBuilderDocument(match);
    const themePalette = {
      primaryColor: String(match.primaryColor ?? match.primary_color ?? "").trim(),
      secondaryColor: String(match.secondaryColor ?? match.secondary_color ?? "").trim(),
      backgroundColor: String(match.backgroundColor ?? match.background_color ?? "").trim(),
      accentColor: String(match.accentColor ?? match.accent_color ?? "").trim()
    };
    const themeId = String(match.themeId ?? match.theme_id ?? "").trim();
    const themeRecord = await fetchBuilderTheme(themeId);
    const resolvedPalette = hasCrmPaletteColors(themePalette)
      ? themePalette
      : mergeCrmThemePalette(themePalette, themeRecord.palette);
    return {
      name: String(match.name ?? "").trim(),
      pageBackground: doc.pageBackground,
      theme: doc.theme,
      layoutSections: doc.layoutSections,
      themePalette: resolvedPalette,
      themeStyles: themeRecord.styles,
      themeId,
      themeShellBackground: themeRecord.shellBackground,
      // Only when the page names a theme: `fetchBuilderTheme` falls back to the
      // first theme in the project, and that must not supply type to a page
      // that was never themed.
      themeRecord: themeId ? themeRecord.record ?? null : null,
    };
  } catch {
    return null;
  }
}

export function BuilderPreviewPage() {
  const [draft, setDraft] = useState<PreviewDraft | null>(null);
  const [themePalette, setThemePalette] = useState<CrmThemePalette | undefined>(undefined);
  const [themeStyles, setThemeStyles] = useState<BuilderThemeStyles | undefined>(undefined);
  const [themeShellBackground, setThemeShellBackground] = useState<ThemeShellBackgroundSource>(null);
  const [loaded, setLoaded] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile" | "email">("desktop");
  const [targetSlug, setTargetSlug] = useState("");
  const isEmailPreview = previewDevice === "email";

  useEffect(() => {
    const storedDevice = window.localStorage.getItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY);
    if (storedDevice === "mobile" || storedDevice === "desktop" || storedDevice === "email") {
      setPreviewDevice(storedDevice);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const slugParam = urlParams.get("slug");
    const pathnameSlug = slugFromPathname(window.location.pathname);
    const targetSlug = slugParam || (pathnameSlug !== "builder-preview" ? pathnameSlug : "");
    setTargetSlug(targetSlug);

    if (targetSlug) {
      fetchPageBySlug(targetSlug)
        .then((page) => {
          if (page) {
            setDraft(page);
            setThemePalette(page.themePalette);
            setThemeStyles(page.themeStyles);
            setThemeShellBackground(page.themeShellBackground ?? null);
          } else {
            loadFromLocalStorage();
          }
        })
        .catch(() => loadFromLocalStorage())
        .finally(() => setLoaded(true));
      return;
    }

    loadFromLocalStorage();
    setLoaded(true);

    function loadFromLocalStorage() {
      try {
        const rawValue = window.localStorage.getItem(BUILDER_PREVIEW_STORAGE_KEY);
        if (!rawValue) {
          fetchBuilderTheme().then((themeRecord) => {
            setThemePalette(themeRecord.palette);
            setThemeStyles(themeRecord.styles);
            setThemeShellBackground(themeRecord.shellBackground ?? null);
          });
          return;
        }
        const parsed = JSON.parse(rawValue) as {
          name?: unknown;
          pageBackground?: unknown;
          layoutSections?: unknown;
          theme?: unknown;
          themePalette?: CrmThemePalette;
          themeStyles?: BuilderThemeStyles;
          themeId?: string;
          themeShellBackground?: ThemeShellBackgroundSource;
        };
        const document = normalizeBuilderDocument(parsed);
        const storedPalette = parsed.themePalette;
        const storedStyles = parsed.themeStyles;
        const storedShellBackground = parsed.themeShellBackground;
        const resolvedStyles =
          buildBuilderThemeStyles(storedShellBackground) ?? storedStyles;
        const themeId = String(parsed.themeId || "").trim();
        setDraft({
          name: String(parsed.name ?? "").trim(),
          pageBackground: document.pageBackground,
          theme: document.theme,
          layoutSections: document.layoutSections,
          themePalette: storedPalette,
          themeStyles: resolvedStyles,
          themeId,
          themeShellBackground: storedShellBackground,
        });
        if (hasCrmPaletteColors(storedPalette) && resolvedStyles) {
          setThemePalette(storedPalette);
          setThemeStyles(resolvedStyles);
          setThemeShellBackground(storedShellBackground ?? null);
          return;
        }
        fetchBuilderTheme(themeId).then((themeRecord) => {
          setThemePalette(mergeCrmThemePalette(storedPalette, themeRecord.palette));
          setThemeStyles(
            buildBuilderThemeStyles(storedShellBackground)
              ?? themeRecord.styles
              ?? resolvedStyles
          );
          setThemeShellBackground(storedShellBackground ?? themeRecord.shellBackground ?? null);
        });
      } catch {
        setDraft({
          name: "",
          pageBackground: createDefaultBackgroundSettings(),
          theme: createDefaultTheme(),
          layoutSections: []
        });
        fetchBuilderTheme().then((themeRecord) => {
          setThemePalette(themeRecord.palette);
          setThemeStyles(themeRecord.styles);
          setThemeShellBackground(themeRecord.shellBackground ?? null);
        });
      }
    }
  }, []);

  const effectiveThemeStyles = themeStyles ?? draft?.themeStyles;

  // The same rule the live site applies (BuilderPublicSitePage): admin-only
  // modules never paint on a public page. Private slugs show everything.
  const sections = draft
    ? isPrivateSiteSlug(targetSlug)
      ? draft.layoutSections
      : filterPublicSections(draft.layoutSections)
    : [];

  const setDevice = (device: "desktop" | "mobile") => {
    setPreviewDevice(device);
    window.localStorage.setItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY, device);
  };

  /*
   * Below the strip this renders EXACTLY what BuilderPublicSitePage renders —
   * same layout wrapper, same class, same props — plus `previewMode` (nav links
   * stay `/slug.html` so they resolve to this preview) and minus `liveSite`
   * (Bug Report would post for real). The old admin card around it is what
   * made the preview look nothing like the site (86bbq2y7x).
   */
  const pagePreview = draft ? (
    <BuilderViewportShellLayout
      className="builder-public-site-layout"
      pageBackground={draft.pageBackground}
      themeShellBackground={themeShellBackground ?? draft.themeShellBackground}
      themeStyles={effectiveThemeStyles}
    >
      <BuilderTemplatePreview
        layoutSections={sections}
        pageBackground={draft.pageBackground}
        theme={resolveRenderTheme(draft.theme, draft.themeRecord)}
        themePalette={themePalette ?? draft.themePalette}
        themeStyles={effectiveThemeStyles}
        themeShellBackground={themeShellBackground ?? draft.themeShellBackground}
        applyThemePageMargins={false}
        suppressShellBackground
        previewMode
      />
    </BuilderViewportShellLayout>
  ) : null;

  return (
    <>
      <div className="builder-preview-strip" role="banner">
        <span className="builder-preview-strip-label">
          PREVIEW · {draft?.name || "Unsaved draft"}
          {isEmailPreview ? " · Email 600px" : ""}
        </span>
        <span className="builder-preview-strip-actions">
          {isEmailPreview ? null : (
            <span className="builder-preview-strip-toggle" role="group" aria-label="Preview device">
              <button
                aria-pressed={previewDevice === "desktop"}
                className={previewDevice === "desktop" ? "is-active" : ""}
                onClick={() => setDevice("desktop")}
                type="button"
              >
                Browser
              </button>
              <button
                aria-pressed={previewDevice === "mobile"}
                className={previewDevice === "mobile" ? "is-active" : ""}
                onClick={() => setDevice("mobile")}
                type="button"
              >
                Mobile
              </button>
            </span>
          )}
          <button className="builder-preview-strip-close" onClick={() => window.close()} type="button">
            Close
          </button>
        </span>
      </div>

      {loaded && draft && draft.layoutSections.length > 0 ? (
        isEmailPreview ? (
          <div className="builder-preview-device-frame builder-preview-device-email">
            <div className="builder-email-workspace-pod builder-email-preview-pod">
              <BuilderTemplatePreview
                emailPreview
                layoutSections={draft.layoutSections}
                pageBackground={draft.pageBackground}
                showShell={false}
              />
            </div>
          </div>
        ) : previewDevice === "mobile" ? (
          // The phone frame wrapper exists ONLY in Mobile mode: the mobile
          // stacking CSS keys off `.builder-preview-device-mobile`, and in
          // Browser mode any wrapper at all is what the live site does not have.
          <div className="builder-preview-device-frame builder-preview-device-mobile">
            {pagePreview}
          </div>
        ) : (
          pagePreview
        )
      ) : loaded ? (
        <div className="builder-preview-empty">
          <h2>No preview content found</h2>
          <p>
            Open this page from the Builder using the Preview button so the current draft can be loaded here.
          </p>
        </div>
      ) : null}
    </>
  );
}
