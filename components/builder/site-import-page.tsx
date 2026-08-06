import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { appApi, unwrapEnvelope, type StarcasterEnvelope } from "@/lib/adapters/starcaster-app";

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
  attempts: number;
  clientAuthorization: string;
  checkpoints: Record<string, { at?: string; blobPath?: string; notes?: string } | boolean | undefined> & {
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

function checkpointOf(job: Job, stage: string): { at?: string; blobPath?: string; notes?: string } | null {
  const value = job.checkpoints?.[stage];
  return value && typeof value === "object" ? value : null;
}

export default function SiteImportPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [pages, setPages] = useState<CaptureIndexPage[] | null>(null);
  const [irText, setIrText] = useState<string | null>(null);
  const [showIr, setShowIr] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
        const normalizeCp = checkpointOf(fresh, "normalize");
        if (normalizeCp?.blobPath) {
          try {
            const ir = await fetch(normalizeCp.blobPath).then((r) => r.json());
            setIrText(JSON.stringify(ir, null, 2));
          } catch {
            setIrText(null);
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
        message: `Job ${created?.id ?? ""} queued. It starts when the worker runs on the operator's machine.`,
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
        Queuing creates the job only. The capture runs from the operator&apos;s machine:&nbsp;
        <code>doppler run --config prd -- node scripts/site_import_worker.mjs --watch</code>
      </p>
      {status ? (
        <p className={`site-import-status${status.isError ? " is-error" : ""}`}>{status.message}</p>
      ) : null}

      <div className="site-import-columns">
        <div className="site-import-job-list">
          <h3>Jobs</h3>
          {jobs.length === 0 ? <p className="meta">No imports yet.</p> : null}
          <ul>
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  className={`site-import-job-link${j.id === selectedId ? " is-active" : ""}`}
                  onClick={() => setSelectedId(j.id)}
                >
                  <span className={`site-import-badge status-${j.status}`}>{j.status}</span>
                  <span className="site-import-job-url">{j.sourceUrl}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="site-import-detail">
          {!job ? (
            selectedId ? <p className="meta">Loading…</p> : <p className="meta">Select a job to see its progress.</p>
          ) : (
            <>
              <div className="site-import-detail-head">
                <h3>
                  {job.sourceUrl} <span className={`site-import-badge status-${job.status}`}>{job.status}</span>
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
              </div>

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
