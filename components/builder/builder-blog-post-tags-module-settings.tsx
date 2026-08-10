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

export function BuilderBlogPostTagsModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "tags",
          label: "Tags",
          width: "full",
          control: "text",
          placeholder: "react, typescript, tutorial",
          rendersVia: "BlogPostTagsPreview"
        }
      ],
      [
        {
          key: "tagsNote",
          label: "",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <p style={{ fontSize: 11, color: "#8ba9be", margin: "2px 0 12px", lineHeight: 1.4 }}>
              Comma-separated. On a post template these come from the Blog Post module&apos;s Taxonomy tab.
            </p>
          )
        }
      ],
      [
        {
          key: "showPrefix",
          label: "Prefix",
          width: "check",
          control: "checkbox",
          fallback: "true",
          rendersVia: "BlogPostTagsPreview"
        },
        {
          key: "prefix",
          label: "Prefix Text",
          width: "text-md",
          control: "custom",
          rendersVia: "BlogPostTagsPreview",
          visibleWhen: (settings) => (settings.showPrefix ?? "true") === "true",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.prefix ?? "Tags:"}
              onChange={(e) => set("prefix", e.target.value)}
              placeholder="Tags:"
            />
          )
        }
      ]
    ],
    layout: [
      [
        {
          key: "layout",
          label: "Layout",
          width: "auto",
          control: "select",
          options: [
            { value: "pills", label: "Pills" },
            { value: "inline", label: "Inline text" }
          ],
          fallback: "pills",
          rendersVia: "BlogPostTagsPreview"
        },
        {
          key: "gap",
          label: "Gap",
          width: "num",
          control: "number",
          min: 2,
          max: 16,
          step: 2,
          fallback: "6",
          rendersVia: "BlogPostTagsPreview"
        }
      ]
    ],
    style: [
      [
        {
          key: "color",
          label: "Tag Color",
          width: "color",
          control: "color",
          dialogLabel: "Tag color",
          fallback: "#587592",
          rendersVia: "BlogPostTagsPreview"
        },
        {
          key: "bgColor",
          label: "Tag Bg",
          width: "color",
          control: "color",
          dialogLabel: "Tag background",
          fallback: "#f0f4f8",
          rendersVia: "BlogPostTagsPreview"
        },
        {
          key: "borderRadius",
          label: "Radius",
          width: "num",
          control: "number",
          min: 0,
          max: 20,
          step: 2,
          fallback: "4",
          rendersVia: "BlogPostTagsPreview"
        },
        {
          key: "fontSize",
          label: "Font Size",
          width: "num",
          control: "number",
          min: 10,
          max: 18,
          step: 1,
          fallback: "12",
          rendersVia: "BlogPostTagsPreview"
        }
      ]
    ],
    advanced: [
      [
        {
          key: "linkToFilter",
          label: "Link to Filter",
          width: "check",
          control: "checkbox",
          fallback: "true",
          rendersVia: "builder-template.ts blog-post-tags renderer"
        },
        {
          key: "filterParam",
          label: "URL Param",
          width: "text-md",
          control: "custom",
          rendersVia: "builder-template.ts blog-post-tags renderer",
          visibleWhen: (settings) => (settings.linkToFilter ?? "true") === "true",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.filterParam ?? "tag"}
              onChange={(e) => set("filterParam", e.target.value)}
              placeholder="tag"
            />
          )
        },
        {
          key: "targetPageUrl",
          label: "Target Page",
          width: "text-md",
          control: "text",
          placeholder: "Leave blank for current page",
          rendersVia: "builder-template.ts blog-post-tags renderer",
          visibleWhen: (settings) => (settings.linkToFilter ?? "true") === "true"
        }
      ]
    ]
  };

  return (
    <div className="builder-blog-post-tags-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
        advancedLabel="Linking"
      />
    </div>
  );
}
