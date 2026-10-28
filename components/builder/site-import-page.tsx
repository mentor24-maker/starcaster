import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { appApi, unwrapEnvelope, type StarcasterEnvelope } from "@/lib/adapters/starcaster-app";
import {
  mapReportUrl,
  pluralize,
  summarizeBuildReport,
  summarizeMenus,
  type BuiltMenus,
  type MapReportData,
} from "./site-import-build-report";
import { SiteImportThemePanel, importThemeRecordOf } from "./site-import-theme-panel";

/**
 * Site Import (staff-only) — queue a site-capture job and review its
 * results: coverage report, page screenshots, asset gallery with the
 * failure ledger, and the raw IR. Spec: docs/site-import/01 §1e.
 *
 * The capture itself runs on the operator's machine, not on Vercel — this
 * page only queues jobs and watches them, and says so plainly. Status
 * POLLS every 5 s while the tab is visible (house pattern; no Realtime).
 */

type CoverageCounts = Record<string, number>;

type Job = {
  id: string;
  sourceUrl: string;
  status: string;
  claimedBy: string;
  claimedAt?: string | null;
  attempts: number;
  clientAuthorization: string;
  checkpoints: Record<
    string,
    { at?: string; blobPath?: string; notes?: string; reportUrl?: string } | boolean | undefined
  > & {
    cancelRequested?: boolean;
  };
  coverage: {
    captured?: CoverageCounts;
    emitted?: CoverageCounts;
    dropped?: CoverageCounts;
    pages?: { discovered: number; captured: number; failed: number };
    caps?: { hit: string[] };
  };
  cost: { browserSeconds?: number; pagesCaptured?: number; assetBytes?: number };
  error: string;
  createdAt: string | null;
  finishedAt: string | null;
};

type Asset = {
  id: string;
  originalUrl: string;
  storageUrl: string;
  mimeType: string;
  byteSize: number;
  status: string;
  error: string;
};

type CaptureIndexPage = {
  url: string;
  slug: string;
  screenshots?: { desktop?: string; tablet?: string; mobile?: string };
};

const POLL_MS = 5000;
const ACTIVE_STATUSES = new Set(["queued", "capturing", "normalizing", "extracting"]);

/**
 * Envelope readers. The API responds `{ ok: true, data: { jobs: [...] } }` —
 * unwrapEnvelope returns the `data` OBJECT, and the payload sits under a key
 * inside it. Treating that object as the array itself is exactly the crash
 * that blanked this screen on 2026-08-06 (jobs.map is not a function → React
 * unmounts the whole root on an uncaught render error), so these helpers are
 * the only way this file reads responses, and they are unit-tested against
 * the real sendOk shape. Exported for those tests.
 */
export function readEnvelopeList<T>(body: StarcasterEnvelope, key: string): T[] {
  const direct = body?.[key];
  if (Array.isArray(direct)) return direct as T[];
  const data = unwrapEnvelope<Record<string, unknown>>(body);
  const nested = data && typeof data === "object" ? data[key] : undefined;
  return Array.isArray(nested) ? (nested as T[]) : [];
}

export function readEnvelopeObject<T>(body: StarcasterEnvelope, key: string): T | null {
  const direct = body?.[key];
  if (direct && typeof direct === "object") return direct as T;
  const data = unwrapEnvelope<Record<string, unknown>>(body);
  const nested = data && typeof data === "object" ? data[key] : undefined;
  return nested && typeof nested === "object" ? (nested as T) : null;
}

/**
 * A render error must degrade to a visible message with a retry button —
 * never a silently blank screen (the React root unmounting on an uncaught
 * error is indistinguishable from "the page is broken" to the operator).
 */
export class SiteImportErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="site-import-page">
          <p className="site-import-status is-error">
            Site Import hit an error: {this.state.error.message}
          </p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function checkpointOf(
  job: Job,
  stage: string
): { at?: string; blobPath?: string; notes?: string; reportUrl?: string } | null {
  const value = job.checkpoints?.[stage];
  return value && typeof value === "object" ? value : null;
}

