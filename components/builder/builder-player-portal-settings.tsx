"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderProjectDataPicker } from "./builder-project-data-picker";
import { BuilderSettingRow } from "./builder-setting-row";

type BuilderPlayerPortalSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderPlayerPortalSettings({ module, onUpdateModule }: BuilderPlayerPortalSettingsProps) {
  const settings = module.settings;

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  return (
    <div className="builder-player-portal-settings">
      <div className="builder-player-portal-settings-row">
        <BuilderSettingRow label="Intro heading">
          <input
            type="text"
            value={module.text}
            onChange={(event) =>
              onUpdateModule((current) => ({
                ...current,
                text: event.target.value
              }))
            }
            placeholder="Sign in"
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Default mode">
          <select
            value={settings.defaultMode === "register" ? "register" : "login"}
            onChange={(event) => updateSetting("defaultMode", event.target.value)}
          >
            <option value="login">Login</option>
            <option value="register">Register</option>
          </select>
        </BuilderSettingRow>
        <BuilderSettingRow label="Show register">
          <select
            value={settings.showRegister === "false" ? "false" : "true"}
            onChange={(event) => updateSetting("showRegister", event.target.value)}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </BuilderSettingRow>
        <BuilderSettingRow label="Redirect path">
          {/* A page picked here is stored by id, so renaming it cannot break the redirect (task 86bcxu518). */}
          <BuilderProjectDataPicker
            source="pages"
            valueKind="path"
            value={settings.redirectPath ?? "/portal/dashboard"}
            onChange={(redirectPath) => updateSetting("redirectPath", redirectPath)}
            noneLabel="— Default (/portal/dashboard) —"
            placeholder="/portal/dashboard"
            ariaLabel="Redirect path"
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Forgot password">
          <select
            value={settings.showForgotPassword === "false" ? "false" : "true"}
            onChange={(event) => updateSetting("showForgotPassword", event.target.value)}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </BuilderSettingRow>
      </div>
      <div className="builder-module-runtime-note">
        <strong>Page copy</strong>
        <p>
          Add instructions and intro copy with a Text module in the column beside this form. Password reset
          completion still happens at <code>/portal/reset</code>.
        </p>
      </div>
    </div>
  );
}
