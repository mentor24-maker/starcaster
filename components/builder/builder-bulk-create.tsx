import type { BuilderPageRecord, BuilderSavedSectionRecord, BuilderTemplateRecord } from "@/lib/builder-template";
import { useMemo, useState } from "react";
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
};

type MenuOption = {
  id: string;
  label: string;
  items: BuilderMenuItem[];
};

type BuilderBulkCreateProps = {
  templates: BuilderTemplateRecord[];
  savedSections: BuilderSavedSectionRecord[];
  onBack: () => void;
  onBulkCreatePages: (templateId: string, items: BulkCreateItem[]) => Promise<BulkCreateResult[]>;
  onEditPage: (pageId: string) => void;
};

export function BuilderBulkCreate({
  templates,
  savedSections,
  onBack,
  onBulkCreatePages,
  onEditPage,
}: BuilderBulkCreateProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedMenuId, setSelectedMenuId] = useState("");
  const [results, setResults] = useState<BulkCreateResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);

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

  function handleMenuChange(menuId: string) {
    setSelectedMenuId(menuId);
    setGenerated(false);
    setResults([]);
    setError(null);
  }

  async function handleGenerate() {
    if (!selectedTemplateId) { setError("Select a template."); return; }
    if (!selectedMenuId) { setError("Select a menu."); return; }
    if (menuItems.length === 0) { setError("The selected menu has no items."); return; }

    const items: BulkCreateItem[] = menuItems.map((item) => ({
      name: item.label,
      slug: item.href.replace(/^\/+/, "").replace(/\/+$/, ""),
    }));

    setIsGenerating(true);
    setError(null);
    try {
      const res = await onBulkCreatePages(selectedTemplateId, items);
      setResults(res);
      setGenerated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate pages.");
    } finally {
      setIsGenerating(false);
    }
  }

  const successCount = results.filter((r) => r.page).length;
  const errorCount = results.filter((r) => r.error).length;

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
          <label className="field">
            <span>Template</span>
            <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
              <option value="">Select a template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Menu</span>
            <select value={selectedMenuId} onChange={(e) => handleMenuChange(e.target.value)}>
              <option value="">Select a menu</option>
              {menuOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {menuItems.length > 0 && !generated ? (
          <div className="builder-bulk-create-preview">
            <div className="builder-bulk-create-preview-label">
              {menuItems.length} page{menuItems.length !== 1 ? "s" : ""} will be created
            </div>
            <ul className="builder-bulk-create-item-list">
              {menuItems.map((item) => (
                <li key={item.id || item.href} className="builder-bulk-create-item">
                  <span className="builder-bulk-create-item-name">{item.label}</span>
                  <code className="builder-bulk-create-item-slug">/{item.href.replace(/^\/+/, "")}</code>
                </li>
              ))}
            </ul>
            <div className="builder-bulk-create-actions">
              <button
                className="submit-button"
                disabled={isGenerating || !selectedTemplateId}
                onClick={() => void handleGenerate()}
                type="button"
              >
                {isGenerating ? "Generating..." : "Generate Pages"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

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
                <col className="builder-bulk-create-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Slug</th>
                  <th>Status</th>
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
