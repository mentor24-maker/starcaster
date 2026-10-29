/**
 * "Shared with this project" — saved sections another project shares with the
 * active one (task 86bcu6tzk; the share itself is 86bcu6t1c).
 *
 * Operator's design, 2026-10-28: shared items are visible but untouched until
 * imported. So nothing here can be edited or placed on a page; the one action
 * is Import, which makes this project its own independent copy (server:
 * lib/builderSharedImport.js). The copy is handed to `onImported` so it joins
 * the project's own list at once, without a reload.
 *
 * Its own file rather than more of builder-module-repository-list.tsx, which
 * is already past 2,600 lines.
 */
import { useEffect, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import type { BuilderSavedSectionRecord } from "@/lib/builder-template";
import { BuilderCollapseIcon } from "./builder-collapse-icon";

export type SharedSavedSectionRecord = BuilderSavedSectionRecord & {
  sourceProjectId: string;
  sourceProjectName: string;
};

export const SHARED_SECTIONS_EMPTY_TEXT = "No other project shares its saved sections with this one.";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: SharedSavedSectionRecord[] };

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return String(body?.error?.message || body?.error || fallback);
  } catch {
    return fallback;
  }
}

export function BuilderSharedSavedSections({
  onImported,
  initiallyCollapsed = true
}: {
  onImported?: (record: BuilderSavedSectionRecord) => void;
  initiallyCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [importingId, setImportingId] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function load() {
    setState({ kind: "loading" });
    try {
      const response = await builderAdminFetch("/api/admin/shared/saved_sections", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error", message: await readError(response, "Could not load the sections shared with this project.") });
        return;
      }
      const body = await response.json();
      const items = Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : [];
      setState({ kind: "ready", items });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Could not load the sections shared with this project." });
    }
  }

  useEffect(() => {
    if (!isCollapsed && state.kind === "loading") void load();
    // Loads the first time the group is opened, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCollapsed]);

  async function importSection(item: SharedSavedSectionRecord) {
    setImportingId(item.id);
    setNotice(null);
    try {
      const response = await builderAdminFetch(
        `/api/admin/shared/saved_sections/${encodeURIComponent(item.id)}/import`,
        { method: "POST" }
      );
      if (!response.ok) {
        const message = await readError(response, "The section could not be imported.");
        setNotice({ tone: "error", text: message });
        // A refusal usually means the share changed underneath this list, so
        // show what is shared NOW rather than leaving a stale button up.
        if (response.status === 404) void load();
        return;
      }
      const body = await response.json();
      const record = (body?.savedSection || body?.data) as BuilderSavedSectionRecord | undefined;
      if (record) onImported?.(record);
      setNotice({
        tone: "ok",
        text: `Imported "${record?.name || item.name}" from ${item.sourceProjectName}. It is now in this project's Saved Sections.`
      });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "The section could not be imported." });
    } finally {
      setImportingId("");
    }
  }

  const label = "Shared with this project";
  return (
    <div className="builder-toolbar-shell builder-shared-sections">
      <div className="builder-panel-toggle-row">
        <button
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
          className="builder-panel-toggle"
          onClick={() => setIsCollapsed((current) => !current)}
          title={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
          type="button"
        >
          <span className="panel-label">{label}</span>
          <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!isCollapsed} /></span>
        </button>
      </div>
      {!isCollapsed ? (
        <div className="table-shell builder-templates-shell">
          {notice ? (
            <p className={notice.tone === "error" ? "builder-shared-sections-notice is-error" : "builder-shared-sections-notice"} role={notice.tone === "error" ? "alert" : "status"}>
              {notice.text}
            </p>
          ) : null}
          <table className="polls-table builder-templates-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">From</th>
                <th scope="col">Layout</th>
                <th scope="col">Modules</th>
                <th className="crud-actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.kind === "loading" ? (
                <tr><td className="empty-cell" colSpan={5}>Loading shared sections…</td></tr>
              ) : state.kind === "error" ? (
                <tr><td className="empty-cell" colSpan={5}>{state.message}</td></tr>
              ) : state.items.length === 0 ? (
                <tr><td className="empty-cell" colSpan={5}>{SHARED_SECTIONS_EMPTY_TEXT}</td></tr>
              ) : (
                state.items.map((item) => (
                  <tr key={`${item.sourceProjectId}:${item.id}`}>
                    <td><strong>{item.name || "Untitled saved section"}</strong></td>
                    <td>from {item.sourceProjectName}</td>
                    <td>{item.section?.layout}</td>
                    <td>{Array.isArray(item.section?.modules) ? item.section.modules.length : 0}</td>
                    <td className="crud-actions-cell">
                      <div className="builder-template-actions">
                        <button
                          className="submit-button"
                          disabled={Boolean(importingId)}
                          onClick={() => void importSection(item)}
                          title={`Copy "${item.name}" into this project. Later changes in ${item.sourceProjectName} will not reach the copy.`}
                          type="button"
                        >
                          {importingId === item.id ? "Importing…" : "Import"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
