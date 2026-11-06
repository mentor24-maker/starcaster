"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const RENDERS_VIA = "SpiralityTasksModule (builder-spirality-tasks-module.tsx)";

/**
 * Spirality Tasks (ticket 86bczt5t4). Content: the heading, then which project
 * the Tasks page opens on (D9: what it shows, ahead of the words). Structure:
 * whether the Submit Task button appears at all.
 *
 * There is no "show Register" toggle: Spirality is invite-only (SP-153; Dane,
 * 2026-11-06, "My team only"), so a teammate joins from an invite email that
 * brings them here with ?link=, and a page without one shows sign-in only.
 */
const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        [
          {
            key: "defaultProject",
            label: "Opens on project",
            width: "text-md",
            control: "text",
            placeholder: "spirality",
            fallback: "",
            rendersVia: RENDERS_VIA
          },
          {
            key: "heading",
            label: "Heading",
            width: "text-md",
            control: "text",
            placeholder: "Tasks",
            fallback: "Tasks",
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    },
    {
      title: "Structure",
      strips: [
        [
          {
            key: "showSubmitTask",
            label: "Submit Task",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    }
  ],
};

export function BuilderSpiralityTasksModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
