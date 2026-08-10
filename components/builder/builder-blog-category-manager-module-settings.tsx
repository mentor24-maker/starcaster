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

const SHOW_HIDE = [
  { value: "true", label: "Show" },
  { value: "false", label: "Hide" }
];

const HIDE_SHOW = [
  { value: "false", label: "Hide" },
  { value: "true", label: "Show" }
];

export function BuilderBlogCategoryManagerModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        { key: "showDescription", label: "Description", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showColor", label: "Color", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showSortOrder", label: "Sort Order", width: "select-sm", control: "select", fallback: "false", options: HIDE_SHOW },
        { key: "showDelete", label: "Delete", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
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
