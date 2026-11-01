/**
 * "Shared by Project" on the Pages screen (task 86bcw3m94): website pages
 * another project shares with the active one, grouped by the project sharing
 * them, each with an Import button.
 *
 * Operator's words, 2026-10-31: "Add a 'Shared by Project' button on Pages
 * next to the other buttons. Only display it if there are > 0 shared pages."
 * So the button renders nothing at all until the list has loaded with at
 * least one page — not while loading, and not when the read failed (a button
 * that opens onto an error is worse than none; the failure is logged).
 *
 * Import makes this project its own unpublished copy of the page BODY
 * (server: lib/builderSharedPageImport.js). The other site's header, menu and
 * footer stay behind, and the notice says so when there were any.
 *
 * WHERE IT SHOWS: the Pages screen (`#page=builderManagePagesPage`) is the
 * frozen vanilla screen (public/js/builder.js), so this mounts on its own root
 * inside that heading's button row (`builderReactRootSharedPages`,
 * src/pages/builder.html), and after an import asks the vanilla screen to
 * reload through the refresh it already exposes — no edit to public/js.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";

export type SharedPageRecord = {
  id: string;
  name: string;
  slug: string;
  isPublished: boolean;
  updatedAt?: string;
  sourceProjectId: string;
  sourceProjectName: string;
};

export type ImportedSharedPage = {
  page: { id: string; name: string; slug: string };
  frameLeftOut: number;
};

export const SHARED_PAGES_BUTTON_LABEL = "Shared by Project";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return String(body?.error?.message || body?.error || fallback);
  } catch {
    return fallback;
  }
}

/** The pages, grouped by the project sharing them, in first-seen order. */
export function groupSharedPages(items: SharedPageRecord[]): Array<{ projectId: string; projectName: string; pages: SharedPageRecord[] }> {
  const groups: Array<{ projectId: string; projectName: string; pages: SharedPageRecord[] }> = [];
  for (const item of items) {
    let group = groups.find((g) => g.projectId === item.sourceProjectId);
    if (!group) {
      group = { projectId: item.sourceProjectId, projectName: item.sourceProjectName || item.sourceProjectId, pages: [] };
      groups.push(group);
    }
    group.pages.push(item);
  }
  return groups;
}

export function importedPageText(item: SharedPageRecord, result: ImportedSharedPage): string {
  const name = result.page?.name || item.name;
  const address = result.page?.slug ? ` at /${result.page.slug}` : "";
  const frame = result.frameLeftOut > 0
    ? ` ${item.sourceProjectName}'s header, menu and footer ${result.frameLeftOut === 1 ? "section was" : `sections (${result.frameLeftOut}) were`} left behind — pick this site's template for it with Change Template.`
    : "";
  return `Imported "${name}" from ${item.sourceProjectName}${address}, as an unpublished draft.${frame}`;
}

function pageAddress(page: SharedPageRecord): string {
  return page.slug ? `/${page.slug}` : "/ (home page)";
}

/**
 * The list inside the dialog, from props alone, so every sentence on it is
 * testable without a browser (builder-shared-pages.test.tsx).
 */
