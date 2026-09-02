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

/** The back link's label is pointless with nowhere to go back to. */
const hasBackLink = (settings: Record<string, string>) =>
  Boolean((settings.backLinkUrl || "").trim());

export function BuilderEventDetailModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  /*
   * Three axes (D8), each ordered by blast radius descending (D9). The event
   * itself is not chosen here — this module renders whichever event the URL
   * names (`?event=<slug>`), which is what the calendar links to. So Content
   * holds the way OUT of the page and the words on its one button.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "backLinkUrl",
              label: "Back To",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "No back link",
              placeholder: "/whats-on",
              rendersVia: "EventDetailPreview back link"
            },
            {
              key: "backLinkLabel",
              label: "Back Label",
              width: "text-md",
              control: "text",
              fallback: "Back to all events",
              placeholder: "Back to all events",
              visibleWhen: hasBackLink,
              rendersVia: "EventDetailPreview back link"
            }
          ],
          [
            {
              key: "ctaLabel",
              label: "Button Label",
              width: "text-md",
              control: "text",
              fallback: "Get Tickets",
              placeholder: "Get Tickets",
              rendersVia: "EventDetailPreview call to action"
            }
          ],
          [
            {
              key: "notFoundMessage",
              label: "If Not Found",
              width: "full",
              control: "text",
              placeholder: "We could not find that event. It may have been removed.",
              rendersVia: "EventDetailPreview not-found state"
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "showImage",
              label: "Image",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventDetailPreview"
            },
            {
              key: "showDescription",
              label: "Description",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventDetailPreview"
            },
            {
              key: "showLocation",
              label: "Location",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventDetailPreview"
            },
            {
              key: "showOrganizer",
              label: "Organizer",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventDetailPreview"
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
              rendersVia: "EventDetailPreview"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-event-detail-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
