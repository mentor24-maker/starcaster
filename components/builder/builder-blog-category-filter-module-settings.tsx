"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

export type FilterCategory = { id: string; label: string; slug: string };

export function parseFilterCategories(settings: Record<string, string>): FilterCategory[] {
  try {
    const parsed = JSON.parse(settings.categories || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is FilterCategory => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

function serializeFilterCategories(cats: FilterCategory[]): string {
  return JSON.stringify(cats);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogCategoryFilterModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const categories = parseFilterCategories(module.settings);

  function persist(next: FilterCategory[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, categories: serializeFilterCategories(next) }
    }));
  }

  function updateCat(id: string, field: keyof FilterCategory, value: string) {
    persist(categories.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }

  function moveCat(id: string, direction: -1 | 1) {
    const index = categories.findIndex((c) => c.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= categories.length) return;
    const next = [...categories];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }

  function removeCat(id: string) {
    persist(categories.filter((c) => c.id !== id));
  }

  function addCat() {
    persist([...categories, { id: `cat-${Date.now()}`, label: "", slug: "" }]);
  }

  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "showAll",
          label: "Show 'All'",
          width: "select-sm",
          control: "select",
          fallback: "true",
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" }
          ]
        },
        {
          key: "allLabel",
          label: "'All' Label",
          width: "text-md",
          control: "custom",
          visibleWhen: (settings) => (settings.showAll ?? "true") === "true",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.allLabel ?? "All"}
              onChange={(e) => set("allLabel", e.target.value)}
              placeholder="All"
            />
          )
        }
      ],
      [
        {
          key: "categories",
          label: "Categories",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <>
              <div className="builder-breadcrumb-items-label" style={{ marginTop: 12 }}>
                Categories
              </div>
              <div className="builder-slider-items">
                {categories.map((cat, index) => (
                  <div key={cat.id} className="builder-slider-item-card">
                    <div className="builder-slider-item-header">
                      <strong>{cat.label || `Category ${index + 1}`}</strong>
                      <div className="builder-section-actions">
                        <button type="button" className="builder-icon-button" onClick={() => moveCat(cat.id, -1)} title="Move left">↑</button>
                        <button type="button" className="builder-icon-button" onClick={() => moveCat(cat.id, 1)} title="Move right">↓</button>
                        <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeCat(cat.id)} title="Remove">✕</button>
                      </div>
                    </div>
                    <div className="builder-slider-item-grid">
                      <label className="field">
                        <span>Label</span>
                        <input
                          type="text"
                          value={cat.label}
                          onChange={(e) => updateCat(cat.id, "label", e.target.value)}
                          placeholder="Technology"
                        />
                      </label>
                      <label className="field">
                        <span>Slug</span>
                        <input
                          type="text"
                          value={cat.slug}
                          onChange={(e) => updateCat(cat.id, "slug", e.target.value)}
                          placeholder="technology"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="secondary-button" onClick={addCat}>
                Add Category
              </button>
            </>
          )
        }
      ]
    ],
    layout: [
      [
        {
          key: "layout",
          label: "Layout",
          width: "select-md",
          control: "select",
          fallback: "pills",
          options: [
            { value: "pills", label: "Pills" },
            { value: "list", label: "List" },
            { value: "dropdown", label: "Dropdown" }
          ]
        },
        {
          key: "alignment",
          label: "Alignment",
          width: "align",
          control: "align",
          ariaLabel: "Category filter alignment",
          fallback: "left"
        },
        { key: "gap", label: "Gap", width: "num", control: "number", min: 4, max: 24, step: 2, fallback: "8" }
      ]
    ],
    style: [
      [
        { key: "activeColor", label: "Active", width: "color", control: "color", dialogLabel: "Active color", fallback: "#0f4f8f" },
        { key: "activeBg", label: "Active BG", width: "color", control: "color", dialogLabel: "Active background", fallback: "#e8f6fc" },
        { key: "inactiveColor", label: "Inactive", width: "color", control: "color", dialogLabel: "Inactive color", fallback: "#587592" },
        { key: "inactiveBg", label: "Inactive BG", width: "color", control: "color", dialogLabel: "Inactive background", fallback: "#f0f4f8" }
      ],
      [
        { key: "borderRadius", label: "Radius", width: "num", control: "number", min: 0, max: 32, step: 2, fallback: "20" },
        { key: "fontSize", label: "Font Size", width: "num", control: "number", min: 10, max: 20, step: 1, fallback: "13" }
      ]
    ],
    advanced: [
      [
        {
          key: "filterParam",
          label: "URL Param",
          width: "text-md",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.filterParam ?? "category"}
              onChange={(e) => set("filterParam", e.target.value)}
              placeholder="category"
            />
          )
        }
      ],
      [
        {
          key: "targetPageUrl",
          label: "Target Page",
          width: "full",
          control: "text",
          placeholder: "Leave blank to filter on the current page"
        }
      ]
    ]
  };

  return (
    <div className="builder-blog-category-filter-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
