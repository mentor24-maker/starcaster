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

export function BuilderBlogSearchModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "placeholder",
          label: "Placeholder",
          width: "full",
          control: "custom",
          rendersVia: "BlogSearchPreview",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.placeholder ?? "Search posts…"}
              onChange={(e) => set("placeholder", e.target.value)}
              placeholder="Search posts…"
            />
          )
        }
      ],
      [
        {
          key: "buttonLabel",
          label: "Button Label",
          width: "text-md",
          control: "custom",
          rendersVia: "BlogSearchPreview",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.buttonLabel ?? "Search"}
              onChange={(e) => set("buttonLabel", e.target.value)}
              placeholder="Search"
            />
          )
        }
      ],
      [
        {
          key: "targetPageUrl",
          label: "Results Page URL",
          width: "full",
          control: "text",
          placeholder: "/blog (leave blank to stay on current page)",
          rendersVia: "BlogSearchPreview"
        }
      ],
      [
        {
          key: "searchParam",
          label: "Search Param",
          width: "text-md",
          control: "custom",
          rendersVia: "BlogSearchPreview",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.searchParam ?? "search"}
              onChange={(e) => set("searchParam", e.target.value)}
              placeholder="search"
            />
          )
        }
      ],
      [
        {
          key: "searchParamNote",
          label: "",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <div className="builder-module-runtime-note">
              <p>
                The search param must match the one set on the paired <strong>Blog Search Results</strong> module.
              </p>
            </div>
          )
        }
      ]
    ],
    style: [
      [
        {
          key: "accentColor",
          label: "Button Color",
          width: "color",
          control: "color",
          dialogLabel: "Button color",
          fallback: "#0f4f8f",
          rendersVia: "BlogSearchPreview"
        },
        {
          key: "borderRadius",
          label: "Radius",
          width: "num",
          control: "number",
          min: 0,
          max: 40,
          fallback: "8",
          rendersVia: "BlogSearchPreview"
        }
      ]
    ]
  };

  return (
    <div className="builder-blog-search-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
