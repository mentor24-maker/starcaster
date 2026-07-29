import { useState, useEffect } from "react";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";

/**
 * "SEO Alt Text" extension screen.
 *
 * Fully automatic: for every image missing alt text on the pages you pick, the
 * server gathers the section's words + the page URL, runs a web search, and asks
 * AI to write a short, natural alt description. The heavy lifting is server-side
 * (lib/seoAltText.js + routes/seoAltText.js) — this screen only picks pages and
 * drives the per-page loop so a long run survives Vercel's serverless freeze.
 *
 * The loop is client-driven ON PURPOSE: one page per request, browser fires the
 * next as each returns, and a live progress popup shows "page N of M". A blind
 * server-side background loop would be killed mid-way when the function returns.
 */

const SECONDS_PER_IMAGE = 2; // rough ETA: one Brave search + one AI call per image

interface PageRecord {
  id: string;
  name: string;
  slug: string;
}

interface ChangeRow {
  sectionId: string;
  moduleId: string;
  from: string;
  to: string;
}

interface PageResult {
  pageId: string;
  name: string;
  slug: string;
  altFilled: number;
  changes: ChangeRow[];
  applied: boolean;
}

interface Progress {
  pagesDone: number;
  totalPages: number;
  imagesDone: number;
  totalImages: number;
  currentPage: string;
}

