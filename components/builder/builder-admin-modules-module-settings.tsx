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
        width: "select-sm",
        control: "select",
        options: [
          { value: "true", label: "Show" },
          { value: "false", label: "Hide" }
        ],
        fallback: "true",
        rendersVia: "AdminModulesPreview (builder-template-preview.tsx)"
      },
      {
        key: "tableTitle",
        label: "Title text",
        width: "text-md",
        control: "text",
        placeholder: "Premium Modules",
        fallback: "Premium Modules",
        visibleWhen: (s) => (s.showTitle ?? "true") === "true",
        rendersVia: "AdminModulesPreview (builder-template-preview.tsx)"
      },
      {
        key: "showToggle",
        label: "Toggle buttons",
        width: "select-md",
        control: "select",
        options: [
          { value: "true", label: "Show" },
          { value: "false", label: "Hide (read-only)" }
        ],
        fallback: "true",
        rendersVia: "AdminModulesPreview (builder-template-preview.tsx)"
      }
    ]
  ]
};

export function BuilderAdminModulesModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
