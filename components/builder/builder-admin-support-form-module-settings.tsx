"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const SHOW_HIDE_OPTIONS = [
  { value: "true", label: "Show" },
  { value: "false", label: "Hide" }
];

const SCHEMA: BuilderSettingsSchema = {
  content: [
    [
      {
        key: "showContact",
        label: "Contact details",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
        fallback: "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      }
    ],
    [
      {
        key: "contactHeading",
        label: "Contact heading",
        width: "full",
        control: "text",
        placeholder: "Need a hand with your website?",
        fallback: "Need a hand with your website?",
        visibleWhen: (s) => (s.showContact ?? "true") === "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      }
    ],
    [
      {
        key: "contactIntro",
        label: "Contact intro",
        width: "full",
        control: "text",
        placeholder: "Optional line above the email and phone",
        visibleWhen: (s) => (s.showContact ?? "true") === "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      }
    ],
    [
      {
        key: "showTitle",
        label: "Show title",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
        fallback: "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      },
      {
        key: "formTitle",
        label: "Title text",
        width: "text-md",
        control: "text",
        placeholder: "Request Support",
        fallback: "Request Support",
        visibleWhen: (s) => (s.showTitle ?? "true") === "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      }
    ],
    [
      {
        key: "defaultPriority",
        label: "Default priority",
        width: "select-md",
        control: "select",
        options: [
          { value: "low", label: "Low" },
          { value: "normal", label: "Normal" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" }
        ],
        fallback: "normal",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      },
      {
        key: "showScreenshot",
        label: "Screenshot upload",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
        fallback: "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      }
    ],
    [
      {
        key: "buttonText",
        label: "Button text",
        width: "text-md",
        control: "text",
        placeholder: "Send Request",
        fallback: "Send Request",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      }
    ],
    [
      {
        key: "showHistory",
        label: "Past requests",
        width: "select-sm",
        control: "select",
        options: SHOW_HIDE_OPTIONS,
        fallback: "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      },
      {
        key: "historyTitle",
        label: "Past requests title",
        width: "text-md",
        control: "text",
        placeholder: "Your Recent Requests",
        fallback: "Your Recent Requests",
        visibleWhen: (s) => (s.showHistory ?? "true") === "true",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
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
        options: [
          { value: "two-column", label: "Two columns" },
          { value: "stacked", label: "One column" }
        ],
        fallback: "two-column",
        rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
      }
    ]
  ]
};

export function BuilderAdminSupportFormModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
