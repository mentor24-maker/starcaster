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

  const schema: BuilderSettingsSchema = {
    content: [
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
      // D1: Title and Rows/Search controls share one strip instead of two
      // short rows stacked down the left edge.
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
      ]
    ],
    // Real titled group (D5) — replaces the old bare <div> divider that
    // borrowed the breadcrumb label class. The `layout` slot is the ordering
    // slot that renders after `content`; the title is what the operator sees.
    layout: {
      title: "Row actions",
      strips: [
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
          },
          {
            key: "showAddButton",
            label: "Add",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: "renderCrmContactsTableModule"
          },
          // D3: joins the four selects instead of sitting orphaned on its
          // own row; still only appears while Add is set to Show.
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
    }
  };

  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
