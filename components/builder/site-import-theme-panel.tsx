import { useState } from "react";
import { appApi, unwrapEnvelope, type StarcasterEnvelope } from "@/lib/adapters/starcaster-app";

/**
 * "Create theme from this import" (task 86bctakkk). Makes the import theme
 * from a captured job WITHOUT re-running the page import — before this, a
 * project whose pages were built with no theme (Alphire, 2026-10-27) had an
 * empty theme list and no way to fill it from the screen.
 *
 * Two steps on purpose: Preview reads the derived palette and the
 * readability notes (GET, writes nothing); Create saves it (POST). The
 * server names it the next free "<site> N", so it never overwrites a theme.
 */

/** A theme an import made, as recorded on the job — by this panel or the
 *  mapper's --theme-only (checkpoints.theme), or by a full --apply build
 *  (checkpoints.map.theme, which always becomes the default). Newest wins. */
export type ImportThemeRecord = {
  name: string;
  madeDefault: boolean;
  previousDefaultName: string;
};

type RecordShape = { name?: unknown; madeDefault?: unknown; previousDefaultName?: unknown; at?: unknown };

export function importThemeRecordOf(checkpoints: Record<string, unknown> | undefined): ImportThemeRecord | null {
  const own = checkpoints?.theme as RecordShape | undefined;
  const map = checkpoints?.map as { theme?: RecordShape; at?: unknown } | undefined;
  const fromMap = map?.theme && typeof map.theme === "object" ? { ...map.theme, at: map.at, madeDefault: true } : null;
  const candidates = [own && typeof own === "object" ? own : null, fromMap].filter(
    (c): c is RecordShape => Boolean(c && typeof c.name === "string" && c.name)
  );
  if (!candidates.length) return null;
  const newest = candidates.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))[0];
  return {
    name: String(newest.name),
    madeDefault: newest.madeDefault !== false,
    previousDefaultName: typeof newest.previousDefaultName === "string" ? newest.previousDefaultName : "",
  };
}

type Preview = {
  name: string;
  notes: string[];
  palette: Record<string, string>;
  previousDefaultName: string;
};

export function readThemePreview(body: unknown): Preview | null {
  const data = unwrapEnvelope<Record<string, unknown> | null>((body ?? {}) as StarcasterEnvelope);
  if (!data || typeof data.name !== "string") return null;
  const theme = (data.theme ?? {}) as { palette?: Record<string, string> };
  const previous = data.previousDefault as { name?: string } | null | undefined;
  return {
    name: data.name,
    notes: Array.isArray(data.notes) ? (data.notes as string[]) : [],
    palette: theme.palette && typeof theme.palette === "object" ? theme.palette : {},
    previousDefaultName: previous?.name ?? "",
  };
}

export function SiteImportThemePanel({
  jobId,
  recorded,
  onCreated,
}: {
  jobId: string;
  recorded: ImportThemeRecord | null;
  onCreated: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const base = `/api/site-import/jobs/${encodeURIComponent(jobId)}/theme`;

  async function handlePreview() {
    setBusy(true);
    setMessage(null);
    try {
      const next = readThemePreview(await appApi(base));
      if (!next) throw new Error("The server answered without a theme to show.");
      setPreview(next);
    } catch (err) {
      setMessage({ text: (err as Error).message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = await appApi(base, { method: "POST", body: JSON.stringify({ makeDefault }) });
      const data = unwrapEnvelope<Record<string, unknown> | null>((body ?? {}) as StarcasterEnvelope);
      const theme = (data?.theme ?? {}) as { name?: string };
      const warning = typeof data?.warning === "string" ? ` ${data.warning}` : "";
      setMessage({
        text: `Theme “${theme.name ?? preview.name}” created. No page was changed. ${String(data?.undo ?? "")}${warning}`,
        isError: Boolean(warning),
      });
      setPreview(null);
      onCreated();
    } catch (err) {
      setMessage({ text: (err as Error).message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-import-theme">
      <h4>Theme from this import</h4>
      {recorded ? (
        <p className="meta">
          This import already made the theme &ldquo;{recorded.name}&rdquo;
          {recorded.madeDefault
            ? recorded.previousDefaultName
              ? ` and made it the default (the default before it was “${recorded.previousDefaultName}”).`
              : " and made it the default (there was no default theme before it)."
            : " (not made the default)."}{" "}
          Creating another makes a new theme beside it; it never changes that one.
        </p>
      ) : (
        <p className="meta">
          Makes a new theme from the colours, fonts and sizes this import captured. No page is changed.
        </p>
      )}
      {!preview ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void handlePreview()}>
          {busy ? "Reading…" : "Create theme from this import"}
        </button>
      ) : (
        <div className="site-import-theme-preview">
          <p>
            It will be saved as <strong>&ldquo;{preview.name}&rdquo;</strong>.
          </p>
          {Object.keys(preview.palette).length ? (
            <ul className="site-import-theme-swatches">
              {Object.entries(preview.palette).map(([role, hex]) => (
                <li key={role}>
                  <span className="site-import-theme-swatch" style={{ background: hex }} />
                  <span>{role}</span> <code>{hex}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">This capture measured no background colours, so the palette stays the theme default.</p>
          )}
          <ul className="site-import-theme-notes">
            {preview.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
          <label className="site-import-theme-default">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />{" "}
            Make it this project&apos;s default theme
            {preview.previousDefaultName ? ` (instead of “${preview.previousDefaultName}”)` : ""}
          </label>
          <div className="site-import-theme-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleCreate()}>
              {busy ? "Creating…" : `Create “${preview.name}”`}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message ? (
        <p className={`site-import-status${message.isError ? " is-error" : ""}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
