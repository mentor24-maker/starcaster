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
 *
 * A1 SORT (2026-08-10): nothing here overrides a theme value — the panel is
 * form copy plus one toggle, and there is no colour, radius, border, shadow
 * or font-family control to move. Every basic control stays basic (A4). The
 * existing `advanced` group holds the success redirect, which is a rare
 * behaviour setting rather than a theme override, so it stays put.
 *
 * SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
 * Everything above that "moved into Advanced" now sits LAST on the axis it
 * already names, ordered by D9 (blast radius, descending). The axis
 * assignments and the A2 theme-colour semantics are unchanged — only the
 * collapsing is gone. Kept rather than rewritten: the reasoning is the record.
 */
const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        // D9 rung 1: where a successful login LANDS is the most consequential
        // setting in this panel, so it leads Content — ahead of the form copy.
        // It sat on Structure only because that is the axis whose Advanced
        // section happened to hold it (A0 retired that section).
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
        ],
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
};

export function BuilderAdminLoginModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
