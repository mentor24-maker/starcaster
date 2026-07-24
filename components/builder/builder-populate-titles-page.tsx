import { useState, useEffect, useMemo } from "react";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";

/**
 * "Populate Module Titles" extension screen.
 *
 * Batch-fills the optional section.title and module.name fields across saved
 * pages from their own content. The source priority is operator-configurable
 * (reorder the list) and persisted locally. Fills blanks only unless overwrite
 * is on. The actual title-derivation logic lives server-side in
 * lib/populateModuleTitles.js — this screen only chooses pages + order and
 * renders the report.
 *
 * Keep TITLE_SOURCES below in sync with the same list in
 * lib/populateModuleTitles.js (key + label).
 */

const TITLE_SOURCES: { key: string; label: string }[] = [
  { key: "heading-leftmost", label: "Left-most, largest heading" },
  { key: "heading-rightside", label: "Right-side, largest heading (two columns)" },
  { key: "heading-largest", label: "Largest heading anywhere" },
  { key: "image-leftmost", label: "Left-most image, Alt text" },
  { key: "image-rightside", label: "Right-side image, Alt text (two columns)" },
  { key: "image-any", label: "Any image, Alt text" },
  { key: "button", label: "Button label" },
  { key: "text-first-line", label: "First line of a text module" },
  { key: "quote", label: "Quote text" },
  { key: "image-filename", label: "Image filename (when no Alt text)" },
];

const DEFAULT_PRIORITY = TITLE_SOURCES.map((s) => s.key);
const LABEL_BY_KEY = new Map(TITLE_SOURCES.map((s) => [s.key, s.label]));
const CONFIG_STORAGE_KEY = "starcaster_populate_titles_config";

interface PageRecord {
  id: string;
  name: string;
  slug: string;
}

interface ChangeRow {
  level: "section" | "module";
  sectionId: string;
  moduleId?: string;
  from: string;
  to: string;
}

interface UpdatedRow {
  id: string;
  name: string;
  slug: string;
  sectionsTitled: number;
  modulesTitled: number;
  applied: boolean;
  changes: ChangeRow[];
}

interface SkippedRow {
  id: string;
  name: string;
  reason: string;
}

interface RunReport {
  updated: UpdatedRow[];
  skipped: SkippedRow[];
  dryRun: boolean;
  overwrite: boolean;
  totalPages: number;
}

/** Reorder a valid priority: keep known keys, dedupe, append any missing. */
function normalizePriority(priority: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of priority) {
    if (LABEL_BY_KEY.has(key) && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  for (const key of DEFAULT_PRIORITY) if (!seen.has(key)) ordered.push(key);
  return ordered;
}

function loadConfig(): { priority: string[]; overwrite: boolean } {
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        priority: normalizePriority(Array.isArray(parsed.priority) ? parsed.priority : DEFAULT_PRIORITY),
        overwrite: parsed.overwrite === true,
      };
    }
  } catch {
    // fall through to defaults
  }
  return { priority: DEFAULT_PRIORITY, overwrite: false };
}

