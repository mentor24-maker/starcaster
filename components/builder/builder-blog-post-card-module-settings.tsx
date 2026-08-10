"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogPostCardModuleSettings({ module, onUpdateModule }: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [{ key: "title", label: "Title", width: "full", control: "text", placeholder: "Post title" }],
      [{ key: "excerpt", label: "Excerpt", width: "full", control: "textarea", rows: 2, placeholder: "Short summary shown on the card" }],
      [
        { key: "author", label: "Author", width: "text-md", control: "text", placeholder: "Author name" },
        { key: "date", label: "Date", width: "text-md", control: "text", placeholder: "Jun 20, 2026" }
      ],
      [{ key: "categories", label: "Categories", width: "full", control: "text", placeholder: "Tech, Design (comma-separated)" }],
      [{ key: "url", label: "Link URL", width: "full", control: "text", placeholder: "/blog/post-slug" }],
      [
        {
          key: "imageUrl",
          label: "Featured Image",
          width: "full",
          control: "custom",
          render: ({ settings, set }) => (
            <BuilderImagePickerField
              value={settings.imageUrl ?? ""}
              onChange={(url) => set("imageUrl", url)}
              placeholder="Image URL"
            />
          )
        }
      ],
      // C3: Show/Hide selects → checkboxes — same "true"/"false" stored values.
      [
        { key: "showFeaturedImage", label: "Image", width: "check", control: "checkbox", fallback: "true" },
        { key: "showExcerpt", label: "Excerpt", width: "check", control: "checkbox", fallback: "true" },
        { key: "showAuthor", label: "Author", width: "check", control: "checkbox", fallback: "true" },
        { key: "showDate", label: "Date", width: "check", control: "checkbox", fallback: "true" },
        { key: "showCategories", label: "Categories", width: "check", control: "checkbox", fallback: "true" }
      ],
      [
        { key: "showReadMore", label: "Read More", width: "check", control: "checkbox", fallback: "true" },
        {
          key: "readMoreLabel",
          label: "Read More Label",
          width: "text-md",
          control: "custom",
          visibleWhen: (settings) => (settings.showReadMore ?? "true") === "true",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.readMoreLabel ?? "Read More"}
              onChange={(e) => set("readMoreLabel", e.target.value)}
              placeholder="Read More"
            />
          )
        }
      ]
    ],
    layout: [
      [
        {
          key: "cardLayout",
          label: "Card Layout",
          width: "select-md",
          control: "select",
          fallback: "vertical",
          options: [
            { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" }
          ]
        },
        {
          key: "imageAspectRatio",
          label: "Image Ratio",
          width: "select-sm",
          control: "select",
          fallback: "16:9",
          visibleWhen: (settings) => (settings.showFeaturedImage ?? "true") === "true",
          options: [
            { value: "16:9", label: "16:9" },
            { value: "4:3", label: "4:3" },
            { value: "3:2", label: "3:2" },
            { value: "1:1", label: "1:1" }
          ]
        }
      ]
    ],
    style: [
      [
        {
          key: "cardStyle",
          label: "Card Style",
          width: "select-md",
          control: "select",
          fallback: "default",
          options: [
            { value: "default", label: "Default" },
            { value: "bordered", label: "Bordered" },
            { value: "shadow", label: "Shadow" }
          ]
        },
        { key: "cardBorderRadius", label: "Radius", width: "num", control: "number", min: 0, max: 32, step: 2, fallback: "12" }
      ]
    ]
  };

  return (
    <div className="builder-blog-post-card-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
