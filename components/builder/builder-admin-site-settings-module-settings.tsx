"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * D8 logical axes (docs/UI_RULES.md): Content only.
 *
 * PAIRING RULE — do not re-split: a toggle that gates ONE specific sibling
 * field (`showTitle` → `panelTitle`) is one control pair and stays adjacent
 * in the same strip, toggle first, on the axis where the field belongs. That
 * pair is this module's only setting, so there is no Structure axis to title.
 *
 * A1 SORT (2026-08-10): no theme overrides — a show/hide toggle and its title
 * text, neither of which second-guesses the theme. Both stay basic (A4).
 */
const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        [
          {
            key: "showTitle",
            label: "Show title",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: "AdminSiteSettingsPreview (builder-template-preview.tsx)"
          },
          {
            key: "panelTitle",
            label: "Title text",
            width: "text-md",
            control: "text",
            placeholder: "Site Settings",
            fallback: "Site Settings",
            visibleWhen: (s) => (s.showTitle ?? "true") === "true",
            rendersVia: "AdminSiteSettingsPreview (builder-template-preview.tsx)"
          }
        ]
      ]
    }
  ]
};

export function BuilderAdminSiteSettingsModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
