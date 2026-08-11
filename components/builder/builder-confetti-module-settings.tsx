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
    // D8 axes (2026-08-10): Structure / Placement / Behavior. The burst has
    // no text and no frame — the counts shape it, the origin places it, and
    // the sound is what it does. (Replaces the D2 panelColumns pairing: three
    // short strips no longer stack down the left edge either way.)
    //
    // A1 sort (2026-08-10): the burst has no colour, border, shadow or font,
    // so nothing here overrides the theme and Advanced holds one control —
    // Z-Index, under Placement per A5. Its companions are Origin X/Y rather
    // than the X/Y Offsets A5 names, but it is the same stacking control the
    // other modules put in Placement › Advanced, and D8's whole point is that
    // a control sits in the same place everywhere. Particles, Spread, the
    // origins, Sound and Volume are the module's own settings (A4).
    //
    // SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
    // Everything above that "moved into Advanced" now sits LAST on the axis it
    // already names, ordered by D9 (blast radius, descending). The axis
    // assignments and the A2 theme-colour semantics are unchanged — only the
    // collapsing is gone. Kept rather than rewritten: the reasoning is the record.
    axes: [
      {
        title: "Structure",
        strips: [
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
        ]
      },
      {
        title: "Placement",
        strips: [
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
            }
          ],
          [
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
        // A5 withdrawn with Advanced (A0): a nudge is now sorted last on
            // Placement rather than hidden — same de-emphasis, one glance away.
      },
      {
        title: "Behavior",
        strips: [
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
      }
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
