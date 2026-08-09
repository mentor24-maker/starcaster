"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const SHOW_HIDE_OPTIONS = [
  { value: "true", label: "Show" },
  { value: "false", label: "Hide" }
];

const SCHEMA: BuilderSettingsSchema = {
  content: [
    [
      {
        key: "showTitle",
        label: "Show table title",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
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
      }
    ],
    [
      {
        key: "rowActionsNote",
        label: "",
        width: "full",
        control: "custom",
        bare: true,
        render: () => <div className="builder-breadcrumb-items-label">Row actions</div>
      }
    ],
    [
      {
        key: "showEditButton",
        label: "Edit button",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
        fallback: "true",
        rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
      },
      {
        key: "showDeleteButton",
        label: "Delete button",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
        fallback: "true",
        rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
      },
      {
        key: "showAddButton",
        label: "Add button",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
        fallback: "true",
        rendersVia: "AdminTeamUsersPreview (builder-template-preview.tsx)"
      }
    ],
    [
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
};

export function BuilderAdminTeamUsersModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
