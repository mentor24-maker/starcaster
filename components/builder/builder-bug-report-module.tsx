"use client";

/**
 * Bug Report module (task 4/5) — the visible half of the in-app bug tool.
 *
 * A small bug icon floats in a page corner; clicking it opens a popup where
 * the visitor describes the problem, optionally attaches screenshots, and
 * submits to POST /api/public/bug-report (task 1/5). Screenshots go one per
 * request to POST /api/public/bug-report/screenshot (task 2/5); if that route
 * is not deployed yet (404) the picker hides itself.
 *
 * THREE CONTEXTS, TWO RENDERINGS:
 *  - On the LIVE tenant site the trigger is `position: fixed` and rendered
 *    through a portal onto <body>. Not decoration: a fixed element inside a
 *    builder column is captured by any ancestor filter/transform (DOCTRINE
 *    §5.17 — the proximity module sat 232px off for a month this way), and the
 *    body is the only ancestor guaranteed to carry none.
 *  - In the builder preview / editor the trigger renders INLINE in the
 *    module's own box, same classes and size, so `check:render` can measure it
 *    and the operator can see what they are placing. The popup still opens on
 *    click in every context — the operator should be able to try it.
 *
 * VISIBILITY IS UX, NOT SECURITY. "Clients" and "staff" tiers ask the server
 * which tier this browser is (GET /api/public/bug-report/viewer) and hide the
 * icon otherwise. The submit endpoint re-verifies the session before trusting
 * any tier claim — hiding an icon never was a security boundary (task 1/5).
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type BugReportVisibility = "public" | "clients" | "staff";
export type BugReportViewerTier = "public" | "client" | "staff";
export type BugReportCorner = "bottom-right" | "bottom-left";

export const BUG_REPORT_ICON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "ladybug", label: "Ladybug" },
  { value: "wrench", label: "Wrench" },
  { value: "flag", label: "Flag" },
  { value: "chat", label: "Speech bubble" },
];

export const BUG_REPORT_VISIBILITY_OPTIONS: Array<{ value: BugReportVisibility; label: string }> = [
  { value: "public", label: "Everyone" },
  { value: "clients", label: "Signed-in clients" },
  { value: "staff", label: "Staff only" },
];

export const BUG_REPORT_CORNER_OPTIONS: Array<{ value: BugReportCorner; label: string }> = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
];

/** Mirrors the 2/5 caps (lib/projectBugReportScreenshots.js) for the panel's read-only note and the picker. */
export const BUG_REPORT_MAX_SCREENSHOTS = 5;
export const BUG_REPORT_MAX_SCREENSHOT_MB = 8;

export const BUG_REPORT_SUBMIT_PATH = "/api/public/bug-report";
export const BUG_REPORT_SCREENSHOT_PATH = "/api/public/bug-report/screenshot";
export const BUG_REPORT_VIEWER_PATH = "/api/public/bug-report/viewer";

/** Pure: does this tier get to see a module with this visibility setting? */
export function bugReportVisibleFor(visibility: string, tier: BugReportViewerTier): boolean {
  if (visibility === "staff") return tier === "staff";
  if (visibility === "clients") return tier === "client" || tier === "staff";
  return true;
}

export function readBugReportSettings(settings: Record<string, string>) {
  const sizeRaw = Number(settings.iconSize || 40);
  const iconSize = Number.isFinite(sizeRaw) ? Math.min(120, Math.max(20, sizeRaw)) : 40;
  return {
    visibility: (settings.visibility === "clients" || settings.visibility === "staff" ? settings.visibility : "public") as BugReportVisibility,
    icon: settings.icon || "bug",
    corner: (settings.corner === "bottom-left" ? "bottom-left" : "bottom-right") as BugReportCorner,
    iconSize,
    iconBlock: settings.iconBlock !== "false",
    blockColor: settings.blockColor || "#0f4f8f",
    iconColor: settings.iconColor || "#ffffff",
    labelText: (settings.labelText || "").trim(),
    popupTitle: (settings.popupTitle || "").trim() || "Report a problem",
    promptPlaceholder: (settings.promptPlaceholder || "").trim() || "What went wrong? What did you expect to happen?",
    thankYouMessage: (settings.thankYouMessage || "").trim() || "Thanks — we got it.",
  };
}