export function SharedPagesList({
  items,
  importingId,
  notice,
  onImport
}: {
  items: SharedPageRecord[];
  importingId?: string;
  notice?: { tone: "ok" | "error"; text: string } | null;
  onImport?: (item: SharedPageRecord) => void;
}) {
  return (
    <div className="builder-shared-pages-list">
      {notice ? (
        <p className={notice.tone === "error" ? "builder-shared-sections-notice is-error" : "builder-shared-sections-notice"} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="meta">No other project shares a page with this one any more.</p>
      ) : (
        groupSharedPages(items).map((group) => (
          <section key={group.projectId} className="builder-shared-pages-group">
            <h4>From {group.projectName}</h4>
            <table className="polls-table">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Address</th>
                  <th scope="col">On that site</th>
                  <th className="crud-actions-cell">Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.pages.map((item) => (
                  <tr key={`${item.sourceProjectId}:${item.id}`}>
                    <td><strong>{item.name || "Untitled page"}</strong></td>
                    <td>{pageAddress(item)}</td>
                    <td>{item.isPublished ? "Published" : "Draft"}</td>
                    <td className="crud-actions-cell">
                      <button
                        className="btn"
                        disabled={Boolean(importingId)}
                        onClick={() => onImport?.(item)}
                        title={`Copy "${item.name}" into this project as an unpublished draft. Later changes in ${item.sourceProjectName} will not reach the copy.`}
                        type="button"
                      >
                        {importingId === item.id ? "Importing…" : "Import"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}

export function BuilderSharedPagesButton({ onImported }: { onImported?: (result: ImportedSharedPage) => void }) {
  const [items, setItems] = useState<SharedPageRecord[] | null>(null);
  const [importingId, setImportingId] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);

  async function load() {
    try {
      const response = await builderAdminFetch("/api/admin/shared/pages", { cache: "no-store" });
      if (!response.ok) {
        console.warn("[shared pages]", await readError(response, "Could not load the pages shared with this project."));
        setItems(null);
        return;
      }
      const body = await response.json();
      setItems(Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : []);
    } catch (e) {
      console.warn("[shared pages]", e);
      setItems(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function importPage(item: SharedPageRecord) {
    setImportingId(item.id);
    setNotice(null);
    try {
      const response = await builderAdminFetch(
        `/api/admin/shared/pages/${encodeURIComponent(item.id)}/import`,
        { method: "POST" }
      );
      if (!response.ok) {
        setNotice({ tone: "error", text: await readError(response, "The page could not be imported.") });
        // A refusal usually means the share changed underneath this list.
        if (response.status === 404) void load();
        return;
      }
      const body = await response.json();
      const data = (body?.data || body) as Partial<ImportedSharedPage>;
      const result: ImportedSharedPage = {
        page: data.page as ImportedSharedPage["page"],
        frameLeftOut: Number(data.frameLeftOut) || 0
      };
      if (result.page) onImported?.(result);
      setNotice({ tone: "ok", text: importedPageText(item, result) });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "The page could not be imported." });
    } finally {
      setImportingId("");
    }
  }

  // Dane's rule: no shared pages, no button. The dialog stays mounted while
  // open so an import that empties the list can still show its notice.
  const open = Boolean(dialog.current?.open);
  if (!items || (items.length === 0 && !open)) return null;

  return (
    <>
      <button
        className="btn"
        onClick={() => {
          setNotice(null);
          dialog.current?.showModal();
        }}
        type="button"
      >
        {SHARED_PAGES_BUTTON_LABEL}
      </button>
      <dialog ref={dialog} className="builder-nested-modal-dialog builder-shared-pages-dialog" aria-label="Pages shared with this project">
        <div className="builder-shared-pages-dialog-head">
          <h3>Pages shared with this project</h3>
          <button className="btn" onClick={() => dialog.current?.close()} type="button">Close</button>
        </div>
        <p className="meta">Importing makes this project its own copy, as an unpublished draft. The other project is not changed.</p>
        <SharedPagesList items={items} importingId={importingId} notice={notice} onImport={(item) => void importPage(item)} />
      </dialog>
    </>
  );
}

type AppBuilderBridge = { App?: { builder?: { refresh?: () => unknown } } };

/**
 * The button as mounted on the Pages screen. Starts over when the active
 * project changes (projectContext emits `session-changed`), so it never offers
 * pages shared with the PREVIOUS project. After an import, the vanilla table
 * reloads so the new draft appears in it at once.
 */
export function BuilderSharedPagesIsland() {
  const [generation, restart] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("projectContext:session-changed", restart);
    return () => window.removeEventListener("projectContext:session-changed", restart);
  }, []);
  return (
    <BuilderSharedPagesButton
      key={generation}
      onImported={() => {
        try {
          void (window as unknown as AppBuilderBridge).App?.builder?.refresh?.();
        } catch {
          // The import itself succeeded and says so; a table that did not
          // reload shows the page after the next visit.
        }
      }}
    />
  );
}
