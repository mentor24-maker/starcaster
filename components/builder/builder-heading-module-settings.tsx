"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderButtonDropShadowSettings } from "./builder-button-drop-shadow-settings";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import {
  BUILDER_HEADING_FONTS,
  getModuleSplitMarginValues,
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
  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const schema: BuilderSettingsSchema = {
    content: [
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
          rendersVia: "BuilderHeadingPreview",
          // Edits module.text, not a settings key.
          render: (ctx) => (
            <input
              type="text"
              value={ctx.module.text}
              onChange={(event) =>
                onUpdateModule((current) => ({
                  ...current,
                  text: event.target.value
                }))
              }
              placeholder="Enter heading"
            />
          )
        }
      ]
    ],
    layout: [
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
        // Read via the same helper getModuleMarginStyle renders with, legacy
        // fallback included — table-cell headings are never normalized, so
        // reading marginTop directly would show 0 while the page renders the
        // legacy value.
        {
          key: "marginTop",
          label: "Top Margin",
          width: "num",
          control: "custom",
          rendersVia: "getModuleMarginStyle",
          render: (ctx) => (
            <BuilderNumberSelectControl
              value={getModuleSplitMarginValues(ctx.settings).top}
              min={0}
              max={160}
              fallback="0"
              onChange={(marginTop) => ctx.set("marginTop", marginTop)}
            />
          )
        },
        {
          key: "marginBottom",
          label: "Bottom Margin",
          width: "num",
          control: "custom",
          rendersVia: "getModuleMarginStyle",
          render: (ctx) => (
            <BuilderNumberSelectControl
              value={getModuleSplitMarginValues(ctx.settings).bottom}
              min={0}
              max={160}
              fallback="0"
              onChange={(marginBottom) => ctx.set("marginBottom", marginBottom)}
            />
          )
        },
        // Horizontal margin capability added by operator ruling 2026-08-09
        // (UI_RULES.md S2 audit item). Pairs with the Top/Bottom split above.
        {
          key: "horizontalMargin",
          label: "H Margin",
          width: "num",
          control: "number",
          min: 0,
          max: 160,
          fallback: "0",
          rendersVia: "getModuleMarginStyle"
        }
      ]
    ],
    style: [
      [
        {
          key: "fontFamily",
          label: "Font",
          width: "auto",
          control: "select",
          options: BUILDER_HEADING_FONTS.map((font) => ({ value: font.key, label: font.label })),
          fallback: "",
          rendersVia: "getHeadingFontStack"
        },
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
          key: "color",
          label: "Color",
          width: "color",
          control: "color",
          dialogLabel: "Heading color",
          fallback: "#18324a",
          rendersVia: "getHeadingModuleStyle"
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
      [
        {
          key: "dropShadow",
          label: "Drop Shadow",
          width: "full",
          control: "custom",
          bare: true,
          visibleWhen: () => !compact,
          rendersVia: "getModuleDropShadowStyle",
          render: (ctx) => (
            <BuilderButtonDropShadowSettings
              settings={ctx.settings}
              themeColors={themeColors}
              onUpdateSetting={updateSetting}
            />
          )
        }
      ],
      [
        // Offsets render in BOTH compact and full mode.
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
