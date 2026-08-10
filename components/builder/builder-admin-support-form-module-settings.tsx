"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * Three titled groups for the panel's three concerns (D5): contact block,
 * form, request history. All three are content semantically — the layout
 * and style SLOTS are borrowed only for their position in the fixed group
 * order, so the panel reads Contact → Form → Request history. The lone
 * layout select rides in the Form group's last strip (D1/D3).
 * `panelColumns` puts Contact beside Form + Request history so the panel
 * fills its width (D2).
 */
const SCHEMA: BuilderSettingsSchema = {
  content: {
    title: "Contact",
    strips: [
      [
        {
          key: "showContact",
          label: "Contact details",
          width: "check",
          control: "checkbox",
          fallback: "true",
          rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
        },
        {
          key: "contactHeading",
          label: "Contact heading",
          width: "text-md",
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
      ]
    ]
  },
  layout: {
    title: "Form",
    strips: [
      [
        {
          key: "showTitle",
          label: "Show title",
          width: "check",
          control: "checkbox",
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
          width: "check",
          control: "checkbox",
          fallback: "true",
          rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
        },
        {
          key: "buttonText",
          label: "Button text",
          width: "text-md",
          control: "text",
          placeholder: "Send Request",
          fallback: "Send Request",
          rendersVia: "AdminSupportFormPreview (builder-template-preview.tsx)"
        },
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
  },
  style: {
    title: "Request history",
    strips: [
      [
        {
          key: "showHistory",
          label: "Past requests",
          width: "check",
          control: "checkbox",
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
    ]
  },
  panelColumns: [["content"], ["layout", "style"]]
};

export function BuilderAdminSupportFormModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
