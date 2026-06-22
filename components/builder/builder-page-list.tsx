import type { BackgroundSettings, BuilderPageRecord, BuilderTemplateRecord, BuilderTheme, BuilderThemeSummary } from "@/lib/builder-template";
import { useEffect, useMemo, useRef, useState } from "react";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { formatTemplateTimestamp } from "./builder-utils";

type SortField = "name" | "slug" | "template" | "updatedAt";
type SortDir = "asc" | "desc";

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
  onPopulateFromWeb: () => void;
  onPreviewDraft: () => void;
  onMakeTemplate: () => void;
  onPageEditorFocus: (focused: boolean) => void;
  onSavePage: () => void;
  autoNewPage?: boolean;
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
  onPopulateFromWeb,
  onPreviewDraft,
  onMakeTemplate,
  onPageEditorFocus,
  onSavePage,
  autoNewPage
}: BuilderPageListProps) {
  const [collapsedPanels, setCollapsedPanels] = useState({
    pages: true,
    details: true
  });
  const [filterText, setFilterText] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusDetailsRef = useRef(false);
  const didAutoNewPageRef = useRef(false);

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
    setCollapsedPanels((current) => ({ ...current, details: false }));
  }, [autoNewPage, onNewPage, onPageEditorFocus]);

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

  const filteredPages = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const result = q
      ? pages.filter(
          (p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
        )
      : pages;
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
      } else {
        av = a.updatedAt;
        bv = b.updatedAt;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [pages, filterText, sortField, sortDir, templates]);

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

  function openDetailsAndFocus() {
    shouldFocusDetailsRef.current = true;
    setCollapsedPanels((current) => ({ ...current, details: false }));
  }

  function handleEditPage(pageId: string) {
    onSelectPage(pageId);
    onPageEditorFocus(true);
    openDetailsAndFocus();
  }

  function handleNewPage() {
    onNewPage();
    onPageEditorFocus(true);
    openDetailsAndFocus();
  }

  useEffect(() => {
    if (collapsedPanels.details || !shouldFocusDetailsRef.current) {
      return;
    }

    shouldFocusDetailsRef.current = false;
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [collapsedPanels.details, selectedPageId]);

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
              onClick={onBulkCreate}
              type="button"
            >
              Bulk Create
            </button>
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              disabled={isSaving}
              onClick={onPopulateFromWeb}
              type="button"
            >
              Populate from Builder
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
              className={`danger-button builder-pages-delete-selected${checkedIds.size === 0 ? " is-no-selection" : ""}`}
              disabled={isSaving}
              onClick={() => { if (checkedIds.size > 0) onDeletePages([...checkedIds]); }}
              type="button"
            >
              {isSaving ? "Deleting…" : checkedIds.size > 0 ? `Delete Selected (${checkedIds.size})` : "Delete Selected"}
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
              <col className="builder-pages-col-updated" />
              <col className="builder-pages-col-actions" />
            </colgroup>
            <thead>
              {!collapsedPanels.pages ? (
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
                      className={`admin-table-sort-button${sortField === "updatedAt" ? " is-active" : ""}`}
                      onClick={() => handleSort("updatedAt")}
                      type="button"
                    >
                      Updated {sortIndicator("updatedAt")}
                    </button>
                  </th>
                  <th className="crud-actions-cell">Actions</th>
                </tr>
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
                    <td className="empty-cell" colSpan={6}>
                      {pages.length === 0 ? "No pages found." : "No pages match your search."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            ) : null}
          </table>
        </div>
      </div>

      <div className="builder-toolbar-shell builder-pages-details-shell">
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
                type="text"
                value={draftName}
                onChange={(event) => onSetDraftName(event.target.value)}
                placeholder="About Normie"
              />
            </label>
            <label className="field">
              <span>Slug</span>
              <input
                type="text"
                value={pageSlug}
                onChange={(event) => onSetPageSlug(event.target.value)}
                placeholder="about"
              />
            </label>
            <label className="field">
              <span>Template</span>
              <select
                value={pageTemplateId}
                onChange={(event) => onApplyTemplate(event.target.value)}
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
                value={pageThemeId}
                onChange={(event) => onApplyTheme(event.target.value)}
              >
                <option value="">None (use template default)</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
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
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
