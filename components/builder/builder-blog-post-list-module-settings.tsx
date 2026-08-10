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

export function BuilderBlogPostListModuleSettings({ module, onUpdateModule }: Props) {
  const schema: BuilderSettingsSchema = {
    // S5 registry (docs/UI_RULES.md): the operator's 6/28 three-column
    // design — General / Page Design / Card Appearance side by side.
    // Flattened once by a convention sweep (2026-08-09 audit); never again.
    // Since 2026-08-10 that layout is expressed as D8 logical axes:
    // Content / Structure / Frame, in that left-to-right order — the same
    // three columns holding the same controls, renamed to the canonical
    // axis vocabulary so a control sits in the same place in every module.
    axes: [
      {
        title: "Content",
        strips: [
      [
        {
          key: "moduleName",
          label: "Label",
          width: "text-md",
          control: "custom",
          render: ({ module: current }) => (
            <input
              type="text"
              value={current.name}
              onChange={(e) => onUpdateModule((m) => ({ ...m, name: e.target.value }))}
              placeholder="Optional internal label"
            />
          )
        },
        // Wired 2026-08-09 by operator ruling (audit F7): postTitle renders
        // as the heading above the list; postSlug names the page that shows
        // a single post (links become /<slug>?post=<post-slug>), replacing
        // the removed postPageUrl field per the 6/28 directive.
        {
          key: "postTitle",
          label: "List Title",
          width: "text-md",
          control: "text",
          placeholder: "Optional heading above the list",
          rendersVia: "BlogPostListPreview heading"
        },
        {
          key: "postSlug",
          label: "Post Page",
          width: "text-md",
          control: "picker",
          source: "pages",
          valueKind: "slug",
          noneLabel: "Default (blog-post-view)",
          placeholder: "blog-post-view",
          rendersVia: "BlogPostListPreview postPageUrl resolution"
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
          width: "select-sm",
          control: "select",
          fallback: "grid",
          options: [
            { value: "grid", label: "Grid" },
            { value: "list", label: "List" },
            { value: "admin-manager", label: "Admin" }
          ]
        },
        {
          key: "columns",
          label: "Columns",
          width: "select-sm",
          control: "select",
          fallback: "3",
          options: [
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3" }
          ]
        },
        {
          key: "postsPerPage",
          label: "Posts Per Page",
          width: "select-sm",
          control: "select",
          fallback: "9",
          options: [
            { value: "3", label: "3" },
            { value: "6", label: "6" },
            { value: "9", label: "9" },
            { value: "12", label: "12" },
            { value: "18", label: "18" }
          ]
        }
      ],
      // The five filter toggles split across two strips so this column
      // stays as narrow as its siblings (D4 equal-width columns).
      // C3: Show/Hide selects → checkboxes — same "true"/"false" stored values.
      [
        { key: "showSearch", label: "Search Bar", width: "check", control: "checkbox", fallback: "true" },
        { key: "showCategoryFilter", label: "Category Filter", width: "check", control: "checkbox", fallback: "true" },
        { key: "showDateFilter", label: "Date Filter", width: "check", control: "checkbox", fallback: "false" }
      ],
      [
        { key: "showAuthorFilter", label: "Author Filter", width: "check", control: "checkbox", fallback: "true" },
        { key: "showTagFilter", label: "Tag Filter", width: "check", control: "checkbox", fallback: "true" }
        // popularityFilter (By Views / By Likes) removed 2026-08-09: posts
        // carry no view/like counts anywhere in the data model, so the
        // control sorted nothing (audit C6). The operator ruled "wire it
        // up" — that requires building post view/like tracking first;
        // tracked in ClickUp Dev Backlog. Re-add the control WITH the
        // tracking feature, never before it.
      ]
        ]
      },
      {
        title: "Frame",
        strips: [
      [
        {
          key: "cardManagerNote",
          label: "Note",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <div className="builder-blog-post-list-card-manager-note">
              Card content, layout, and style are set in the <strong>Card Manager</strong> module.
              Add a Card Manager to any page to edit the card template.
            </div>
          )
        }
      ],
      [
        { key: "cardGap", label: "Card Gap", width: "num", control: "number", min: 8, max: 64, step: 4, fallback: "24" }
      ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-post-list-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
