"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * D8 logical axes (docs/UI_RULES.md): Content / Structure.
 *
 * This panel previously used three CONCERN groups (Contact / Form / Request
 * history) driven by `panelColumns`. D8 replaces concern grouping with the
 * canonical axes, so a control sits in the same column in every module.
 * Reading order inside each axis still runs contact → form → history, so the
 * three concerns remain legible top-to-bottom.
 *
 * PAIRING RULE — do not re-split: a toggle that gates specific sibling
 * field(s) (`showContact` → contact heading/intro, `showTitle` → `formTitle`,
 * `showHistory` → `historyTitle`) is one control pair and stays adjacent in
 * the same strip, toggle first, on the axis where the fields belong. Only
 * toggles gating a whole region with no sibling field (`showScreenshot`) stay
 * on Structure. Keys, fallbacks, options, visibleWhen and labels are
 * unchanged.
 *
 * A1 SORT (2026-08-10): no theme overrides in this panel. Everything here is
 * form copy, toggles, a default priority and a layout mode — content and
 * structure, none of it theme-backed — so nothing moves to Advanced and the
 * module needs no Advanced section (A4).
 */
const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
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
        ],
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
          }
        ],
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
    {
      title: "Structure",
      strips: [
        [
          {
            key: "showScreenshot",
            label: "Screenshot upload",
            width: "check",
            control: "checkbox",
            fallback: "true",
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
    }
  ]
};

export function BuilderAdminSupportFormModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
