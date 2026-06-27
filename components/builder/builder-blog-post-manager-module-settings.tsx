"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogPostManagerModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  return (
    <div className="builder-blog-post-manager-settings">
      <BuilderSettingRow label="Edit page URL" fullWidth>
        <input
          type="text"
          value={s.editPageUrl ?? ""}
          onChange={(e) => set("editPageUrl", e.target.value)}
          placeholder="/builder-preview.html?slug=blog-post-edit"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="View page URL" fullWidth>
        <input
          type="text"
          value={s.viewPageUrl ?? ""}
          onChange={(e) => set("viewPageUrl", e.target.value)}
          placeholder="/builder-preview.html?slug=blog-post-view"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Show status">
        <select value={s.showStatus ?? "true"} onChange={(e) => set("showStatus", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Show date">
        <select value={s.showDate ?? "true"} onChange={(e) => set("showDate", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Show delete">
        <select value={s.showDelete ?? "true"} onChange={(e) => set("showDelete", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      <BuilderThemeColorSettingRow
        fallback="#0f4f8f"
        label="Accent color"
        themeColors={themeColors}
        value={s.accentColor ?? "#0f4f8f"}
        onChange={(accentColor) => set("accentColor", accentColor)}
      />
    </div>
  );
}
