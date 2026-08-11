"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderSimpleTextModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  compact?: boolean;
  themeColors?: BuilderThemePalette;
};

/**
 * Colour the section supplies when the operator has not overridden it. Simple
 * Text inherits rather than declaring its own colour, so this is what the
 * swatch shows as "the theme's value" — the same ink the other text modules
 * resolve to on a default theme.
 */
const INHERITED_TEXT_COLOR = "#214c71";

/**
 * Type settings for the Simple Text module (the `plain` text variant).
 *
 * Simple Text ships with no type scale of its own — it inherits size, weight
 * and colour from its section, which is what lets it sit flush. That made it
 * the one text module with nothing to set, so these controls exist to opt into
 * an override. Every field is empty by default and stays empty until touched;
 * `getPlainTextModuleStyle` emits a CSS property only for the ones that carry a
 * value, so an untouched module renders exactly as it did before this editor
 * existed.
 *
 * The keys are the heading module's keys on purpose (`fontSize`, `fontWeight`,
 * `lineHeight`, `letterSpacing`, `color`) — one vocabulary across the two text
 * editors rather than a private one here.
 *
 * D8 axes: Text only. Alignment, width and the margins are the text module's
 * universal chrome and already render in the module card — repeating them here
 * would duplicate chrome (E6).
 */
export function BuilderSimpleTextModuleSettings({
  module,
  onUpdateModule,
  compact = false,
  themeColors = []
}: BuilderSimpleTextModuleSettingsProps) {
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Text",
        strips: [
          [
            {
              key: "fontSize",
              label: "Size",
              width: "auto",
              control: "custom",
              rendersVia: "getPlainTextModuleStyle",
              // Empty means "inherit", which no number input can express on its
              // own — hence a custom control rather than the `number` one.
              render: (ctx) => (
                <input
                  type="number"
                  min={8}
                  max={160}
                  step={1}
                  placeholder="Inherit"
                  value={ctx.settings.fontSize ?? ""}
                  onChange={(event) => ctx.set("fontSize", event.target.value)}
                />
              )
            },
            {
              key: "fontWeight",
              label: "Weight",
              width: "select-md",
              control: "select",
              options: [
                { value: "", label: "Inherit" },
                { value: "300", label: "Light (300)" },
                { value: "400", label: "Regular (400)" },
                { value: "500", label: "Medium (500)" },
                { value: "600", label: "Semibold (600)" },
                { value: "700", label: "Bold (700)" },
                { value: "800", label: "Extrabold (800)" },
                { value: "900", label: "Black (900)" }
              ],
              fallback: "",
              rendersVia: "getPlainTextModuleStyle"
            }
          ],
          [
            {
              key: "lineHeight",
              label: "Line Height",
              width: "auto",
              control: "custom",
              visibleWhen: () => !compact,
              rendersVia: "getPlainTextModuleStyle",
              render: (ctx) => (
                <input
                  type="number"
                  min={0.8}
                  max={3}
                  step={0.05}
                  placeholder="Inherit"
                  value={ctx.settings.lineHeight ?? ""}
                  onChange={(event) => ctx.set("lineHeight", event.target.value)}
                />
              )
            },
            {
              // The answer to "how do I put more space between letters" —
              // typing repeated entities gets you one gap in one place, this
              // spaces the whole block evenly and survives editing.
              key: "letterSpacing",
              label: "Letter Spacing",
              width: "auto",
              control: "custom",
              visibleWhen: () => !compact,
              rendersVia: "getPlainTextModuleStyle",
              render: (ctx) => (
                <input
                  type="number"
                  min={-5}
                  max={20}
                  step={0.5}
                  placeholder="Inherit"
                  value={ctx.settings.letterSpacing ?? ""}
                  onChange={(event) => ctx.set("letterSpacing", event.target.value)}
                />
              )
            }
          ]
        ],
        // A1: colour is a theme value. Empty follows the theme, and overriding
        // it is the deliberate act — so it sits in Advanced, as it does on the
        // heading module.
        advanced: [
          [
            {
              key: "color",
              label: "Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Text color",
              themeDefault: INHERITED_TEXT_COLOR,
              rendersVia: "getPlainTextModuleStyle"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-simple-text-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