/**
 * What `scripts/site_import_map.mjs --apply` writes onto the job when it builds
 * the Builder pages. A dry run writes nothing, so its absence means "no pages
 * were built" — the only place that fact is recorded.
 */
export type MapCheckpoint = {
  at?: string;
  pageIds?: Record<string, string>;
  theme?: { id?: string; name?: string; previousDefaultName?: string };
  /** Saved-section ids of the Top Menu / Footer Menu the run made (86bchydp6). */
  menus?: { top?: string; footer?: string };
};

export function mapCheckpointOf(job: Pick<Job, "checkpoints">): MapCheckpoint | null {
  const value = (job.checkpoints as Record<string, unknown> | undefined)?.map;
  return value && typeof value === "object" ? (value as MapCheckpoint) : null;
}

export type ImportStatus = {
  /** Badge text. Never the bare word "complete" — see importStatus. */
  label: string;
  /** CSS suffix for the badge: status-<tone>. */
  tone: "running" | "failed" | "captured" | "built";
  built: boolean;
  pageCount: number;
};

const MOUNTAIN_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  month: "short",
  day: "numeric",
});

/**
 * An import is two steps: the worker COPIES the site (capture, assets,
 * normalize — after which it sets status "complete"), and an agent session
 * BUILDS the Builder pages from the copy. The raw status only knows about the
 * first, so showing it read "COMPLETE" over an empty Pages list (Strands
 * Movie, 2026-10-12). Running and failed jobs keep their status word; a
 * finished copy says which of the two steps it has reached.
 */
export function importStatus(job: Pick<Job, "status" | "checkpoints">): ImportStatus {
  const map = mapCheckpointOf(job);
  const pageCount = map ? Object.keys(map.pageIds ?? {}).length : 0;
  if (job.status === "failed") return { label: "failed", tone: "failed", built: false, pageCount };
  if (job.status !== "complete") return { label: job.status, tone: "running", built: false, pageCount };
  if (!map) return { label: "Captured — pages not built yet", tone: "captured", built: false, pageCount: 0 };
  const noun = pageCount === 1 ? "draft page" : "draft pages";
  const at = map.at ? new Date(map.at) : null;
  const day = at && !Number.isNaN(at.getTime()) ? ` on ${MOUNTAIN_DAY.format(at)}` : "";
  return { label: `Built ${pageCount} ${noun}${day}`, tone: "built", built: true, pageCount };
}

/** How long a queued import may wait before the screen says the worker is not running. */
export const QUEUED_TOO_LONG_MS = 60 * 60 * 1000;

