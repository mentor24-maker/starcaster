"use client";

import { useEffect, useState } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderCrmContactsTableModuleSettings({ module, onUpdateModule }: Props) {
  const [configs, setConfigs] = useState<{ id: string; name: string }[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(true);

  useEffect(() => {
    fetch("/api/crm/configs", { credentials: "include", headers: starcasterScopedHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const list = d?.configs ?? d?.data ?? [];
        setConfigs(Array.isArray(list) ? list : []);
      })
      .catch(() => {})
      .finally(() => setLoadingConfigs(false));
  }, []);

  /**
   * D8 logical axes (docs/UI_RULES.md): Content / Structure.
   *
   * PAIRING RULE — do not re-split: a toggle that gates ONE specific sibling
   * field (`showTitle` → `tableTitle`, `showAddButton` → `addButtonLabel`) is
   * one control pair and stays adjacent in the same strip, toggle first, on
   * the axis where the field belongs. Only toggles gating a whole region with
   * no sibling field (`showSearch`, `showViewButton`, `showEditButton`,
   * `showDeleteButton`) stay on Structure, alongside the page size. Keys,
   * fallbacks, options, visibleWhen and labels are unchanged.
   *
   * A1 SORT (2026-08-10): no theme overrides in this panel. The CRM config
   * picker, the title/button copy, the rows-per-page count and the five
   * visibility toggles are all content and structure — none of them
   * second-guesses a theme value — so nothing moves to Advanced (A4).
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "crmConfigId",
              label: "CRM Config",
              width: "full",
              control: "custom",
              rendersVia: "renderCrmContactsTableModule",
              render: (ctx) =>
                loadingConfigs ? (
                  <select disabled><option>Loading…</option></select>
                ) : configs.length === 0 ? (
                  <div className="builder-module-runtime-note" style={{ marginTop: 0 }}>
                    <p>No CRM found. Set one up in <strong>Builder › CRM</strong>.</p>
                  </div>
                ) : (
                  <select value={ctx.settings.crmConfigId ?? ""} onChange={(e) => ctx.set("crmConfigId", e.target.value)}>
                    <option value="">— Auto-detect from project —</option>
                    {configs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name || c.id}</option>
                    ))}
                  </select>
                )
            }
          ],
          [
            {
              key: "showTitle",
              label: "Table Title",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "renderCrmContactsTableModule"
            },
            {
              key: "tableTitle",
              label: "Title Text",
              width: "text-md",
              control: "custom",
              visibleWhen: (settings) => (settings.showTitle ?? "true") === "true",
              rendersVia: "renderCrmContactsTableModule",
              // The default text shows as the editable value (matching the render
              // fallback), not as a placeholder — pre-schema behavior kept.
              render: (ctx) => (
                <input
                  type="text"
                  value={ctx.settings.tableTitle ?? "Contacts"}
                  onChange={(e) => ctx.set("tableTitle", e.target.value)}
                  placeholder="Contacts"
                />
              )
            },
            {
              key: "showAddButton",
              label: "Add",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "renderCrmContactsTableModule"
            },
            {
              key: "addButtonLabel",
              label: "Add Button Label",
              width: "text-md",
              control: "custom",
              visibleWhen: (settings) => (settings.showAddButton ?? "true") === "true",
              rendersVia: "renderCrmContactsTableModule",
              render: (ctx) => (
                <input
                  type="text"
                  value={ctx.settings.addButtonLabel ?? "Add Contact"}
                  onChange={(e) => ctx.set("addButtonLabel", e.target.value)}
                  placeholder="Add Contact"
                />
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
              key: "rowsPerPage",
              label: "Rows Per Page",
              width: "select-sm",
              control: "select",
              options: [
                { value: "10", label: "10" },
                { value: "20", label: "20" },
                { value: "50", label: "50" },
                { value: "100", label: "100" }
              ],
              fallback: "20",
              rendersVia: "renderCrmContactsTableModule"
            },
            {
              key: "showSearch",
              label: "Search Bar",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "renderCrmContactsTableModule"
            }
          ],
          [
            {
              key: "showViewButton",
              label: "View",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "renderCrmContactsTableModule"
            },
            {
              key: "showEditButton",
              label: "Edit",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "renderCrmContactsTableModule"
            },
            {
              key: "showDeleteButton",
              label: "Delete",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "renderCrmContactsTableModule"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