export function BuilderPopulateTitlesPage() {
  const initial = useMemo(loadConfig, []);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [priority, setPriority] = useState<string[]>(initial.priority);
  const [overwrite, setOverwrite] = useState<boolean>(initial.overwrite);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<RunReport | null>(null);
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

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ priority, overwrite }));
    } catch {
      // Non-blocking preference persistence
    }
  }, [priority, overwrite]);

  const allSelected = pages.length > 0 && selectedIds.size === pages.length;

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

  function move(index: number, delta: number) {
    setPriority((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function resetPriority() {
    setPriority(DEFAULT_PRIORITY);
  }

  async function run(dryRun: boolean) {
    setIsRunning(true);
    setStatus(null);
    setReport(null);
    try {
      const res = await appApi("/api/builder/landing-pages/populate-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageIds: Array.from(selectedIds),
          priority,
          overwrite,
          dryRun,
        }),
      });
      const data = unwrapEnvelope<RunReport>(res);
      setReport(data);
      const titled = data.updated.reduce((sum, u) => sum + u.sectionsTitled + u.modulesTitled, 0);
      setStatus({
        message: dryRun
          ? `Preview: ${titled} title${titled === 1 ? "" : "s"} would be filled across ${data.updated.length} page${data.updated.length === 1 ? "" : "s"}. Nothing saved yet.`
          : `Done: filled ${titled} title${titled === 1 ? "" : "s"} across ${data.updated.length} page${data.updated.length === 1 ? "" : "s"}.`,
        isError: false,
      });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not run the tool", isError: true });
    } finally {
      setIsRunning(false);
    }
  }

  const scopeNote = selectedIds.size === 0 ? "all pages" : `${selectedIds.size} selected page${selectedIds.size === 1 ? "" : "s"}`;

  return (
    <div className="populate-titles-page">
      <p className="meta">
        This tool reads what's inside each section and module on your saved pages and writes a short
        title for anything that doesn't have one yet — using the section's biggest heading, an image's
        description, a button label, and so on. It only fills titles that are <strong>empty</strong>, so
        it never changes anything you've already named. Always run <em>Preview</em> first: it shows
        exactly what it would write, without saving.
      </p>

      <div className="populate-titles-columns">
        <section className="populate-titles-panel">
          <div className="populate-titles-panel-head">
            <h3>Priority order</h3>
            <button type="button" className="btn btn-sm" onClick={resetPriority}>Reset to default</button>
          </div>
          <p className="meta">The tool tries each source top-to-bottom and uses the first one that has content.</p>
          <ol className="populate-titles-priority">
            {priority.map((key, index) => (
              <li key={key} className="populate-titles-priority-row">
                <span className="populate-titles-priority-num">{index + 1}</span>
                <span className="populate-titles-priority-label">{LABEL_BY_KEY.get(key) ?? key}</span>
                <span className="populate-titles-priority-actions">
                  <button type="button" className="btn btn-sm" disabled={index === 0} aria-label="Move up" onClick={() => move(index, -1)}>↑</button>
                  <button type="button" className="btn btn-sm" disabled={index === priority.length - 1} aria-label="Move down" onClick={() => move(index, 1)}>↓</button>
                </span>
              </li>
            ))}
          </ol>
          <div className="populate-titles-overwrite">
            <label className="populate-titles-check">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              <span>Replace titles that already have text</span>
            </label>
            <p className="meta populate-titles-check-help">
              Leave this off to fill only the empty ones and keep the titles you've written yourself.
            </p>
          </div>
        </section>

        <section className="populate-titles-panel">
          <div className="populate-titles-panel-head">
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
            <ul className="populate-titles-pages">
              {pages.map((page) => (
                <li key={page.id}>
                  <label className="populate-titles-check">
                    <input type="checkbox" checked={selectedIds.has(page.id)} onChange={() => togglePage(page.id)} />
                    <span>{page.name || page.slug || page.id}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="populate-titles-panel">
          <div className="populate-titles-panel-head">
            <h3>Selected</h3>
            {selectedIds.size > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => setSelectedIds(new Set())}>Clear</button>
            )}
          </div>
          {selectedIds.size === 0 ? (
            <p className="meta populate-titles-selected-empty">
              Nothing selected — the tool will run on <strong>all {pages.length} page{pages.length === 1 ? "" : "s"}</strong>.
            </p>
          ) : (
            <ul className="populate-titles-selected-list">
              {pages.filter((p) => selectedIds.has(p.id)).map((page) => (
                <li key={page.id} className="populate-titles-selected-row">
                  <span className="populate-titles-selected-name">{page.name || page.slug || page.id}</span>
                  <button type="button" className="btn btn-sm" aria-label={`Remove ${page.name || page.slug || page.id}`} onClick={() => togglePage(page.id)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="populate-titles-actions">
        <button type="button" className="btn" disabled={isRunning || isLoading} onClick={() => run(true)}>
          {isRunning ? "Working…" : `Preview (${scopeNote})`}
        </button>
        <button type="button" className="btn btn-primary" disabled={isRunning || isLoading} onClick={() => run(false)}>
          {isRunning ? "Working…" : `Populate Titles (${scopeNote})`}
        </button>
      </div>

      {status && <p className={`populate-titles-status${status.isError ? " is-error" : ""}`}>{status.message}</p>}

      {report && (
        <div className="populate-titles-report">
          {report.updated.length === 0 ? (
            <p className="meta">No blank titles to fill on the pages you chose.</p>
          ) : (
            report.updated.map((page) => (
              <details key={page.id} className="populate-titles-report-page">
                <summary>
                  <strong>{page.name || page.slug || page.id}</strong>
                  <span className="meta">
                    {" "}— {page.sectionsTitled} section{page.sectionsTitled === 1 ? "" : "s"}, {page.modulesTitled} module{page.modulesTitled === 1 ? "" : "s"}
                    {report.dryRun ? " (preview)" : ""}
                  </span>
                </summary>
                <ul className="populate-titles-change-list">
                  {page.changes.map((c, i) => (
                    <li key={i}>
                      <span className="populate-titles-change-level">{c.level}</span>
                      <span className="populate-titles-change-arrow">
                        {c.from ? <><em>{c.from}</em> → </> : null}
                        <strong>{c.to}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
          {report.skipped.length > 0 && (
            <p className="meta populate-titles-skipped">
              Skipped {report.skipped.length} page{report.skipped.length === 1 ? "" : "s"} with no blank titles to fill.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