export function BuilderSeoAltTextPage() {
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [results, setResults] = useState<PageResult[]>([]);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await appApi("/api/builder/landing-pages");
        const list = unwrapEnvelope<PageRecord[]>(res, "pages");
        setPages(Array.isArray(list) ? list : []);
      } catch {
        setPages([]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const allSelected = pages.length > 0 && selectedIds.size === pages.length;
  const isRunning = progress !== null;

  function togglePage(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(pages.map((p) => p.id)));
  }

  function targetPages(): PageRecord[] {
    if (selectedIds.size === 0) return pages;
    return pages.filter((p) => selectedIds.has(p.id));
  }

  async function postPage(pageId: string, extra: Record<string, unknown>) {
    const res = await appApi("/api/builder/seo-alt-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, overwrite, ...extra }),
    });
    return unwrapEnvelope<Record<string, unknown>>(res);
  }

  async function run(dryRun: boolean) {
    const chosen = targetPages();
    if (chosen.length === 0) return;
    setStatus(null);
    setResults([]);

    // Count pass — cheap, no search/AI — so the popup shows a real total + ETA.
    const counts: number[] = [];
    let totalImages = 0;
    setProgress({ pagesDone: 0, totalPages: chosen.length, imagesDone: 0, totalImages: 0, currentPage: "Counting images…" });
    try {
      for (const page of chosen) {
        const data = await postPage(page.id, { countOnly: true });
        const n = Number(data.imageCount || 0);
        counts.push(n);
        totalImages += n;
      }
    } catch (err) {
      setProgress(null);
      setStatus({ message: (err as Error).message || "Could not count images", isError: true });
      return;
    }

    if (totalImages === 0) {
      setProgress(null);
      setStatus({
        message: overwrite
          ? "No images found on the pages you chose."
          : "Every image on the pages you chose already has alt text. Turn on “Replace existing alt text” to redo them.",
        isError: false,
      });
      return;
    }

    // Process pass — one page per request; browser drives the loop.
    const collected: PageResult[] = [];
    let imagesDone = 0;
    try {
      for (let i = 0; i < chosen.length; i++) {
        const page = chosen[i];
        setProgress({
          pagesDone: i,
          totalPages: chosen.length,
          imagesDone,
          totalImages,
          currentPage: page.name || page.slug || page.id,
        });
        const data = await postPage(page.id, { dryRun });
        const result: PageResult = {
          pageId: page.id,
          name: page.name,
          slug: page.slug,
          altFilled: Number(data.altFilled || 0),
          changes: Array.isArray(data.changes) ? (data.changes as ChangeRow[]) : [],
          applied: data.applied === true,
        };
        collected.push(result);
        imagesDone += counts[i] || 0;
        setResults([...collected]);
      }
    } catch (err) {
      setProgress(null);
      setResults(collected);
      setStatus({ message: (err as Error).message || "Something went wrong mid-run", isError: true });
      return;
    }

    setProgress(null);
    const filled = collected.reduce((sum, r) => sum + r.altFilled, 0);
    setStatus({
      message: dryRun
        ? `Preview: ${filled} alt text${filled === 1 ? "" : "s"} would be written across ${collected.length} page${collected.length === 1 ? "" : "s"}. Nothing saved yet.`
        : `Done: wrote ${filled} alt text${filled === 1 ? "" : "s"} across ${collected.length} page${collected.length === 1 ? "" : "s"}.`,
      isError: false,
    });
  }

  const scopeNote = selectedIds.size === 0 ? "all pages" : `${selectedIds.size} selected page${selectedIds.size === 1 ? "" : "s"}`;

  return (
    <div className="seo-alt-text-page">
      <p className="meta">
        For every image that has no alt text yet, this reads the words already in the image's section
        plus the page's web address, checks what's ranking in a live web search, and writes a short,
        natural description into the image's Alt field — good for both screen readers and SEO/GEO.
        It fills <strong>empty</strong> alt text only, so it never overwrites anything you wrote yourself.
        Each image runs a web search and an AI request, so a big page takes a little while — the progress
        bar shows exactly where it is. Always run <em>Preview</em> first.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "16px 0" }}>
        <section style={{ flex: "1 1 320px", minWidth: 280 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Pages</h3>
            {pages.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={toggleAll}>
                {allSelected ? "Clear selection" : "Select all"}
              </button>
            )}
          </div>
          <p className="meta">Leave everything unchecked to run on <strong>all</strong> pages.</p>
          {isLoading ? (
            <p className="meta">Loading pages…</p>
          ) : pages.length === 0 ? (
            <p className="meta">No pages found.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 320, overflowY: "auto" }}>
              {pages.map((page) => (
                <li key={page.id} style={{ padding: "2px 0" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedIds.has(page.id)} onChange={() => togglePage(page.id)} />
                    <span>{page.name || page.slug || page.id}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ flex: "1 1 260px", minWidth: 240 }}>
          <h3>Options</h3>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>Replace alt text that's already there</span>
          </label>
          <p className="meta">
            Leave this off to fill only the empty ones and keep the alt text you've written yourself.
          </p>
        </section>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button type="button" className="btn" disabled={isRunning || isLoading} onClick={() => run(true)}>
          {isRunning ? "Working…" : `Preview (${scopeNote})`}
        </button>
        <button type="button" className="btn btn-primary" disabled={isRunning || isLoading} onClick={() => run(false)}>
          {isRunning ? "Working…" : `Write Alt Text (${scopeNote})`}
        </button>
      </div>

      {status && (
        <p className="meta" style={{ marginTop: 12, color: status.isError ? "var(--danger, #b00)" : undefined }}>
          {status.message}
        </p>
      )}

      {progress && <ProgressModal progress={progress} />}

      {results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {results.map((page) => (
            <details key={page.pageId} style={{ marginBottom: 8 }}>
              <summary>
                <strong>{page.name || page.slug || page.pageId}</strong>
                <span className="meta">
                  {" "}— {page.altFilled} image{page.altFilled === 1 ? "" : "s"}
                  {page.applied ? "" : " (preview)"}
                </span>
              </summary>
              <ul style={{ margin: "6px 0 6px 16px" }}>
                {page.changes.map((c, i) => (
                  <li key={i}>
                    {c.from ? <><em>{c.from}</em> → </> : null}
                    <strong>{c.to}</strong>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressModal({ progress }: { progress: Progress }) {
  const pct = progress.totalImages > 0 ? Math.round((progress.imagesDone / progress.totalImages) * 100) : 0;
  const remaining = Math.max(0, progress.totalImages - progress.imagesDone);
  const etaSeconds = remaining * SECONDS_PER_IMAGE;
  const etaLabel =
    etaSeconds >= 60 ? `about ${Math.ceil(etaSeconds / 60)} min left` : `about ${etaSeconds}s left`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div style={{ background: "var(--panel-bg, #fff)", color: "var(--text, #111)", borderRadius: 10, padding: 24, width: 380, maxWidth: "90vw", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}>
        <h3 style={{ marginTop: 0 }}>Writing alt text…</h3>
        <p className="meta" style={{ margin: "4px 0 12px" }}>
          {progress.currentPage} — page {Math.min(progress.pagesDone + 1, progress.totalPages)} of {progress.totalPages}
        </p>
        <div style={{ height: 10, borderRadius: 6, background: "rgba(0,0,0,0.12)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent, #3b82f6)", transition: "width 0.3s" }} />
        </div>
        <p className="meta" style={{ margin: "10px 0 0" }}>
          {progress.imagesDone} of {progress.totalImages} images · {etaLabel}
        </p>
      </div>
    </div>
  );
}
