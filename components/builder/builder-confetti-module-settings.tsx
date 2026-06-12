"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  buildConfettiOriginSelectOptions,
  CONFETTI_EFFECT_DEFAULTS,
  CONFETTI_SOUND_OPTIONS,
  normalizeConfettiModuleSettings
} from "@/lib/confetti-effect";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderSettingRow } from "./builder-setting-row";

type BuilderConfettiModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (module: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const ORIGIN_OPTIONS = buildConfettiOriginSelectOptions();

export function BuilderConfettiModuleSettings({
  module,
  onUpdateModule
}: BuilderConfettiModuleSettingsProps) {
  const settings = normalizeConfettiModuleSettings(module.settings);

  function updateSettings(updates: Record<string, string>) {
    onUpdateModule((current) => ({
      ...current,
      settings: normalizeConfettiModuleSettings({ ...current.settings, ...updates })
    }));
  }

  return (
    <div className="builder-confetti-module-settings">
      <BuilderSettingRow label="Particle Count" fullWidth>
        <BuilderNumberSelectControl
          value={settings.particleCount}
          min={1}
          max={500}
          fallback={CONFETTI_EFFECT_DEFAULTS.particleCount}
          onChange={(particleCount) => updateSettings({ particleCount })}
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Spread" fullWidth>
        <BuilderNumberSelectControl
          value={settings.spread}
          min={0}
          max={180}
          fallback={CONFETTI_EFFECT_DEFAULTS.spread}
          onChange={(spread) => updateSettings({ spread })}
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Origin X" fullWidth>
        <select
          value={settings.originX}
          onChange={(event) => updateSettings({ originX: event.target.value })}
        >
          {ORIGIN_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Origin Y" fullWidth>
        <select
          value={settings.originY}
          onChange={(event) => updateSettings({ originY: event.target.value })}
        >
          {ORIGIN_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Z-Index" fullWidth>
        <input
          max={999999}
          min={1}
          onChange={(event) => updateSettings({ zIndex: event.target.value })}
          step={1}
          type="number"
          value={settings.zIndex}
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Sound" fullWidth>
        <select
          value={settings.sound}
          onChange={(event) => updateSettings({ sound: event.target.value })}
        >
          {CONFETTI_SOUND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </BuilderSettingRow>

      {settings.sound !== "off" ? (
        <BuilderSettingRow label="Sound Volume" fullWidth>
          <BuilderNumberSelectControl
            value={settings.popVolume}
            min={0}
            max={100}
            fallback={CONFETTI_EFFECT_DEFAULTS.popVolume}
            onChange={(popVolume) => updateSettings({ popVolume })}
          />
        </BuilderSettingRow>
      ) : null}
    </div>
  );
}
