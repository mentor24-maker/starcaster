"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
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

export function BuilderBlogNewsletterSubscribeModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    // Text content is left; the short layout + color strips stack on the
    // right instead of wasting it (D2).
    panelColumns: [["content"], ["layout", "style"]],
    content: [
      // Form ID + Headline share a strip (D1) — they were two stacked
      // full-width rows.
      [
        {
          key: "crmFormId",
          label: "CRM Form ID",
          width: "text-md",
          control: "text",
          placeholder: "Paste Form ID from Builder › CRM"
        },
        {
          key: "headline",
          label: "Headline",
          width: "text-md",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.headline ?? "Stay in the loop"}
              onChange={(e) => set("headline", e.target.value)}
              placeholder="Stay in the loop"
            />
          )
        }
      ],
      [
        {
          key: "crmFormNote",
          label: "Note",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <div className="builder-module-runtime-note">
              <p>
                Create an email-capture form in <strong>Builder › CRM</strong> and paste the Form ID above.
                The form's fields, submit label, and success message are configured there.
              </p>
            </div>
          )
        }
      ],
      [
        {
          key: "headline",
          label: "Headline",
          width: "full",
          control: "custom",
          render: ({ settings, set }) => (
            <input
              type="text"
              value={settings.headline ?? "Stay in the loop"}
              onChange={(e) => set("headline", e.target.value)}
              placeholder="Stay in the loop"
            />
          )
        }
      ],
      [
        {
          key: "description",
          label: "Description",
          width: "full",
          control: "textarea",
          rows: 2,
          placeholder: "Get new posts delivered to your inbox."
        }
      ],
      [
        {
          key: "showImage",
          label: "Image",
          width: "select-sm",
          control: "select",
          fallback: "false",
          options: [
            { value: "false", label: "None" },
            { value: "true", label: "Show" }
          ]
        }
      ],
      [
        {
          key: "imageUrl",
          label: "Image URL",
          width: "full",
          control: "custom",
          visibleWhen: (settings) => settings.showImage === "true",
          render: ({ settings, set }) => (
            <BuilderImagePickerField
              value={settings.imageUrl ?? ""}
              onChange={(url) => set("imageUrl", url)}
              placeholder="Decorative image or icon"
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
          fallback: "stacked",
          options: [
            { value: "stacked", label: "Stacked" },
            { value: "inline", label: "Inline" }
          ]
        }
      ]
    ],
    style: [
      [
        { key: "accentColor", label: "Accent", width: "color", control: "color", dialogLabel: "Accent color", fallback: "#0f4f8f" },
        { key: "bgColor", label: "Background", width: "color", control: "color", dialogLabel: "Background color", fallback: "#eaf4ff" }
      ]
    ]
  };

  return (
    <div className="builder-blog-newsletter-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
