"use client";

import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeSignedOffsetValue } from "@/lib/builder-template";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { BuilderThemeColorField, type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderSpeechBubbleModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  richTextGallery?: RichTextGalleryBinding;
  themeColors?: BuilderThemePalette;
};

const OFFSET_INPUT_STYLE = { width: "9ch" } as const;

export function BuilderSpeechBubbleModuleSettings({
  module,
  onUpdateModule,
  richTextGallery,
  themeColors = []
}: BuilderSpeechBubbleModuleSettingsProps) {
  /*
   * D8 axes (2026-08-10): Content / Structure / Placement / Frame. Text
   * Color rides Frame with the other three swatches rather than opening a
   * fifth "Text" column for a single field — the four colours were already
   * one strip, and four axes is the ceiling.
   *
   * (Replaces the D2 panelColumns pairing that put rich text left and the
   * short layout + style strips right.)
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "text",
              label: "Content",
              width: "full",
              control: "custom",
              rendersVia: "builder-speech-bubble-runtime",
              render: () => (
                <BuilderRichTextEditor
                  value={module.text}
                  onChange={(value) => onUpdateModule((current) => ({ ...current, text: value }))}
                  {...richTextGallery}
                />
              )
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "containerWidth",
              label: "Width",
              width: "num",
              control: "number",
              min: 200,
              max: 900,
              step: 10,
              fallback: "520",
              rendersVia: "builder-speech-bubble-runtime"
            },
            {
              key: "containerHeight",
              label: "Height",
              width: "num",
              control: "number",
              min: 0,
              max: 800,
              step: 10,
              fallback: "0",
              rendersVia: "builder-speech-bubble-runtime"
            }
          ],
          [
            {
              key: "heightNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <span className="builder-module-offset-hint">
                  Height 0 fits the content; larger values set a minimum height.
                </span>
              )
            }
          ]
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "offsetX",
              label: "X Offset",
              width: "num",
              control: "custom",
              rendersVia: "builder-speech-bubble-runtime",
              render: ({ settings, set }) => (
                <input
                  type="number"
                  min={-500}
                  max={500}
                  step={1}
                  style={OFFSET_INPUT_STYLE}
                  value={settings.offsetX ?? "0"}
                  onChange={(event) => set("offsetX", normalizeSignedOffsetValue(event.target.value, "0"))}
                />
              )
            },
            {
              key: "offsetY",
              label: "Y Offset",
              width: "num",
              control: "custom",
              rendersVia: "builder-speech-bubble-runtime",
              render: ({ settings, set }) => (
                <input
                  type="number"
                  min={-500}
                  max={500}
                  step={1}
                  style={OFFSET_INPUT_STYLE}
                  value={settings.offsetY ?? "0"}
                  onChange={(event) => set("offsetY", normalizeSignedOffsetValue(event.target.value, "0"))}
                />
              )
            },
            {
              key: "zIndex",
              label: "Z-Index",
              width: "num",
              control: "custom",
              rendersVia: "builder-speech-bubble-runtime",
              render: ({ settings, set }) => (
                <input
                  type="number"
                  min={-999}
                  max={999999}
                  step={1}
                  style={OFFSET_INPUT_STYLE}
                  value={settings.zIndex ?? "10"}
                  onChange={(event) => set("zIndex", event.target.value)}
                />
              )
            }
          ],
          [
            {
              key: "offsetNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <span className="builder-module-offset-hint">
                  Positive X moves right; positive Y moves up. Higher Z-Index stacks in front.
                </span>
              )
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "backgroundColor",
              label: "Background",
              width: "color",
              control: "custom",
              rendersVia: "builder-speech-bubble-runtime",
              render: ({ settings, set }) => (
                <BuilderThemeColorField
                  dialogLabel="Background color"
                  fallback="#ffffff"
                  themeColors={themeColors}
                  value={normalizeBuilderHexColor(settings.backgroundColor || "#ffffff")}
                  onChange={(backgroundColor) => set("backgroundColor", normalizeBuilderHexColor(backgroundColor))}
                />
              )
            },
            {
              key: "borderColor",
              label: "Border Color",
              width: "color",
              control: "custom",
              rendersVia: "builder-speech-bubble-runtime",
              render: ({ settings, set }) => (
                <BuilderThemeColorField
                  dialogLabel="Border color"
                  fallback="#9ed4ee"
                  themeColors={themeColors}
                  value={normalizeBuilderHexColor(settings.borderColor || "#9ed4ee")}
                  onChange={(borderColor) => set("borderColor", normalizeBuilderHexColor(borderColor))}
                />
              )
            },
            {
              key: "borderThickness",
              label: "Border",
              width: "num",
              control: "number",
              min: 0,
              max: 24,
              fallback: "2",
              rendersVia: "builder-speech-bubble-runtime"
            },
            {
              key: "textColor",
              label: "Text Color",
              width: "color",
              control: "custom",
              rendersVia: "builder-speech-bubble-runtime",
              render: ({ settings, set }) => (
                <BuilderThemeColorField
                  dialogLabel="Text color"
                  fallback="#18324a"
                  themeColors={themeColors}
                  value={normalizeBuilderHexColor(settings.textColor || "#18324a")}
                  onChange={(textColor) => set("textColor", normalizeBuilderHexColor(textColor))}
                />
              )
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-speech-bubble-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
