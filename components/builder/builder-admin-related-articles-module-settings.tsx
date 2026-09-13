"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * Settings for the Related Articles module, split out of the Tag Manager on
 * 2026-09-03 (86bbuhph0).
 *
 * D8 logical axes (docs/UI_RULES.md): Content and Structure.
 *
 * PAIRING RULE - a toggle that gates ONE specific sibling field stays adjacent
 * to it in the same strip, toggle first: `showTitle` gates `panelTitle`.
 *
 * WHICH AXIS: `articleStatus` filters which articles the picker lists, which is
 * content selection, so it sits on Content beside the button label it works
 * with. `showCategories` decides whether categories are offered as a way to
 * choose articles at all, which changes what the panel is made of, so it is
 * Structure.
 *
 * THE KEYS ARE THE OLD ONES ON PURPOSE. `relateButtonLabel`, `articleStatus`
 * and `showCategories` were saved onto live tenant pages by the combined
 * module. Reusing the names means a tenant who had customised them keeps their
 * values when they place this module; inventing new ones would silently reset
 * every customisation to its fallback.
 *
 * A1 SORT: no theme overrides here at all - no colour, border, radius, shadow
 * or font-family control - so no axis gets an Advanced section, and there is
 * no Frame axis to title.
 */
const RENDERS_VIA = "AdminRelatedArticlesPreview (builder-template-preview.tsx)";

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
            placeholder: "Related Articles",
            fallback: "Related Articles",
            visibleWhen: (s) => (s.showTitle ?? "true") === "true",
            rendersVia: RENDERS_VIA
          }
        ],
        [
          {
            key: "relateButtonLabel",
            label: "Button text",
            width: "text-md",
            control: "text",
            placeholder: "Relate Checked",
            fallback: "Relate Checked",
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
            label: "Categories in picker",
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

export function BuilderAdminRelatedArticlesModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-admin-related-articles-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
