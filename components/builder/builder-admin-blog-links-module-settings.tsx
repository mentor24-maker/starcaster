"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * D8 logical axes (docs/UI_RULES.md): Content and Structure.
 *
 * PAIRING RULE - a toggle that gates ONE specific sibling field stays adjacent
 * to it in the same strip, toggle first. Two such pairs exist here:
 * `showTitle` gates `panelTitle`, and `showRelate` gates `relateButtonLabel`.
 * Neither is split across strips or axes.
 *
 * WHICH AXIS: `showCategories` and `showTags` choose which taxonomies the left
 * pane offers, so they are Structure - they change what the page is made of,
 * not the words on it. `articleStatus` filters which articles the right-hand
 * list shows, which is content selection, so it sits on Content beside the
 * Relate pair it qualifies.
 *
 * A1 SORT: no theme overrides here at all - no colour, border, radius, shadow
 * or font-family control - so no axis gets an Advanced section, and there is
 * no Frame axis to title.
 */
const RENDERS_VIA = "AdminBlogLinksPreview (builder-template-preview.tsx)";

const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        [
          {
            key: "showTitle",
            label: "Show title",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: RENDERS_VIA
          },
          {
            key: "panelTitle",
            label: "Title text",
            width: "text-md",
            control: "text",
            placeholder: "Blog Links",
            fallback: "Blog Links",
            visibleWhen: (s) => (s.showTitle ?? "true") === "true",
            rendersVia: RENDERS_VIA
          }
        ],
        [
          {
            key: "showRelate",
            label: "Relate articles",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: RENDERS_VIA
          },
          {
            key: "relateButtonLabel",
            label: "Button text",
            width: "text-md",
            control: "text",
            placeholder: "Relate Checked",
            fallback: "Relate Checked",
            visibleWhen: (s) => (s.showRelate ?? "true") === "true",
            rendersVia: RENDERS_VIA
          },
          {
            key: "articleStatus",
            label: "Articles",
            width: "select-md",
            control: "select",
            options: [
              { value: "all", label: "All" },
              { value: "published", label: "Published only" },
              { value: "draft", label: "Drafts only" }
            ],
            fallback: "all",
            visibleWhen: (s) => (s.showRelate ?? "true") === "true",
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    },
    {
      title: "Structure",
      strips: [
        [
          {
            key: "showCategories",
            label: "Categories",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: RENDERS_VIA
          },
          {
            key: "showTags",
            label: "Tags",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    }
  ]
};

export function BuilderAdminBlogLinksModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-admin-blog-links-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
