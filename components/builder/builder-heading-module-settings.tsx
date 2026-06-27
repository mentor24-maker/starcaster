"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderButtonDropShadowSettings } from "./builder-button-drop-shadow-settings";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BUILDER_HEADING_FONTS,
  HEADING_VARIANT_PRESETS,
  type HeadingVariantPresetKey
} from "./builder-utils";
import {
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";

type BuilderHeadingModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  compact?: boolean;
  themeColors?: BuilderThemePalette;
};

export function BuilderHeadingModuleSettings({
  module,
  onUpdateModule,
  compact = false,
  themeColors = []
}: BuilderHeadingModuleSettingsProps) {
  const settings = module.settings;

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const variantKey = (settings.variant ?? "default") as HeadingVariantPresetKey;
  const stylePresetKey: HeadingVariantPresetKey =
    variantKey in HEADING_VARIANT_PRESETS ? variantKey : "default";

  return (
    <div className="builder-heading-module-settings">
      <BuilderSettingRow label="Style">
        <select
          value={stylePresetKey}
          onChange={(event) => {
            const nextKey = event.target.value as HeadingVariantPresetKey;
            const preset = HEADING_VARIANT_PRESETS[nextKey] ?? HEADING_VARIANT_PRESETS.default;

            onUpdateModule((current) => ({
              ...current,
              settings: {
                ...current.settings,
                variant: preset.variant,
                level: preset.level,
                fontSize: preset.fontSize
              }
            }));
          }}
        >
          <option value="eyebrow">Eyebrow</option>
          <option value="section">Section Heading</option>
          <option value="hero">Hero Title</option>
          <option value="default">Custom</option>
        </select>
      </BuilderSettingRow>
      <BuilderSettingRow label="Heading" fullWidth>
        <input
          type="text"
          value={module.text}
          onChange={(event) =>
            onUpdateModule((current) => ({
              ...current,
              text: event.target.value
            }))
          }
          placeholder="Enter heading"
        />
      </BuilderSettingRow>
      <BuilderSettingRow label="Font" fullWidth>
        <select
          value={settings.fontFamily ?? ""}
          onChange={(event) => updateSetting("fontFamily", event.target.value)}
        >
          {BUILDER_HEADING_FONTS.map((font) => (
            <option key={font.key || "default"} value={font.key}>
              {font.label}
            </option>
          ))}
        </select>
      </BuilderSettingRow>
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Level">
            <select
              value={settings.level ?? "h2"}
              onChange={(event) => updateSetting("level", event.target.value)}
            >
              <option value="h1">H1</option>
              <option value="h2">H2</option>
              <option value="h3">H3</option>
              <option value="h4">H4</option>
              <option value="h5">H5</option>
              <option value="h6">H6</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Size (px)">
            <input
              type="number"
              min={10}
              max={160}
              step={1}
              value={settings.fontSize ?? "32"}
              onChange={(event) => updateSetting("fontSize", event.target.value)}
            />
          </BuilderSettingRow>
          <BuilderThemeColorSettingRow
            fallback="#18324a"
            label="Color"
            themeColors={themeColors}
            value={settings.color ?? "#18324a"}
            onChange={(color) => updateSetting("color", color)}
          />
          <BuilderSettingRow label="Weight">
            <select
              value={settings.fontWeight ?? (settings.bold === "false" ? "500" : "800")}
              onChange={(event) => updateSetting("fontWeight", event.target.value)}
            >
              <option value="400">Regular (400)</option>
              <option value="500">Medium (500)</option>
              <option value="600">Semibold (600)</option>
              <option value="700">Bold (700)</option>
              <option value="800">Extrabold (800)</option>
              <option value="900">Black (900)</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Align">
            <select
              value={settings.textAlign ?? "left"}
              onChange={(event) => updateSetting("textAlign", event.target.value)}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </BuilderSettingRow>
        </div>
        <div className="builder-button-setting-column">
          {!compact ? (
            <>
              <BuilderSettingRow label="Italic">
                <select
                  value={settings.italic ?? "false"}
                  onChange={(event) => updateSetting("italic", event.target.value)}
                >
                  <option value="false">Off</option>
                  <option value="true">On</option>
                </select>
              </BuilderSettingRow>
              <BuilderSettingRow label="Underline">
                <select
                  value={settings.underline ?? "false"}
                  onChange={(event) => updateSetting("underline", event.target.value)}
                >
                  <option value="false">Off</option>
                  <option value="true">On</option>
                </select>
              </BuilderSettingRow>
              <BuilderSettingRow label="Outline">
                <select
                  value={settings.outline ?? "false"}
                  onChange={(event) => updateSetting("outline", event.target.value)}
                >
                  <option value="false">Off</option>
                  <option value="true">On</option>
                </select>
              </BuilderSettingRow>
              <BuilderSettingRow label="Transform">
                <select
                  value={settings.textTransform ?? "none"}
                  onChange={(event) => updateSetting("textTransform", event.target.value)}
                >
                  <option value="none">None</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="capitalize">Capitalize</option>
                  <option value="lowercase">lowercase</option>
                </select>
              </BuilderSettingRow>
              <BuilderSettingRow label="Line Height">
                <input
                  type="number"
                  min={0.8}
                  max={3}
                  step={0.05}
                  value={settings.lineHeight ?? "1.2"}
                  onChange={(event) => updateSetting("lineHeight", event.target.value)}
                />
              </BuilderSettingRow>
              <BuilderSettingRow label="Letter Spacing">
                <input
                  type="number"
                  min={-5}
                  max={20}
                  step={0.5}
                  value={settings.letterSpacing ?? "0"}
                  onChange={(event) => updateSetting("letterSpacing", event.target.value)}
                />
              </BuilderSettingRow>
            </>
          ) : null}
          <BuilderSettingRow label="Top Margin">
            <BuilderNumberSelectControl
              value={settings.marginTop ?? settings.verticalMargin ?? "0"}
              min={0}
              max={160}
              fallback="0"
              onChange={(marginTop) => updateSetting("marginTop", marginTop)}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Bottom Margin">
            <BuilderNumberSelectControl
              value={settings.marginBottom ?? settings.verticalMargin ?? "0"}
              min={0}
              max={160}
              fallback="0"
              onChange={(marginBottom) => updateSetting("marginBottom", marginBottom)}
            />
          </BuilderSettingRow>
        </div>
      </div>
      {!compact ? (
        <>
          <BuilderButtonDropShadowSettings
            settings={settings}
            themeColors={themeColors}
            onUpdateSetting={updateSetting}
          />
          <BuilderModuleOffsetFields
            horizontalOffset={settings.horizontalOffset ?? "0"}
            verticalOffset={settings.verticalOffset ?? "0"}
            onHorizontalOffsetChange={(horizontalOffset) => updateSetting("horizontalOffset", horizontalOffset)}
            onVerticalOffsetChange={(verticalOffset) => updateSetting("verticalOffset", verticalOffset)}
          />
        </>
      ) : (
        <BuilderModuleOffsetFields
          horizontalOffset={settings.horizontalOffset ?? "0"}
          verticalOffset={settings.verticalOffset ?? "0"}
          onHorizontalOffsetChange={(horizontalOffset) => updateSetting("horizontalOffset", horizontalOffset)}
          onVerticalOffsetChange={(verticalOffset) => updateSetting("verticalOffset", verticalOffset)}
        />
      )}
    </div>
  );
}
