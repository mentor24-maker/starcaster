import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorField } from "./builder-theme-color-field";

type BuilderButtonDropShadowSettingsProps = {
  settings: BuilderTemplateModule["settings"];
  onUpdateSetting: (key: string, value: string) => void;
  themeColors?: Array<{ label: string; hex: string }>;
};

export function BuilderButtonDropShadowSettings({
  settings,
  onUpdateSetting,
  themeColors = []
}: BuilderButtonDropShadowSettingsProps) {
  const dropShadowEnabled = settings.dropShadow === "true" || settings.dropShadow === "on";
  const shadowColor = settings.dropShadowColor?.startsWith("#")
    ? settings.dropShadowColor
    : "#000000";

  return (
    <div className="builder-button-drop-shadow-settings">
      <BuilderSettingRow label="Drop Shadow" fullWidth>
        <select
          value={settings.dropShadow ?? "false"}
          onChange={(event) => onUpdateSetting("dropShadow", event.target.value)}
        >
          <option value="false">Off</option>
          <option value="true">On</option>
        </select>
      </BuilderSettingRow>
      {dropShadowEnabled ? (
        <div className="builder-button-setting-columns">
          <div className="builder-button-setting-column">
            <BuilderSettingRow label="Shadow Color">
              <BuilderThemeColorField
                dialogLabel="Button shadow color"
                fallback="#000000"
                themeColors={themeColors}
                value={shadowColor}
                onChange={(color) => onUpdateSetting("dropShadowColor", color)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Shadow X">
              <input
                type="number"
                min={-20}
                max={20}
                step={1}
                value={settings.dropShadowX ?? "3"}
                onChange={(event) => onUpdateSetting("dropShadowX", event.target.value)}
              />
            </BuilderSettingRow>
          </div>
          <div className="builder-button-setting-column">
            <BuilderSettingRow label="Shadow Y">
              <input
                type="number"
                min={-20}
                max={20}
                step={1}
                value={settings.dropShadowY ?? "3"}
                onChange={(event) => onUpdateSetting("dropShadowY", event.target.value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Shadow Blur">
              <input
                type="number"
                min={0}
                max={30}
                step={1}
                value={settings.dropShadowBlur ?? "2"}
                onChange={(event) => onUpdateSetting("dropShadowBlur", event.target.value)}
              />
            </BuilderSettingRow>
          </div>
        </div>
      ) : null}
    </div>
  );
}
