"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogPostCreateModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    // D8 logical axes: Content / Structure / Frame. Content holds every
    // word the form puts on screen plus where it sends the author
    // afterwards (a destination); Structure holds the status defaults and
    // the "Fields to show" bank — the controls that decide what the form
    // is made of; Frame holds the accent colour.
    //
    // A1 sort (2026-08-10): Accent is a theme value, so it moves to Frame ›
    // Advanced as a `theme-color` (A2 — empty means "follow the theme"; the
    // old fallback is now themeDefault). Nothing else here overrides the
    // theme: labels, buttons, destinations and the field bank are the
    // module's own settings, so they stay basic (A4).
    axes: [
      {
        title: "Content",
        strips: [
      [
        // C3: Show/Hide selects → checkboxes — same "true"/"false" stored values.
        { key: "showFormTitle", label: "Form Title", width: "check", control: "checkbox", fallback: "true" },
        {
          key: "formTitle",
          label: "Title Text",
          width: "text-md",
          control: "custom",
          visibleWhen: (settings) => (settings.showFormTitle ?? "true") === "true",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.formTitle ?? "Create New Post"}
              onChange={(e) => set("formTitle", e.target.value)}
              placeholder="Create New Post"
            />
          )
        }
      ],
      [
        {
          key: "submitLabel",
          label: "Publish Button",
          width: "text-md",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.submitLabel ?? "Publish Post"}
              onChange={(e) => set("submitLabel", e.target.value)}
              placeholder="Publish Post"
            />
          )
        },
        {
          key: "draftLabel",
          label: "Draft Button",
          width: "text-md",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.draftLabel ?? "Save as Draft"}
              onChange={(e) => set("draftLabel", e.target.value)}
              placeholder="Save as Draft"
            />
          )
        }
      ],
      [
        {
          key: "afterSubmitHeader",
          label: "After Submit",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <div className="builder-breadcrumb-items-label" style={{ marginTop: 12, marginBottom: 6 }}>
              After submit
            </div>
          )
        }
      ],
      [
        {
          key: "successMessage",
          label: "Success Message",
          width: "full",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.successMessage ?? "Post created successfully."}
              onChange={(e) => set("successMessage", e.target.value)}
              placeholder="Post created successfully."
            />
          )
        }
      ],
      [
        {
          key: "redirectAfterCreate",
          label: "Redirect To",
          width: "full",
          control: "text",
          placeholder: "/admin/posts  (leave blank to stay on this page)"
        }
      ]
        ]
      },
      {
        title: "Structure",
        strips: [
      [
        {
          key: "defaultStatus",
          label: "Default Status",
          width: "select-md",
          control: "select",
          fallback: "draft",
          options: [
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" }
          ]
        },
        // C3: was a Yes / "No (uses default)" select — same "true"/"false"
        // stored values; the "uses default" nuance moves to a tooltip (L7).
        {
          key: "allowStatusChange",
          label: "Author Can Change",
          width: "check",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="checkbox"
              title="Unchecked: posts always use the default status above"
              checked={(settings.allowStatusChange ?? "true") === "true"}
              onChange={(e) => set("allowStatusChange", e.target.checked ? "true" : "false")}
            />
          )
        }
      ],
      [
        {
          key: "fieldsHeader",
          label: "Fields",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <div className="builder-breadcrumb-items-label" style={{ marginTop: 12, marginBottom: 6 }}>
              Fields to show
            </div>
          )
        }
      ],
      [
        // C3: Show/Hide selects → checkboxes — same "true"/"false" stored values.
        { key: "showSlug", label: "Slug", width: "check", control: "checkbox", fallback: "true" },
        { key: "showFeaturedImage", label: "Featured Image", width: "check", control: "checkbox", fallback: "true" },
        { key: "showExcerpt", label: "Excerpt", width: "check", control: "checkbox", fallback: "true" },
        // The old Hide option read "Hide (use logged-in user)" — that
        // nuance moves to a tooltip (L7).
        {
          key: "showAuthorField",
          label: "Author Field",
          width: "check",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="checkbox"
              title="Unchecked: the field is hidden and the logged-in user is the author"
              checked={(settings.showAuthorField ?? "false") === "true"}
              onChange={(e) => set("showAuthorField", e.target.checked ? "true" : "false")}
            />
          )
        },
        { key: "showCategories", label: "Categories", width: "check", control: "checkbox", fallback: "true" },
        { key: "showTags", label: "Tags", width: "check", control: "checkbox", fallback: "true" },
        { key: "showSeoFields", label: "SEO Fields", width: "check", control: "checkbox", fallback: "false" }
      ]
        ]
      },
      {
        title: "Frame",
        strips: [],
        advanced: [
      [
        { key: "accentColor", label: "Accent", width: "color", control: "theme-color", dialogLabel: "Accent color", themeDefault: "#0f4f8f" }
      ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-post-create-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
