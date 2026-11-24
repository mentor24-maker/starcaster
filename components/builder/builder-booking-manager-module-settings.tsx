"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * Settings for the Booking Manager module (SC-910).
 *
 * The calendar's own settings (hours, meeting length, wording) are NOT here:
 * they belong to the calendar and are edited on the Booking Manager screen
 * itself, so they stay one value however many pages show the manager. This
 * panel only shapes the module: its title, and which page a booking's
 * "Open CRM Contact" link opens.
 *
 * D8 axes: Content only. `showTitle` gates `panelTitle`, so they share a strip,
 * toggle first. `contactsPageUrl` is a page picker (a typed address breaks
 * when the page is renamed, landmine 19); the module adds `?contact=<id>` to
 * it, so it offers no section (lib/pageInboundLinks.js NO_SECTION_LINK_SETTINGS).
 */
const RENDERS_VIA = "BookingManagerModule (builder-booking-manager-module.tsx)";

const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        [
          {
            key: "showTitle",
            label: "Show Title",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: RENDERS_VIA
          },
          {
            key: "panelTitle",
            label: "Title Text",
            width: "text-md",
            control: "text",
            placeholder: "Booking Manager",
            fallback: "Booking Manager",
            visibleWhen: (s) => (s.showTitle ?? "true") === "true",
            rendersVia: RENDERS_VIA
          }
        ],
        [
          {
            key: "contactsPageUrl",
            label: "Contact Manager Page",
            width: "text-md",
            control: "picker",
            source: "pages",
            valueKind: "path",
            noneLabel: "— Default —",
            placeholder: "/admin-contact-manager",
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    }
  ]
};

export function BuilderBookingManagerModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-booking-manager-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
