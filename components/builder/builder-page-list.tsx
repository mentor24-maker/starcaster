import type { BackgroundSettings, BuilderPageRecord, BuilderTemplateRecord, BuilderTheme } from "@/lib/builder-template";
import { useEffect, useRef, useState } from "react";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { BuilderThemeTypographySettings } from "./builder-theme-typography-settings";
import { formatTemplateTimestamp } from "./builder-utils";

type BuilderPageListProps = {
  pages: BuilderPageRecord[];
  templates: BuilderTemplateRecord[];
  selectedPageId: string;
  draftName: string;
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  pageSlug: string;
  pageTemplateId: string;
  isPublishedPage: boolean;
  isSaving: boolean;
  onSelectPage: (pageId: string) => void;
  onPreviewPage: (slug: string) => void;
  onClonePage: (pageId: string) => void;
  onDeletePage: (pageId: string, pageName: string) => void;
  onSetDraftName: (name: string) => void;
  onUpdatePageBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onUpdateTheme: (updater: (theme: BuilderTheme) => BuilderTheme) => void;
  onSetPageSlug: (slug: string) => void;
  onApplyTemplate: (templateId: string) => void;
  onSetIsPublished: (isPublished: boolean) => void;
  onNewPage: () => void;
  onBulkCreate: () => void;
  onPreviewDraft: () => void;
  onMakeTemplate: () => void;
  onPageEditorFocus: (focused: boolean) => void;
  onSavePage: () => void;
};

export function BuilderPageList({
  pages,
  templates,
  selectedPageId,
  draftName,
  pageBackground,
  theme,
  pageSlug,
  pageTemplateId,
  isPublishedPage,
  isSaving,
  onSelectPage,
  onPreviewPage,
  onClonePage,
  onDeletePage,
  onSetDraftName,
  onUpdatePageBackground,
  onUpdateTheme,
  onSetPageSlug,
  onApplyTemplate,
  onSetIsPublished,
  onNewPage,
  onBulkCreate,
  onPreviewDraft,
  onMakeTemplate,
  onPageEditorFocus,
  onSavePage
}: BuilderPageListProps) {
  const [collapsedPanels, setCollapsedPanels] = useState({
    pages: true,
    details: true
  });
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusDetailsRef = useRef(false);

  function togglePanel(panel: keyof typeof collapsedPanels) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel]
    }));
  }

  useEffect(() => {
    onPageEditorFocus(!collapsedPanels.details || Boolean(selectedPageId));
  }, [collapsedPanels.details, onPageEditorFocus, selectedPageId]);

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
              onClick={handleNewPage}
              type="button"
            >
              New Page
            </button>
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              onClick={onBulkCreate}
              type="button"
            >
              Bulk Create
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
              {!collapsedPanels.pages ? (
                <tr className="builder-pages-list-columns-row">
                  <th>Title</th>
                  <th>Slug</th>
                  <th>Template</th>
                  <th>Updated</th>
                  <th className="crud-actions-cell">Actions</th>
                </tr>
              ) : null}
            </thead>
            {!collapsedPanels.pages ? (
              <tbody>
                {pages.map((page) => {
                  const isSelected = page.id === selectedPageId;

                  return (
                    <tr className={isSelected ? "is-selected-row" : undefined} key={page.id}>
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
                            onClick={() => onPreviewPage(page.slug)}
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
                {pages.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={5}>No pages found.</td>
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
            <label className="field builder-meta-field-status">
              <span>Status</span>
              <select
                value={isPublishedPage ? "published" : "draft"}
                onChange={(event) => onSetIsPublished(event.target.value === "published")}
              >
                <option value="published">Published</option>
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
              />
              <div className="builder-theme-panel">
                <h3 className="builder-theme-panel-title">Theme · Typography</h3>
                <BuilderThemeTypographySettings theme={theme} onChange={onUpdateTheme} />
              </div>
            </div>
            <div className="builder-meta-grid-pages-actions">
              <button
                aria-label="Make Template"
                className="builder-icon-button"
                disabled={isSaving}
                onClick={onMakeTemplate}
                title="Make Template"
                type="button"
              >
                💾
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
