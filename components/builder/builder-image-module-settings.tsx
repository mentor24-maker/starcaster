import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderImageModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

const SIZE_OPTIONS = ["10", "15", "25", "33", "50", "66", "75", "90", "100"];

const EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "bounce", label: "Bounce" },
  { value: "fast-bounce", label: "Fast Bounce" },
  { value: "big-bounce", label: "Big Bounce" },
  { value: "spin", label: "Spin" },
  { value: "cruise", label: "Cruise" },
  { value: "tumbleweed", label: "Tumbleweed" }
];

/**
 * Shared "prime" image controls, used by the image module and by nested
 * images (e.g. inside table cells), so an image gets the same treatment
 * wherever it lives.
 *
 * REFERENCE IMPLEMENTATION for the settings-editor layout standard —
 * see "Settings editor layout" in docs/MODULE_STANDARDS.md. Controls are
 * sorted onto logical axes (master rule D8, 2026-08-10) — Content /
 * Structure / Frame, each a titled column — every control declares a
 * width token, and every setting here is honoured by the renderer
 * (`getImageModuleStyle` / `BuilderImagePreview`). The axes replace the
 * old content/layout/style trio plus `panelColumns`: the lone Width
 * select is a column of its own rather than a stranded row (D1/D3).
 *
 * A1 sort (2026-08-10): the border trio — thickness, radius and colour —
 * are theme values, so they moved into Frame's own Advanced section, and
 * Border Color became a `theme-color` override whose themeDefault is its
 * old fallback (A2). Effect stays basic: it is an appearance mode the
 * theme knows nothing about, not an override. Alt text and Width are the
 * module's own settings and stay basic (A4).
 */
export function BuilderImageModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: BuilderImageModuleSettingsProps) {
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "alt",
              label: "Alt text",
              width: "full",
              control: "text",
              placeholder: "Describe the image for screen readers",
              rendersVia: "BuilderImagePreview"
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "size",
              label: "Width",
              width: "select-sm",
              control: "select",
              fallback: "100",
              options: SIZE_OPTIONS.map((value) => ({ value, label: `${value}%` })),
              rendersVia: "getImageModuleStyle"
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "effect",
              label: "Effect",
              width: "select-md",
              control: "select",
              fallback: "none",
              options: EFFECT_OPTIONS,
              rendersVia: "getImageModuleStyle"
            }
          ]
        ],
        // A1: the border's thickness, corners and colour are all theme values.
        advanced: [
          [
            {
              key: "borderThickness",
              label: "Border",
              width: "num",
              control: "number",
              min: 0,
              max: 24,
              fallback: "0",
              rendersVia: "getImageModuleStyle"
            },
            {
              key: "borderRadius",
              label: "Radius",
              width: "num",
              control: "number",
              min: 0,
              max: 80,
              fallback: "18",
              rendersVia: "getImageModuleStyle"
            },
            {
              key: "borderColor",
              label: "Border Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Image border color",
              themeDefault: "#0f4f8f",
              rendersVia: "getImageModuleStyle"
            }
          ]
        ]
      }
    ]
  };

  return (
    <BuilderSchemaModuleSettings
      schema={schema}
      module={module}
      onUpdateModule={onUpdateModule}
      themeColors={themeColors}
    />
  );
}
