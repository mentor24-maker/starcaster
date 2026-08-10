"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * D8 logical axes (docs/UI_RULES.md): Content / Structure. The words the
 * form shows sit under Content; the toggle that decides whether the forgot-
 * password link is present at all is Structure. Same keys, same fallbacks,
 * same labels — only which column each control lives in changed.
 * `advanced` still renders below, full width.
 *
 * PAIRING RULE: `showForgotPassword` gates a whole region and has no sibling
 * field to reveal, so it correctly belongs on Structure. (A toggle that DID
 * gate one specific field would instead sit beside that field, toggle first.)
 */
const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        [
          {
            key: "formTitle",
            label: "Form title",
            width: "text-md",
            control: "text",
            placeholder: "Admin Sign In",
            fallback: "Admin Sign In",
            rendersVia: "AdminLoginPreview (builder-template-preview.tsx)"
          },
          {
            key: "buttonText",
            label: "Button text",
            width: "text-md",
            control: "text",
            placeholder: "Sign In",
            fallback: "Sign In",
            rendersVia: "AdminLoginPreview (builder-template-preview.tsx)"
          }
        ]
      ]
    },
    {
      title: "Structure",
      strips: [
        [
          {
            key: "showForgotPassword",
            label: "Forgot password",
            width: "check",
            control: "checkbox",
            fallback: "true",
            rendersVia: "AdminLoginPreview (builder-template-preview.tsx)"
          }
        ]
      ]
    }
  ],
  advanced: [
    [
      {
        key: "successRedirect",
        label: "Redirect on success",
        width: "full",
        control: "picker",
        source: "pages",
        valueKind: "path",
        placeholder: "/admin-dashboard",
        fallback: "/admin-dashboard",
        rendersVia: "AdminLoginPreview (builder-template-preview.tsx)"
      }
    ]
  ]
};

export function BuilderAdminLoginModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
