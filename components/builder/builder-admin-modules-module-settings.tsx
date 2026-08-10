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
        // The old select's Hide option read "Hide (read-only)" — that nuance
        // (unchecked leaves visitors a read-only modules list) rides on the
        // tooltip so it cannot silently disappear (L7).
        key: "showToggle",
        label: "Toggle buttons",
        width: "check",
        control: "custom",
        fallback: "true",
        rendersVia: "AdminModulesPreview (builder-template-preview.tsx)",
        render: (ctx) => (
          <input
            type="checkbox"
            title="Unchecked: modules list is read-only"
            checked={(ctx.settings.showToggle ?? "true") === "true"}
            onChange={(event) => ctx.set("showToggle", event.target.checked ? "true" : "false")}
          />
        )
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
