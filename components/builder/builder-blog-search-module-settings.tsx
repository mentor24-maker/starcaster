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
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Frame. Same keys,
    // fallbacks and rendersVia — only the column each control sits in changed.
    // Button Color and Radius are the button's fill and corners, so they read
    // as Frame. The old panelColumns hint is gone: axes ARE the columns.
    // The search-param note stays with the field it explains.
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "placeholder",
              label: "Placeholder",
              width: "text-md",
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
            },
            {
              key: "targetPageUrl",
              label: "Results Page URL",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "Current page",
              placeholder: "/blog",
              rendersVia: "BlogSearchPreview"
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
            },
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
        ]
      },
      {
        title: "Frame",
        strips: [
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
      }
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
