import type { BackgroundSettings, BuilderPageRecord, BuilderPageSnapshotSummary, BuilderTemplateRecord, BuilderTheme, BuilderThemeSummary } from "@/lib/builder-template";
import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { buildBuilderThemePaletteColors, builderThemeToCrmPalette, formatTemplateTimestamp, getThemeFormControlVars } from "./builder-utils";

type SortField = "name" | "slug" | "template" | "visibility" | "updatedAt";
type SortDir = "asc" | "desc";
type ArchiveView = "pages" | "archive-list" | "archive-detail";
type VisibilityFilter = "" | "public" | "private" | "draft";

export type PageVisibility = "public" | "private" | "draft";

export function pageVisibilityFromRecord(page: BuilderPageRecord | null | undefined): PageVisibility {
  if (!page) return "public";
  if (page.isPublished === false) return "draft";
  if (page.isPrivate === true) return "private";
  return "public";
}

export function pageVisibilityToFlags(visibility: PageVisibility): { isPublished: boolean; isPrivate: boolean } {
  if (visibility === "draft") return { isPublished: false, isPrivate: false };
  if (visibility === "private") return { isPublished: true, isPrivate: true };
  return { isPublished: true, isPrivate: false };
}

function pageVisibilityState(page: BuilderPageRecord): PageVisibility {
  return pageVisibilityFromRecord(page);
}

function pageVisibilityLabel(page: BuilderPageRecord): string {
  const state = pageVisibilityState(page);
  if (state === "draft") return "Draft";
  if (state === "private") return "Private";
  return "Public";
}

function pageVisibilitySortKey(page: BuilderPageRecord): string {
  const state = pageVisibilityState(page);
  if (state === "draft") return "0";
  if (state === "public") return "1";
  return "2";
}

type ActiveArchive = {
  id: string;
  label: string;
  createdAt: string;
  pages: BuilderPageRecord[];
};

type BuilderPageListProps = {
  pages: BuilderPageRecord[];
  templates: BuilderTemplateRecord[];
  selectedPageId: string;
  draftName: string;
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  pageSlug: string;
  pageTemplateId: string;
  isSaving: boolean;
  onSelectPage: (pageId: string) => void;
  onPreviewPage: (slug: string) => void;
  onClonePage: (pageId: string) => void;
  onDeletePage: (pageId: string, pageName: string) => void;
  onDeletePages: (pageIds: string[]) => void;
  onSetDraftName: (name: string) => void;
  onUpdatePageBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onUpdateTheme: (updater: (theme: BuilderTheme) => BuilderTheme) => void;
  onSetPageSlug: (slug: string) => void;
  themes: BuilderThemeSummary[];
  pageThemeId: string;
  onApplyTemplate: (templateId: string) => void;
  onApplyTheme: (themeId: string) => void;
  onNewPage: () => void;
  onBulkCreate: () => void;
  onPreviewDraft: () => void;
  onMakeTemplate: () => void;
  onPageEditorFocus: (focused: boolean) => void;
  onSavePage: () => void;
  pageVisibility: PageVisibility;
  onSetPageVisibility: (visibility: PageVisibility) => void;
  autoNewPage?: boolean;
  /** When mounted to edit a specific page (e.g. Manage Pages CRUD edit), open Page Details. */
  autoOpenPageDetails?: boolean;
  snapshots: BuilderPageSnapshotSummary[];
  isSnapshoting: boolean;
  isRestoring: boolean;
  activeArchive: ActiveArchive | null;
  onArchivePages: (pageIds: string[]) => void;
  onLoadArchive: (snapshotId: string) => void;
  onRestoreArchive: (snapshotId: string) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
};

