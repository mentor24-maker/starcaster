import { useState } from "react";
import { appApi } from "@/lib/adapters/starcaster-app";
import {
  buildDisabledReason,
  buildIsActive,
  buildPreviewOf,
  buildRequestOf,
  buildStatusLine,
  previewIsCurrent,
  summarizePreview,
} from "./site-import-build-controls-model";

/**
 * "Preview build" and "Build draft pages" (task 86bcz9wcx). Dane, 2026-11-05:
 * "I'd rather have a button on the screen so I can launch the build myself."
 *
 * Both buttons only QUEUE a request (POST /api/site-import/jobs/:id/build);
 * the import worker on the Mac Mini runs it within about five minutes and
 * writes the result back on the job, which this panel reads. Preview changes
 * nothing. Build is greyed out until a preview exists that still matches the
 * job, and it only ever makes draft pages — nothing is published.
 */
export function SiteImportBuildControls({
  jobId,
  checkpoints,
  onQueued,
}: {
  jobId: string;
  checkpoints: Record<string, unknown> | undefined;
  onQueued: () => void;
}) {
  const [noTheme, setNoTheme] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");

  const request = buildRequestOf(checkpoints);
  const active = buildIsActive(request);
  const status = buildStatusLine(request);
  const preview = buildPreviewOf(checkpoints);
  const current = previewIsCurrent(checkpoints);
  const summary = summarizePreview(preview?.result);
  const disabledReason = buildDisabledReason(checkpoints);

  async function queue(mode: "preview" | "apply") {
    setBusy(true);
    setMessage("");
    try {
      await appApi(`/api/site-import/jobs/${encodeURIComponent(jobId)}/build`, {
        method: "POST",
        body: JSON.stringify({ mode, noTheme }),
      });
      onQueued();
    } catch (err) {
      setMessage((err as Error).message || "The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-import-build-controls">
      <h4>Build the pages</h4>
      <p className="meta">
        Makes draft pages in Builder › Pages from this copy of the site. Preview first: it shows what the build will
        do and changes nothing. Nothing is ever published by either button.
      </p>
      {status ? (
        // A failure uses the screen's existing error line, so it reads like every other error here.
        <p className={status.tone === "failed" ? "site-import-status is-error" : `site-import-build-state is-${status.tone}`}>
          {status.text}
        </p>
      ) : null}

      {summary ? (
        <div className={`site-import-build-preview${current ? "" : " is-stale"}`}>
          <h5>Preview{current ? "" : " (out of date)"}</h5>
          {summary.refresh ? <p className="meta">{summary.refresh}</p> : null}
          <p>{summary.headline}</p>
          {summary.pages.length ? (
            <ul className="site-import-build-preview-pages">
              {summary.pages.map((page, i) => (
                <li key={`${page.slug}-${i}`}>
                  <strong>{page.name}</strong> <span className="meta">/{page.slug.replace(/^\//, "")}</span>
                  {page.action === "update" ? <span className="meta"> — updates the page already built</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {summary.theme.kind === "theme" ? (
            <>
              <p>
                Theme: <strong>&ldquo;{summary.theme.name}&rdquo;</strong>
                {summary.theme.makesDefault
                  ? " — becomes this project's default theme."
                  : " — made, but not made the default (this is a refresh)."}
              </p>
              {summary.theme.swatches.length ? (
                <ul className="site-import-theme-swatches">
                  {summary.theme.swatches.map(({ role, hex }) => (
                    <li key={role}>
                      <span className="site-import-theme-swatch" style={{ background: hex }} />
                      <span>{role}</span> <code>{hex}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">This copy measured no colours, so the theme keeps the default palette.</p>
              )}
              {summary.theme.notes.length ? (
                <ul className="site-import-theme-notes">
                  {summary.theme.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : summary.theme.kind === "skipped" ? (
            <p className="meta">Theme: skipped for this preview — the pages would use the project&apos;s current theme.</p>
          ) : (
            <p className="meta">Theme: this preview did not say which theme it would make.</p>
          )}
          {summary.warnings.length ? (
            <ul className="site-import-build-warnings">
              {summary.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="site-import-build-actions">
        <button type="button" className="btn" disabled={busy || active} onClick={() => void queue("preview")}>
          {preview ? "Preview Again" : "Preview Build"}
        </button>
        <label className="site-import-theme-default">
          <input type="checkbox" checked={noTheme} onChange={(e) => setNoTheme(e.target.checked)} /> Skip the theme
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          onClick={() => void queue("apply")}
        >
          Build Draft Pages
        </button>
      </div>
      {disabledReason && !active ? <p className="meta">{disabledReason}</p> : null}
      {message ? <p className="site-import-status is-error">{message}</p> : null}
    </div>
  );
}
