"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderButtonDropShadowSettings } from "./builder-button-drop-shadow-settings";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  HEADING_VARIANT_PRESETS,
  type HeadingVariantPresetKey
} from "./builder-utils";

type BuilderHeadingModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  compact?: boolean;
};

export function BuilderHeadingModuleSettings({
  module,
  onUpdateModule,
  compact = false
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
          <BuilderSettingRow label="Color">
            <input
              type="color"
              value={settings.color ?? "#18324a"}
              onChange={(event) => updateSetting("color", event.target.value)}
            />
          </BuilderSettingRow>
          {!compact ? (
            <BuilderSettingRow label="Bold">
              <select
                value={settings.bold ?? "true"}
                onChange={(event) => updateSetting("bold", event.target.value)}
              >
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </BuilderSettingRow>
          ) : null}
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
          <BuilderButtonDropShadowSettings settings={settings} onUpdateSetting={updateSetting} />
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
