"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  /** The theme's swatches; an empty Accent Color follows the Primary one. */
  themeColors?: BuilderThemePalette;
};

/**
 * Settings for the visitor's Booking Calendar module (SC-911).
 *
 * The calendar's own settings (opening hours, meeting length, the wording
 * visitors read) are NOT here: they belong to the calendar and are edited on
 * the Booking Manager, so one change reaches every page that shows it. This
 * panel only chooses WHICH calendar and shapes the module.
 *
 * D8 axes, each ordered by blast radius (D9): Content is the source (which
 * calendar, stored by id, landmine 19) then the heading; Structure is the
 * week's first day; Frame is the accent colour, empty = the theme's (A2).
 */
const RENDERS_VIA = "BookingCalendarModule (builder-booking-calendar-module.tsx)";

function schemaFor(themePrimary: string): BuilderSettingsSchema {
  return {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "calendarId",
              label: "Calendar",
              width: "text-md",
              control: "picker",
              source: "booking-calendars",
              valueKind: "id",
              noneLabel: "— First calendar —",
              placeholder: "Calendar id",
              rendersVia: RENDERS_VIA
            },
            {
              key: "heading",
              label: "Heading",
              width: "text-md",
              control: "text",
              placeholder: "The calendar's own heading",
              rendersVia: RENDERS_VIA
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
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
              rendersVia: RENDERS_VIA
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
              themeDefault: themePrimary || "#0f4f8f",
              rendersVia: RENDERS_VIA
            }
          ]
        ]
      }
    ]
  };
}

export function BuilderBookingCalendarModuleSettings({ module, onUpdateModule, themeColors = [] }: Props) {
  // The renderer falls back to the theme's primary colour (themePalette in
  // BookingCalendarModule), so the empty control shows that same colour.
  const themePrimary = themeColors.find((c) => /primary/i.test(c.label))?.hex ?? "";
  return (
    <div className="builder-booking-calendar-settings">
      <BuilderSchemaModuleSettings
        schema={schemaFor(themePrimary)}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
