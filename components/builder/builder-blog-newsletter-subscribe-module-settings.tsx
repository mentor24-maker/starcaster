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
    // D8 logical axes: Content / Structure / Frame. Text content is still
    // the leftmost column (it dominates the panel); the short layout and
    // colour strips become their own axes instead of wasting the right
    // side (D2). The Image checkbox stays with the Image URL it reveals —
    // together they are one content control, not a display bank.
    axes: [
      {
        title: "Content",
        strips: [
      // Form ID + Headline share a strip (D1) — they were two stacked
      // full-width rows.
      [
        {
          key: "crmFormId",
          label: "CRM Form",
          width: "text-md",
          control: "picker",
          source: "crm-forms",
          valueKind: "id",
          noneLabel: "None",
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
                Create an email-capture form in <strong>Builder › CRM</strong> and choose it above.
                The form's fields, submit label, and success message are configured there.
              </p>
            </div>
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
        // C3: was a None/Show select — same "true"/"false" stored values.
        {
          key: "showImage",
          label: "Image",
          width: "check",
          control: "checkbox",
          fallback: "false"
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
        ]
      },
      {
        title: "Structure",
        strips: [
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
        ]
      },
      {
        title: "Frame",
        strips: [
      [
        { key: "accentColor", label: "Accent", width: "color", control: "color", dialogLabel: "Accent color", fallback: "#0f4f8f" },
        { key: "bgColor", label: "Background", width: "color", control: "color", dialogLabel: "Background color", fallback: "#eaf4ff" }
      ]
        ]
      }
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
