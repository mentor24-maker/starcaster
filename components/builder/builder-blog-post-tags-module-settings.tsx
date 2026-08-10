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
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Structure / Text /
    // Frame. Same keys, fallbacks and visibleWhen rules — only the column each
    // control sits in changed. Gap sits on Frame beside the pill background
    // and radius (it is the space between pills), matching Tag Cloud.
    //
    // Linking fold (A1-A5): the old top-level "Linking" group made a SECOND
    // collapsible below the per-axis Advanced region. Its controls are a
    // destination and its URL param — Content by D8's table ("what the module
    // shows … links") — so they now live in the Content axis's `advanced`.
    // The panel has exactly one Advanced region, and these sit under their
    // own column heading. Same keys, fallbacks, visibleWhen and rendersVia.
    //
    // A1 sort (2026-08-10): Tag Color (Text), Tag Bg and Radius (Frame) are
    // theme-backed, so each moved to its own axis's Advanced section, and the
    // two colours became `theme-color` overrides whose themeDefault is their
    // old fallback (A2). Gap stays basic on Frame — it is spacing, keeps its
    // name (W7), and keeps Frame's basic row from emptying. Font Size is a
    // SIZE and stays basic, as do the tags list, Prefix and Layout (A4).
    axes: [
      {
        title: "Content",
        strips: [
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
        // A1: where a tag click goes, and the param it sets — the former
        // top-level "Linking" group, folded in so the panel has one Advanced.
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
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "Current page",
              placeholder: "/blog",
              rendersVia: "builder-template.ts blog-post-tags renderer",
              visibleWhen: (settings) => (settings.linkToFilter ?? "true") === "true"
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
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
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
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
        // A1: the tag text colour overrides the theme.
        advanced: [
          [
            {
              key: "color",
              label: "Tag Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Tag color",
              themeDefault: "#587592",
              rendersVia: "BlogPostTagsPreview"
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
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
        // A1: the pill background and its corner radius are theme-backed.
        advanced: [
          [
            {
              key: "bgColor",
              label: "Tag Bg",
              width: "color",
              control: "theme-color",
              dialogLabel: "Tag background",
              themeDefault: "#f0f4f8",
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
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-post-tags-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
