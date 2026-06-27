"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";

export type CloudTag = { id: string; label: string; slug: string; count?: number };

export function parseCloudTags(settings: Record<string, string>): CloudTag[] {
  try {
    const parsed = JSON.parse(settings.tags || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is CloudTag => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

function serializeCloudTags(tags: CloudTag[]): string {
  return JSON.stringify(tags);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogTagCloudModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const s = module.settings;
  const tags = parseCloudTags(s);
  const isCloud = (s.layout ?? "cloud") === "cloud";

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function persist(next: CloudTag[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, tags: serializeCloudTags(next) }
    }));
  }

  function updateTag(id: string, field: keyof CloudTag, value: string | number) {
    persist(tags.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }

  function moveTag(id: string, direction: -1 | 1) {
    const index = tags.findIndex((t) => t.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= tags.length) return;
    const next = [...tags];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }

  function removeTag(id: string) {
    persist(tags.filter((t) => t.id !== id));
  }

  function addTag() {
    persist([...tags, { id: `tag-${Date.now()}`, label: "", slug: "", count: 1 }]);
  }

  return (
    <div className="builder-blog-tag-cloud-settings">

      {/* Display */}
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "cloud"} onChange={(e) => set("layout", e.target.value)}>
              <option value="cloud">Cloud (sized by count)</option>
              <option value="pills">Pills (uniform)</option>
              <option value="list">List</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Show counts">
            <select value={s.showCounts ?? "false"} onChange={(e) => set("showCounts", e.target.value)}>
              <option value="false">Hide</option>
              <option value="true">Show</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Alignment">
            <select value={s.alignment ?? "left"} onChange={(e) => set("alignment", e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Gap (px)">
            <input
              type="number" min={4} max={24} step={2}
              value={s.gap ?? "8"}
              onChange={(e) => set("gap", e.target.value)}
            />
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          {isCloud ? (
            <>
              <BuilderSettingRow label="Min font (px)">
                <input
                  type="number" min={10} max={18} step={1}
                  value={s.minFontSize ?? "12"}
                  onChange={(e) => set("minFontSize", e.target.value)}
                />
              </BuilderSettingRow>
              <BuilderSettingRow label="Max font (px)">
                <input
                  type="number" min={14} max={36} step={2}
                  value={s.maxFontSize ?? "22"}
                  onChange={(e) => set("maxFontSize", e.target.value)}
                />
              </BuilderSettingRow>
            </>
          ) : null}

          <BuilderThemeColorSettingRow
            fallback="#587592"
            label="Tag color"
            themeColors={themeColors}
            value={s.inactiveColor ?? "#587592"}
            onChange={(inactiveColor) => set("inactiveColor", inactiveColor)}
          />

          <BuilderThemeColorSettingRow
            fallback="#f0f4f8"
            label="Tag bg"
            themeColors={themeColors}
            value={s.inactiveBg ?? "#f0f4f8"}
            onChange={(inactiveBg) => set("inactiveBg", inactiveBg)}
          />

          <BuilderThemeColorSettingRow
            fallback="#0f4f8f"
            label="Active color"
            themeColors={themeColors}
            value={s.activeColor ?? "#0f4f8f"}
            onChange={(activeColor) => set("activeColor", activeColor)}
          />
        </div>
      </div>

      {/* Routing */}
      <BuilderSettingRow label="URL param" fullWidth>
        <input
          type="text"
          value={s.filterParam ?? "tag"}
          onChange={(e) => set("filterParam", e.target.value)}
          placeholder="tag"
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

      {/* Tag list */}
      <div className="builder-breadcrumb-items-label" style={{ marginTop: 12 }}>Tags</div>

      <div className="builder-slider-items">
        {tags.map((tag, index) => (
          <div key={tag.id} className="builder-slider-item-card">
            <div className="builder-slider-item-header">
              <strong>{tag.label || `Tag ${index + 1}`}</strong>
              <div className="builder-section-actions">
                <button type="button" className="builder-icon-button" onClick={() => moveTag(tag.id, -1)}>↑</button>
                <button type="button" className="builder-icon-button" onClick={() => moveTag(tag.id, 1)}>↓</button>
                <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeTag(tag.id)}>✕</button>
              </div>
            </div>
            <div className="builder-slider-item-grid">
              <label className="field">
                <span>Label</span>
                <input
                  type="text"
                  value={tag.label}
                  onChange={(e) => updateTag(tag.id, "label", e.target.value)}
                  placeholder="react"
                />
              </label>
              <label className="field">
                <span>Slug</span>
                <input
                  type="text"
                  value={tag.slug}
                  onChange={(e) => updateTag(tag.id, "slug", e.target.value)}
                  placeholder="react"
                />
              </label>
              {isCloud ? (
                <label className="field">
                  <span>Count / weight</span>
                  <input
                    type="number" min={1} max={999}
                    value={tag.count ?? 1}
                    onChange={(e) => updateTag(tag.id, "count", parseInt(e.target.value, 10) || 1)}
                  />
                </label>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="secondary-button" onClick={addTag}>
        Add Tag
      </button>
    </div>
  );
}
