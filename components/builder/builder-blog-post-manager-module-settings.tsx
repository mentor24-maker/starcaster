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
    // D8 logical axes: Content / Structure / Frame. The two page pickers
    // are destinations (Content); the toggles decide which columns the
    // manager shows (Structure); Accent is the module's own colour (Frame).
    //
    // A1 sort (2026-08-10): Accent is a theme value, so it moves to Frame ›
    // Advanced as a `theme-color` (A2 — empty means "follow the theme"; the
    // old fallback is now themeDefault). The page pickers and column
    // toggles are the module's own settings and stay basic (A4).
    //
    // SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
    // Everything above that "moved into Advanced" now sits LAST on the axis it
    // already names, ordered by D9 (blast radius, descending). The axis
    // assignments and the A2 theme-colour semantics are unchanged — only the
    // collapsing is gone. Kept rather than rewritten: the reasoning is the record.
    axes: [
      {
        title: "Content",
        strips: [
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
      ]
        ]
      },
      {
        title: "Structure",
        strips: [
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
              label: "Accent Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Accent color",
              themeDefault: "#0f4f8f",
              rendersVia: "BlogPostManagerPreview"
            }
          ]
        ],
      }
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
