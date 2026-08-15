"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { borderStyleOptions } from "./builder-button-border-picker";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import {
  BuilderSchemaModuleSettings,
  MODULE_MARGIN_SIDES,
  paddingFields,
  type BuilderSchemaFieldContext,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { getModuleAlignment, getModuleBackgroundSettings } from "./builder-utils";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderTextModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (
    updater: (
      background: import("@/lib/builder-template").BackgroundSettings
    ) => import("@/lib/builder-template").BackgroundSettings
  ) => void;
  themeColors?: BuilderThemePalette;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

/**
 * The rich-text ("paragraph") module's settings, as D8 axes. Until 2026-08-15
 * this module lived on the shared chrome alone — Background, Alignment, the
 * four margins, and Width, with no frame and no padding, so a bordered or
 * padded text box could only be faked with an outer section. The operator
 * asked for the missing columns outright ("border controls... two more
 * columns for Border and Placement", 2026-08-14).
 *
 * The chrome's controls move here rather than rendering twice (E6 — the
 * Navigation lesson: two Alignment controls doing different things). The
 * Simple Text variant keeps the chrome; only the rich-text editor takes
 * these axes.
 *
 *   Structure   Width, Background — how much column the block takes and
 *               what it sits on.
 *   Text        the block's vertical rhythm: line height, then the gap
 *               between paragraphs (added 2026-08-15 — the module had
 *               neither, so a footer link column could not be tightened
 *               at all).
 *   Placement   Alignment → margins → padding → offsets (D9: the nudge is
 *               the finest adjustment, last).
 *   Frame       the operator's "Border" column, under its canonical D8
 *               title: style → width → colour → radius.
 *
 * Four axes is the D8 ceiling; a fifth is a design question for the
 * operator, not a thing to squeeze in.
 *
 * Content is not an axis here: the rich-text editor itself is the Content
 * surface, rendered full-width below by the module card.
 */
export function BuilderTextModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: BuilderTextModuleSettingsProps) {
  const schema: BuilderSettingsSchema = {
    axes: [
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
              options: ["25", "33", "50", "66", "75", "90", "100"].map((value) => ({
                value,
                label: `${value}%`
              })),
              rendersVia: "getTextModuleWidthStyle"
            }
          ],
          [
            {
              key: "background",
              label: "Background",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "getBuilderBackgroundStyle",
              render: () => (
                <BuilderBackgroundControls
                  label="Background"
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  onChange={onUpdateModuleBackground}
                  themeBackgroundColor={themeBackgroundColor}
                  themeColors={themeColors}
                  themePrimaryColor={themePrimaryColor}
                />
              )
            }
          ]
        ]
      },
      {
        // The block's vertical rhythm. Both default to empty — "follow the
        // theme" (A2) — so no existing text block changes until one is set.
        // D9: line height touches every line in the module; the paragraph gap
        // only touches the seams between them.
        title: "Text",
        strips: [
          [
            {
              key: "lineHeight",
              label: "Line Height",
              width: "select-sm",
              control: "select",
              fallback: "",
              options: [
                { value: "", label: "Theme" },
                ...["1", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.75", "2"].map((value) => ({
                  value,
                  label: value
                }))
              ],
              rendersVia: "getTextModuleRhythmStyle"
            },
            {
              key: "paragraphGap",
              label: "Paragraph Gap",
              width: "select-sm",
              control: "select",
              fallback: "",
              options: [
                { value: "", label: "Default" },
                ...["0", "2", "4", "6", "8", "10", "12", "14", "18", "24", "32", "40"].map(
                  (value) => ({ value, label: `${value}px` })
                )
              ],
              rendersVia: "getTextModuleRhythmStyle"
            }
          ]
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "alignment",
              label: "Alignment",
              width: "align",
              control: "custom",
              rendersVia: "getAlignmentClass",
              render: (ctx: BuilderSchemaFieldContext) => (
                <BuilderAlignmentIconGroup
                  value={getModuleAlignment(ctx.settings)}
                  onChange={(alignment) => ctx.set("alignment", alignment)}
                />
              )
            },
            // The four sides, read through the same legacy vertical/horizontal
            // fallback the renderer resolves with (same as the chrome strip
            // this replaces): a page that has not been re-saved keeps showing
            // the numbers it is actually rendering.
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
          // Padding is the frame half of spacing — between the border and the
          // words — which the text module never had (the image module got its
          // half on 2026-08-11).
          paddingFields("getTextModuleFrameStyle"),
          // D9 rung 6, last on the axis: nudges, not everyday placement.
          [
            {
              key: "horizontalOffset",
              label: "Offsets",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "getModuleNudgeTransform",
              render: (ctx: BuilderSchemaFieldContext) => (
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
      },
      {
        // Frame's order is style, width, colour, then radius (D9 — mode
        // before size before colour, fine adjustment last).
        title: "Frame",
        strips: [
          [
            {
              key: "borderStyle",
              label: "Style",
              width: "select-md",
              control: "select",
              fallback: "solid",
              options: borderStyleOptions,
              rendersVia: "getTextModuleFrameStyle"
            },
            {
              key: "borderWidth",
              label: "Border",
              width: "num",
              control: "number",
              min: 0,
              max: 24,
              fallback: "0",
              rendersVia: "getTextModuleFrameStyle"
            },
            {
              key: "borderColor",
              label: "Border Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Text border color",
              themeDefault: "#214c71",
              rendersVia: "getTextModuleFrameStyle"
            },
            {
              key: "borderRadius",
              label: "Radius",
              width: "num",
              control: "number",
              min: 0,
              max: 80,
              step: 5,
              fallback: "0",
              rendersVia: "getTextModuleFrameStyle"
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
