"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderAdminLoginModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSettingRow label="Form title" fullWidth>
        <input
          type="text"
          value={s.formTitle ?? "Admin Sign In"}
          onChange={(e) => set("formTitle", e.target.value)}
          placeholder="Admin Sign In"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Button text" fullWidth>
        <input
          type="text"
          value={s.buttonText ?? "Sign In"}
          onChange={(e) => set("buttonText", e.target.value)}
          placeholder="Sign In"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Forgot password link">
        <select value={s.showForgotPassword ?? "true"} onChange={(e) => set("showForgotPassword", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>
    </div>
  );
}
