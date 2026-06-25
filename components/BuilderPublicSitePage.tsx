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

function slugFromPathname(pathname: string): string {
  let p = pathname.replace(/\.html$/, "");
  p = p.replace(/^\/api\/_site\/[^/]+/, "").replace(/^\/_site\/[^/]+/, "");
  if (p === "/_site" || p === "/api/_site") p = "/";
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const pathParam = params?.get("path");
  if (pathParam && (pathname.includes("/_site/") || pathname.includes("/api/_site/"))) {
    p = pathParam.replace(/\.html$/, "");
  }
  return p.replace(/^\//, "").replace(/\/$/, "");
}

function isHomeSlug(slug: string): boolean {
  return slug === "" || slug === "home";
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
  const slug = slugFromPathname(pathname);

  if (isHomeSlug(slug)) {
    return findHomePage(pages);
  }

  if (slug) {
    return pages.find((p) => p.slug === slug) ?? null;
  }

  return null;
}

type Props = { projectId: string };

export function BuilderPublicSitePage({ projectId }: Props) {
  const [page, setPage] = useState<SitePage | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!projectId) { setLoaded(true); return; }
    const routingPath = window.location.pathname + window.location.search;
    fetchPublicPages(projectId)
      .then((pages) => setPage(findPageForPath(pages, routingPath)))
      .catch(() => setPage(null))
      .finally(() => setLoaded(true));
  }, [projectId]);

  if (!loaded) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center", color: "#333" }}>
        <p>Loading…</p>
      </div>
    );
  }

  if (!page || !page.layoutSections.length) {
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
      showShell={false}
    />
  );
}
