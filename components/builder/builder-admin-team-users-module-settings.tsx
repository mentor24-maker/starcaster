"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderAdminTeamUsersModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const showTitle = (s.showTitle ?? "true") === "true";

  return (
    <div className="builder-crm-contacts-table-settings">
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
            value={s.tableTitle ?? "Team Members"}
            onChange={(e) => set("tableTitle", e.target.value)}
            placeholder="Team Members"
          />
        </BuilderSettingRow>
      )}

      <div className="builder-breadcrumb-items-label" style={{ marginTop: 12, marginBottom: 6 }}>
        Row actions
      </div>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
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

          {(s.showAddButton ?? "true") === "true" && (
            <BuilderSettingRow label="Add button label" fullWidth>
              <input
                type="text"
                value={s.addButtonLabel ?? "Add Team Member"}
                onChange={(e) => set("addButtonLabel", e.target.value)}
                placeholder="Add Team Member"
              />
            </BuilderSettingRow>
          )}
        </div>
      </div>
    </div>
  );
}
