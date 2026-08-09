"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSchemaFieldContext,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

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
  themeColors?: BuilderThemePalette;
};

/** Bespoke trail-item manager — stays custom; the scalar controls live in the schema. */
function BreadcrumbItemsManager({ settings, set }: BuilderSchemaFieldContext) {
  const items = parseBreadcrumbItems(settings);

  function persistItems(nextItems: BreadcrumbItem[]) {
    set("items", serializeBreadcrumbItems(nextItems));
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
    <>
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
    </>
  );
}

export function BuilderBreadcrumbModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "items",
          label: "Trail items",
          width: "full",
          control: "custom",
          bare: true,
          rendersVia: "parseBreadcrumbItems",
          render: (ctx) => <BreadcrumbItemsManager {...ctx} />
        }
      ]
    ],
    layout: [
      [
        {
          key: "alignment",
          label: "Align",
          width: "select-sm",
          control: "select",
          options: [
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" }
          ],
          fallback: "left",
          rendersVia: "builder-module-card breadcrumb preview"
        }
      ]
    ],
    style: [
      [
        {
          key: "separator",
          label: "Separator",
          width: "auto",
          control: "custom",
          rendersVia: "builder-module-card breadcrumb preview",
          render: (ctx) => (
            <input
              type="text"
              maxLength={4}
              value={ctx.settings.separator ?? "›"}
              onChange={(e) => ctx.set("separator", e.target.value)}
              style={{ width: 48 }}
            />
          )
        },
        {
          key: "fontSize",
          label: "Size",
          width: "num",
          control: "number",
          min: 10,
          max: 32,
          fallback: "14",
          rendersVia: "builder-module-card breadcrumb preview"
        },
        {
          key: "bold",
          label: "Bold",
          width: "select-sm",
          control: "select",
          options: [
            { value: "false", label: "Off" },
            { value: "true", label: "On" }
          ],
          fallback: "false",
          rendersVia: "builder-module-card breadcrumb preview"
        }
      ],
      [
        {
          key: "color",
          label: "Link Color",
          width: "color",
          control: "color",
          dialogLabel: "Link color",
          fallback: "#587592",
          rendersVia: "builder-module-card breadcrumb preview"
        },
        {
          key: "activeColor",
          label: "Current Color",
          width: "color",
          control: "color",
          dialogLabel: "Current color",
          fallback: "#18324a",
          rendersVia: "builder-module-card breadcrumb preview"
        }
      ]
    ]
  };

  return (
    <div className="builder-breadcrumb-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