function BugGlyph({ icon }: { icon: string }): ReactNode {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (icon) {
    case "ladybug":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
          <circle cx="12" cy="13" r="7" />
          <path d="M12 6v14M6.5 9.5a7 7 0 0 1 11 0" />
          <circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" />
          <circle cx="10" cy="16" r="1" fill="currentColor" /><circle cx="14" cy="16" r="1" fill="currentColor" />
        </svg>
      );
    case "wrench":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
          <path d="M14.5 3.5a5 5 0 0 0-5.4 6.9L3.5 16l4.5 4.5 5.6-5.6a5 5 0 0 0 6.9-5.4l-3 3-3-1-1-3 3-3z" />
        </svg>
      );
    case "flag":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
          <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />
        </svg>
      );
    case "chat":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M8 9h8M8 12.5h5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
          <ellipse cx="12" cy="13.5" rx="5" ry="6" />
          <path d="M12 9.5v10M7 13.5H3.5M20.5 13.5H17M8.2 9.5 5.5 7M15.8 9.5 18.5 7M8.2 17.5 5.5 20M15.8 17.5 18.5 20" />
          <path d="M9.5 8.5a2.5 2.5 0 0 1 5 0" />
        </svg>
      );
  }
}

/** Live tenant pages carry this layout class (BuilderPublicSitePage); nothing else does. */
function onLiveTenantPage(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(".builder-public-site-layout"));
}

type Props = {
  settings: Record<string, string>;
  previewMode?: boolean;
  projectId?: string;
  /** Test seam; defaults to window.fetch. */
  fetchImpl?: typeof fetch;
};

