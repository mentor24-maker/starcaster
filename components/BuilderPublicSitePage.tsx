"use client";

import { useEffect, useRef, useState } from "react";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import {
  builderThemeToCrmPalette,
  buildBuilderThemeStyles,
  coerceThemeShellBackgroundSource,
  mergeCrmThemePalette,
  type BuilderThemeStyles,
  type CrmThemePalette,
  type ThemeShellBackgroundSource,
} from "@/components/builder/builder-utils";
import { BuilderViewportShellLayout } from "@/components/builder/builder-viewport-shell-layout";
import {
  createDefaultBackgroundSettings,
  createDefaultTheme,
  normalizeBuilderDocument,
} from "@/lib/builder-template";
import {
  ADMIN_LOGIN_PATH,
  getAdminAuthHeaders,
  isAdminNavCookieSet,
  redirectAfterAdminLogout,
} from "@/lib/public-admin-session";
import { starcasterScopedHeaders, unwrapEnvelope } from "@/lib/adapters/starcaster-app";
import { isPrivateSiteSlug } from "@/lib/public-site-page-slugs";

type SiteThemeShell = ThemeShellBackgroundSource & BuilderThemeStyles;

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
  themeShell?: SiteThemeShell | null;
};

function mapSitePageRecord(page: Record<string, unknown>): SitePage {
  const doc = normalizeBuilderDocument(page);
  const themeShellRaw = page.themeShell;
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
    themeShell:
      themeShellRaw && typeof themeShellRaw === "object" && !Array.isArray(themeShellRaw)
        ? (themeShellRaw as SiteThemeShell)
        : null,
  };
}

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
  return pages.map((p: unknown) => mapSitePageRecord(p as Record<string, unknown>));
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
  return pages.map((p: unknown) => mapSitePageRecord(p as Record<string, unknown>));
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
  const [themeStyles, setThemeStyles] = useState<BuilderThemeStyles | undefined>(undefined);
  const [themeShellBackground, setThemeShellBackground] = useState<ThemeShellBackgroundSource>(null);
  const [loaded, setLoaded] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [isAdminNav, setIsAdminNav] = useState(false);
  const adminLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setIsAdminNav(isAdminNavCookieSet());
  }, []);

  // Position Admin link just above the language/globe social icon.
  useEffect(() => {
    if (!isAdminNav || !loaded) return;
    const adminEl = adminLinkRef.current;
    if (!adminEl) return;

    function findLangEntry(): HTMLElement | null {
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>(".builder-preview-social-entry img")
      );
      const langImg = imgs.find((img) => /\/language|\/globe/.test(img.getAttribute("src") ?? ""));
      if (!langImg) return null;
      return langImg.closest<HTMLElement>(".builder-preview-social-entry") ?? langImg;
    }

    function reposition() {
      const entry = findLangEntry();
      if (!entry) return;
      const rect = entry.getBoundingClientRect();
      const h = adminEl!.offsetHeight || 24;
      const topVal = rect.top - h - 46;
      adminEl!.style.top = `${topVal}px`;
      adminEl!.style.left = `${rect.left + Math.round((rect.width - (adminEl!.offsetWidth || 54)) / 2)}px`;
      adminEl!.style.bottom = "auto";
      adminEl!.style.right = "auto";
    }

    const timer = setTimeout(reposition, 80);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition);
    };
  }, [isAdminNav, loaded]);

  useEffect(() => {
    if (!projectId) { setLoaded(true); return; }
    const routingPath = window.location.pathname || "/";
    const slug = normalizePublicSlug(routingPath);

    if (slug === "admin-logout") {
      setRedirecting(true);
      void redirectAfterAdminLogout(ADMIN_LOGIN_PATH);
      return;
    }

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
      setThemeStyles(undefined);
      setThemeShellBackground(null);
      return;
    }
    const fromPage = pageThemePalette(page);
    const embeddedShell = page.themeShell ?? null;

    if (embeddedShell) {
      const shell = coerceThemeShellBackgroundSource(embeddedShell) ?? embeddedShell;
      setThemePalette(mergeCrmThemePalette(fromPage, builderThemeToCrmPalette(shell)));
      setThemeStyles(buildBuilderThemeStyles(shell));
      setThemeShellBackground(shell);
      return;
    }

    const themeId = String(page.themeId || "").trim();
    const hasPageColors = Boolean(
      fromPage.primaryColor ||
      fromPage.secondaryColor ||
      fromPage.backgroundColor ||
      fromPage.accentColor
    );

    if (!themeId && hasPageColors) {
      setThemePalette(fromPage);
      setThemeStyles(undefined);
      setThemeShellBackground(null);
      return;
    }

    fetch("/api/builder/themes", {
      credentials: "include",
      headers: {
        ...starcasterScopedHeaders(),
        ...(projectId ? { "X-Project-ID": projectId } : {}),
      },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Record<string, unknown> | null) => {
        const themes = (unwrapEnvelope<Array<Record<string, unknown>>>(data ?? {}, "themes") ?? []);
        const match = themeId
          ? themes.find((theme) => String(theme.id || "") === themeId) || themes[0] || null
          : themes[0] || null;
        const shell = coerceThemeShellBackgroundSource(match) ?? match;
        setThemePalette(mergeCrmThemePalette(fromPage, builderThemeToCrmPalette(shell)));
        setThemeStyles(buildBuilderThemeStyles(shell));
        setThemeShellBackground(shell);
      })
      .catch(() => {
        setThemePalette(fromPage);
        setThemeStyles(undefined);
        setThemeShellBackground(null);
      });
  }, [page, projectId]);

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

  const effectiveThemeStyles = page.themeShell
    ? buildBuilderThemeStyles(page.themeShell)
    : themeStyles;
  const effectiveThemeShellBackground = coerceThemeShellBackgroundSource(
    page.themeShell ?? themeShellBackground
  );

  return (
    <>
      {isAdminNav ? (
        <a
          ref={adminLinkRef}
          href={ADMIN_LOGIN_PATH}
          className="site-admin-nav-link"
          aria-label="Admin"
        >
          Admin
        </a>
      ) : null}
      <BuilderViewportShellLayout
        className="builder-public-site-layout"
        pageBackground={page.pageBackground}
        themeShellBackground={effectiveThemeShellBackground}
        themeStyles={effectiveThemeStyles}
      >
        <BuilderTemplatePreview
          layoutSections={sections}
          pageBackground={page.pageBackground}
          theme={page.theme}
          themePalette={themePalette ?? pageThemePalette(page)}
          themeStyles={effectiveThemeStyles}
          themeShellBackground={effectiveThemeShellBackground}
          applyThemePageMargins={false}
          suppressShellBackground
          projectId={projectId}
        />
      </BuilderViewportShellLayout>
    </>
  );
}
