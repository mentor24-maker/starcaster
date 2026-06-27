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

export function BuilderMessagingTagListModuleSettings({
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
    <div className="builder-messaging-tag-list-settings">
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "cloud"} onChange={(e) => set("layout", e.target.value)}>
              <option value="cloud">Cloud</option>
              <option value="pills">Pills</option>
              <option value="list">List</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Alignment">
            <select value={s.alignment ?? "left"} onChange={(e) => set("alignment", e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Gap (px)">
            <input
              type="number" min={4} max={24} step={2}
              value={s.gap ?? "8"}
              onChange={(e) => set("gap", e.target.value)}
            />
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderThemeColorSettingRow
            fallback="#0f4f8f"
            label="Active color"
            themeColors={themeColors}
            value={s.activeColor ?? "#0f4f8f"}
            onChange={(activeColor) => set("activeColor", activeColor)}
          />

          <BuilderThemeColorSettingRow
            fallback="#587592"
            label="Tag color"
            themeColors={themeColors}
            value={s.inactiveColor ?? "#587592"}
            onChange={(inactiveColor) => set("inactiveColor", inactiveColor)}
          />

          <BuilderThemeColorSettingRow
            fallback="#f0f4f8"
            label="Tag bg"
            themeColors={themeColors}
            value={s.inactiveBg ?? "#f0f4f8"}
            onChange={(inactiveBg) => set("inactiveBg", inactiveBg)}
          />

          <BuilderSettingRow label="Min font (px)">
            <input
              type="number" min={10} max={18} step={1}
              value={s.minFontSize ?? "12"}
              onChange={(e) => set("minFontSize", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Max font (px)">
            <input
              type="number" min={14} max={32} step={1}
              value={s.maxFontSize ?? "22"}
              onChange={(e) => set("maxFontSize", e.target.value)}
            />
          </BuilderSettingRow>
        </div>
      </div>

      <BuilderSettingRow label="Post feed URL" fullWidth>
        <input
          type="text"
          value={s.targetPageUrl ?? ""}
          onChange={(e) => set("targetPageUrl", e.target.value)}
          placeholder="/builder-preview.html?slug=blog"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="URL param" fullWidth>
        <input
          type="text"
          value={s.filterParam ?? "tag"}
          onChange={(e) => set("filterParam", e.target.value)}
          placeholder="tag"
        />
      </BuilderSettingRow>
    </div>
  );
}
