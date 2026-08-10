"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * D8 logical axes (docs/UI_RULES.md): Content only. The module is one link —
 * its words and its destination, both Content. Inventing a second axis to
 * fill the row would put controls somewhere they do not belong.
 */
const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
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
            control: "picker",
            source: "pages",
            valueKind: "path",
            placeholder: "/admin-login",
            fallback: "/admin-login",
            rendersVia: "AdminNavLinkPreview (builder-template-preview.tsx)"
          }
        ]
      ]
    }
  ]
};

export function BuilderAdminNavLinkModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
