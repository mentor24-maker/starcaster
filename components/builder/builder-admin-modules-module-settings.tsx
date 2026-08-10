"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * D8 logical axes (docs/UI_RULES.md): Content / Structure.
 *
 * PAIRING RULE — do not re-split: a toggle that gates ONE specific sibling
 * field (`showTitle` → `tableTitle`) is one control pair and stays adjacent
 * in the same strip, toggle first, on the axis where the field belongs.
 * Only a toggle gating a whole region with no sibling field (`showToggle`)
 * lives on Structure.
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
          }
        ]
      ]
    },
    {
      title: "Structure",
      strips: [
        [
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
    }
  ]
};

export function BuilderAdminModulesModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
