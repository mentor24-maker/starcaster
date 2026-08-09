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
        key: "linkText",
        label: "Link text",
        width: "text-md",
        control: "text",
        placeholder: "Admin",
        fallback: "Admin",
        rendersVia: "AdminNavLinkPreview (builder-template-preview.tsx)"
      },
      {
        key: "linkHref",
        label: "Link URL",
        width: "text-md",
        control: "text",
        placeholder: "/admin-login",
        fallback: "/admin-login",
        rendersVia: "AdminNavLinkPreview (builder-template-preview.tsx)"
      }
    ]
  ]
};

export function BuilderAdminNavLinkModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
