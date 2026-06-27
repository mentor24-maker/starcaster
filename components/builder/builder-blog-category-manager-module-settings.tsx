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

export function BuilderBlogCategoryManagerModuleSettings({
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
    <div className="builder-blog-category-manager-settings">
      <BuilderSettingRow label="Show description">
        <select value={s.showDescription ?? "true"} onChange={(e) => set("showDescription", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Show color">
        <select value={s.showColor ?? "true"} onChange={(e) => set("showColor", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Show sort order">
        <select value={s.showSortOrder ?? "false"} onChange={(e) => set("showSortOrder", e.target.value)}>
          <option value="false">Hide</option>
          <option value="true">Show</option>
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
