/**
 * "What the build step will create" — reads the map report the build step
 * (`scripts/site_import_map.mjs`) uploads on every run, dry or `--apply`, to
 * `SiteImport/<jobId>/map-report.json`, and turns it into what the Imports
 * screen shows: one row per page, WordPress leftovers flagged in plain words,
 * placeholder totals by kind. Task 86bch6e2q — until this, those facts lived
 * only in an agent session's terminal.
 *
 * The shape here is the REAL one (read from job simp_1791736361987_b1etxy's
 * report, mirrored from `MapReport` in lib/site-import/map.ts). The report
 * carries no theme, so the screen says that rather than inventing one.
 */

export type MapReportPage = {
  path: string;
  slug: string;
  modules: number;
  placeholders: number;
  builderPageId?: string | null;
};

export type MapReportData = {
  elements?: { total?: number; mapped?: number; placeholder?: number };
  pages?: MapReportPage[];
  placeholderPatterns?: { signature: string; count: number }[];
  /** Not written by the mapper today; shown if a future report carries it. */
  theme?: { name?: string; notes?: string[] } | null;
};

/**
 * Why a page probably is not one you want in your menu, or null if it looks
 * like a real page. `seenRoot` is whether an earlier row already mapped "/"
 * — the mapper emits extra copies of the home page as `home-imported`,
 * `home-imported-2`, … and those carry the same source path.
 */
export function leftoverReason(page: { path: string; slug: string }, seenRoot = false): string | null {
  const path = String(page.path || "").toLowerCase();
  const slug = String(page.slug || "").toLowerCase();
  if (/^home-imported(-\d+)?$/.test(slug) || (path === "/" && seenRoot)) {
    return "another copy of the home page";
  }
  // The mapper renames a page whose address is already taken by appending
  // "-imported" — delraytennis.com's /Events-Calendar/ beside /events-calendar/.
  if (/-imported(-\d+)?$/.test(slug)) return "its address was already taken, so it may be a duplicate";
  if (/^\/author\//.test(path)) return "a WordPress author archive";
  if (/^\/category\//.test(path)) return "a WordPress category archive";
  if (/^\/tag\//.test(path)) return "a WordPress tag archive";
  if (/^\/forums?\//.test(path)) return "a forum page";
  if (/^\/\d{4}\/\d{2}\/\d{2}\//.test(path)) return "a dated blog post";
  if (/^\/feed\/?$/.test(path)) return "the WordPress feed";
  if (/\/page\/\d+\/?$/.test(path)) return "a second page of a listing";
  return null;
}

export type BuildReportRow = MapReportPage & { leftover: string | null };

export type BuildReportSummary = {
  rows: BuildReportRow[];
  leftoverCount: number;
  placeholderTotal: number;
  /** Placeholder counts by kind ("form", "embed", "table"), largest first. */
  placeholderKinds: { kind: string; count: number }[];
  theme: { name?: string; notes?: string[] } | null;
};

export function summarizeBuildReport(report: MapReportData): BuildReportSummary {
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  let seenRoot = false;
  const rows = pages.map((page) => {
    const leftover = leftoverReason(page, seenRoot);
    if (page.path === "/") seenRoot = true;
    return { ...page, leftover };
  });

  const byKind = new Map<string, number>();
  for (const pattern of Array.isArray(report?.placeholderPatterns) ? report.placeholderPatterns : []) {
    const kind = String(pattern.signature || "").split(":")[0].trim() || "other";
    byKind.set(kind, (byKind.get(kind) ?? 0) + (Number(pattern.count) || 0));
  }
  const placeholderKinds = Array.from(byKind, ([kind, count]) => ({ kind, count })).sort(
    (a, b) => b.count - a.count
  );

  return {
    rows,
    leftoverCount: rows.filter((r) => r.leftover).length,
    // Summed from the rows, not `elements.placeholder`: an older report
    // (delraytennis.com, 2026-08) says 0 there while its pages carry 24, and
    // a total that disagrees with the table under it reads as a broken screen.
    placeholderTotal: rows.reduce((sum, r) => sum + (Number(r.placeholders) || 0), 0),
    placeholderKinds,
    theme: report?.theme && typeof report.theme === "object" ? report.theme : null,
  };
}

/**
 * Where the report lives. An `--apply` run records its URL on the map
 * checkpoint; a dry run records nothing, so the path is derived from the
 * same blob store the capture index sits in (`…/SiteImport/<id>/capture/
 * index.json` → `…/SiteImport/<id>/map-report.json`).
 */
export function mapReportUrl(
  jobId: string,
  mapReportUrlFromCheckpoint: string | undefined,
  captureBlobPath: string | undefined
): string | null {
  if (mapReportUrlFromCheckpoint) return mapReportUrlFromCheckpoint;
  if (!captureBlobPath) return null;
  const marker = `/SiteImport/${jobId}/`;
  const at = captureBlobPath.indexOf(marker);
  if (at < 0) return null;
  return `${captureBlobPath.slice(0, at + marker.length)}map-report.json`;
}

export function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
