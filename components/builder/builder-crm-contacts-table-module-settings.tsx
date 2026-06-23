"use client";

import { useEffect, useState } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderCrmContactsTableModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;
  const [configs, setConfigs] = useState<{ id: string; name: string }[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(true);

  useEffect(() => {
    const projectId =
      (window as unknown as { App?: { projectContext?: { getSessionProjectId?: () => string } } })
        ?.App?.projectContext?.getSessionProjectId?.() ?? "";
    const headers: Record<string, string> = {};
    if (projectId) headers["X-Project-ID"] = projectId;
    fetch("/api/crm/configs", { headers })
      .then((r) => r.json())
      .then((d) => {
        const list = d?.configs ?? d?.data ?? [];
        setConfigs(Array.isArray(list) ? list : []);
      })
      .catch(() => {})
      .finally(() => setLoadingConfigs(false));
  }, []);

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const showTitle = (s.showTitle ?? "true") === "true";
  const showAddButton = (s.showAddButton ?? "true") === "true";

  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSettingRow label="CRM Config" fullWidth>
        {loadingConfigs ? (
          <select disabled><option>Loading…</option></select>
        ) : configs.length === 0 ? (
          <div className="builder-module-runtime-note" style={{ marginTop: 0 }}>
            <p>No CRM found. Set one up in <strong>Builder › CRM</strong>.</p>
          </div>
        ) : (
          <select value={s.crmConfigId ?? ""} onChange={(e) => set("crmConfigId", e.target.value)}>
            <option value="">— Auto-detect from project —</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
        )}
      </BuilderSettingRow>

      <BuilderSettingRow label="Show table title">
        <select value={s.showTitle ?? "true"} onChange={(e) => set("showTitle", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {showTitle && (
        <BuilderSettingRow label="Title text" fullWidth>
          <input
            type="text"
            value={s.tableTitle ?? "Contacts"}
            onChange={(e) => set("tableTitle", e.target.value)}
            placeholder="Contacts"
          />
        </BuilderSettingRow>
      )}

      <BuilderSettingRow label="Rows per page">
        <select value={s.rowsPerPage ?? "20"} onChange={(e) => set("rowsPerPage", e.target.value)}>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Search bar">
        <select value={s.showSearch ?? "true"} onChange={(e) => set("showSearch", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      <div className="builder-breadcrumb-items-label" style={{ marginTop: 12, marginBottom: 6 }}>
        Row actions
      </div>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="View button">
            <select value={s.showViewButton ?? "true"} onChange={(e) => set("showViewButton", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Edit button">
            <select value={s.showEditButton ?? "true"} onChange={(e) => set("showEditButton", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Delete button">
            <select value={s.showDeleteButton ?? "true"} onChange={(e) => set("showDeleteButton", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Add button">
            <select value={s.showAddButton ?? "true"} onChange={(e) => set("showAddButton", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          {showAddButton && (
            <BuilderSettingRow label="Add button label">
              <input
                type="text"
                value={s.addButtonLabel ?? "Add Contact"}
                onChange={(e) => set("addButtonLabel", e.target.value)}
                placeholder="Add Contact"
              />
            </BuilderSettingRow>
          )}
        </div>
      </div>
    </div>
  );
}
