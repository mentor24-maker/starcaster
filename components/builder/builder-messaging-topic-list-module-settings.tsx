"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderThemeColorField,
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
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Layout" width="select-sm">
          <select value={s.layout ?? "pills"} onChange={(e) => set("layout", e.target.value)}>
            <option value="pills">Pills</option>
            <option value="list">List</option>
            <option value="dropdown">Dropdown</option>
          </select>
        </BuilderModuleField>
        <BuilderModuleField label="Show 'All'" width="select-sm">
          <select value={s.showAll ?? "true"} onChange={(e) => set("showAll", e.target.value)}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </BuilderModuleField>
        <BuilderModuleField label="Alignment" width="select-sm">
          <select value={s.alignment ?? "left"} onChange={(e) => set("alignment", e.target.value)}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      {(s.showAll ?? "true") === "true" ? (
        <BuilderSettingRow label="'All' label" fullWidth>
          <input
            type="text"
            value={s.allLabel ?? "All Topics"}
            onChange={(e) => set("allLabel", e.target.value)}
            placeholder="All Topics"
          />
        </BuilderSettingRow>
      ) : null}

      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Active color" width="color">
          <BuilderThemeColorField
            dialogLabel="Active pill text color"
            fallback="#0f4f8f"
            themeColors={themeColors}
            value={s.activeColor ?? "#0f4f8f"}
            onChange={(activeColor) => set("activeColor", activeColor)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Active bg" width="color">
          <BuilderThemeColorField
            dialogLabel="Active pill background"
            fallback="#0f4f8f"
            themeColors={themeColors}
            value={s.activeBg ?? "#0f4f8f"}
            onChange={(activeBg) => set("activeBg", activeBg)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Inactive color" width="color">
          <BuilderThemeColorField
            dialogLabel="Inactive pill text color"
            fallback="#587592"
            themeColors={themeColors}
            value={s.inactiveColor ?? "#587592"}
            onChange={(inactiveColor) => set("inactiveColor", inactiveColor)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Inactive bg" width="color">
          <BuilderThemeColorField
            dialogLabel="Inactive pill background"
            fallback="#f0f4f8"
            themeColors={themeColors}
            value={s.inactiveBg ?? "#f0f4f8"}
            onChange={(inactiveBg) => set("inactiveBg", inactiveBg)}
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Radius" width="num">
          <BuilderNumberSelectControl
            value={s.borderRadius ?? "20"}
            min={0}
            max={32}
            step={2}
            fallback="20"
            onChange={(borderRadius) => set("borderRadius", borderRadius)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Font size" width="num">
          <BuilderNumberSelectControl
            value={s.fontSize ?? "13"}
            min={10}
            max={20}
            fallback="13"
            onChange={(fontSize) => set("fontSize", fontSize)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Gap" width="num">
          <BuilderNumberSelectControl
            value={s.gap ?? "8"}
            min={4}
            max={24}
            step={2}
            fallback="8"
            onChange={(gap) => set("gap", gap)}
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

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

      <details className="hanging-details">
        <summary>Border</summary>
        <div className="builder-module-form-row">
          <BuilderThemeColorSettingRow
            dialogLabel="Module border color"
            fallback="#000000"
            label="Color"
            themeColors={themeColors}
            value={s.moduleBorderColor || "#000000"}
            onChange={(moduleBorderColor) => set("moduleBorderColor", moduleBorderColor)}
          />
          <BuilderSettingRow label="Width">
            <BuilderNumberSelectControl
              value={s.moduleBorderWidth ?? "0"}
              min={0}
              max={8}
              fallback="0"
              onChange={(moduleBorderWidth) => set("moduleBorderWidth", moduleBorderWidth)}
            />
          </BuilderSettingRow>
        </div>
      </details>
    </div>
  );
}
