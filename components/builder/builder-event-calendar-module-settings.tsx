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

/** The month grid has no card count and no cap — every day of the month shows. */
const isCardLayout = (settings: Record<string, string>) =>
  (settings.layout || "month") !== "month";

const isGridLayout = (settings: Record<string, string>) =>
  (settings.layout || "month") === "cards";

const isMonthLayout = (settings: Record<string, string>) =>
  (settings.layout || "month") === "month";

export function BuilderEventCalendarModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  /*
   * Three axes (D8), each field ordered by blast radius descending (D9):
   * the destination and heading are Content, the shape and what appears are
   * Structure, the module's own colour is Frame.
   *
   * Four fields are gated by layout (`visibleWhen`), because a control that
   * does nothing in the current mode is worse than one that is absent — it
   * reads as broken. Columns and Limit belong to the list and card layouts;
   * Week Starts On belongs to the month grid alone.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "calendarTitle",
              label: "Heading",
              width: "text-md",
              control: "text",
              placeholder: "Optional heading above the calendar",
              rendersVia: "EventCalendarPreview heading"
            },
            {
              key: "eventPageUrl",
              label: "Event Page",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "None (no links)",
              placeholder: "/event",
              rendersVia: "EventCalendarPreview event links"
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
              width: "select-md",
              control: "select",
              fallback: "month",
              options: [
                { value: "month", label: "Month Grid" },
                { value: "list", label: "Upcoming List" },
                { value: "cards", label: "Cards" }
              ],
              rendersVia: "EventCalendarPreview"
            },
            {
              key: "columns",
              label: "Columns",
              width: "num",
              control: "number",
              min: 1,
              max: 4,
              fallback: "3",
              visibleWhen: isGridLayout,
              rendersVia: "EventCalendarPreview card grid"
            },
            {
              key: "limit",
              label: "How Many",
              width: "num",
              control: "number",
              min: 1,
              max: 50,
              fallback: "12",
              visibleWhen: isCardLayout,
              rendersVia: "EventCalendarPreview"
            },
            {
              key: "weekStartsOn",
              label: "Week Starts",
              width: "select-sm",
              control: "select",
              fallback: "0",
              options: [
                { value: "0", label: "Sunday" },
                { value: "1", label: "Monday" }
              ],
              visibleWhen: isMonthLayout,
              rendersVia: "EventCalendarPreview monthGrid"
            }
          ],
          [
            {
              key: "showPast",
              label: "Past Events",
              width: "check",
              control: "checkbox",
              fallback: "false",
              rendersVia: "EventCalendarPreview"
            },
            {
              key: "showImages",
              label: "Images",
              width: "check",
              control: "checkbox",
              fallback: "true",
              visibleWhen: isCardLayout,
              rendersVia: "EventCalendarPreview"
            },
            {
              key: "showLocation",
              label: "Location",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "EventCalendarPreview"
            },
            {
              key: "showExcerpt",
              label: "Summary",
              width: "check",
              control: "checkbox",
              fallback: "true",
              visibleWhen: isCardLayout,
              rendersVia: "EventCalendarPreview"
            }
          ],
          [
            {
              key: "emptyMessage",
              label: "Empty Message",
              width: "full",
              control: "text",
              placeholder: "No events scheduled just yet — check back soon.",
              rendersVia: "EventCalendarPreview empty state"
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
              rendersVia: "EventCalendarPreview"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-event-calendar-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
