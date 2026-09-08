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
 * to it in the same strip, toggle first. One such pair is left here:
 * `showTitle` gates `panelTitle`.
 *
 * WHICH AXIS: `showTags` (the tag manager table) changes what the page is made
 * of, so it is Structure. The two page-address fields are Structure too: they
 * decide where the post-count popup sends you, not what the panel shows.
 *
 * THE RELATE SETTINGS MOVED. `showRelate`, `relateButtonLabel`, `articleStatus`
 * and `showCategories` belong to the `admin-related-articles` module now
 * (86bbuhph0). A page saved before that split still carries them in its stored
 * settings; they are simply ignored here, which is harmless and is why the
 * module type id was NOT renamed.
 *
 * `showTags` kept its original name on purpose. It was saved onto live tenant
 * pages by the first version of this module, and renaming a settings key
 * silently resets it to its fallback on every page already carrying it.
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
            placeholder: "Tag Manager",
            fallback: "Tag Manager",
            visibleWhen: (s) => (s.showTitle ?? "true") === "true",
            rendersVia: RENDERS_VIA
          }
        ],
      ]
    },
    {
      title: "Structure",
      strips: [
        [
          {
            key: "showTags",
            label: "Tag manager",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: RENDERS_VIA
          },
        ],
        [
          /*
           * Where a post opens from the "posts with this tag" popup. The
           * defaults are the slugs the admin scaffold gives every tenant
           * (lib/projectAdminScaffold.js), so these are only touched by a
           * tenant who renamed those pages.
           */
          {
            key: "managerPageUrl",
            label: "Blog Manager page",
            width: "text-md",
            control: "text",
            placeholder: "/admin-blog-manager",
            rendersVia: RENDERS_VIA
          },
          {
            key: "postViewUrl",
            label: "Post view page",
            width: "text-md",
            control: "text",
            placeholder: "/blog-post-view",
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
