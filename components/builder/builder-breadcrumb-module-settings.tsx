"use client";

import { Fragment } from "react";
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

      <div className="builder-item-grid builder-item-grid--crumbs">
        <span className="builder-item-grid-header">Label</span>
        <span className="builder-item-grid-header">URL</span>
        <span className="builder-item-grid-header">Action</span>
        {items.map((item, index) => (
          <Fragment key={item.id}>
            <input
              type="text"
              value={item.label}
              onChange={(e) => updateItem(item.id, "label", e.target.value)}
              placeholder="Page name"
              aria-label={`Item ${index + 1} label`}
            />
            <input
              type="text"
              value={item.url}
              onChange={(e) => updateItem(item.id, "url", e.target.value)}
              placeholder={index === items.length - 1 ? "current page — leave blank" : "/path-or-url"}
              aria-label={`Item ${index + 1} URL`}
            />
            <div className="builder-item-grid-actions">
              <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, -1)} aria-label="Move Up" title="Move up">↑</button>
              <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, 1)} aria-label="Move Down" title="Move down">↓</button>
              <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeItem(item.id)} aria-label="Delete" title="Delete">✕</button>
            </div>
          </Fragment>
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
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Placement / Text.
    // Same keys, fallbacks and options — only the column each control sits in
    // changed. The separator character is something the module SHOWS, so it
    // joins the trail items on Content; Align gets the Placement column.
    //
    // A1 sort (2026-08-10): Link Color and Current Color are theme overrides,
    // so both moved to Text's own Advanced section as `theme-color` controls
    // whose themeDefault is their old fallback (A2). Size (a font SIZE) and
    // Bold stay on Text's basic row; the trail items, Separator and Align are
    // the module's own settings and stay basic (A4).
    axes: [
      {
        title: "Content",
        strips: [
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
          ],
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
            }
          ]
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            // D1/D3: Align is a lone small select — it joins the trail-styling
            // strip rather than stranding a row of its own. (It is a layout
            // setting; the merge is purely visual, the key is unchanged.)
            // D8 (8/10): axes give it the Placement column instead, so the
            // anti-orphan merge is no longer what holds it up — kept for the
            // history, and the key is still unchanged.
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
        ]
      },
      {
        title: "Text",
        strips: [
          [
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
              width: "check",
              control: "checkbox",
              fallback: "false",
              rendersVia: "builder-module-card breadcrumb preview"
            }
          ]
        ],
        // A1: both trail colours override the theme.
        advanced: [
          [
            {
              key: "color",
              label: "Link Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Link color",
              themeDefault: "#587592",
              rendersVia: "builder-module-card breadcrumb preview"
            },
            {
              key: "activeColor",
              label: "Current Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Current color",
              themeDefault: "#18324a",
              rendersVia: "builder-module-card breadcrumb preview"
            }
          ]
        ]
      }
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
