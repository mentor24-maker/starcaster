"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const SCHEMA: BuilderSettingsSchema = {
  content: [
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
      },
      {
        key: "showForgotPassword",
        label: "Forgot password",
        width: "check",
        control: "checkbox",
        fallback: "true",
        rendersVia: "AdminLoginPreview (builder-template-preview.tsx)"
      }
    ]
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
