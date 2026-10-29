/**
 * "Shared with this project" — page templates another project shares with the
 * active one (task 86bcu6ubh; the share itself is 86bcu6t1c).
 *
 * Operator's design, 2026-10-28: shared items are visible but untouched until
 * imported. The one action is Import, which makes this project its own copy
 * of the template AND of the saved sections its header, menu and footer are
 * built from (server: lib/builderSharedTemplateImport.js) — so the copy is
 * complete rather than pointing at another project's sections. Email
 * templates are left out, as they are from every page-template list.
 *
 * Its own file, the twin of builder-shared-saved-sections.tsx.
 *
 * WHERE IT SHOWS: the Templates page (`#page=builderTemplatesPage`) lists
 * templates with the frozen vanilla screen (public/js/builder.js), not with
 * the React BuilderTemplateList, which only appears inside the template
 * editor. So this group mounts on its own root under that table
 * (`builderReactRootSharedPageTemplates`, src/pages/builder.html) through
 * `BuilderSharedPageTemplatesIsland`, and after an import asks the vanilla
 * screen to reload through the refresh it already exposes — no edit to
 * public/js, which is frozen.
 */
import { useEffect, useReducer, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import type { BuilderSavedSectionRecord, BuilderTemplateRecord } from "@/lib/builder-template";
import { BuilderCollapseIcon } from "./builder-collapse-icon";

export type SharedPageTemplateRecord = BuilderTemplateRecord & {
  sourceProjectId: string;
  sourceProjectName: string;
};

export type ImportedPageTemplate = {
  template: BuilderTemplateRecord;
  savedSections: BuilderSavedSectionRecord[];
  droppedReferences: number;
};

export const SHARED_TEMPLATES_EMPTY_TEXT = "No other project shares its page templates with this one.";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: SharedPageTemplateRecord[] };

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return String(body?.error?.message || body?.error || fallback);
  } catch {
    return fallback;
  }
}

/** Header, menu and footer: the sections a template points at rather than owns. */
function sharedSectionCount(template: BuilderTemplateRecord): number {
  const sections = Array.isArray(template.layoutSections) ? template.layoutSections : [];
  return sections.filter((section) => section?.canonical === true && Boolean(section?.savedSectionId)).length;
}

function importedText(item: SharedPageTemplateRecord, result: ImportedPageTemplate): string {
  const name = result.template?.name || item.name;
  const count = result.savedSections.length;
  const sections = count === 0
    ? ""
    : count === 1
      ? " with the 1 section it is built from, now in this project's Saved Sections"
      : ` with the ${count} sections it is built from, now in this project's Saved Sections`;
  const dropped = result.droppedReferences > 0
    ? ` ${result.droppedReferences === 1 ? "1 shared section was" : `${result.droppedReferences} shared sections were`} left out because ${item.sourceProjectName} no longer has ${result.droppedReferences === 1 ? "it" : "them"}.`
    : "";
  return `Imported "${name}" from ${item.sourceProjectName}${sections}.${dropped}`;
}

export function BuilderSharedPageTemplates({
  onImported,
  initiallyCollapsed = true
}: {
  onImported?: (result: ImportedPageTemplate) => void;
  initiallyCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [importingId, setImportingId] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function load() {
    setState({ kind: "loading" });
    try {
      const response = await builderAdminFetch("/api/admin/shared/page_templates", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error", message: await readError(response, "Could not load the templates shared with this project.") });
        return;
      }
      const body = await response.json();
      const items: SharedPageTemplateRecord[] = Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : [];
      setState({ kind: "ready", items: items.filter((item) => item.templateKind !== "email") });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Could not load the templates shared with this project." });
    }
  }

  useEffect(() => {
    if (!isCollapsed && state.kind === "loading") void load();
    // Loads the first time the group is opened, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCollapsed]);

  async function importTemplate(item: SharedPageTemplateRecord) {
    setImportingId(item.id);
    setNotice(null);
    try {
      const response = await builderAdminFetch(
        `/api/admin/shared/page_templates/${encodeURIComponent(item.id)}/import`,
        { method: "POST" }
      );
      if (!response.ok) {
        const message = await readError(response, "The template could not be imported.");
        setNotice({ tone: "error", text: message });
        // A refusal usually means the share changed underneath this list, so
        // show what is shared NOW rather than leaving a stale button up.
        if (response.status === 404) void load();
        return;
      }
      const body = await response.json();
      const data = (body?.data || body) as Partial<ImportedPageTemplate>;
      const result: ImportedPageTemplate = {
        template: data.template as BuilderTemplateRecord,
        savedSections: Array.isArray(data.savedSections) ? data.savedSections : [],
        droppedReferences: Number(data.droppedReferences) || 0
      };
      if (result.template) onImported?.(result);
      setNotice({ tone: "ok", text: importedText(item, result) });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "The template could not be imported." });
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
                <th scope="col">Shared sections</th>
                <th className="crud-actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.kind === "loading" ? (
                <tr><td className="empty-cell" colSpan={4}>Loading shared templates…</td></tr>
              ) : state.kind === "error" ? (
                <tr><td className="empty-cell" colSpan={4}>{state.message}</td></tr>
              ) : state.items.length === 0 ? (
                <tr><td className="empty-cell" colSpan={4}>{SHARED_TEMPLATES_EMPTY_TEXT}</td></tr>
              ) : (
                state.items.map((item) => (
                  <tr key={`${item.sourceProjectId}:${item.id}`}>
                    <td><strong>{item.name || "Untitled template"}</strong></td>
                    <td>from {item.sourceProjectName}</td>
                    <td>{sharedSectionCount(item)}</td>
                    <td className="crud-actions-cell">
                      <div className="builder-template-actions">
                        <button
                          className="submit-button"
                          disabled={Boolean(importingId)}
                          onClick={() => void importTemplate(item)}
                          title={`Copy "${item.name}" and the header, menu and footer it uses into this project. Later changes in ${item.sourceProjectName} will not reach the copy.`}
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

type AppBuilderBridge = { App?: { builder?: { refresh?: () => unknown } } };

/**
 * The group as mounted on the Templates page. Starts over when the active
 * project changes (projectContext emits `session-changed`), so the list never
 * shows what was shared with the PREVIOUS project. After an import, the
 * vanilla table above it reloads, so the new template appears there at once.
 */
export function BuilderSharedPageTemplatesIsland() {
  const [generation, restart] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("projectContext:session-changed", restart);
    return () => window.removeEventListener("projectContext:session-changed", restart);
  }, []);
  return (
    <BuilderSharedPageTemplates
      key={generation}
      onImported={() => {
        try {
          void (window as unknown as AppBuilderBridge).App?.builder?.refresh?.();
        } catch {
          // The import itself succeeded and says so; a table that did not
          // reload shows the template after the next visit.
        }
      }}
    />
  );
}
