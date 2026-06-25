"use client";

import { useEffect, useState } from "react";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import {
  createDefaultBackgroundSettings,
  createDefaultTheme,
  normalizeBuilderDocument,
} from "@/lib/builder-template";

type SitePage = {
  name: string;
  slug: string;
  pageBackground: ReturnType<typeof createDefaultBackgroundSettings>;
  theme: ReturnType<typeof normalizeBuilderDocument>["theme"];
  layoutSections: ReturnType<typeof normalizeBuilderDocument>["layoutSections"];
  projectId?: string;
};

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

function isRestrictedAdminSlug(slug: string): boolean {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "admin-login") return false;
  if (normalized === "admin" || normalized.startsWith("admin-")) return true;
  return false;
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
    };
  });
}

async function fetchRestrictedAdminPages(projectId: string): Promise<SitePage[] | "unauthorized"> {
  const res = await fetch(
    `/api/public/admin-pages?projectId=${encodeURIComponent(projectId)}`,
    { credentials: "include" }
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
    };
  });
}

// Module types that are admin-only and must never render on the public site.
const ADMIN_ONLY_MODULE_TYPES = new Set([
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
      (m) => !ADMIN_ONLY_MODULE_TYPES.has(m.type)
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
  const [loaded, setLoaded] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!projectId) { setLoaded(true); return; }
    const routingPath = window.location.pathname || "/";
    const slug = normalizePublicSlug(routingPath);
    const needsAdminAuth = isRestrictedAdminSlug(slug);

    fetchPublicPages(projectId)
      .then(async (pages) => {
        let found = findPageForPath(pages, routingPath);
        if (!found && needsAdminAuth) {
          const adminPages = await fetchRestrictedAdminPages(projectId);
          if (adminPages === "unauthorized") {
            setRedirecting(true);
            window.location.href = "/admin-login";
            return;
          }
          found = findPageForPath(adminPages, routingPath);
        }
        setPage(found);
      })
      .catch(() => setPage(null))
      .finally(() => setLoaded(true));
  }, [projectId]);

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

  return (
    <BuilderTemplatePreview
      layoutSections={filterPublicSections(page.layoutSections)}
      pageBackground={page.pageBackground}
      theme={page.theme}
      projectId={projectId}
    />
  );
}
