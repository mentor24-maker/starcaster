"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

export type BreadcrumbItem = { id: string; label: string; url: string };

export function parseBreadcrumbItems(settings: Record<string, string>): BreadcrumbItem[] {
  try {
    const parsed = JSON.parse(settings.items || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is BreadcrumbItem => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

function serializeBreadcrumbItems(items: BreadcrumbItem[]): string {
  return JSON.stringify(items);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBreadcrumbModuleSettings({ module, onUpdateModule }: Props) {
  const settings = module.settings;
  const items = parseBreadcrumbItems(settings);

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function persistItems(nextItems: BreadcrumbItem[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, items: serializeBreadcrumbItems(nextItems) }
    }));
  }

  function updateItem(id: string, field: keyof BreadcrumbItem, value: string) {
    persistItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function moveItem(id: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persistItems(next);
  }

  function removeItem(id: string) {
    persistItems(items.filter((item) => item.id !== id));
  }

  function addItem() {
    const id = `crumb-${Date.now()}-${items.length + 1}`;
    persistItems([...items, { id, label: "", url: "" }]);
  }

  return (
    <div className="builder-breadcrumb-module-settings">
      <div className="builder-breadcrumb-style-grid">
        <BuilderSettingRow label="Separator">
          <input
            type="text"
            maxLength={4}
            value={settings.separator ?? "›"}
            onChange={(e) => updateSetting("separator", e.target.value)}
            style={{ width: 48 }}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Size (px)">
          <input
            type="number"
            min={10}
            max={32}
            step={1}
            value={settings.fontSize ?? "14"}
            onChange={(e) => updateSetting("fontSize", e.target.value)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Link color">
          <input
            type="color"
            value={settings.color ?? "#587592"}
            onChange={(e) => updateSetting("color", e.target.value)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Current color">
          <input
            type="color"
            value={settings.activeColor ?? "#18324a"}
            onChange={(e) => updateSetting("activeColor", e.target.value)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Bold">
          <select
            value={settings.bold ?? "false"}
            onChange={(e) => updateSetting("bold", e.target.value)}
          >
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </BuilderSettingRow>
        <BuilderSettingRow label="Align">
          <select
            value={settings.alignment ?? "left"}
            onChange={(e) => updateSetting("alignment", e.target.value)}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </BuilderSettingRow>
      </div>

      <div className="builder-breadcrumb-items-label">Trail items — last item is the current page</div>

      <div className="builder-slider-items">
        {items.map((item, index) => (
          <div key={item.id} className="builder-slider-item-card">
            <div className="builder-slider-item-header">
              <strong>{item.label || `Item ${index + 1}`}</strong>
              <div className="builder-section-actions">
                <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, -1)} title="Move left">↑</button>
                <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, 1)} title="Move right">↓</button>
                <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeItem(item.id)} title="Remove">✕</button>
              </div>
            </div>
            <div className="builder-slider-item-grid">
              <label className="field">
                <span>Label</span>
                <input type="text" value={item.label} onChange={(e) => updateItem(item.id, "label", e.target.value)} placeholder="Page name" />
              </label>
              <label className="field">
                <span>URL{index === items.length - 1 ? " (current — leave blank)" : ""}</span>
                <input
                  type="text"
                  value={item.url}
                  onChange={(e) => updateItem(item.id, "url", e.target.value)}
                  placeholder={index === items.length - 1 ? "" : "/path-or-url"}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="secondary-button" onClick={addItem}>
        Add Crumb
      </button>
    </div>
  );
}
