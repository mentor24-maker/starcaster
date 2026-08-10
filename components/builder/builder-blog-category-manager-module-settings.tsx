"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogCategoryManagerModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    // D8 logical axes: Structure / Frame. Every toggle here decides which
    // column the manager shows, so they are Structure, not Content — the
    // module's content is the category rows themselves, which come from
    // the database, not from settings.
    axes: [
      {
        title: "Structure",
        strips: [
          [
            // C3: Show/Hide selects → checkboxes — same "true"/"false" stored values.
            { key: "showDescription", label: "Description", width: "check", control: "checkbox", fallback: "true" },
            { key: "showColor", label: "Color", width: "check", control: "checkbox", fallback: "true" },
            { key: "showSortOrder", label: "Sort Order", width: "check", control: "checkbox", fallback: "false" },
            { key: "showDelete", label: "Delete", width: "check", control: "checkbox", fallback: "true" }
          ]
        ]
      },
      {
        // D3 note kept for its history: Accent used to ride the toggle strip
        // so a one-field style group would not strand itself on its own ROW.
        // Under D8 it gets its own COLUMN instead — same key, same fallback,
        // still no wasted row. It is the first thing to leave if border and
        // accent settings move to Themes, which would drop this to one axis.
        title: "Frame",
        strips: [
          [
            { key: "accentColor", label: "Accent", width: "color", control: "color", dialogLabel: "Accent color", fallback: "#0f4f8f" }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-category-manager-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
