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
    content: [
      [
        // C3: Show/Hide selects → checkboxes — same "true"/"false" stored values.
        { key: "showDescription", label: "Description", width: "check", control: "checkbox", fallback: "true" },
        { key: "showColor", label: "Color", width: "check", control: "checkbox", fallback: "true" },
        { key: "showSortOrder", label: "Sort Order", width: "check", control: "checkbox", fallback: "false" },
        { key: "showDelete", label: "Delete", width: "check", control: "checkbox", fallback: "true" },
        // D3: Accent rides the toggle strip instead of stranding a one-field
        // style group on its own row. Same key/fallback — layout only.
        { key: "accentColor", label: "Accent", width: "color", control: "color", dialogLabel: "Accent color", fallback: "#0f4f8f" }
      ]
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
