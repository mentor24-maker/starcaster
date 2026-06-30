"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorSettingRow, type BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogSearchModuleSettings({
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
    <div className="builder-blog-search-settings">
      <BuilderSettingRow label="Placeholder" fullWidth>
        <input
          type="text"
          value={s.placeholder ?? "Search posts…"}
          onChange={(e) => set("placeholder", e.target.value)}
          placeholder="Search posts…"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Button Label" fullWidth>
        <input
          type="text"
          value={s.buttonLabel ?? "Search"}
          onChange={(e) => set("buttonLabel", e.target.value)}
          placeholder="Search"
        />
      </BuilderSettingRow>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderThemeColorSettingRow
            fallback="#0f4f8f"
            label="Button color"
            themeColors={themeColors}
            value={s.accentColor ?? "#0f4f8f"}
            onChange={(accentColor) => set("accentColor", accentColor)}
          />
        </div>
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Border radius">
            <input
              type="number"
              min={0}
              max={40}
              value={s.borderRadius ?? "8"}
              onChange={(e) => set("borderRadius", e.target.value)}
              style={{ width: 64 }}
            />
          </BuilderSettingRow>
        </div>
      </div>

      <BuilderSettingRow label="Results page URL" fullWidth>
        <input
          type="text"
          value={s.targetPageUrl ?? ""}
          onChange={(e) => set("targetPageUrl", e.target.value)}
          placeholder="/blog (leave blank to stay on current page)"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Search param" fullWidth>
        <input
          type="text"
          value={s.searchParam ?? "search"}
          onChange={(e) => set("searchParam", e.target.value)}
          placeholder="search"
        />
      </BuilderSettingRow>
      <div className="builder-module-runtime-note">
        <p>
          The search param must match the one set on the paired <strong>Blog Search Results</strong> module.
        </p>
      </div>
    </div>
  );
}
