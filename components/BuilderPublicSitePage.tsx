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
  const withoutExt = pathname.replace(/\.html$/, "");
  return withoutExt.replace(/^\//, "").replace(/\/$/, "");
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

function findPageForPath(pages: SitePage[], pathname: string): SitePage | null {
  if (!pages.length) return null;
  const slug = slugFromPathname(pathname);
  // Try exact slug match first, then fall back to root/home page
  const exact = pages.find((p) => p.slug === slug);
  if (exact) return exact;
  // Root path or no match — use first page (or one with empty slug)
  const home = pages.find((p) => p.slug === "") ?? pages[0];
  return home ?? null;
}

type Props = { projectId: string };

export function BuilderPublicSitePage({ projectId }: Props) {
  const [page, setPage] = useState<SitePage | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!projectId) { setLoaded(true); return; }
    fetchPublicPages(projectId)
      .then((pages) => setPage(findPageForPath(pages, window.location.pathname)))
      .catch(() => setPage(null))
      .finally(() => setLoaded(true));
  }, [projectId]);

  if (!loaded) return null;

  if (!page || !page.layoutSections.length) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}>
        <p>Coming soon.</p>
      </div>
    );
  }

  return (
    <BuilderTemplatePreview
      layoutSections={page.layoutSections}
      pageBackground={page.pageBackground}
      theme={page.theme}
      projectId={projectId}
      showShell={false}
    />
  );
}
