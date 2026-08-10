"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const SCHEMA: BuilderSettingsSchema = {
  content: [
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
};

export function BuilderAdminSiteSettingsModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
