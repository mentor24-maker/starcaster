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

export function BuilderMessagingTopicListModuleSettings({
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
    <div className="builder-messaging-topic-list-settings">
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "pills"} onChange={(e) => set("layout", e.target.value)}>
              <option value="pills">Pills</option>
              <option value="list">List</option>
              <option value="dropdown">Dropdown</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Show 'All'">
            <select value={s.showAll ?? "true"} onChange={(e) => set("showAll", e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </BuilderSettingRow>

          {(s.showAll ?? "true") === "true" ? (
            <BuilderSettingRow label="'All' label">
              <input
                type="text"
                value={s.allLabel ?? "All Topics"}
                onChange={(e) => set("allLabel", e.target.value)}
                placeholder="All Topics"
              />
            </BuilderSettingRow>
          ) : null}

          <BuilderSettingRow label="Alignment">
            <select value={s.alignment ?? "left"} onChange={(e) => set("alignment", e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
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
            fallback="#0f4f8f"
            label="Active bg"
            themeColors={themeColors}
            value={s.activeBg ?? "#0f4f8f"}
            onChange={(activeBg) => set("activeBg", activeBg)}
          />

          <BuilderThemeColorSettingRow
            fallback="#587592"
            label="Inactive color"
            themeColors={themeColors}
            value={s.inactiveColor ?? "#587592"}
            onChange={(inactiveColor) => set("inactiveColor", inactiveColor)}
          />

          <BuilderThemeColorSettingRow
            fallback="#f0f4f8"
            label="Inactive bg"
            themeColors={themeColors}
            value={s.inactiveBg ?? "#f0f4f8"}
            onChange={(inactiveBg) => set("inactiveBg", inactiveBg)}
          />

          <BuilderSettingRow label="Border radius (px)">
            <input
              type="number" min={0} max={32} step={2}
              value={s.borderRadius ?? "20"}
              onChange={(e) => set("borderRadius", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Font size (px)">
            <input
              type="number" min={10} max={20} step={1}
              value={s.fontSize ?? "13"}
              onChange={(e) => set("fontSize", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Gap (px)">
            <input
              type="number" min={4} max={24} step={2}
              value={s.gap ?? "8"}
              onChange={(e) => set("gap", e.target.value)}
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
          value={s.filterParam ?? "topic"}
          onChange={(e) => set("filterParam", e.target.value)}
          placeholder="topic"
        />
      </BuilderSettingRow>
    </div>
  );
}
