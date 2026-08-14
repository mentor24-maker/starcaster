"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderInlineRichTextEditor } from "./builder-inline-rich-text-editor";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import {
  BuilderSchemaModuleSettings,
  dropShadowFields,
  MODULE_MARGIN_SIDES,
  type BuilderSchemaFieldContext,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import {
  BUILDER_HEADING_FONTS,
  HEADING_VARIANT_PRESETS,
  type HeadingVariantPresetKey
} from "./builder-utils";
import { type BuilderThemePalette } from "./builder-theme-color-field";

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
  /*
   * D8 axes (master rule D8, 2026-08-10): Content / Text / Placement.
   * Level is a heading-only control, so it rides the Text axis rather than
   * taking a Structure column of its own.
   *
   * SUPERSEDED, kept because the axis assignments it made are still the
   * ones in force — only the hiding is gone. The 2026-08-11 A1/A6 sort
   * moved Colour out of Advanced ("text colour is basic") and moved Drop
   * Shadow from Frame to Text, which is where it always belonged:
   * `getHeadingModuleStyle` renders it as `text-shadow`, not `box-shadow`.
   * It shadows the letters. With it gone the Frame axis held nothing at
   * all, so the module dropped to three axes (A7).
   *
   * A0 (operator 8/13): there is no Advanced section any more. Font family
   * and the drop-shadow block came out of it onto the Text axis, and the
   * offsets onto Placement — the axes they already belonged to, now in the
   * open. A2 is what protects the theme, not the hiding: Colour and Font
   * are still empty-means-theme controls wherever they sit.
   *
   * D9 orders each axis by blast radius, descending:
   *
   *   Text        Level and Font decide what the thing IS (rungs 2) →
   *               Size, Weight, Transform (4) → Colour (5) → the
   *               decorations, the metrics, and last of all the shadow,
   *               which is the definition of the last 2% (6).
   *   Placement   Align (2) → the margins (4) → offsets, nudges by
   *               construction, last (6).
   *
   * Compact mode still hides exactly the controls it always hid, so a
   * table-cell heading renders the same three axes with fewer fields.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "variant",
              label: "Style",
              width: "select-md",
              control: "custom",
              rendersVia: "getHeadingModuleStyle",
              // One preset choice writes variant + level + fontSize atomically.
              render: (ctx) => {
                const variantKey = (ctx.settings.variant ?? "default") as HeadingVariantPresetKey;
                const stylePresetKey: HeadingVariantPresetKey =
                  variantKey in HEADING_VARIANT_PRESETS ? variantKey : "default";
                return (
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
                );
              }
            }
          ],
          [
            {
              key: "text",
              label: "Heading",
              width: "full",
              control: "custom",
              rendersVia: "formatHeadingContent",
              // Edits module.text, not a settings key. Inline formatting only —
              // the heading is one element, so a word can be recoloured or
              // resized but nothing block-level may go in. The Text axis below
              // still sets the whole heading; this is for the exceptions.
              render: (ctx) => (
                <BuilderInlineRichTextEditor
                  value={ctx.module.text}
                  onChange={(text) => onUpdateModule((current) => ({ ...current, text }))}
                  themeColors={themeColors}
                />
              )
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
            {
              key: "level",
              label: "Level",
              width: "select-sm",
              control: "select",
              options: [
                { value: "h1", label: "H1" },
                { value: "h2", label: "H2" },
                { value: "h3", label: "H3" },
                { value: "h4", label: "H4" },
                { value: "h5", label: "H5" },
                { value: "h6", label: "H6" }
              ],
              fallback: "h2",
              rendersVia: "getHeadingModuleLevel"
            },
            // D9 rung 2, beside Level: the typeface is the other setting
            // that changes what the heading IS rather than how much of it
            // there is. Still a theme override (A2) — empty follows the
            // theme — it is just not hidden any more (A0).
            {
              key: "fontFamily",
              label: "Font",
              width: "auto",
              control: "select",
              options: BUILDER_HEADING_FONTS.map((font) => ({ value: font.key, label: font.label })),
              fallback: "",
              rendersVia: "getHeadingFontStack"
            }
          ],
          [
            {
              key: "fontSize",
              label: "Size",
              width: "auto",
              control: "custom",
              rendersVia: "getHeadingModuleStyle",
              render: (ctx) => (
                <input
                  type="number"
                  min={10}
                  max={160}
                  step={1}
                  value={ctx.settings.fontSize ?? "32"}
                  onChange={(event) => ctx.set("fontSize", event.target.value)}
                />
              )
            },
            {
              key: "fontWeight",
              label: "Weight",
              width: "auto",
              control: "custom",
              rendersVia: "getHeadingFontWeight",
              // Default depends on the legacy bold flag, so the fallback is dynamic.
              render: (ctx) => (
                <select
                  value={ctx.settings.fontWeight ?? (ctx.settings.bold === "false" ? "500" : "800")}
                  onChange={(event) => ctx.set("fontWeight", event.target.value)}
                >
                  <option value="400">Regular (400)</option>
                  <option value="500">Medium (500)</option>
                  <option value="600">Semibold (600)</option>
                  <option value="700">Bold (700)</option>
                  <option value="800">Extrabold (800)</option>
                  <option value="900">Black (900)</option>
                </select>
              )
            },
            {
              key: "textTransform",
              label: "Transform",
              width: "select-md",
              control: "select",
              options: [
                { value: "none", label: "None" },
                { value: "uppercase", label: "UPPERCASE" },
                { value: "capitalize", label: "Capitalize" },
                { value: "lowercase", label: "lowercase" }
              ],
              fallback: "none",
              visibleWhen: () => !compact,
              rendersVia: "getHeadingModuleStyle"
            }
          ],
          // D9 rung 5. A6: text colour is basic — it was never a candidate
          // for hiding even while Advanced existed.
          [
            {
              key: "color",
              label: "Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Heading color",
              themeDefault: "#18324a",
              rendersVia: "getHeadingModuleStyle"
            }
          ],
          [
            {
              key: "italic",
              label: "Italic",
              width: "check",
              control: "checkbox",
              fallback: "false",
              visibleWhen: () => !compact,
              rendersVia: "getHeadingModuleStyle"
            },
            {
              key: "underline",
              label: "Underline",
              width: "check",
              control: "checkbox",
              fallback: "false",
              visibleWhen: () => !compact,
              rendersVia: "getHeadingModuleStyle"
            },
            {
              key: "outline",
              label: "Outline",
              width: "check",
              control: "checkbox",
              fallback: "false",
              visibleWhen: () => !compact,
              rendersVia: "getHeadingModuleStyle"
            }
          ],
          [
            {
              key: "lineHeight",
              label: "Line Height",
              width: "auto",
              control: "custom",
              visibleWhen: () => !compact,
              rendersVia: "getHeadingModuleStyle",
              render: (ctx) => (
                <input
                  type="number"
                  min={0.8}
                  max={3}
                  step={0.05}
                  value={ctx.settings.lineHeight ?? "1.2"}
                  onChange={(event) => ctx.set("lineHeight", event.target.value)}
                />
              )
            },
            {
              key: "letterSpacing",
              label: "Letter Spacing",
              width: "auto",
              control: "custom",
              visibleWhen: () => !compact,
              rendersVia: "getHeadingModuleStyle",
              render: (ctx) => (
                <input
                  type="number"
                  min={-5}
                  max={20}
                  step={0.5}
                  value={ctx.settings.letterSpacing ?? "0"}
                  onChange={(event) => ctx.set("letterSpacing", event.target.value)}
                />
              )
            }
          ],
          // D9 rung 6, last on the axis: a drop shadow is the last 2% of a
          // heading, and A0 says that is expressed by sorting it last
          // rather than by hiding it. It is a TEXT effect — `text-shadow`
          // on the letters, not a `box-shadow` on a frame (A7).
          dropShadowFields("getModuleDropShadowStyle", { visibleWhen: () => !compact })
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "textAlign",
              label: "Align",
              width: "select-sm",
              control: "select",
              options: [
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" }
              ],
              fallback: "left",
              rendersVia: "getHeadingModuleStyle"
            },
            // The four sides, read through the same table and the same legacy
            // fallback the renderer resolves with: a table-cell heading is
            // never normalized, so reading `marginTop` alone would show 0
            // while the page renders the pair it was saved with.
            ...MODULE_MARGIN_SIDES.map(({ key, label, legacy }) => ({
              key,
              label,
              width: "num" as const,
              control: "custom" as const,
              rendersVia: "getModuleOuterSpacingStyle",
              render: (ctx: BuilderSchemaFieldContext) => (
                <BuilderNumberSelectControl
                  value={ctx.settings[key] ?? ctx.settings[legacy] ?? "0"}
                  min={0}
                  max={160}
                  step={5}
                  fallback="0"
                  onChange={(next) => ctx.set(key, next)}
                />
              )
            }))
          ],
          // D9 rung 6, last on the axis. A5 used to put these in
          // Placement's own Advanced section for exactly this reason —
          // "nudges, not everyday placement" — and A0 keeps the judgement
          // while dropping the collapse. They render in compact too.
          [
            {
              key: "horizontalOffset",
              label: "Offsets",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "getModuleNudgeTransform",
              render: (ctx) => (
                <BuilderModuleOffsetFields
                  horizontalOffset={ctx.settings.horizontalOffset ?? "0"}
                  verticalOffset={ctx.settings.verticalOffset ?? "0"}
                  onHorizontalOffsetChange={(horizontalOffset) => ctx.set("horizontalOffset", horizontalOffset)}
                  onVerticalOffsetChange={(verticalOffset) => ctx.set("verticalOffset", verticalOffset)}
                />
              )
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-heading-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
