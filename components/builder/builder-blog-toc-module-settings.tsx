"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

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
};

export function BuilderBlogTocModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;
  const items = parseTocItems(s);

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

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

  return (
    <div className="builder-blog-toc-settings">

      {/* Title */}
      <BuilderSettingRow label="Show title">
        <select value={s.showTitle ?? "true"} onChange={(e) => set("showTitle", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {(s.showTitle ?? "true") === "true" ? (
        <BuilderSettingRow label="Title text" fullWidth>
          <input
            type="text"
            value={s.title ?? "In This Article"}
            onChange={(e) => set("title", e.target.value)}
            placeholder="In This Article"
          />
        </BuilderSettingRow>
      ) : null}

      {/* Style */}
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Style">
            <select value={s.style ?? "default"} onChange={(e) => set("style", e.target.value)}>
              <option value="default">Default</option>
              <option value="numbered">Numbered</option>
              <option value="dotted">Dotted</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Indent subheadings">
            <select value={s.indentSubheadings ?? "true"} onChange={(e) => set("indentSubheadings", e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Font size (px)">
            <input
              type="number"
              min={11}
              max={20}
              step={1}
              value={s.fontSize ?? "14"}
              onChange={(e) => set("fontSize", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Link color">
            <input
              type="color"
              value={s.color ?? "#0f4f8f"}
              onChange={(e) => set("color", e.target.value)}
            />
          </BuilderSettingRow>
        </div>
      </div>

      {/* Items */}
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
    </div>
  );
}
