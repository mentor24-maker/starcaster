"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogSearchResultsModuleSettings({ module, onUpdateModule }: Props) {
  const schema: BuilderSettingsSchema = {
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Structure. Same
    // keys and fallbacks — only the column each control sits in changed.
    // Max Results is a count and Thumb Width is sizing, so both are Structure.
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "searchParam",
              label: "Search Param",
              width: "text-md",
              control: "custom",
              rendersVia: "BlogSearchResultsPreview",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.searchParam ?? "search"}
                  onChange={(e) => set("searchParam", e.target.value)}
                  placeholder="search"
                />
              )
            },
            {
              key: "postPageUrl",
              label: "Post Page URL",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "Default (/blog-post-view)",
              placeholder: "/blog-post-view",
              rendersVia: "BlogSearchResultsPreview"
            },
            {
              key: "emptyMessage",
              label: "Empty Message",
              width: "text-md",
              control: "custom",
              rendersVia: "BlogSearchResultsPreview",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.emptyMessage ?? "No posts found."}
                  onChange={(e) => set("emptyMessage", e.target.value)}
                  placeholder="No posts found."
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
                  <p>Must match the search param on the paired <strong>Blog Search</strong> module.</p>
                </div>
              )
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "limit",
              label: "Max Results",
              width: "num",
              control: "number",
              min: 1,
              max: 200,
              fallback: "50",
              rendersVia: "BlogSearchResultsPreview"
            },
            {
              key: "thumbWidth",
              label: "Thumb Width",
              width: "num",
              control: "number",
              min: 60,
              max: 240,
              fallback: "120",
              rendersVia: "BlogSearchResultsPreview"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-search-results-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
