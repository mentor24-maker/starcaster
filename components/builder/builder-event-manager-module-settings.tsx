"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderEventManagerModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  /*
   * The same three axes the Post Manager panel uses (D8): a destination is
   * Content, the column toggles are Structure, the module's own colour is
   * Frame. Within each axis, blast radius descending (D9).
   *
   * There is no Edit Page picker here, unlike the Post Manager: this module
   * edits in place, in its own form, so there is no second page to send the
   * operator to. The one page setting it does have is where a "View" click
   * goes on the public site — the event detail page, which is the next
   * ticket. Empty means the View button is disabled rather than pointing at
   * a page that does not exist yet.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "viewPageUrl",
              label: "Event Page URL",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "None",
              placeholder: "/builder-preview.html?slug=event",
              rendersVia: "EventManagerPreview"
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "showStatus",
              label: "Status",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventManagerPreview"
            },
            {
              key: "showDate",
              label: "Date",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventManagerPreview"
            },
            {
              key: "showLocation",
              label: "Location",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventManagerPreview"
            },
            {
              key: "showDelete",
              label: "Delete",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventManagerPreview"
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "accentColor",
              label: "Accent Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Accent color",
              themeDefault: "#0f4f8f",
              rendersVia: "EventManagerPreview"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-event-manager-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