function waitWords(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * What a queued job is waiting for, in words — or null when it is not waiting.
 *
 * alphire.agency sat "queued" here for 14 days (ticket 86bctakm0): nothing ran
 * the worker, and the screen said only that the job "starts when the worker
 * runs", which read as "soon". The worker now runs every five minutes on the
 * Mac Mini, so a job waiting longer than an hour means it is NOT running, and
 * the note says so plainly instead of leaving an unexplained "queued".
 */
export function queueWaitNote(
  job: Pick<Job, "status" | "claimedAt" | "createdAt">,
  now: number = Date.now()
): { text: string; overdue: boolean } | null {
  if (job.status !== "queued" || job.claimedAt) return null;
  const created = job.createdAt ? Date.parse(job.createdAt) : NaN;
  if (!Number.isFinite(created)) {
    return {
      text: "Waiting for the import worker, which has not picked this job up. When it was queued could not be read.",
      overdue: true,
    };
  }
  const waited = now - created;
  if (waited <= QUEUED_TOO_LONG_MS) {
    return {
      text: `Waiting for the import worker — queued ${waitWords(waited)} ago. It checks for new imports every 5 minutes on the Mac Mini.`,
      overdue: false,
    };
  }
  return {
    text: `Waiting for the import worker for ${waitWords(waited)}. It should pick a job up within minutes, so it is not running. The Mac Mini posts a notice on the bus about any import that waits over an hour.`,
    overdue: true,
  };
}

export type BuiltPageRow = { path: string; pageId: string; name: string; slug: string; missing: boolean };

/**
 * Pair each source path the mapper built with the Builder page it wrote.
 * `pages` is null when the page list could not be read, which is not the same
 * as a page having been deleted since — only a page absent from a list that
 * WAS read is marked missing.
 */
export function builtPageRows(
  pageIds: Record<string, string> | undefined,
  pages: Array<{ id: string | number; name?: string; slug?: string }> | null
): BuiltPageRow[] {
  const byId = new Map((pages ?? []).map((p) => [String(p.id), p]));
  return Object.entries(pageIds ?? {})
    .map(([path, pageId]) => {
      const page = byId.get(String(pageId));
      return {
        path,
        pageId: String(pageId),
        name: page?.name ?? "",
        slug: page?.slug ?? "",
        missing: pages !== null && !page,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Opened in a NEW TAB on purpose. The Builder reads `builderPage` only when the
 * app loads on that hash (the Assets "Used In" links work the same way); an
 * in-app hash change lands on the Pages list with the editor closed — measured
 * 2026-10-12. A new tab also keeps this list open while going through pages.
 */
function builderPageHref(pageId: string): string {
  return `#page=builderManagePagesPage&builderPage=${encodeURIComponent(pageId)}`;
}

export default function SiteImportPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [pages, setPages] = useState<CaptureIndexPage[] | null>(null);
  const [irText, setIrText] = useState<string | null>(null);
  const [showIr, setShowIr] = useState(false);
  // undefined = still looking; null = no rehearsal report exists for this job.
  const [mapReport, setMapReport] = useState<MapReportData | null | undefined>(undefined);
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The project's Builder pages, read once a job has built some, to name the
  // pages it built. null = not read (or the read failed — see builderPagesError).
  const [builderPages, setBuilderPages] = useState<Array<{ id: string; name?: string; slug?: string }> | null>(null);
  const [builderPagesError, setBuilderPagesError] = useState("");
  // The menus an --apply run made, with the project's saved sections to name
  // them by. null = no build recorded menu ids.
  const [builtMenus, setBuiltMenus] = useState<BuiltMenus | null>(null);
  const detailFetchedFor = useRef<string>("");

  const loadJobs = useCallback(async () => {
    try {
      const body = await appApi("/api/site-import/jobs");
      setJobs(readEnvelopeList<Job>(body, "jobs"));
    } catch (err) {
      setStatus({ message: (err as Error).message, isError: true });
    }
  }, []);

  const loadJobDetail = useCallback(async (id: string) => {
    try {
      const body = await appApi(`/api/site-import/jobs/${encodeURIComponent(id)}`);
      const fresh = readEnvelopeObject<Job>(body, "job");
      if (!fresh) return;
      setJob(fresh);
      // Once a run has capture output, fetch the page list (screenshots)
      // and — after normalize — assets + IR, one time per job.
      const captureCp = checkpointOf(fresh, "capture");
      if (captureCp?.blobPath && detailFetchedFor.current !== id + fresh.status) {
        detailFetchedFor.current = id + fresh.status;
        try {
          const index = await fetch(captureCp.blobPath).then((r) => r.json());
          setPages(Array.isArray(index?.pages) ? index.pages : []);
        } catch {
          setPages([]);
        }
        try {
          const assetsBody = await appApi(`/api/site-import/jobs/${encodeURIComponent(id)}/assets`);
          setAssets(readEnvelopeList<Asset>(assetsBody, "assets"));
        } catch {
          setAssets([]);
        }
        const reportUrl = mapReportUrl(id, checkpointOf(fresh, "map")?.reportUrl, captureCp.blobPath);
        if (reportUrl) {
          try {
            const res = await fetch(reportUrl, { cache: "no-store" });
            const report = res.ok ? await res.json() : null;
            setMapReport(report && Array.isArray(report.pages) ? report : null);
          } catch {
            setMapReport(null);
          }
        } else {
          setMapReport(null);
        }
        const normalizeCp = checkpointOf(fresh, "normalize");
        if (normalizeCp?.blobPath) {
          try {
            const ir = await fetch(normalizeCp.blobPath).then((r) => r.json());
            setIrText(JSON.stringify(ir, null, 2));
          } catch {
            setIrText(null);
          }
        }
        if (mapCheckpointOf(fresh)) {
          try {
            const pagesBody = await appApi("/api/builder/landing-pages");
            const data = unwrapEnvelope<unknown>(pagesBody);
            setBuilderPages(
              Array.isArray(data)
                ? (data as Array<{ id: string; name?: string; slug?: string }>)
                : readEnvelopeList(pagesBody, "pages")
            );
            setBuilderPagesError("");
          } catch (err) {
            setBuilderPages(null);
            setBuilderPagesError((err as Error).message);
          }
          const menuIds = mapCheckpointOf(fresh)?.menus;
          if (menuIds && (menuIds.top || menuIds.footer)) {
            try {
              const sectionsBody = await appApi("/api/builder/saved-sections");
              const data = unwrapEnvelope<unknown>(sectionsBody);
              setBuiltMenus({
                ids: menuIds,
                sections: Array.isArray(data)
                  ? (data as Array<{ id: string; name?: string }>)
                  : readEnvelopeList(sectionsBody, "savedSections"),
              });
            } catch (err) {
              setBuiltMenus({ ids: menuIds, sections: null, error: (err as Error).message });
            }
          } else {
            setBuiltMenus({ ids: {}, sections: [] });
          }
        }
      }
    } catch (err) {
      setStatus({ message: (err as Error).message, isError: true });
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // Poll the open job while it is still running and the tab is visible.
  useEffect(() => {
    if (!selectedId) return;
    detailFetchedFor.current = "";
    setJob(null);
    setAssets(null);
    setPages(null);
    setIrText(null);
    setShowIr(false);
    setMapReport(undefined);
    setBuilderPages(null);
    setBuilderPagesError("");
    setBuiltMenus(null);
    void loadJobDetail(selectedId);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setJob((current) => {
        if (!current || ACTIVE_STATUSES.has(current.status)) void loadJobDetail(selectedId);
        return current;
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedId, loadJobDetail]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceUrl.trim() || submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const body = await appApi("/api/site-import/jobs", {
        method: "POST",
        body: JSON.stringify({ sourceUrl }),
      });
      const created = readEnvelopeObject<Job>(body, "job");
      setSourceUrl("");
      setStatus({
        message: `Job ${created?.id ?? ""} queued. The import worker picks it up within about 5 minutes.`,
        isError: false,
      });
      await loadJobs();
      if (created) setSelectedId(created.id);
    } catch (err) {
      setStatus({ message: (err as Error).message, isError: true });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      await appApi(`/api/site-import/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      setStatus({ message: "Cancellation requested — the worker stops at the next stage boundary.", isError: false });
      void loadJobDetail(id);
    } catch (err) {
      setStatus({ message: (err as Error).message, isError: true });
    }
  }

  const dropped = job?.coverage?.dropped ?? {};
  const droppedTotal = Object.values(dropped).reduce((a, b) => a + b, 0);
  const coverageClasses = Array.from(
    new Set([
      ...Object.keys(job?.coverage?.captured ?? {}),
      ...Object.keys(job?.coverage?.emitted ?? {}),
      ...Object.keys(dropped),
    ])
  ).sort();
  const jobStatus = job ? importStatus(job) : null;
  const waitNote = job ? queueWaitNote(job) : null;
  const mapCp = job ? mapCheckpointOf(job) : null;
  const builtRows = mapCp ? builtPageRows(mapCp.pageIds, builderPages) : [];
  const failedAssets = (assets ?? []).filter((a) => a.status === "failed");
  const imageAssets = (assets ?? []).filter(
    (a) => a.status === "downloaded" && a.mimeType.startsWith("image/")
  );

  return (
    <div className="site-import-page">
      <form className="site-import-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="site-import-url-input"
          placeholder="https://www.clientsite.com/"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          disabled={submitting}
        />
        <button type="submit" className="btn btn-primary" disabled={submitting || !sourceUrl.trim()}>
          {submitting ? "Queuing…" : "Queue Import"}
        </button>
      </form>
      <p className="meta">
        The import worker runs on the Mac Mini every 5 minutes and picks up queued jobs on its own.
      </p>
      {status ? (
        <p className={`site-import-status${status.isError ? " is-error" : ""}`}>{status.message}</p>
      ) : null}

      <div className="site-import-columns">
        <div className="site-import-job-list">
          <h3>Jobs</h3>
          {jobs.length === 0 ? <p className="meta">No imports yet.</p> : null}
          <ul>
            {jobs.map((j) => {
              const s = importStatus(j);
              return (
                <li key={j.id}>
                  <button
                    type="button"
                    className={`site-import-job-link${j.id === selectedId ? " is-active" : ""}`}
                    onClick={() => setSelectedId(j.id)}
                  >
                    <span className={`site-import-badge status-${j.status} status-${s.tone}`}>{s.label}</span>
                    <span className="site-import-job-url">{j.sourceUrl}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="site-import-detail">
          {!job ? (
            selectedId ? <p className="meta">Loading…</p> : <p className="meta">Select a job to see its progress.</p>
          ) : (
            <>
              <div className="site-import-detail-head">
                <h3>
                  {job.sourceUrl}{" "}
                  <span className={`site-import-badge status-${job.status} status-${jobStatus?.tone}`}>{jobStatus?.label}</span>
                </h3>
                {ACTIVE_STATUSES.has(job.status) && !job.checkpoints?.cancelRequested ? (
                  <button type="button" className="btn" onClick={() => void handleCancel(job.id)}>
                    Cancel
                  </button>
                ) : null}
              </div>
              {job.checkpoints?.cancelRequested && ACTIVE_STATUSES.has(job.status) ? (
                <p className="meta">Cancellation requested — waiting for the worker to reach a stage boundary.</p>
              ) : null}
              {job.error ? <p className="site-import-status is-error">{job.error}</p> : null}
              {waitNote ? (
                <p className={`site-import-status${waitNote.overdue ? " is-error" : ""}`}>{waitNote.text}</p>
              ) : null}

              <div className="site-import-stages">
                {["capture", "assets", "normalize"].map((stage) => {
                  const cp = checkpointOf(job, stage);
                  return (
                    <span key={stage} className={`site-import-stage${cp ? " is-done" : ""}`}>
                      {stage}
                      {cp?.notes ? <em> — {cp.notes}</em> : null}
                    </span>
                  );
                })}
                <span className={`site-import-stage${mapCp ? " is-done" : ""}`}>
                  Build pages
                  {mapCp ? <em> — {jobStatus?.pageCount ?? 0} draft</em> : null}
                </span>
              </div>
              {job.status === "complete" && !mapCp ? (
                <p className="meta site-import-build-note">
                  The site has been copied but no Builder pages exist yet. An agent session builds them
                  (Claude Code: &lsquo;build the pages for import {job.id}&rsquo;). It runs a rehearsal first
                  and creates drafts only. Nothing is published.
                </p>
              ) : null}
              {mapCp ? (
                <div className="site-import-built">
                  <h4>
                    Built pages ({builtRows.length}) — drafts, nothing published
                  </h4>
                  {builderPagesError ? (
                    <p className="site-import-status is-error">
                      Could not read this project&apos;s Builder pages to name them ({builderPagesError}). The
                      links below still open each page.
                    </p>
                  ) : null}
                  {builtRows.length === 0 ? (
                    <p className="meta">The build step ran but recorded no pages for this import.</p>
                  ) : (
                    <ul className="site-import-built-list">
                      {builtRows.map((row) => (
                        <li key={row.path}>
                          <code>{row.path}</code> →{" "}
                          {row.missing ? (
                            <span className="is-error-text">
                              page {row.pageId} no longer exists in this project (deleted since it was built)
                            </span>
                          ) : (
                            <a href={builderPageHref(row.pageId)} target="_blank" rel="noreferrer">
                              {row.name || `page ${row.pageId}`}
                              {row.slug ? <span className="meta"> /{row.slug.replace(/^\//, "")}</span> : null}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {job.status === "complete" && checkpointOf(job, "normalize")?.blobPath ? (
                <SiteImportThemePanel
                  jobId={job.id}
                  recorded={importThemeRecordOf(job.checkpoints as Record<string, unknown>)}
                  onCreated={() => void loadJobDetail(job.id)}
                />
              ) : null}

              {droppedTotal > 0 ? (
                <div className="site-import-dropped-alert">
                  Coverage dropped {droppedTotal} element{droppedTotal === 1 ? "" : "s"} — this is a
                  normalizer bug, not a property of the site. Do not trust this import until it is fixed.
                </div>
              ) : null}

              {coverageClasses.length > 0 ? (
                <table className="site-import-coverage">
                  <thead>
                    <tr><th>Element class</th><th>Captured</th><th>Emitted</th><th>Dropped</th></tr>
                  </thead>
                  <tbody>
                    {coverageClasses.map((cls) => {
                      const d = dropped[cls] ?? 0;
                      return (
                        <tr key={cls} className={d > 0 ? "is-dropped" : ""}>
                          <td>{cls}</td>
                          <td>{job.coverage?.captured?.[cls] ?? 0}</td>
                          <td>{job.coverage?.emitted?.[cls] ?? 0}</td>
                          <td>{d}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
              {job.coverage?.pages ? (
                <p className="meta">
                  Pages: {job.coverage.pages.captured}/{job.coverage.pages.discovered} captured,{" "}
                  {job.coverage.pages.failed} failed
                  {job.coverage.caps?.hit?.length ? ` — caps hit: ${job.coverage.caps.hit.join(", ")}` : ""}
                  {job.cost?.assetBytes ? ` — assets ${formatBytes(job.cost.assetBytes)}` : ""}
                </p>
              ) : null}

              {checkpointOf(job, "capture") ? (
                <BuildReportPanel
                  report={mapReport}
                  built={Boolean(checkpointOf(job, "map"))}
                  builtMenus={builtMenus}
                />
              ) : null}

              {pages && pages.length > 0 ? (
                <>
                  <h4>Captured pages</h4>
                  <div className="site-import-shots">
                    {pages.map((p) => (
                      <figure key={p.slug}>
                        {p.screenshots?.desktop ? (
                          <a href={p.screenshots.desktop} target="_blank" rel="noreferrer">
                            <img src={p.screenshots.desktop} alt={`Screenshot of ${p.url}`} loading="lazy" />
                          </a>
                        ) : null}
                        <figcaption>{p.url}</figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              ) : null}

              {failedAssets.length > 0 ? (
                <>
                  <h4 className="is-error-text">Failed asset downloads ({failedAssets.length})</h4>
                  <ul className="site-import-failures">
                    {failedAssets.map((a) => (
                      <li key={a.id}>
                        <span className="site-import-failure-url">{a.originalUrl}</span> — {a.error}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {imageAssets.length > 0 ? (
                <>
                  <h4>Assets ({imageAssets.length} images{assets ? ` of ${assets.length} total` : ""})</h4>
                  <div className="site-import-assets">
                    {imageAssets.slice(0, 60).map((a) => (
                      <a key={a.id} href={a.storageUrl} target="_blank" rel="noreferrer" title={a.originalUrl}>
                        <img src={a.storageUrl} alt="" loading="lazy" />
                      </a>
                    ))}
                  </div>
                </>
              ) : null}

              {irText ? (
                <div className="site-import-ir">
                  <button type="button" className="btn" onClick={() => setShowIr((v) => !v)}>
                    {showIr ? "Hide raw IR" : "View raw IR"}
                  </button>
                  {showIr ? <pre className="site-import-ir-json">{irText}</pre> : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What the build step (scripts/site_import_map.mjs) will create — or did
 * create, once its `--apply` run has recorded the map checkpoint. Read-only;
 * running the mapper stays a terminal step (task 86bch6e2q non-goal).
 */
function BuildReportPanel({
  report,
  built,
  builtMenus,
}: {
  report: MapReportData | null | undefined;
  built: boolean;
  builtMenus: BuiltMenus | null;
}) {
  const title = built ? "What the build step created" : "What the build step will create";
  if (report === undefined) {
    return (
      <div className="site-import-build-report">
        <h4>{title}</h4>
        <p className="meta">Looking for the build step&apos;s report…</p>
      </div>
    );
  }
  if (report === null) {
    return (
      <div className="site-import-build-report">
        <h4>{title}</h4>
        <p className="meta">No rehearsal has been run for this import yet, so there is nothing to show here.</p>
      </div>
    );
  }
  const summary = summarizeBuildReport(report);
  return (
    <div className="site-import-build-report">
      <h4>{title}</h4>
      <p className="meta">
        {pluralize(summary.rows.length, "page")}
        {summary.leftoverCount
          ? `, ${summary.leftoverCount} of them probably not pages you want in your menu`
          : ""}
        . {pluralize(summary.placeholderTotal, "grey placeholder")}
        {summary.placeholderKinds.length
          ? ` (${summary.placeholderKinds.map((k) => pluralize(k.count, k.kind)).join(", ")})`
          : ""}
        .
      </p>
      <p className="meta">
        {summary.theme
          ? `Import theme: ${summary.theme.name ?? "unnamed"}${
              summary.theme.notes?.length ? ` — ${summary.theme.notes.join("; ")}` : ""
            }`
          : "This report does not say which theme the build step makes the default; that is only printed in the terminal today."}
      </p>
      <MenusBlock report={report} builtMenus={built ? builtMenus : null} />
      <table className="site-import-build-pages">
        <thead>
          <tr>
            <th>Old address</th>
            <th>New page</th>
            <th>Modules</th>
            <th>Placeholders</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row, index) => (
            <tr key={`${row.slug}-${index}`} className={row.leftover ? "is-leftover" : ""}>
              <td>{row.path}</td>
              <td>/{row.slug}</td>
              <td>{row.modules}</td>
              <td>{row.placeholders}</td>
              <td>{row.leftover ? `Probably not a page you want in your menu — ${row.leftover}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The Top Menu and Footer Menu the build step makes (task 86bchydp7) — and,
 * where one is missing, the report's own reason, because "no Footer Menu"
 * alone reads as broken when the site's footer simply has no links.
 */
function MenusBlock({ report, builtMenus }: { report: MapReportData; builtMenus: BuiltMenus | null }) {
  const menus = summarizeMenus(report, builtMenus);
  return (
    <div className="site-import-menus">
      <h5>Menus</h5>
      {menus.predates ? (
        <p className="meta">{menus.message}</p>
      ) : (
        <ul className="site-import-menus-list">
          {menus.lines.map((line) => (
            <li key={line.kind}>
              <strong>{line.label}</strong> — {line.detail ?? "none"}
              {line.built ? <span className="site-import-menus-built"> → {line.built}</span> : null}
              {line.reasons.length ? (
                <ul className="site-import-menus-reasons">
                  {line.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : line.detail === null ? (
                <span className="meta"> (the report gives no reason)</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
