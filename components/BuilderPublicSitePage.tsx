"use client";

import { useEffect, useState } from "react";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import {
  builderThemeToCrmPalette,
  mergeCrmThemePalette,
  type CrmThemePalette,
} from "@/components/builder/builder-utils";
import {
  createDefaultBackgroundSettings,
  createDefaultTheme,
  normalizeBuilderDocument,
} from "@/lib/builder-template";
import { getAdminAuthHeaders } from "@/lib/public-admin-session";
import { isPrivateSiteSlug } from "@/lib/public-site-page-slugs";

type SitePage = {
  name: string;
  slug: string;
  pageBackground: ReturnType<typeof createDefaultBackgroundSettings>;
  theme: ReturnType<typeof normalizeBuilderDocument>["theme"];
  layoutSections: ReturnType<typeof normalizeBuilderDocument>["layoutSections"];
  projectId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  themeId?: string;
};

function pageThemePalette(page: SitePage) {
  return {
    primaryColor: String(page.primaryColor || "").trim(),
    secondaryColor: String(page.secondaryColor || "").trim(),
    backgroundColor: String(page.backgroundColor || "").trim(),
    accentColor: String(page.accentColor || "").trim(),
  };
}

function normalizePublicSlug(value: string): string {
  let path = String(value || "").trim().split("?")[0]?.split("#")[0] || "";
  path = path.replace(/\.html$/i, "");
  path = path.replace(/^\/api\/_site\/[^/]+/, "").replace(/^\/_site\/[^/]+/, "");
  if (path === "/_site" || path === "/api/_site") path = "/";
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const pathParam = params?.get("path");
  if (pathParam && (value.includes("/_site/") || value.includes("/api/_site/"))) {
    path = pathParam.replace(/\.html$/i, "");
  }
  const slug = path.replace(/^\//, "").replace(/\/$/, "").toLowerCase();
  return slug === "home" ? "" : slug;
}

function isHomeSlug(slug: string): boolean {
  return slug === "";
}

async function fetchPublicPages(projectId: string): Promise<SitePage[]> {
  const res = await fetch(`/api/public/pages?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) return [];
  const data = await res.json() as { pages?: unknown[] };
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return pages.map((p: unknown) => {
    const page = p as Record<string, unknown>;
    const doc = normalizeBuilderDocument(page);
    return {
      name: String(page.name ?? "").trim(),
      slug: String(page.slug ?? "").trim(),
      pageBackground: doc.pageBackground,
      theme: doc.theme,
      layoutSections: doc.layoutSections,
      projectId: String(page.projectId ?? page.project_id ?? ""),
      primaryColor: String(page.primaryColor ?? page.primary_color ?? ""),
      secondaryColor: String(page.secondaryColor ?? page.secondary_color ?? ""),
      backgroundColor: String(page.backgroundColor ?? page.background_color ?? ""),
      accentColor: String(page.accentColor ?? page.accent_color ?? ""),
      themeId: String(page.themeId ?? page.theme_id ?? ""),
    };
  });
}

async function fetchPrivatePages(projectId: string): Promise<SitePage[] | "unauthorized"> {
  const res = await fetch(
    `/api/public/admin-pages?projectId=${encodeURIComponent(projectId)}`,
    { credentials: "include", headers: getAdminAuthHeaders() }
  );
  if (res.status === 401) return "unauthorized";
  if (!res.ok) return [];
  const data = await res.json() as { pages?: unknown[] };
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return pages.map((p: unknown) => {
    const page = p as Record<string, unknown>;
    const doc = normalizeBuilderDocument(page);
    return {
      name: String(page.name ?? "").trim(),
      slug: String(page.slug ?? "").trim(),
      pageBackground: doc.pageBackground,
      theme: doc.theme,
      layoutSections: doc.layoutSections,
      projectId: String(page.projectId ?? page.project_id ?? ""),
      primaryColor: String(page.primaryColor ?? page.primary_color ?? ""),
      secondaryColor: String(page.secondaryColor ?? page.secondary_color ?? ""),
      backgroundColor: String(page.backgroundColor ?? page.background_color ?? ""),
      accentColor: String(page.accentColor ?? page.accent_color ?? ""),
      themeId: String(page.themeId ?? page.theme_id ?? ""),
    };
  });
}

// Strip admin-only modules from public pages (defense in depth).
const PRIVATE_ONLY_MODULE_TYPES = new Set([
  "blog-post-create",
  "blog-post-manager",
  "blog-category-manager",
]);

function filterPublicSections(
  sections: SitePage["layoutSections"]
): SitePage["layoutSections"] {
  return sections.map((section) => ({
    ...section,
    modules: (section.modules || []).filter(
      (m) => !PRIVATE_ONLY_MODULE_TYPES.has(m.type)
    ),
  }));
}

function findHomePage(pages: SitePage[]): SitePage | null {
  const emptySlug = pages.find((p) => p.slug === "");
  if (emptySlug) return emptySlug;
  const homeSlug = pages.find((p) => p.slug === "home");
  if (homeSlug) return homeSlug;
  return null;
}

function findPageForPath(pages: SitePage[], pathname: string): SitePage | null {
  if (!pages.length) return null;
  const slug = normalizePublicSlug(pathname);

  if (isHomeSlug(slug)) {
    return findHomePage(pages);
  }

  if (slug) {
    return pages.find((p) => normalizePublicSlug(p.slug) === slug) ?? null;
  }

  return null;
}

type Props = { projectId: string };

export function BuilderPublicSitePage({ projectId }: Props) {
  const [page, setPage] = useState<SitePage | null>(null);
  const [themePalette, setThemePalette] = useState<CrmThemePalette | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!projectId) { setLoaded(true); return; }
    const routingPath = window.location.pathname || "/";
    const slug = normalizePublicSlug(routingPath);
    const isPrivate = isPrivateSiteSlug(slug);

    const load = isPrivate
      ? fetchPrivatePages(projectId).then((privatePages) => {
          if (privatePages === "unauthorized") {
            setRedirecting(true);
            window.location.href = "/admin-login";
            return null;
          }
          return findPageForPath(privatePages, routingPath);
        })
      : fetchPublicPages(projectId).then((pages) => findPageForPath(pages, routingPath));

    load
      .then((found) => setPage(found))
      .catch(() => setPage(null))
      .finally(() => setLoaded(true));
  }, [projectId]);

  useEffect(() => {
    if (!page) {
      setThemePalette(undefined);
      return;
    }
    const fromPage = pageThemePalette(page);
    const hasColors = Boolean(
      fromPage.primaryColor ||
      fromPage.secondaryColor ||
      fromPage.backgroundColor ||
      fromPage.accentColor
    );
    if (hasColors) {
      setThemePalette(fromPage);
      return;
    }
    const themeId = String(page.themeId || "").trim();
    fetch("/api/builder/themes", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { themes?: Array<{ id?: string; primaryColor?: string; secondaryColor?: string; backgroundColor?: string; accentColor?: string }> } | null) => {
        const themes = Array.isArray(data?.themes) ? data.themes : [];
        const match = themeId
          ? themes.find((theme) => String(theme.id || "") === themeId) || themes[0]
          : themes[0];
        setThemePalette(mergeCrmThemePalette(fromPage, builderThemeToCrmPalette(match)));
      })
      .catch(() => {
        setThemePalette(fromPage);
      });
  }, [page]);

  if (redirecting) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center", color: "#333" }}>
        <p>Redirecting to sign in…</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center", color: "#333" }}>
        <p>Loading…</p>
      </div>
    );
  }

  if (!page) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}>
        <p>Coming soon.</p>
      </div>
    );
  }

  const slug = normalizePublicSlug(window.location.pathname || "/");
  const sections = isPrivateSiteSlug(slug)
    ? page.layoutSections
    : filterPublicSections(page.layoutSections);

  return (
    <BuilderTemplatePreview
      layoutSections={sections}
      pageBackground={page.pageBackground}
      theme={page.theme}
      themePalette={themePalette ?? pageThemePalette(page)}
      projectId={projectId}
    />
  );
}
