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
   *
   * A1 sort (2026-08-10): every one of Frame's four controls is theme-backed
   * — three colours and a border thickness — so the whole row moved into
   * Frame's own Advanced section, and the X/Y offsets and Z-Index moved into
   * Placement's (A5), taking their explanatory hint with them. Both basic
   * rows are therefore empty; the columns hold their place so the Advanced
   * grid stays aligned. The four colours keep their `custom` renders: each
   * one round-trips through normalizeBuilderHexColor and treats an empty
   * value as its hardcoded default, so converting them to `theme-color`
   * (A2) would change what an empty setting MEANS — that conversion needs
   * the runtime to learn "empty = follow the theme" first.
   * Content, Width and Height are the module's own settings (A4).
   *
   * SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
   * Everything above that "moved into Advanced" now sits LAST on the axis it
   * already names, ordered by D9 (blast radius, descending). The axis
   * assignments and the A2 theme-colour semantics are unchanged — only the
   * collapsing is gone. Kept rather than rewritten: the reasoning is the record.
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
        ],
        // A5: offsets and the stacking order they travel with are nudges,
        // not everyday placement — the hint moves with the fields it explains.
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
        ],
        // A2 theme values, sorted last on Frame (D9). Left
        // as `custom` renders on purpose; see the note at the top of the file.
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
