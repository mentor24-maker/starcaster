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
   * bespoke had to survive the conversion. Pill Radius belongs to Structure
   * because it shapes the pills; the MODULE border is the Frame control and
   * it stays in Advanced where it has always been.
   *
   * A1 SORT (2026-08-10):
   *  - The four pill colours (Active/Inactive text and background) are theme
   *    overrides, so they left the Text axis's basic strip for that axis's
   *    own `advanced` and became `theme-color` (A2). Each themeDefault is the
   *    hex that used to be its fallback, so the control still SHOWS the same
   *    colour; what changed is that an unset value now means "follow the
   *    theme" rather than pre-filling an override nobody chose.
   *  - Pill Radius is a border radius, which the criteria treat as
   *    theme-backed, so it moved to Structure's `advanced` — still under
   *    Structure, the axis it belongs to, just collapsed. It stays a plain
   *    number control; only COLOURS convert to `theme-color`.
   *  - Font size stays basic: a per-module decision, not a brand token.
   *    Layout, Gap, Alignment and the whole Content axis stay basic (A4).
   *  - The "Border" group below is already Advanced and is left exactly as
   *    it was. Its colour is a `custom` render whose `||` fallback semantics
   *    would change under conversion, so per A2's escape hatch it moves
   *    nowhere and converts to nothing.
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
          ,
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
        ],
        // A1: a border radius is theme-backed, so Pill Radius collapses into
        // Structure's own Advanced rather than leaving the axis it belongs to.
        advanced: [
          [
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
            }
          ]
        ],
        // A1/A2: the pill colours are theme overrides. Empty now means
        // "follow the theme"; themeDefault carries the old fallback hex, so
        // the swatch shows what it always showed.
        advanced: [
          [
            {
              key: "activeColor",
              label: "Active color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Active pill text color",
              themeDefault: "#0f4f8f",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "activeBg",
              label: "Active bg",
              width: "color",
              control: "theme-color",
              dialogLabel: "Active pill background",
              themeDefault: "#0f4f8f",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "inactiveColor",
              label: "Inactive color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Inactive pill text color",
              themeDefault: "#587592",
              rendersVia: "MessagingTopicListPreview"
            },
            {
              key: "inactiveBg",
              label: "Inactive bg",
              width: "color",
              control: "theme-color",
              dialogLabel: "Inactive pill background",
              themeDefault: "#f0f4f8",
              rendersVia: "MessagingTopicListPreview"
            }
          ]
        ]
      },
      {
        /*
         * Frame instead of a Placement axis (2026-08-10): this module had
         * FOUR axes plus a separate top-level "Border" group, so the
         * operator would have seen two collapsibles — "Advanced" then
         * "Border" — against his ruling that advanced controls sit under
         * the same columns as the basic settings. Alignment is the only
         * Placement control and reads fine as arrangement, so it moved to
         * Structure and Frame takes the freed axis. Keys unchanged.
         */
        title: "Frame",
        strips: [],
        advanced: [
          [
            {
              key: "moduleBorderColor",
              label: "Color",
              width: "color",
              control: "custom",
              rendersVia: "MessagingTopicListPreview",
              // `||` not `??`: an empty stored value falls back to black, as
              // it did before the conversion — so this is NOT a theme-color
              // control until that default is flipped (A2).
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
    ]
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
