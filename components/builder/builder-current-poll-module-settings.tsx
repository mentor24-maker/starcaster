"use client";

import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { POLL_CONTENT_WIDTH_OPTIONS } from "@/lib/poll-pod-config";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderSettingRow } from "./builder-setting-row";
import { getModuleAlignment, getModuleBackgroundSettings } from "./builder-utils";

type BuilderCurrentPollModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (module: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  themeColors?: Array<{ label: string; hex: string }>;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

export function BuilderCurrentPollModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: BuilderCurrentPollModuleSettingsProps) {
  const moduleAlignment = getModuleAlignment(module.settings);

  return (
    <div className="builder-current-poll-module-settings">
      <BuilderSettingRow label="Width">
        <select
          value={module.settings.size ?? "100"}
          onChange={(event) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, size: event.target.value }
            }))
          }
        >
          {POLL_CONTENT_WIDTH_OPTIONS.map((width) => (
            <option key={width} value={String(width)}>
              {width}%
            </option>
          ))}
        </select>
      </BuilderSettingRow>

      <BuilderBackgroundControls
        label="Background"
        background={getModuleBackgroundSettings(module.settings)}
        horizontal
        onChange={onUpdateModuleBackground}
        themeBackgroundColor={themeBackgroundColor}
        themeColors={themeColors}
        themePrimaryColor={themePrimaryColor}
      />

      <BuilderSettingRow label="Alignment" fullWidth>
        <BuilderAlignmentIconGroup
          value={moduleAlignment}
          onChange={(alignment) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, alignment }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Vertical Margin" fullWidth>
        <BuilderNumberSelectControl
          fallback="0"
          max={160}
          min={0}
          value={module.settings.verticalMargin ?? "0"}
          onChange={(verticalMargin) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, verticalMargin }
            }))
          }
        />
      </BuilderSettingRow>
    </div>
  );
}
