import type { BuilderPageRecord, BuilderSavedSectionRecord, BuilderTemplateRecord, BuilderThemeSummary } from "@/lib/builder-template";
import { useEffect, useMemo, useState } from "react";
import { CONTENT_DISPLAY_MODELS } from "./builder-content-models";
import type { BuilderMenuItem } from "./builder-menu";

type BulkCreateItem = {
  name: string;
  slug: string;
};

export type BulkCreateResult = {
  name: string;
  slug: string;
  page?: BuilderPageRecord;
  error?: string;
  contentExtracted?: boolean;
  contentNote?: string;
};

export type ExtractionPreviewItem = {
  name: string;
  slug: string;
  detected: boolean;
  blockCount: number;
  reason?: string;
  blocks?: Array<{ imageUrl: string; imageAlt: string; htmlPreview: string; layout: string }>;
};

export type AcquireRunSummary = {
  runId: string;
  sourceUrl: string;
  pageCount: number;
  createdAt: string;
  detectedModelId?: string;
};

type MenuOption = {
  id: string;
  label: string;
  items: BuilderMenuItem[];
};

type BuilderBulkCreateProps = {
  templates: BuilderTemplateRecord[];
  savedSections: BuilderSavedSectionRecord[];
  acquireRuns: AcquireRunSummary[];
  themes: BuilderThemeSummary[];
  onBack: () => void;
  onRefreshRuns?: () => void;
  onBulkCreatePages: (templateId: string, items: BulkCreateItem[], themeId?: string) => Promise<BulkCreateResult[]>;
  onBulkCreateWithModel: (
    templateId: string,
    items: BulkCreateItem[],
    contentModelId: string,
    runId: string,
    themeId?: string,
  ) => Promise<BulkCreateResult[]>;
  onPreviewExtraction?: (
    contentModelId: string,
    runId: string,
    items: BulkCreateItem[],
  ) => Promise<ExtractionPreviewItem[]>;
  onEditPage: (pageId: string) => void;
};