export function BugReportModule({ settings, previewMode = false, projectId = "", fetchImpl }: Props) {
  const s = readBugReportSettings(settings);
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  // Live-site detection happens after mount (SSR-safe): until then render
  // nothing fixed and nothing gated, which is also what a test environment
  // without the layout class gets — inline, as in the preview.
  const [live, setLive] = useState(false);
  const [tier, setTier] = useState<BugReportViewerTier | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isLive = !previewMode && onLiveTenantPage();
    setLive(isLive);
  }, [previewMode]);

  // Ask the server which tier this browser is — only on the live site, and
  // only when the setting actually gates anything.
  useEffect(() => {
    if (!live || s.visibility === "public") { setTier(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const response = await doFetch(`${BUG_REPORT_VIEWER_PATH}?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as { data?: { tier?: string } };
        const got = body.data?.tier;
        if (!cancelled) setTier(got === "staff" || got === "client" ? got : "public");
      } catch {
        if (!cancelled) setTier("public");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, s.visibility, projectId]);

  const gated = live && s.visibility !== "public";
  if (gated && (tier === null || !bugReportVisibleFor(s.visibility, tier))) return null;

  const triggerStyle: Record<string, string> = {
    "--bug-report-size": `${s.iconSize}px`,
    "--bug-report-icon-color": s.iconColor,
    ...(s.iconBlock ? { "--bug-report-block-color": s.blockColor } : {}),
  };

  const trigger = (
    <button
      type="button"
      className={`builder-bug-report-trigger builder-bug-report-trigger--${s.corner}${s.iconBlock ? " is-block" : ""}${live ? " is-floating" : " is-inline"}${s.labelText ? " has-label" : ""}`}
      style={triggerStyle as React.CSSProperties}
      onClick={() => setOpen(true)}
      aria-label={s.labelText || s.popupTitle}
      aria-haspopup="dialog"
      title={s.popupTitle}
      data-bug-report-visibility={s.visibility}
    >
      <span className="builder-bug-report-glyph"><BugGlyph icon={s.icon} /></span>
      {s.labelText ? <span className="builder-bug-report-label">{s.labelText}</span> : null}
    </button>
  );

  const dialog = open ? (
    <BugReportDialog
      settings={s}
      projectId={projectId}
      tier={tier ?? "public"}
      fetchImpl={doFetch}
      onClose={() => setOpen(false)}
    />
  ) : null;

  const canPortal = typeof document !== "undefined";
  return (
    <>
      {live && canPortal ? createPortal(trigger, document.body) : <div className="builder-bug-report-inline-host">{trigger}</div>}
      {dialog && canPortal ? createPortal(dialog, document.body) : dialog}
    </>
  );
}

type PickedShot = { name: string; assetId?: number; error?: string; uploading: boolean };

function BugReportDialog({
  settings: s,
  projectId,
  tier,
  fetchImpl,
  onClose,
}: {
  settings: ReturnType<typeof readBugReportSettings>;
  projectId: string;
  tier: BugReportViewerTier;
  fetchImpl: typeof fetch;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [shots, setShots] = useState<PickedShot[]>([]);
  const [pickerAvailable, setPickerAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Probe the screenshot route once: 404 means task 2/5 is not deployed here
  // and the picker should not offer something that cannot work.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchImpl(BUG_REPORT_SCREENSHOT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, probe: true }),
        });
        if (!cancelled) setPickerAvailable(response.status !== 404);
      } catch {
        if (!cancelled) setPickerAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchImpl, projectId]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(onClose, 2000);
    return () => window.clearTimeout(timer);
  }, [done, onClose]);

  const uploadOne = useCallback(async (file: File, index: number) => {
    const tooBig = file.size > BUG_REPORT_MAX_SCREENSHOT_MB * 1024 * 1024;
    if (tooBig) {
      setShots((current) => current.map((shot, i) => (i === index ? { ...shot, uploading: false, error: `Over ${BUG_REPORT_MAX_SCREENSHOT_MB} MB` } : shot)));
      return;
    }
    const fileBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
    const response = await fetchImpl(BUG_REPORT_SCREENSHOT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, fileName: file.name, fileBase64 }),
    });
    const body = (await response.json().catch(() => ({}))) as { data?: { assetId?: number }; error?: { message?: string } };
    setShots((current) => current.map((shot, i) => {
      if (i !== index) return shot;
      if (!response.ok || !body.data?.assetId) return { ...shot, uploading: false, error: body.error?.message || "Upload failed" };
      return { ...shot, uploading: false, assetId: body.data.assetId };
    }));
  }, [fetchImpl, projectId]);

  function onPickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const room = BUG_REPORT_MAX_SCREENSHOTS - shots.length;
    const accepted = files.slice(0, Math.max(0, room));
    if (!accepted.length) return;
    const startIndex = shots.length;
    setShots((current) => [...current, ...accepted.map((file) => ({ name: file.name, uploading: true }))]);
    accepted.forEach((file, offset) => { void uploadOne(file, startIndex + offset).catch(() => {
      setShots((current) => current.map((shot, i) => (i === startIndex + offset ? { ...shot, uploading: false, error: "Upload failed" } : shot)));
    }); });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = description.trim();
    if (!text) { setError("Please describe what went wrong."); return; }
    if (shots.some((shot) => shot.uploading)) { setError("A screenshot is still uploading — one moment."); return; }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetchImpl(BUG_REPORT_SUBMIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          description: text,
          pageUrl: typeof window !== "undefined" ? window.location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          viewerTier: tier,
          screenshotAssetIds: shots.map((shot) => shot.assetId).filter((id): id is number => typeof id === "number"),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || body.ok === false) throw new Error(body.error?.message || "Could not send your report. Please try again.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="builder-bug-report-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="builder-bug-report-dialog" role="dialog" aria-modal="true" aria-labelledby="builder-bug-report-title">
        <div className="builder-bug-report-dialog-head">
          <h3 id="builder-bug-report-title" className="builder-bug-report-dialog-title">{s.popupTitle}</h3>
          <button type="button" className="builder-bug-report-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {done ? (
          <p className="builder-bug-report-thanks" role="status">{s.thankYouMessage}</p>
        ) : (
          <form className="builder-bug-report-form" onSubmit={(event) => void submit(event)}>
            <textarea
              ref={textareaRef}
              className="builder-bug-report-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={s.promptPlaceholder}
              rows={5}
              maxLength={5000}
              aria-label={s.popupTitle}
            />
            {pickerAvailable ? (
              <div className="builder-bug-report-shots">
                <label className="builder-bug-report-picker">
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={onPickFiles} disabled={shots.length >= BUG_REPORT_MAX_SCREENSHOTS} />
                  <span>Add screenshots (up to {BUG_REPORT_MAX_SCREENSHOTS}, {BUG_REPORT_MAX_SCREENSHOT_MB} MB each)</span>
                </label>
                {shots.length ? (
                  <ul className="builder-bug-report-shot-list">
                    {shots.map((shot, i) => (
                      <li key={`${shot.name}-${i}`} className={shot.error ? "is-error" : shot.uploading ? "is-uploading" : "is-ready"}>
                        {shot.name}{shot.uploading ? " — uploading…" : shot.error ? ` — ${shot.error}` : " ✓"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {error ? <p className="builder-bug-report-error" role="alert">{error}</p> : null}
            <div className="builder-bug-report-actions">
              <button type="button" className="builder-bug-report-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="builder-bug-report-submit" disabled={submitting}>{submitting ? "Sending…" : "Send report"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
