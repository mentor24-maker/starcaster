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

const SHOW_HIDE = [
  { value: "true", label: "Show" },
  { value: "false", label: "Hide" }
];

const HIDE_SHOW = [
  { value: "false", label: "Hide" },
  { value: "true", label: "Show" }
];

export function BuilderBlogPostCreateModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        { key: "showFormTitle", label: "Form Title", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
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
        {
          key: "allowStatusChange",
          label: "Author Can Change",
          width: "select-md",
          control: "select",
          fallback: "true",
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No (uses default)" }
          ]
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
        { key: "showSlug", label: "Slug", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showFeaturedImage", label: "Featured Image", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showExcerpt", label: "Excerpt", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        {
          key: "showAuthorField",
          label: "Author Field",
          width: "select-md",
          control: "select",
          fallback: "false",
          options: [
            { value: "false", label: "Hide (use logged-in user)" },
            { value: "true", label: "Show" }
          ]
        },
        { key: "showCategories", label: "Categories", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showTags", label: "Tags", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showSeoFields", label: "SEO Fields", width: "select-sm", control: "select", fallback: "false", options: HIDE_SHOW }
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
    ],
    style: [
      [
        { key: "accentColor", label: "Accent", width: "color", control: "color", dialogLabel: "Accent color", fallback: "#0f4f8f" }
      ]
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
