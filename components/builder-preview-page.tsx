"use client";

import { useEffect, useState } from "react";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import {
  BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
  BUILDER_PREVIEW_STORAGE_KEY,
  createDefaultBackgroundSettings,
  createDefaultTheme,
  normalizeBuilderDocument
} from "@/lib/builder-template";

import type { CrmThemePalette } from "@/components/builder/builder-utils";
import {
  builderThemeToCrmPalette,
  mergeCrmThemePalette,
} from "@/components/builder/builder-utils";

type PreviewDraft = {
  name: string;
  pageBackground: ReturnType<typeof createDefaultBackgroundSettings>;
  theme: ReturnType<typeof normalizeBuilderDocument>["theme"];
  layoutSections: ReturnType<typeof normalizeBuilderDocument>["layoutSections"];
  themePalette?: CrmThemePalette;
  themeId?: string;
};

type BuilderThemeRecord = {
  id?: string;
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
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

async function fetchBuilderThemePalette(themeId?: string): Promise<CrmThemePalette | undefined> {
  try {
    const res = await fetch("/api/builder/themes", { credentials: "include" });
    if (!res.ok) return undefined;
    const data = await res.json() as { themes?: BuilderThemeRecord[] };
    const themes = Array.isArray(data.themes) ? data.themes : [];
    const theme = themeId
      ? themes.find((entry) => String(entry.id || "") === themeId) || themes[0]
      : themes[0];
    return builderThemeToCrmPalette(theme);
  } catch {
    return undefined;
  }
}

function slugFromPathname(pathname: string): string {
  // /about.html → "about", /blog/posts.html → "blog/posts", / → ""
  const withoutExt = pathname.replace(/\.html$/, "");
  return withoutExt.replace(/^\//, "").replace(/\/$/, "");
}

async function fetchPageBySlug(slug: string): Promise<PreviewDraft | null> {
  try {
    const res = await fetch("/api/builder/landing-pages", { credentials: "include" });
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
    const resolvedPalette = hasCrmPaletteColors(themePalette)
      ? themePalette
      : mergeCrmThemePalette(themePalette, await fetchBuilderThemePalette(themeId));
    return {
      name: String(match.name ?? "").trim(),
      pageBackground: doc.pageBackground,
      theme: doc.theme,
      layoutSections: doc.layoutSections,
      themePalette: resolvedPalette,
      themeId
    };
  } catch {
    return null;
  }
}

export function BuilderPreviewPage() {
  const [draft, setDraft] = useState<PreviewDraft | null>(null);
  const [themePalette, setThemePalette] = useState<CrmThemePalette | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile" | "email">("desktop");
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

    if (targetSlug) {
      fetchPageBySlug(targetSlug)
        .then((page) => {
          if (page) {
            setDraft(page);
            setThemePalette(page.themePalette);
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
          fetchBuilderThemePalette().then((palette) => {
            setThemePalette(palette);
          });
          return;
        }
        const parsed = JSON.parse(rawValue) as {
          name?: unknown;
          pageBackground?: unknown;
          layoutSections?: unknown;
          theme?: unknown;
          themePalette?: CrmThemePalette;
          themeId?: string;
        };
        const document = normalizeBuilderDocument(parsed);
        const storedPalette = parsed.themePalette;
        const themeId = String(parsed.themeId || "").trim();
        setDraft({
          name: String(parsed.name ?? "").trim(),
          pageBackground: document.pageBackground,
          theme: document.theme,
          layoutSections: document.layoutSections,
          themePalette: storedPalette,
          themeId
        });
        if (hasCrmPaletteColors(storedPalette)) {
          setThemePalette(storedPalette);
          return;
        }
        fetchBuilderThemePalette(themeId).then((palette) => {
          setThemePalette(mergeCrmThemePalette(storedPalette, palette));
        });
      } catch {
        setDraft({
          name: "",
          pageBackground: createDefaultBackgroundSettings(),
          theme: createDefaultTheme(),
          layoutSections: []
        });
        fetchBuilderThemePalette().then((palette) => {
          setThemePalette(palette);
        });
      }
    }
  }, []);

  return (
    <main className="admin-page">
      <section className="admin-shell admin-shell-wide">
        <div className="admin-header">
          <div className="admin-brand-copy">
            <div className="page-eyebrow">Builder Preview</div>
            <h1 className="admin-title">{draft?.name || "Unsaved Template Preview"}</h1>
            <p className="page-copy admin-copy">
              {isEmailPreview
                ? "This is the 600px email pod preview for the current Builder draft."
                : "This is the fully rendered page preview for the current Builder draft."}
            </p>
          </div>
          <div className="admin-actions">
            {isEmailPreview ? (
              <span className="builder-email-preview-badge">Email · 600px</span>
            ) : (
              <div className="builder-device-toggle" role="group" aria-label="Preview device">
                <button
                  className={previewDevice === "desktop" ? "submit-button" : "secondary-button"}
                  onClick={() => {
                    setPreviewDevice("desktop");
                    window.localStorage.setItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY, "desktop");
                  }}
                  type="button"
                >
                  Browser
                </button>
                <button
                  className={previewDevice === "mobile" ? "submit-button" : "secondary-button"}
                  onClick={() => {
                    setPreviewDevice("mobile");
                    window.localStorage.setItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY, "mobile");
                  }}
                  type="button"
                >
                  Mobile
                </button>
              </div>
            )}
            <button className="secondary-button" onClick={() => window.close()} type="button">
              Close Preview
            </button>
          </div>
        </div>

        {loaded && draft && draft.layoutSections.length > 0 ? (
          <div className={`builder-preview-device-frame builder-preview-device-${previewDevice}`}>
            {isEmailPreview ? (
              <div className="builder-email-workspace-pod builder-email-preview-pod">
                <BuilderTemplatePreview
                  emailPreview
                  layoutSections={draft.layoutSections}
                  pageBackground={draft.pageBackground}
                  showShell={false}
                />
              </div>
            ) : (
              <BuilderTemplatePreview
                layoutSections={draft.layoutSections}
                pageBackground={draft.pageBackground}
                theme={draft.theme}
                themePalette={themePalette}
                previewMode
                showShell={false}
              />
            )}
          </div>
        ) : loaded ? (
          <section className="admin-section">
            <div className="panel-label">Preview</div>
            <h2>No preview content found</h2>
            <p className="page-copy admin-copy">
              Open this page from the Builder using the `Preview` button so the current draft can be loaded here.
            </p>
          </section>
        ) : null}
      </section>
    </main>
  );
}