export function BuilderBulkCreate({
  templates,
  savedSections,
  acquireRuns,
  themes,
  onBack,
  onRefreshRuns,
  onBulkCreatePages,
  onBulkCreateWithModel,
  onPreviewExtraction,
  onEditPage,
}: BuilderBulkCreateProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedThemeId, setSelectedThemeId] = useState("");
  const [selectedMenuId, setSelectedMenuId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [results, setResults] = useState<BulkCreateResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewItems, setPreviewItems] = useState<ExtractionPreviewItem[]>([]);
  const [previewDone, setPreviewDone] = useState(false);

  // Refresh crawl runs when this panel mounts so the list is current.
  useEffect(() => { onRefreshRuns?.(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // When a run is selected and it has a detected model, auto-populate the model dropdown.
  useEffect(() => {
    if (!selectedRunId || selectedModelId) return;
    const run = acquireRuns.find((r) => r.runId === selectedRunId);
    if (run?.detectedModelId) setSelectedModelId(run.detectedModelId);
  }, [selectedRunId, acquireRuns]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Only show templates that have actual content sections (stubs with empty sections
  // are only meaningful in Page Details, not Bulk Create).
  const createableTemplates = useMemo(
    () => templates.filter((t) => t.layoutSections.length > 0),
    [templates],
  );

  const menuOptions = useMemo((): MenuOption[] => {
    const options: MenuOption[] = [];

    for (const template of templates) {
      for (const section of template.layoutSections) {
        for (const module of section.modules) {
          if (module.type === "navigation") {
            try {
              const items = JSON.parse(module.settings.navItems || "[]") as BuilderMenuItem[];
              if (items.length > 0) {
                options.push({
                  id: `template:${template.id}:module:${module.id}`,
                  label: `${template.name} / ${module.name || "Navigation"}`,
                  items,
                });
              }
            } catch {
              // skip invalid navItems JSON
            }
          }
        }
      }
    }

    for (const savedSection of savedSections) {
      for (const module of savedSection.section.modules) {
        if (module.type === "navigation") {
          try {
            const items = JSON.parse(module.settings.navItems || "[]") as BuilderMenuItem[];
            if (items.length > 0) {
              options.push({
                id: `saved:${savedSection.id}:module:${module.id}`,
                label: `${savedSection.name} / ${module.name || "Navigation"}`,
                items,
              });
            }
          } catch {
            // skip invalid navItems JSON
          }
        }
      }
    }

    return options;
  }, [templates, savedSections]);

  const selectedMenu = menuOptions.find((opt) => opt.id === selectedMenuId);
  const menuItems = selectedMenu?.items ?? [];
  const selectedTemplate = createableTemplates.find((t) => t.id === selectedTemplateId) ?? null;
  const useContentModel = Boolean(selectedModelId);

  function resetPreview() {
    setPreviewDone(false);
    setPreviewItems([]);
  }

  function handleMenuChange(menuId: string) {
    setSelectedMenuId(menuId);
    setGenerated(false);
    setResults([]);
    setError(null);
    resetPreview();
  }

  function handleModelChange(modelId: string) {
    setSelectedModelId(modelId);
    setGenerated(false);
    setResults([]);
    setError(null);
    resetPreview();
  }

  async function handleGenerate() {
    if (!selectedTemplateId) { setError("Select a template."); return; }
    if (!selectedMenuId) { setError("Select a pages menu."); return; }
    if (menuItems.length === 0) { setError("The selected pages menu has no items."); return; }
    if (useContentModel && !selectedRunId) { setError("Select a source website to use with this content model."); return; }

    const items: BulkCreateItem[] = menuItems.map((item) => {
      const pathSlug = item.href.startsWith("/")
        ? item.href.replace(/^\/+/, "").replace(/\/+$/, "")
        : "";
      const slug = pathSlug || item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return { name: item.label, slug };
    });

    setIsGenerating(true);
    setError(null);
    try {
      const themeArg = selectedThemeId || undefined;
      const res = useContentModel
        ? await onBulkCreateWithModel(selectedTemplateId, items, selectedModelId, selectedRunId, themeArg)
        : await onBulkCreatePages(selectedTemplateId, items, themeArg);
      setResults(res);
      setGenerated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate pages.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handlePreview() {
    if (!selectedTemplateId) { setError("Select a template."); return; }
    if (!selectedMenuId) { setError("Select a pages menu."); return; }
    if (menuItems.length === 0) { setError("The selected pages menu has no items."); return; }
    if (!selectedModelId) { setError("Select a content model."); return; }
    if (!selectedRunId) { setError("Select a source website."); return; }
    if (!onPreviewExtraction) return;

    const items: BulkCreateItem[] = menuItems.map((item) => {
      const pathSlug = item.href.startsWith("/")
        ? item.href.replace(/^\/+/, "").replace(/\/+$/, "")
        : "";
      const slug = pathSlug || item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return { name: item.label, slug };
    });

    setIsPreviewing(true);
    setError(null);
    resetPreview();
    try {
      const preview = await onPreviewExtraction(selectedModelId, selectedRunId, items);
      setPreviewItems(preview);
      setPreviewDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  }

  const successCount = results.filter((r) => r.page).length;
  const errorCount = results.filter((r) => r.error).length;
  const previewDetectedCount = previewItems.filter((p) => p.detected).length;

  return (
    <>
      <div className="builder-toolbar-shell builder-bulk-create-shell">
        <div className="builder-bulk-create-header">
          <button className="secondary-button builder-bulk-create-back" onClick={onBack} type="button">
            ← Pages
          </button>
          <h3 className="builder-bulk-create-title">Bulk Create Pages</h3>
        </div>

        {error ? <div className="notice error admin-notice builder-bulk-create-notice">{error}</div> : null}

        <div className="builder-bulk-create-form">
          <div className="builder-bulk-create-fields">
            <label className="field">
              <span>Source Website <span className="builder-bulk-create-optional">(optional)</span></span>
              <select
                value={selectedRunId}
                onChange={(e) => { setSelectedRunId(e.target.value); setGenerated(false); setResults([]); setError(null); resetPreview(); }}
              >
                <option value="">Select a source website</option>
                {acquireRuns.map((run) => (
                  <option key={run.runId} value={run.runId}>
                    {run.sourceUrl} — {run.pageCount} page{run.pageCount !== 1 ? "s" : ""}
                    {run.createdAt ? ` (${run.createdAt.slice(0, 10)})` : ""}
                  </option>
                ))}
              </select>
              {acquireRuns.length === 0 ? (
                <span className="builder-bulk-create-template-warning">
                  No crawl runs found. Run a web crawl from the Populate from Web page first.
                </span>
              ) : null}
            </label>

            <label className="field">
              <span>Pages Menu</span>
              <select value={selectedMenuId} onChange={(e) => handleMenuChange(e.target.value)}>
                <option value="">Select a menu</option>
                {menuOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Template</span>
              <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                <option value="">Select a template</option>
                {createableTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.layoutSections.length} section{template.layoutSections.length !== 1 ? "s" : ""})
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Theme <span className="builder-bulk-create-optional">(optional)</span></span>
              <select value={selectedThemeId} onChange={(e) => setSelectedThemeId(e.target.value)}>
                <option value="">Use template default</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Content Model <span className="builder-bulk-create-optional">(optional)</span></span>
              <select value={selectedModelId} onChange={(e) => handleModelChange(e.target.value)}>
                <option value="">None — create pages with template layout only</option>
                {CONTENT_DISPLAY_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {selectedModelId ? (
                <span className="builder-bulk-create-model-hint">
                  {CONTENT_DISPLAY_MODELS.find((m) => m.id === selectedModelId)?.description}
                </span>
              ) : null}
            </label>
          </div>

          {selectedRunId ? (
            <div className="builder-bulk-create-right">
              {(() => {
                const run = acquireRuns.find((r) => r.runId === selectedRunId);
                const detectedModel = run?.detectedModelId
                  ? CONTENT_DISPLAY_MODELS.find((m) => m.id === run.detectedModelId)
                  : null;
                return run ? (
                  <div className="builder-bulk-create-run-info">
                    <div className="builder-bulk-create-run-url">{run.sourceUrl}</div>
                    <div className="builder-bulk-create-run-meta">
                      {run.pageCount} page{run.pageCount !== 1 ? "s" : ""} crawled
                      {run.createdAt ? ` on ${run.createdAt.slice(0, 10)}` : ""}
                    </div>
                    {detectedModel ? (
                      <div className="builder-bulk-create-detected-model">
                        Auto-detected: {detectedModel.name}
                      </div>
                    ) : null}
                  </div>
                ) : null;
              })()}

              {menuItems.length > 0 ? (
                <>
                  <div className="builder-bulk-create-preview-label">
                    {menuItems.length} page{menuItems.length !== 1 ? "s" : ""} will be created
                    {useContentModel ? " with content extracted from source" : ""}
                  </div>
                  <ul className="builder-bulk-create-item-list">
                    {menuItems.map((item) => (
                      <li key={item.id || item.href} className="builder-bulk-create-item">
                        <span className="builder-bulk-create-item-name">{item.label}</span>
                        <code className="builder-bulk-create-item-slug">/{item.href.replace(/^\/+/, "")}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="builder-bulk-create-right-placeholder">Select a menu to see pages to be created.</div>
              )}
            </div>
          ) : null}
        </div>

        {menuItems.length > 0 && !generated ? (
          <div className="builder-bulk-create-actions">
            {useContentModel && onPreviewExtraction ? (
              <button
                className="secondary-button"
                disabled={isPreviewing || isGenerating || !selectedModelId || !selectedRunId}
                onClick={() => void handlePreview()}
                type="button"
              >
                {isPreviewing ? "Previewing…" : "Preview Extraction"}
              </button>
            ) : null}
            <button
              className="submit-button"
              disabled={isGenerating || !selectedTemplateId || (useContentModel && !selectedRunId)}
              onClick={() => void handleGenerate()}
              type="button"
            >
              {isGenerating ? "Generating..." : "Generate Pages"}
            </button>
          </div>
        ) : null}
      </div>

      {previewDone && previewItems.length > 0 ? (
        <div className="builder-toolbar-shell builder-bulk-create-preview-shell">
          <div className="builder-bulk-create-results-header">
            <span className="builder-bulk-create-results-summary">
              Extraction Preview — {previewDetectedCount}/{previewItems.length} page{previewItems.length !== 1 ? "s" : ""} matched
            </span>
          </div>
          <div className="table-shell">
            <table className="polls-table builder-bulk-create-preview-table">
              <colgroup>
                <col className="builder-bulk-create-col-title" />
                <col className="builder-bulk-create-col-status" />
                <col className="builder-bulk-create-col-content" />
              </colgroup>
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Detection</th>
                  <th>Blocks</th>
                </tr>
              </thead>
              <tbody>
                {previewItems.map((item, i) => (
                  <tr key={i} className={item.detected ? undefined : "builder-bulk-create-row-warn"}>
                    <td>
                      <strong>{item.name}</strong>
                      <br />
                      <code>/{item.slug}</code>
                    </td>
                    <td>
                      {item.detected ? (
                        <span className="builder-bulk-create-status-ok">✓ Detected</span>
                      ) : (
                        <span className="builder-bulk-create-status-warn" title={item.reason}>✗ Not detected</span>
                      )}
                    </td>
                    <td>
                      {item.detected && item.blocks ? (
                        <details className="builder-bulk-create-preview-blocks">
                          <summary>{item.blockCount} block{item.blockCount !== 1 ? "s" : ""}</summary>
                          <div className="builder-bulk-create-preview-block-list">
                            {item.blocks.map((b, j) => (
                              <div key={j} className="builder-bulk-create-preview-block">
                                <span className="builder-bulk-create-preview-block-layout">{b.layout}</span>
                                {b.imageUrl ? (
                                  <img
                                    src={b.imageUrl}
                                    alt={b.imageAlt || ""}
                                    className="builder-bulk-create-preview-block-img"
                                  />
                                ) : null}
                                <p className="builder-bulk-create-preview-block-html">
                                  {b.htmlPreview.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {generated && results.length > 0 ? (
        <div className="builder-toolbar-shell builder-bulk-create-results-shell">
          <div className="builder-bulk-create-results-header">
            <span className="builder-bulk-create-results-summary">
              {successCount} created{errorCount > 0 ? `, ${errorCount} failed` : ""}
            </span>
          </div>
          <div className="table-shell">
            <table className="polls-table builder-bulk-create-results-table">
              <colgroup>
                <col className="builder-bulk-create-col-title" />
                <col className="builder-bulk-create-col-slug" />
                <col className="builder-bulk-create-col-status" />
                {useContentModel ? <col className="builder-bulk-create-col-content" /> : null}
                <col className="builder-bulk-create-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Slug</th>
                  <th>Status</th>
                  {useContentModel ? <th>Content</th> : null}
                  <th className="crud-actions-cell">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, i) => (
                  <tr key={i} className={result.error ? "builder-bulk-create-row-error" : undefined}>
                    <td><strong>{result.name}</strong></td>
                    <td className="template-id-cell"><code>/{result.slug}</code></td>
                    <td>
                      {result.page ? (
                        <span className="builder-bulk-create-status-ok">Created</span>
                      ) : (
                        <span className="builder-bulk-create-status-error" title={result.error}>
                          {result.error ?? "Failed"}
                        </span>
                      )}
                    </td>
                    {useContentModel ? (
                      <td title={result.contentNote}>
                        {result.contentExtracted ? (
                          <span className="builder-bulk-create-status-ok">✓ Extracted</span>
                        ) : (
                          <span className="builder-bulk-create-status-warn">{result.contentNote ?? "Template only"}</span>
                        )}
                      </td>
                    ) : null}
                    <td className="crud-actions-cell">
                      <div className="builder-template-actions">
                        {result.page ? (
                          <button
                            aria-label="Edit page"
                            className="polls-icon-button polls-icon-button-edit"
                            onClick={() => onEditPage(result.page!.id)}
                            title="Edit page"
                            type="button"
                          >
                            ✎
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