export function BuilderPageList({
  pages,
  templates,
  themes,
  selectedPageId,
  draftName,
  pageBackground,
  pageSlug,
  pageTemplateId,
  pageThemeId,
  isSaving,
  onSelectPage,
  onPreviewPage,
  onClonePage,
  onDeletePage,
  onDeletePages,
  onSetDraftName,
  onUpdatePageBackground,
  onSetPageSlug,
  onApplyTemplate,
  onApplyTheme,
  onNewPage,
  onBulkCreate,
  onPreviewDraft,
  onMakeTemplate,
  onPageEditorFocus,
  onSavePage,
  pageVisibility,
  onSetPageVisibility,
  autoNewPage,
  autoOpenPageDetails,
  snapshots,
  isSnapshoting,
  isRestoring,
  activeArchive,
  onArchivePages,
  onLoadArchive,
  onRestoreArchive,
  onDeleteSnapshot,
}: BuilderPageListProps) {
  const [collapsedPanels, setCollapsedPanels] = useState({
    pages: true,
    details: true
  });
  const [filterText, setFilterText] = useState("");
  const [filterVisibility, setFilterVisibility] = useState<VisibilityFilter>("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [archiveView, setArchiveView] = useState<ArchiveView>("pages");

  const linkedTheme = pageThemeId
    ? themes.find((theme) => theme.id === pageThemeId) ?? null
    : null;
  const themeColors = buildBuilderThemePaletteColors(linkedTheme);
  const pageDetailsThemeStyle = useMemo(
    () =>
      getThemeFormControlVars(
        linkedTheme?.typography ? { typography: linkedTheme.typography } : undefined,
        builderThemeToCrmPalette(linkedTheme)
      ),
    [linkedTheme]
  );

  function openPageDetailsPanel(scrollIntoView = false) {
    shouldFocusDetailsRef.current = true;
    if (scrollIntoView) {
      shouldScrollDetailsRef.current = true;
    }
    setCollapsedPanels({ pages: true, details: false });
  }

  function scrollAndFocusPageDetails() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const shell = pageDetailsShellRef.current;
        if (shell) {
          const top = shell.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
        }
        const titleInput = titleInputRef.current;
        if (!titleInput) return;
        titleInput.classList.add("is-auto-focused");
        titleInput.focus({ preventScroll: true });
        titleInput.select();
      });
    });
  }

  function handlePageDetailsFieldBlur(event: FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    event.currentTarget.classList.remove("is-auto-focused");
  }

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const pageDetailsShellRef = useRef<HTMLDivElement | null>(null);
  const shouldFocusDetailsRef = useRef(false);
  const shouldScrollDetailsRef = useRef(false);
  const didAutoNewPageRef = useRef(false);
  const didAutoOpenPageDetailsRef = useRef(false);

  function togglePanel(panel: keyof typeof collapsedPanels) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel]
    }));
  }

  // When mounted to create a new page, open Page Details immediately.
  useEffect(() => {
    if (!autoNewPage || didAutoNewPageRef.current) return;
    didAutoNewPageRef.current = true;
    onNewPage();
    onPageEditorFocus(true);
    shouldFocusDetailsRef.current = true;
    shouldScrollDetailsRef.current = true;
    openPageDetailsPanel(true);
  }, [autoNewPage, onNewPage, onPageEditorFocus]);

  // When mounted to edit a specific page (Manage Pages CRUD → Builder: Pages).
  useEffect(() => {
    if (!autoOpenPageDetails || didAutoOpenPageDetailsRef.current || !selectedPageId) return;
    didAutoOpenPageDetailsRef.current = true;
    onPageEditorFocus(true);
    openPageDetailsPanel(true);
  }, [autoOpenPageDetails, onPageEditorFocus, selectedPageId]);

  // Backup when legacy builder.js mounts an existing page editor (after navigation settles).
  useEffect(() => {
    function handleOpenPageDetails() {
      onPageEditorFocus(true);
      openPageDetailsPanel(true);
      window.setTimeout(() => scrollAndFocusPageDetails(), 150);
    }
    window.addEventListener("builder:openPageDetails", handleOpenPageDetails);
    return () => window.removeEventListener("builder:openPageDetails", handleOpenPageDetails);
  }, [onPageEditorFocus]);

  useEffect(() => {
    onPageEditorFocus(!collapsedPanels.details || Boolean(selectedPageId));
  }, [collapsedPanels.details, onPageEditorFocus, selectedPageId]);

  // Remove stale checked IDs when the pages list changes (e.g. after delete)
  useEffect(() => {
    const validIds = new Set(pages.map((p) => p.id));
    setCheckedIds((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pages]);

  // When an archive is loaded, switch to detail view
  useEffect(() => {
    if (activeArchive) setArchiveView("archive-detail");
  }, [activeArchive?.id]);

  const filteredPages = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    let result = q
      ? pages.filter(
          (p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
        )
      : pages.slice();
    if (filterVisibility) {
      result = result.filter((page) => pageVisibilityState(page) === filterVisibility);
    }
    return result.slice().sort((a, b) => {
      let av = "";
      let bv = "";
      if (sortField === "name") {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sortField === "slug") {
        av = a.slug.toLowerCase();
        bv = b.slug.toLowerCase();
      } else if (sortField === "template") {
        av = (templates.find((t) => t.id === a.templateId)?.name ?? "").toLowerCase();
        bv = (templates.find((t) => t.id === b.templateId)?.name ?? "").toLowerCase();
      } else if (sortField === "visibility") {
        av = pageVisibilitySortKey(a);
        bv = pageVisibilitySortKey(b);
      } else {
        av = a.updatedAt;
        bv = b.updatedAt;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [pages, filterText, filterVisibility, sortField, sortDir, templates]);

  const allVisibleChecked =
    filteredPages.length > 0 && filteredPages.every((p) => checkedIds.has(p.id));
  const someVisibleChecked =
    filteredPages.some((p) => checkedIds.has(p.id)) && !allVisibleChecked;

  function handleCheckAll() {
    if (allVisibleChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredPages.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredPages.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  function handleCheckRow(pageId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function sortIndicator(field: SortField) {
    if (field !== sortField) return <span className="admin-table-sort-indicator">↕</span>;
    return (
      <span className="admin-table-sort-indicator">{sortDir === "asc" ? "▲" : "▼"}</span>
    );
  }

  function openDetailsAndFocus(scrollIntoView = false) {
    openPageDetailsPanel(scrollIntoView);
  }

  function handleEditPage(pageId: string) {
    onSelectPage(pageId);
    onPageEditorFocus(true);
    openDetailsAndFocus(true);
  }

  function handleNewPage() {
    onNewPage();
    onPageEditorFocus(true);
    openDetailsAndFocus(true);
  }

  useEffect(() => {
    if (collapsedPanels.details || !shouldFocusDetailsRef.current) {
      return;
    }

    shouldFocusDetailsRef.current = false;
    const shouldScroll = shouldScrollDetailsRef.current;
    shouldScrollDetailsRef.current = false;
    const runFocus = () => {
      if (shouldScroll) {
        scrollAndFocusPageDetails();
        return;
      }
      titleInputRef.current?.focus({ preventScroll: true });
      titleInputRef.current?.classList.add("is-auto-focused");
      titleInputRef.current?.select();
    };
    window.requestAnimationFrame(() => {
      window.setTimeout(runFocus, shouldScroll ? 120 : 0);
    });
  }, [collapsedPanels.details, selectedPageId]);

  function handleOpenArchiveList() {
    setArchiveView("archive-list");
  }

  function handleViewArchive(snapshotId: string) {
    onLoadArchive(snapshotId);
    // archiveView switches to "archive-detail" via the useEffect above when activeArchive loads
  }

  function handleBackToPages() {
    setArchiveView("pages");
  }

  function handleBackToArchiveList() {
    setArchiveView("archive-list");
  }

  // --- Archive list view ---

  if (archiveView === "archive-list") {
    return (
      <div className="builder-toolbar-shell builder-pages-list-shell">
        <div className="builder-pages-list-heading-layout">
          <div className="builder-pages-list-heading-primary">
            <button
              className="builder-panel-toggle builder-archive-back-button"
              onClick={handleBackToPages}
              type="button"
              aria-label="Back to Pages"
            >
              <span className="builder-archive-back-arrow">←</span>
              <span className="panel-label">Pages</span>
            </button>
            <span className="builder-archive-heading-label">Archives</span>
          </div>
        </div>

        <div className="table-shell builder-templates-shell">
          <table className="polls-table builder-templates-table builder-pages-list-table">
            <colgroup>
              <col className="builder-pages-col-title" />
              <col className="builder-pages-col-updated" />
              <col className="builder-pages-col-slug" />
              <col className="builder-pages-col-actions" />
            </colgroup>
            <thead>
              <tr className="builder-pages-list-columns-row">
                <th>Label</th>
                <th>Saved</th>
                <th>Pages</th>
                <th className="crud-actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap) => (
                <tr key={snap.id}>
                  <td><strong>{snap.label || <em>Untitled</em>}</strong></td>
                  <td>{new Date(snap.createdAt).toLocaleString()}</td>
                  <td>{snap.pageCount}</td>
                  <td className="crud-actions-cell">
                    <div className="builder-template-actions">
                      <button
                        aria-label="View archived pages"
                        className="polls-icon-button polls-icon-button-edit"
                        onClick={() => handleViewArchive(snap.id)}
                        title="View archive"
                        type="button"
                      >
                        ✎
                      </button>
                      <button
                        aria-label="Delete archive"
                        className="polls-icon-button polls-icon-button-danger"
                        onClick={() => onDeleteSnapshot(snap.id)}
                        title="Delete archive"
                        type="button"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={4}>
                    No archives yet. Select pages and click Archive to save one.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // --- Archive detail view ---

  if (archiveView === "archive-detail" && activeArchive) {
    const archivePages = Array.isArray(activeArchive.pages) ? activeArchive.pages : [];
    const archiveLabel = activeArchive.label || new Date(activeArchive.createdAt).toLocaleString();
    const archiveTimestamp = new Date(activeArchive.createdAt).toLocaleString();

    return (
      <div className="builder-toolbar-shell builder-pages-list-shell">
        <div className="builder-pages-list-heading-layout">
          <div className="builder-pages-list-heading-primary">
            <button
              className="builder-panel-toggle builder-archive-back-button"
              onClick={handleBackToArchiveList}
              type="button"
              aria-label="Back to Archives"
            >
              <span className="builder-archive-back-arrow">←</span>
              <span className="panel-label">Archives</span>
            </button>
            <span className="builder-archive-heading-label">
              {archiveLabel} — {archiveTimestamp}
            </span>
          </div>
          <div className="builder-pages-list-heading-actions">
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              disabled={isRestoring}
              onClick={() => onRestoreArchive(activeArchive.id)}
              type="button"
            >
              {isRestoring ? "Restoring…" : "Restore All"}
            </button>
          </div>
        </div>

        <div className="table-shell builder-templates-shell">
          <table className="polls-table builder-templates-table builder-pages-list-table">
            <colgroup>
              <col className="builder-pages-col-title" />
              <col className="builder-pages-col-slug" />
              <col className="builder-pages-col-template" />
              <col className="builder-pages-col-updated" />
              <col className="builder-pages-col-actions" />
            </colgroup>
            <thead>
              <tr className="builder-pages-list-columns-row">
                <th>Title</th>
                <th>Slug</th>
                <th>Template</th>
                <th>Updated</th>
                <th className="crud-actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {archivePages.map((page) => (
                <tr key={page.id}>
                  <td><strong>{page.name || "Untitled page"}</strong></td>
                  <td className="template-id-cell"><code>/{page.slug}</code></td>
                  <td>{templates.find((t) => t.id === page.templateId)?.name || "Unknown"}</td>
                  <td>{formatTemplateTimestamp(page.updatedAt)}</td>
                  <td className="crud-actions-cell">
                    <div className="builder-template-actions">
                      <button
                        aria-label="Preview page"
                        className="polls-icon-button polls-icon-button-view"
                        onClick={() => onPreviewPage(page.slug || page.id)}
                        title="Preview page"
                        type="button"
                      >
                        <span aria-hidden="true" className="polls-icon-glyph-eye" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {archivePages.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={5}>No pages in this archive.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // --- Normal pages view ---

  return (
    <>
      <div className="builder-toolbar-shell builder-pages-list-shell">
        <div className="builder-pages-list-heading-layout">
          <div className="builder-pages-list-heading-primary">
            <button
              aria-expanded={!collapsedPanels.pages}
              aria-label={collapsedPanels.pages ? "Expand Pages" : "Collapse Pages"}
              className="builder-panel-toggle"
              onClick={() => togglePanel("pages")}
              title={collapsedPanels.pages ? "Expand Pages" : "Collapse Pages"}
              type="button"
            >
              <span className="panel-label">Pages</span>
              <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!collapsedPanels.pages} /></span>
            </button>
          </div>
          <div className="builder-pages-list-heading-actions">
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              onClick={handleOpenArchiveList}
              type="button"
            >
              Archive
            </button>
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              onClick={onBulkCreate}
              type="button"
            >
              Bulk Create
            </button>
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              onClick={handleNewPage}
              type="button"
            >
              New Page
            </button>
          </div>
        </div>

        {!collapsedPanels.pages ? (
          <div className="builder-pages-filter-bar">
            <input
              className="builder-pages-filter-input"
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search pages…"
              type="search"
              value={filterText}
            />
            <button
              className={`submit-button builder-pages-archive-selected${checkedIds.size === 0 ? " is-no-selection" : ""}`}
              disabled={isSaving || isSnapshoting || checkedIds.size === 0}
              onClick={() => { if (checkedIds.size > 0) onArchivePages([...checkedIds]); }}
              title={checkedIds.size > 0 ? `Archive ${checkedIds.size} selected page(s)` : "Select pages to archive"}
              type="button"
            >
              {isSnapshoting ? "Archiving…" : checkedIds.size > 0 ? `Archive (${checkedIds.size})` : "Archive"}
            </button>
            <button
              className={`danger-button builder-pages-delete-selected${checkedIds.size === 0 ? " is-no-selection" : ""}`}
              disabled={isSaving}
              onClick={() => { if (checkedIds.size > 0) onDeletePages([...checkedIds]); }}
              type="button"
            >
              {isSaving ? "Deleting…" : checkedIds.size > 0 ? `Delete (${checkedIds.size})` : "Delete"}
            </button>
          </div>
        ) : null}

        <div className="table-shell builder-templates-shell">
          <table className="polls-table builder-templates-table builder-pages-list-table">
            <colgroup>
              <col className="builder-pages-col-check" />
              <col className="builder-pages-col-title" />
              <col className="builder-pages-col-slug" />
              <col className="builder-pages-col-template" />
              <col className="builder-pages-col-visibility" />
              <col className="builder-pages-col-updated" />
              <col className="builder-pages-col-actions" />
            </colgroup>
            <thead>
              {!collapsedPanels.pages ? (
                <>
                <tr className="builder-crud-filter-row">
                  <th scope="col" />
                  <th scope="col" />
                  <th scope="col" />
                  <th scope="col" />
                  <th scope="col">
                    <label className="builder-crud-filter-field">
                      <span className="builder-crud-filter-label">Filter Visibility</span>
                      <select
                        aria-label="Filter Visibility"
                        className="builder-crud-filter-select"
                        onChange={(event) => setFilterVisibility(event.target.value as VisibilityFilter)}
                        value={filterVisibility}
                      >
                        <option value="">All Visibility</option>
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                        <option value="draft">Draft</option>
                      </select>
                    </label>
                  </th>
                  <th scope="col" />
                  <th scope="col" />
                </tr>
                <tr className="builder-pages-list-columns-row">
                  <th className="builder-pages-check-cell">
                    <input
                      aria-label="Select all pages"
                      checked={allVisibleChecked}
                      onChange={handleCheckAll}
                      ref={(el) => { if (el) el.indeterminate = someVisibleChecked; }}
                      title={allVisibleChecked ? "Deselect all" : "Select all"}
                      type="checkbox"
                    />
                  </th>
                  <th>
                    <button
                      className={`admin-table-sort-button${sortField === "name" ? " is-active" : ""}`}
                      onClick={() => handleSort("name")}
                      type="button"
                    >
                      Title {sortIndicator("name")}
                    </button>
                  </th>
                  <th>
                    <button
                      className={`admin-table-sort-button${sortField === "slug" ? " is-active" : ""}`}
                      onClick={() => handleSort("slug")}
                      type="button"
                    >
                      Slug {sortIndicator("slug")}
                    </button>
                  </th>
                  <th>
                    <button
                      className={`admin-table-sort-button${sortField === "template" ? " is-active" : ""}`}
                      onClick={() => handleSort("template")}
                      type="button"
                    >
                      Template {sortIndicator("template")}
                    </button>
                  </th>
                  <th>
                    <button
                      className={`admin-table-sort-button${sortField === "visibility" ? " is-active" : ""}`}
                      onClick={() => handleSort("visibility")}
                      type="button"
                    >
                      Visibility {sortIndicator("visibility")}
                    </button>
                  </th>
                  <th>
                    <button
                      className={`admin-table-sort-button${sortField === "updatedAt" ? " is-active" : ""}`}
                      onClick={() => handleSort("updatedAt")}
                      type="button"
                    >
                      Updated {sortIndicator("updatedAt")}
                    </button>
                  </th>
                  <th className="crud-actions-cell">Actions</th>
                </tr>
                </>
              ) : null}
            </thead>
            {!collapsedPanels.pages ? (
              <tbody>
                {filteredPages.map((page) => {
                  const isSelected = page.id === selectedPageId;
                  const isChecked = checkedIds.has(page.id);

                  return (
                    <tr className={isSelected ? "is-selected-row" : undefined} key={page.id}>
                      <td className="builder-pages-check-cell">
                        <input
                          aria-label={`Select ${page.name || "Untitled page"}`}
                          checked={isChecked}
                          onChange={() => handleCheckRow(page.id)}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <strong>{page.name || "Untitled page"}</strong>
                      </td>
                      <td className="template-id-cell">
                        <code>/{page.slug}</code>
                      </td>
                      <td>{templates.find((template) => template.id === page.templateId)?.name || "Unknown"}</td>
                      <td>{pageVisibilityLabel(page) || "—"}</td>
                      <td>{formatTemplateTimestamp(page.updatedAt)}</td>
                      <td className="crud-actions-cell">
                        <div className="builder-template-actions">
                          <button
                            className="polls-icon-button polls-icon-button-edit"
                            onClick={() => handleEditPage(page.id)}
                            type="button"
                            aria-label={isSelected ? "Editing current page" : "Edit page"}
                            title={isSelected ? "Editing current page" : "Edit page"}
                          >
                            {isSelected ? "●" : "✎"}
                          </button>
                          <button
                            className="polls-icon-button polls-icon-button-view"
                            onClick={() => onPreviewPage(page.slug || page.id)}
                            type="button"
                            aria-label="Preview page"
                            title="Preview page"
                          >
                            <span aria-hidden="true" className="polls-icon-glyph-eye" />
                          </button>
                          <button
                            aria-label="Clone page"
                            className="polls-icon-button polls-icon-button-view"
                            disabled={isSaving}
                            onClick={() => onClonePage(page.id)}
                            title="Clone"
                            type="button"
                          >
                            ⧉
                          </button>
                          <button
                            className="polls-icon-button polls-icon-button-danger"
                            onClick={() => onDeletePage(page.id, page.name)}
                            type="button"
                            disabled={isSaving}
                            aria-label="Delete page"
                            title="Delete page"
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredPages.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={7}>
                      {pages.length === 0 ? "No pages found." : "No pages match your search."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            ) : null}
          </table>
        </div>
      </div>

      <div
        className="builder-toolbar-shell builder-pages-details-shell"
        ref={pageDetailsShellRef}
        style={pageDetailsThemeStyle}
      >
        <div className="builder-pages-crud-heading-layout">
          <div className="builder-pages-crud-heading-primary">
            <button
              aria-expanded={!collapsedPanels.details}
              aria-label={collapsedPanels.details ? "Expand Page Details" : "Collapse Page Details"}
              className="builder-panel-toggle"
              onClick={() => togglePanel("details")}
              title={collapsedPanels.details ? "Expand Page Details" : "Collapse Page Details"}
              type="button"
            >
              <span className="panel-label">Page Details</span>
              <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!collapsedPanels.details} /></span>
            </button>
          </div>
          <div className="builder-pages-crud-heading-actions">
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              onClick={onPreviewDraft}
              type="button"
            >
              Preview
            </button>
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              disabled={isSaving}
              onClick={onMakeTemplate}
              type="button"
            >
              Save as Template
            </button>
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              disabled={isSaving}
              onClick={onSavePage}
              type="button"
            >
              {isSaving ? "Saving..." : "Save Page"}
            </button>
          </div>
        </div>
        {!collapsedPanels.details ? (
          <div className="builder-meta-grid builder-meta-grid-pages">
            <label className="field">
              <span>Page title</span>
              <input
                ref={titleInputRef}
                className="builder-page-details-field"
                type="text"
                value={draftName}
                onChange={(event) => onSetDraftName(event.target.value)}
                onBlur={handlePageDetailsFieldBlur}
                placeholder="About StarCaster"
              />
            </label>
            <label className="field">
              <span>Slug</span>
              <input
                className="builder-page-details-field"
                type="text"
                value={pageSlug}
                onChange={(event) => onSetPageSlug(event.target.value)}
                onBlur={handlePageDetailsFieldBlur}
                placeholder="about"
              />
            </label>
            <label className="field">
              <span>Template</span>
              <select
                className="builder-page-details-field"
                value={pageTemplateId}
                onChange={(event) => onApplyTemplate(event.target.value)}
                onBlur={handlePageDetailsFieldBlur}
              >
                <option value="">Select a template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Theme</span>
              <select
                className="builder-page-details-field"
                value={pageThemeId}
                onChange={(event) => onApplyTheme(event.target.value)}
                onBlur={handlePageDetailsFieldBlur}
              >
                <option value="">None (use template default)</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Visibility</span>
              <select
                className="builder-page-details-field"
                value={pageVisibility}
                onChange={(event) => onSetPageVisibility(event.target.value as PageVisibility)}
                onBlur={handlePageDetailsFieldBlur}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="draft">Draft</option>
              </select>
            </label>
            <div className="builder-meta-grid-pages-background">
              <BuilderBackgroundControls
                label="Background"
                background={pageBackground}
                compact
                hideClear
                showColorFieldLabel={false}
                onChange={onUpdatePageBackground}
                themeBackgroundColor={linkedTheme?.backgroundColor}
                themeColors={themeColors}
                themePrimaryColor={linkedTheme?.primaryColor}
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
