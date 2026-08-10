"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogPostManagerModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "editPageUrl",
          label: "Edit Page URL",
          width: "text-md",
          control: "picker",
          source: "pages",
          valueKind: "path",
          noneLabel: "Auto",
          placeholder: "/builder-preview.html?slug=blog-post-edit",
          rendersVia: "BlogPostManagerPreview"
        },
        {
          key: "viewPageUrl",
          label: "View Page URL",
          width: "text-md",
          control: "picker",
          source: "pages",
          valueKind: "path",
          noneLabel: "Auto",
          placeholder: "/builder-preview.html?slug=blog-post-view",
          rendersVia: "BlogPostManagerPreview"
        }
      ],
      [
        {
          key: "showStatus",
          label: "Status",
          width: "check",
          control: "checkbox",
          fallback: "true",
          rendersVia: "BlogPostManagerPreview"
        },
        {
          key: "showDate",
          label: "Date",
          width: "check",
          control: "checkbox",
          fallback: "true",
          rendersVia: "BlogPostManagerPreview"
        },
        {
          key: "showDelete",
          label: "Delete",
          width: "check",
          control: "checkbox",
          fallback: "true",
          rendersVia: "BlogPostManagerPreview"
        },
        {
          key: "accentColor",
          label: "Accent Color",
          width: "color",
          control: "color",
          dialogLabel: "Accent color",
          fallback: "#0f4f8f",
          rendersVia: "BlogPostManagerPreview"
        }
      ]
    ]
  };

  return (
    <div className="builder-blog-post-manager-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
