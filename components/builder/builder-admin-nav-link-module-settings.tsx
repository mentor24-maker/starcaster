"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderAdminNavLinkModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSettingRow label="Link text" fullWidth>
        <input
          type="text"
          value={s.linkText ?? "Admin"}
          onChange={(e) => set("linkText", e.target.value)}
          placeholder="Admin"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Link URL" fullWidth>
        <input
          type="text"
          value={s.linkHref ?? "/admin-login"}
          onChange={(e) => set("linkHref", e.target.value)}
          placeholder="/admin-login"
        />
      </BuilderSettingRow>
    </div>
  );
}
