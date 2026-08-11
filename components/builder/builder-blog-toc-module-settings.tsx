"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

export type TocItem = { id: string; label: string; anchor: string; depth: 1 | 2 };

export function parseTocItems(settings: Record<string, string>): TocItem[] {
  try {
    const parsed = JSON.parse(settings.items || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is TocItem => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

function serializeTocItems(items: TocItem[]): string {
  return JSON.stringify(items);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogTocModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const items = parseTocItems(module.settings);

  function persist(next: TocItem[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, items: serializeTocItems(next) }
    }));
  }

  function updateItem(id: string, field: keyof TocItem, value: string | 1 | 2) {
    persist(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function moveItem(id: string, direction: -1 | 1) {
    const index = items.findIndex((x) => x.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }

  function removeItem(id: string) {
    persist(items.filter((x) => x.id !== id));
  }

  function addItem(depth: 1 | 2) {
    persist([...items, { id: `toc-${Date.now()}-${items.length}`, label: "", anchor: "", depth }]);
  }

  const schema: BuilderSettingsSchema = {
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Structure / Text.
    // Same keys, fallbacks and visibleWhen rules — only the column each
    // control sits in changed. "Style" (marker) and "Indent H3s" describe how
    // the list is arranged, so they are Structure, not typography.
    //
    // A1 sort (2026-08-10): Link Color is the module's one theme-backed
    // setting, so it moved to Text's own Advanced section as a `theme-color`
    // override whose themeDefault is its old fallback (A2). Font Size is a
    // SIZE, not a theme override, so it stays basic — as do the title, the
    // heading manager and the two Structure selects (A4).
    //
    // SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
    // Everything above that "moved into Advanced" now sits LAST on the axis it
    // already names, ordered by D9 (blast radius, descending). The axis
    // assignments and the A2 theme-colour semantics are unchanged — only the
    // collapsing is gone. Kept rather than rewritten: the reasoning is the record.
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "showTitle",
              label: "Title",
              width: "select-md",
              control: "select",
              options: [
                { value: "true", label: "Show" },
                { value: "false", label: "Hide" }
              ],
              fallback: "true",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            },
            {
              key: "title",
              label: "Title Text",
              width: "text-md",
              control: "custom",
              rendersVia: "builder-module-card.tsx blog-toc preview",
              visibleWhen: (settings) => (settings.showTitle ?? "true") === "true",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.title ?? "In This Article"}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="In This Article"
                />
              )
            }
          ],
          [
            {
              key: "items",
              label: "Headings",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "builder-module-card.tsx blog-toc preview",
              render: () => (
                <>
                  <div className="builder-breadcrumb-items-label" style={{ marginTop: 12 }}>
                    Headings — H3s indent under the nearest H2
                  </div>
                  <div className="builder-slider-items">
                    {items.map((item, index) => (
                      <div
                        key={item.id}
                        className="builder-slider-item-card"
                        style={{ marginLeft: item.depth === 2 ? 16 : 0 }}
                      >
                        <div className="builder-slider-item-header">
                          <strong style={{ color: item.depth === 2 ? "#8ba9be" : undefined }}>
                            {item.depth === 2 ? "H3" : "H2"} {item.label || `Heading ${index + 1}`}
                          </strong>
                          <div className="builder-section-actions">
                            <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, -1)} title="Move up">↑</button>
                            <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, 1)} title="Move down">↓</button>
                            <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeItem(item.id)} title="Remove">✕</button>
                          </div>
                        </div>
                        <div className="builder-slider-item-grid">
                          <label className="field">
                            <span>Label</span>
                            <input
                              type="text"
                              value={item.label}
                              onChange={(e) => updateItem(item.id, "label", e.target.value)}
                              placeholder="Section heading text"
                            />
                          </label>
                          <label className="field">
                            <span>Anchor ID</span>
                            <input
                              type="text"
                              value={item.anchor}
                              onChange={(e) => updateItem(item.id, "anchor", e.target.value)}
                              placeholder="section-slug"
                            />
                          </label>
                          <label className="field">
                            <span>Level</span>
                            <select
                              value={item.depth}
                              onChange={(e) => updateItem(item.id, "depth", Number(e.target.value) as 1 | 2)}
                            >
                              <option value={1}>H2</option>
                              <option value={2}>H3 (sub)</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button type="button" className="secondary-button" onClick={() => addItem(1)}>
                      + H2
                    </button>
                    <button type="button" className="secondary-button" onClick={() => addItem(2)}>
                      + H3
                    </button>
                  </div>
                </>
              )
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "style",
              label: "Style",
              width: "select-md",
              control: "select",
              options: [
                { value: "default", label: "Default" },
                { value: "numbered", label: "Numbered" },
                { value: "dotted", label: "Dotted" }
              ],
              fallback: "default",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            },
            {
              key: "indentSubheadings",
              label: "Indent H3s",
              width: "select-md",
              control: "select",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" }
              ],
              fallback: "true",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
            {
              key: "fontSize",
              label: "Font Size",
              width: "num",
              control: "number",
              min: 11,
              max: 20,
              step: 1,
              fallback: "14",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            }
          ],
          [
            {
              key: "color",
              label: "Link Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Link color",
              themeDefault: "#0f4f8f",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            }
          ]
        ],
        // A2 theme override; colour sorts after size on Text (D9).
      }
    ]
  };

  return (
    <div className="builder-blog-toc-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
