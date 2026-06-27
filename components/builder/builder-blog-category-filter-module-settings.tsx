"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";

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
  const s = module.settings;
  const categories = parseFilterCategories(s);

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

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

  return (
    <div className="builder-blog-category-filter-settings">

      {/* Display */}
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "pills"} onChange={(e) => set("layout", e.target.value)}>
              <option value="pills">Pills</option>
              <option value="list">List</option>
              <option value="dropdown">Dropdown</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Show 'All'">
            <select value={s.showAll ?? "true"} onChange={(e) => set("showAll", e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </BuilderSettingRow>

          {(s.showAll ?? "true") === "true" ? (
            <BuilderSettingRow label="'All' label">
              <input
                type="text"
                value={s.allLabel ?? "All"}
                onChange={(e) => set("allLabel", e.target.value)}
                placeholder="All"
              />
            </BuilderSettingRow>
          ) : null}

          <BuilderSettingRow label="Alignment">
            <select value={s.alignment ?? "left"} onChange={(e) => set("alignment", e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderThemeColorSettingRow
            fallback="#0f4f8f"
            label="Active color"
            themeColors={themeColors}
            value={s.activeColor ?? "#0f4f8f"}
            onChange={(activeColor) => set("activeColor", activeColor)}
          />

          <BuilderThemeColorSettingRow
            fallback="#e8f6fc"
            label="Active bg"
            themeColors={themeColors}
            value={s.activeBg ?? "#e8f6fc"}
            onChange={(activeBg) => set("activeBg", activeBg)}
          />

          <BuilderThemeColorSettingRow
            fallback="#587592"
            label="Inactive color"
            themeColors={themeColors}
            value={s.inactiveColor ?? "#587592"}
            onChange={(inactiveColor) => set("inactiveColor", inactiveColor)}
          />

          <BuilderThemeColorSettingRow
            fallback="#f0f4f8"
            label="Inactive bg"
            themeColors={themeColors}
            value={s.inactiveBg ?? "#f0f4f8"}
            onChange={(inactiveBg) => set("inactiveBg", inactiveBg)}
          />

          <BuilderSettingRow label="Border radius (px)">
            <input
              type="number" min={0} max={32} step={2}
              value={s.borderRadius ?? "20"}
              onChange={(e) => set("borderRadius", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Font size (px)">
            <input
              type="number" min={10} max={20} step={1}
              value={s.fontSize ?? "13"}
              onChange={(e) => set("fontSize", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Gap (px)">
            <input
              type="number" min={4} max={24} step={2}
              value={s.gap ?? "8"}
              onChange={(e) => set("gap", e.target.value)}
            />
          </BuilderSettingRow>
        </div>
      </div>

      {/* Routing */}
      <BuilderSettingRow label="URL param" fullWidth>
        <input
          type="text"
          value={s.filterParam ?? "category"}
          onChange={(e) => set("filterParam", e.target.value)}
          placeholder="category"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Target page" fullWidth>
        <input
          type="text"
          value={s.targetPageUrl ?? ""}
          onChange={(e) => set("targetPageUrl", e.target.value)}
          placeholder="Leave blank to filter on the current page"
        />
      </BuilderSettingRow>

      {/* Categories list */}
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
    </div>
  );
}
