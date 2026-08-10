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
 * field (`showTitle` → `tableTitle`, `showAddButton` → `addButtonLabel`) is
 * one control pair and stays adjacent in the same strip, toggle first, on the
 * axis where the field belongs. Only toggles gating a whole region with no
 * sibling field (`showEditButton`, `showDeleteButton`) stay on Structure.
 * Keys, fallbacks and visibleWhen are unchanged.
 *
 * A1 SORT (2026-08-10): no theme overrides — button labels and four
 * visibility toggles, with no colour, radius, border, shadow or font-family
 * control. Everything stays basic (A4).
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
            rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
          },
          {
            key: "tableTitle",
            label: "Title text",
            width: "text-md",
            control: "text",
            placeholder: "Team Members",
            fallback: "Team Members",
            visibleWhen: (s) => (s.showTitle ?? "true") === "true",
            rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
          },
          {
            key: "showAddButton",
            label: "Add button",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
          },
          {
            key: "addButtonLabel",
            label: "Add button label",
            width: "text-md",
            control: "text",
            placeholder: "Add Team Member",
            fallback: "Add Team Member",
            visibleWhen: (s) => (s.showAddButton ?? "true") === "true",
            rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
          }
        ]
      ]
    },
    {
      title: "Structure",
      strips: [
        [
          {
            key: "showEditButton",
            label: "Edit button",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
          },
          {
            key: "showDeleteButton",
            label: "Delete button",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
          }
        ]
      ]
    }
  ]
};

export function BuilderAdminTeamUsersModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
