"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  buildConfettiOriginSelectOptions,
  CONFETTI_EFFECT_DEFAULTS,
  CONFETTI_SOUND_OPTIONS,
  normalizeConfettiModuleSettings
} from "@/lib/confetti-effect";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

type BuilderConfettiModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (module: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const ORIGIN_OPTIONS = buildConfettiOriginSelectOptions();

export function BuilderConfettiModuleSettings({
  module,
  onUpdateModule
}: BuilderConfettiModuleSettingsProps) {
  // Every read and write goes through normalizeConfettiModuleSettings, exactly
  // as the pre-schema editor did — values are clamped on save, not just shown.
  const settings = normalizeConfettiModuleSettings(module.settings);

  const schema: BuilderSettingsSchema = {
    // D2: three short strips would stack down the left edge — arrange the
    // groups side by side so the panel fills its width.
    panelColumns: [["content", "layout"], ["style"]],
    content: [
      [
        {
          key: "particleCount",
          label: "Particles",
          width: "num",
          control: "number",
          min: 1,
          max: 500,
          fallback: CONFETTI_EFFECT_DEFAULTS.particleCount,
          rendersVia: "buildConfettiEffectOptions"
        },
        {
          key: "spread",
          label: "Spread",
          width: "num",
          control: "number",
          min: 0,
          max: 180,
          fallback: CONFETTI_EFFECT_DEFAULTS.spread,
          rendersVia: "buildConfettiEffectOptions"
        }
      ]
    ],
    layout: [
      [
        {
          key: "originX",
          label: "Origin X",
          width: "select-sm",
          control: "select",
          options: ORIGIN_OPTIONS.map((value) => ({ value, label: value })),
          rendersVia: "buildConfettiEffectOptions"
        },
        {
          key: "originY",
          label: "Origin Y",
          width: "select-sm",
          control: "select",
          options: ORIGIN_OPTIONS.map((value) => ({ value, label: value })),
          rendersVia: "buildConfettiEffectOptions"
        },
        {
          key: "zIndex",
          label: "Z-Index",
          width: "auto",
          control: "custom",
          rendersVia: "buildConfettiEffectOptions",
          render: (ctx) => (
            <input
              max={999999}
              min={1}
              onChange={(event) => ctx.set("zIndex", event.target.value)}
              step={1}
              type="number"
              value={ctx.settings.zIndex}
            />
          )
        }
      ]
    ],
    style: [
      [
        {
          key: "sound",
          label: "Sound",
          width: "select-md",
          control: "select",
          options: CONFETTI_SOUND_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
          rendersVia: "resolveConfettiSound"
        },
        {
          key: "popVolume",
          label: "Volume",
          width: "num",
          control: "number",
          min: 0,
          max: 100,
          fallback: CONFETTI_EFFECT_DEFAULTS.popVolume,
          visibleWhen: (settings) => settings.sound !== "off",
          rendersVia: "resolveConfettiSound"
        }
      ]
    ]
  };

  return (
    <div className="builder-confetti-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={{ ...module, settings }}
        onUpdateModule={(updater) =>
          onUpdateModule((current) => {
            const next = updater(current);
            return { ...next, settings: normalizeConfettiModuleSettings(next.settings) };
          })
        }
      />
    </div>
  );
}
