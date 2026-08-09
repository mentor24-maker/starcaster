"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

const DESTINATION_DEFAULTS: Record<string, string> = {
  "blog-search-results": "/blog-search-results",
  "blog-post-list": "/blog",
};

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

function resolveDestinationType(settings: Record<string, string>): string {
  return settings.destinationType ?? (settings.targetPageUrl ? "custom" : "none");
}

export function BuilderMessagingTagListModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  function setDestination(type: string) {
    const defaultUrl = DESTINATION_DEFAULTS[type] ?? "";
    onUpdateModule((current) => ({
      ...current,
      settings: {
        ...current.settings,
        destinationType: type,
        targetPageUrl: type === "none" ? "" : (defaultUrl || current.settings.targetPageUrl || ""),
      }
    }));
  }

  const destinationType = resolveDestinationType(module.settings);

  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "destinationType",
          label: "Destination",
          width: "select-md",
          control: "custom",
          rendersVia: "builder-template-preview messaging-tag-list",
          render: ({ settings }) => (
            <select value={resolveDestinationType(settings)} onChange={(e) => setDestination(e.target.value)}>
              <option value="none">No link</option>
              <option value="blog-search-results">Blog Search Results</option>
              <option value="blog-post-list">Blog Post List</option>
              <option value="custom">Custom</option>
            </select>
          )
        }
      ],
      [
        {
          key: "targetPageUrl",
          label: "Page URL",
          width: "full",
          control: "text",
          placeholder: DESTINATION_DEFAULTS[destinationType] ?? "/blog-search-results",
          visibleWhen: (settings) => resolveDestinationType(settings) !== "none",
          rendersVia: "builder-template-preview messaging-tag-list"
        }
      ],
      [
        {
          key: "filterParam",
          label: "URL Param",
          width: "text-md",
          control: "custom",
          visibleWhen: (settings) => resolveDestinationType(settings) === "custom",
          rendersVia: "builder-template-preview messaging-tag-list",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.filterParam ?? "tag"}
              placeholder="tag"
              onChange={(e) => set("filterParam", e.target.value)}
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
          width: "select-md",
          control: "select",
          fallback: "cloud",
          options: [
            { value: "cloud", label: "Cloud" },
            { value: "pills", label: "Pills" },
            { value: "list", label: "List" }
          ],
          rendersVia: "builder-template-preview messaging-tag-list"
        },
        {
          key: "alignment",
          label: "Alignment",
          width: "align",
          control: "align",
          ariaLabel: "Tag list alignment",
          fallback: "left",
          rendersVia: "builder-template-preview messaging-tag-list"
        },
        {
          key: "gap",
          label: "Gap",
          width: "num",
          control: "number",
          min: 4,
          max: 24,
          step: 2,
          fallback: "8",
          rendersVia: "builder-template-preview messaging-tag-list"
        },
        {
          key: "maxTags",
          label: "Max Tags",
          width: "select-sm",
          control: "select",
          fallback: "",
          options: [
            { value: "", label: "All" },
            ...Array.from({ length: 100 }, (_, i) => i + 1).map((n) => ({
              value: String(n),
              label: String(n)
            }))
          ],
          rendersVia: "builder-template-preview messaging-tag-list"
        }
      ]
    ],
    style: [
      [
        {
          key: "activeColor",
          label: "Active Color",
          width: "color",
          control: "color",
          dialogLabel: "Active tag color",
          fallback: "#0f4f8f",
          rendersVia: "builder-template-preview messaging-tag-list"
        },
        {
          key: "inactiveColor",
          label: "Tag Color",
          width: "color",
          control: "color",
          dialogLabel: "Tag color",
          fallback: "#587592",
          rendersVia: "builder-template-preview messaging-tag-list"
        },
        {
          key: "inactiveBg",
          label: "Tag Bg",
          width: "color",
          control: "color",
          dialogLabel: "Tag background color",
          fallback: "#f0f4f8",
          rendersVia: "builder-template-preview messaging-tag-list"
        }
      ],
      [
        {
          key: "minFontSize",
          label: "Min Font",
          width: "num",
          control: "number",
          min: 10,
          max: 18,
          fallback: "12",
          rendersVia: "builder-template-preview messaging-tag-list"
        },
        {
          key: "maxFontSize",
          label: "Max Font",
          width: "num",
          control: "number",
          min: 14,
          max: 32,
          fallback: "22",
          rendersVia: "builder-template-preview messaging-tag-list"
        }
      ]
    ]
  };

  return (
    <div className="builder-messaging-tag-list-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
