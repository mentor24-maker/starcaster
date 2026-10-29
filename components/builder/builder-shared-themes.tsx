/**
 * "Shared with this project" on the Themes page (task 86bcu6uav).
 *
 * Lists the themes other projects share with the active one
 * (GET /api/admin/shared/themes, task 86bcu6t1c), each with an Import button
 * that copies it into this project (POST …/shared/themes/:id/import,
 * lib/builderSharedThemeImport.js). The copy is never made the default, so
 * nothing on the live site changes when somebody presses Import — the status
 * line says so, because "imported" next to a theme picker reads as "applied".
 *
 * Its own file rather than more of builder-themes-page.tsx, which is already
 * past 850 lines.
 */
import { useCallback, useEffect, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";

export type SharedThemeRecord = {
  id: string;
  name: string;
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  typography?: { fonts?: { heading?: string; body?: string } } | null;
  sourceProjectId: string;
  sourceProjectName: string;
};

export const SHARED_THEMES_EMPTY_TEXT = "No other project shares its themes with this one.";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: SharedThemeRecord[] };

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return String(body?.error?.message || body?.error || fallback);
  } catch {
    return fallback;
  }
}

/** "Lora / Inter", or what is missing said plainly. */
export function describeThemeFonts(theme: SharedThemeRecord): string {
  const heading = String(theme.typography?.fonts?.heading || "").trim();
  const body = String(theme.typography?.fonts?.body || "").trim();
  if (heading && body && heading !== body) return `${heading} / ${body}`;
  return heading || body || "Site default fonts";
}

const SWATCH_KEYS: Array<{ key: keyof SharedThemeRecord; label: string }> = [
  { key: "primaryColor", label: "Primary" },
  { key: "secondaryColor", label: "Secondary" },
  { key: "backgroundColor", label: "Background" },
  { key: "accentColor", label: "Accent" },
];

export function BuilderSharedThemes({
  onImported,
}: {
  /** Called with the new theme so the page can refresh its own list. */
  onImported?: (theme: { id: string; name: string }) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [importingId, setImportingId] = useState("");
  const [notice, setNotice] = useState<{ isError: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await builderAdminFetch("/api/admin/shared/themes", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error", message: await readError(response, "Could not load the themes shared with this project.") });
        return;
      }
      const body = await response.json();
      const items = Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : [];
      setState({ kind: "ready", items });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Could not load the themes shared with this project." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function importTheme(item: SharedThemeRecord) {
    setImportingId(item.id);
    setNotice(null);
    try {
      const response = await builderAdminFetch(
        `/api/admin/shared/themes/${encodeURIComponent(item.id)}/import`,
        { method: "POST" }
      );
      if (!response.ok) {
        setNotice({ isError: true, text: await readError(response, "The theme could not be imported.") });
        // A refusal usually means the share changed underneath this list, so
        // show what is shared NOW rather than leaving a stale button up.
        if (response.status === 404) void load();
        return;
      }
      const body = await response.json();
      const theme = (body?.theme || body?.data) as { id: string; name: string } | undefined;
      if (theme) onImported?.(theme);
      setNotice({
        isError: false,
        text: `Imported "${theme?.name || item.name}" from ${item.sourceProjectName}. It is in this project's themes now; your default theme and live site are unchanged.`,
      });
    } catch (e) {
      setNotice({ isError: true, text: e instanceof Error ? e.message : "The theme could not be imported." });
    } finally {
      setImportingId("");
    }
  }

  return (
    <section className="builder-themes-col builder-shared-themes" aria-label="Shared with this project">
      <h3 className="builder-themes-col-heading">Shared with this project</h3>
      {notice ? (
        <div
          className={`builder-themes-status${notice.isError ? " builder-themes-status-error" : ""}`}
          role={notice.isError ? "alert" : "status"}
        >
          {notice.text}
        </div>
      ) : null}
      <div className="table-shell">
        <table className="polls-table builder-shared-themes-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">From</th>
              <th scope="col">Colours</th>
              <th scope="col">Fonts</th>
              <th className="crud-actions-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.kind === "loading" ? (
              <tr><td className="empty-cell" colSpan={5}>Loading shared themes…</td></tr>
            ) : state.kind === "error" ? (
              <tr><td className="empty-cell" colSpan={5}>{state.message}</td></tr>
            ) : state.items.length === 0 ? (
              <tr><td className="empty-cell" colSpan={5}>{SHARED_THEMES_EMPTY_TEXT}</td></tr>
            ) : (
              state.items.map((item) => (
                <tr key={`${item.sourceProjectId}:${item.id}`}>
                  <td><strong>{item.name || "Untitled theme"}</strong></td>
                  <td>from {item.sourceProjectName}</td>
                  <td>
                    <span className="builder-shared-themes-swatches">
                      {SWATCH_KEYS.map(({ key, label }) => {
                        const colour = String(item[key] || "").trim();
                        return colour ? (
                          <span
                            key={key}
                            className="builder-shared-themes-swatch"
                            style={{ background: colour }}
                            title={`${label} ${colour}`}
                          />
                        ) : null;
                      })}
                    </span>
                  </td>
                  <td>{describeThemeFonts(item)}</td>
                  <td className="crud-actions-cell">
                    <button
                      type="button"
                      className="submit-button builder-themes-btn"
                      disabled={Boolean(importingId)}
                      onClick={() => void importTheme(item)}
                      title={`Copy "${item.name}" into this project. It will not become the default, and later changes in ${item.sourceProjectName} will not reach the copy.`}
                    >
                      {importingId === item.id ? "Importing…" : "Import"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
