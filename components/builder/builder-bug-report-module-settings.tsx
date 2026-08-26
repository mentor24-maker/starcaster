"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";
import {
  BUG_REPORT_CORNER_OPTIONS,
  BUG_REPORT_ICON_OPTIONS,
  BUG_REPORT_MAX_SCREENSHOTS,
  BUG_REPORT_MAX_SCREENSHOT_MB,
  BUG_REPORT_VISIBILITY_OPTIONS,
} from "./builder-bug-report-module";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * Bug Report module editor (task 4/5), schema-driven on the standard lattice.
 *
 * D8 axes: Content (what the popup says, who sees it) / Icon (what floats on
 * the page and how big) / Placement (which corner). No Frame axis: the module
 * has no box of its own on the page — the trigger IS the module, and its
 * block colour lives on the Icon axis because that is the thing it colours.
 *
 * A1: no theme overrides here — the icon deliberately does not follow the
 * theme, it is a utility control that must stay readable on any page, so its
 * two colours are plain colour controls with the platform blue as fallback.
 *
 * Icon Size steps by 5 (MODULE_UI_DOCTRINE "where the steps land"): 20–120,
 * and the default 40 sits on the grid.
 *
 * "Email each report" (task 5/5) sits on Content beside "Who sees it": both
 * decide what HAPPENS to a report rather than how the trigger looks, and by
 * D9 (blast radius descending) audience comes before destination, with the
 * screenshot note — which is only an explanation — last. The server reads
 * this value off the project's own pages and never off the submitted request;
 * the reasoning is in lib/bugReportEmail.js.
 */
const RENDERS_VIA = "BugReportModule (builder-bug-report-module.tsx)";

const SCHEMA: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        [
          {
            key: "popupTitle",
            label: "Popup title",
            width: "text-md",
            control: "text",
            placeholder: "Report a problem",
            fallback: "Report a problem",
            rendersVia: RENDERS_VIA
          },
          {
            key: "promptPlaceholder",
            label: "Prompt",
            width: "text-md",
            control: "text",
            placeholder: "What went wrong? What did you expect to happen?",
            fallback: "What went wrong? What did you expect to happen?",
            rendersVia: RENDERS_VIA
          }
        ],
        [
          {
            key: "thankYouMessage",
            label: "Thank-you",
            width: "text-md",
            control: "text",
            placeholder: "Thanks — we got it.",
            fallback: "Thanks — we got it.",
            rendersVia: RENDERS_VIA
          },
          {
            key: "labelText",
            label: "Label beside icon",
            width: "text-md",
            control: "text",
            placeholder: "(icon only)",
            fallback: "",
            rendersVia: RENDERS_VIA
          }
        ],
        [
          {
            key: "visibility",
            label: "Who sees it",
            width: "select-md",
            control: "select",
            options: BUG_REPORT_VISIBILITY_OPTIONS,
            fallback: "public",
            rendersVia: `${RENDERS_VIA} bugReportVisibleFor`
          },
          {
            key: "emailReports",
            label: "Email each report",
            width: "check",
            control: "checkbox",
            trueValue: "true",
            falseValue: "false",
            fallback: "false",
            rendersVia: "lib/bugReportEmail.js — sends to the project's Support Email"
          },
          {
            key: "screenshotNote",
            label: "Screenshots",
            width: "text-md",
            control: "custom",
            render: () => (
              <span className="builder-bug-report-settings-note">
                Up to {BUG_REPORT_MAX_SCREENSHOTS} per report, {BUG_REPORT_MAX_SCREENSHOT_MB} MB each — set by the server, not here.
              </span>
            )
          }
        ]
      ]
    },
    {
      title: "Icon",
      strips: [
        [
          {
            key: "icon",
            label: "Icon",
            width: "select-md",
            control: "select",
            options: BUG_REPORT_ICON_OPTIONS,
            fallback: "bug",
            rendersVia: RENDERS_VIA
          },
          {
            key: "iconSize",
            label: "Icon size",
            width: "num",
            control: "number",
            min: 20,
            max: 120,
            step: 5,
            fallback: "40",
            rendersVia: `${RENDERS_VIA} --bug-report-size`
          },
          {
            key: "iconColor",
            label: "Icon color",
            width: "color",
            control: "color",
            dialogLabel: "Icon color",
            fallback: "#ffffff",
            rendersVia: `${RENDERS_VIA} --bug-report-icon-color`
          }
        ],
        [
          {
            key: "iconBlock",
            label: "Background block",
            width: "check",
            control: "checkbox",
            trueValue: "true",
            falseValue: "false",
            fallback: "true",
            rendersVia: `${RENDERS_VIA} is-block`
          },
          {
            key: "blockColor",
            label: "Block color",
            width: "color",
            control: "color",
            dialogLabel: "Block color",
            fallback: "#0f4f8f",
            visibleWhen: (settings) => settings.iconBlock !== "false",
            rendersVia: `${RENDERS_VIA} --bug-report-block-color`
          }
        ]
      ]
    },
    {
      title: "Placement",
      strips: [
        [
          {
            key: "corner",
            label: "Corner",
            width: "select-md",
            control: "select",
            options: BUG_REPORT_CORNER_OPTIONS,
            fallback: "bottom-right",
            rendersVia: `${RENDERS_VIA} builder-bug-report-trigger--<corner>`
          }
        ]
      ]
    }
  ]
};

export function BuilderBugReportModuleSettings({ module, onUpdateModule }: Props) {
  return (
    <div className="builder-bug-report-settings">
      <BuilderSchemaModuleSettings schema={SCHEMA} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
