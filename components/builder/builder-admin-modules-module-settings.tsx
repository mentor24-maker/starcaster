"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderAdminModulesModuleSettings({ module, onUpdateModule }: Props) {
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
      <BuilderSettingRow label="Show title">
        <select value={s.showTitle ?? "true"} onChange={(e) => set("showTitle", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {showTitle && (
        <BuilderSettingRow label="Title text" fullWidth>
          <input
            type="text"
            value={s.tableTitle ?? "Premium Modules"}
            onChange={(e) => set("tableTitle", e.target.value)}
            placeholder="Premium Modules"
          />
        </BuilderSettingRow>
      )}

      <BuilderSettingRow label="Show toggle buttons">
        <select value={s.showToggle ?? "true"} onChange={(e) => set("showToggle", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide (read-only)</option>
        </select>
      </BuilderSettingRow>
    </div>
  );
}
