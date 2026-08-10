"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { BuilderThemeColorField, type BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

function showsAllPill(settings: Record<string, string>): boolean {
  return (settings.showAll ?? "true") === "true";
}

export function BuilderMessagingTopicListModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  /*
   * Converted from hand-written strips to the schema generator with D8 axes
   * (2026-08-10): Content / Structure / Text / Placement, plus the Border
   * block that already lived in an Advanced <details>. Same keys, same
   * defaults, same conditional on the "All" label.
   *
   * The topic list's own fetch lives in MessagingTopicListPreview
   * (components/builder-template-preview.tsx), not in this editor — nothing
   * bespoke had to survive the conversion. Pill Radius sits on Structure
   * because it shapes the pills; the MODULE border is the Frame control and
   * it stays in Advanced where it has always been.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "showAll",
              label: "Show 'All'",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "MessagingTopicListPreview"
            }
          ],
          [
            {
              key: "allLabel",
              label: "'All' label",
              width: "full",
              control: "custom",
              visibleWhen: showsAllPill,
              rendersVia: "MessagingTopicListPreview",
              // Pre-filled with the default rather than left empty behind a
              // placeholder — kept exactly as the hand-written row behaved.
              render: (ctx) => (
                <input
                  type="text"
                  value={ctx.settings.allLabel ?? "All Topics"}
                  onChange={(event) => ctx.set("allLabel", event.target.value)}
                  placeholder="All Topics"
                />
              )
            }
          ],
          [
            {
              key: "targetPageUrl",
              label: "Post feed URL",
              width: "full",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "None",
              placeholder: "/builder-preview.html?slug=blog",
              rendersVia: "MessagingTopicListPreview"
            }
          ],
          [
            {
              key: "filterParam",
              label: "URL param",
              width: "full",
              control: "custom",
              rendersVia: "MessagingTopicListPreview",
              render: (ctx) => (
                <input
                  type="text"
                  value={ctx.settings.filterParam ?? "topic"}
                  onChange={(event) => ctx.set("filterParam", event.target.value)}
                  placeholder="topic"
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
              key: "layout",
              label: "Layout",
              width: "select-sm",
              control: "select",
              options: [
                { value: "pills", label: "Pills" },
                { value: "list", label: "List" },
                { value: "dropdown", label: "Dropdown" }
              ],
              fallback: "pills",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "borderRadius",
              label: "Radius",
              width: "num",
              control: "number",
              min: 0,
              max: 32,
              step: 2,
              fallback: "20",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "gap",
              label: "Gap",
              width: "num",
              control: "number",
              min: 4,
              max: 24,
              step: 2,
              fallback: "8",
              rendersVia: "MessagingTopicListPreview"
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
            {
              key: "fontSize",
              label: "Font size",
              width: "num",
              control: "number",
              min: 10,
              max: 20,
              fallback: "13",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "activeColor",
              label: "Active color",
              width: "color",
              control: "color",
              dialogLabel: "Active pill text color",
              fallback: "#0f4f8f",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "activeBg",
              label: "Active bg",
              width: "color",
              control: "color",
              dialogLabel: "Active pill background",
              fallback: "#0f4f8f",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "inactiveColor",
              label: "Inactive color",
              width: "color",
              control: "color",
              dialogLabel: "Inactive pill text color",
              fallback: "#587592",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "inactiveBg",
              label: "Inactive bg",
              width: "color",
              control: "color",
              dialogLabel: "Inactive pill background",
              fallback: "#f0f4f8",
              rendersVia: "MessagingTopicListPreview"
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
              width: "select-sm",
              control: "select",
              options: [
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" }
              ],
              fallback: "left",
              rendersVia: "MessagingTopicListPreview"
            }
          ]
        ]
      }
    ],
    advanced: {
      title: "Border",
      strips: [
        [
          {
            key: "moduleBorderColor",
            label: "Color",
            width: "color",
            control: "custom",
            rendersVia: "MessagingTopicListPreview",
            // `||` not `??`: an empty stored value falls back to black, as it
            // did before the conversion.
            render: (ctx) => (
              <BuilderThemeColorField
                dialogLabel="Module border color"
                fallback="#000000"
                themeColors={themeColors}
                value={ctx.settings.moduleBorderColor || "#000000"}
                onChange={(moduleBorderColor) => ctx.set("moduleBorderColor", moduleBorderColor)}
              />
            )
          },
          {
            key: "moduleBorderWidth",
            label: "Width",
            width: "num",
            control: "number",
            min: 0,
            max: 8,
            fallback: "0",
            rendersVia: "MessagingTopicListPreview"
          }
        ]
      ]
    }
  };

  return (
    <div className="builder-messaging-topic-list-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
