"use client";

import { useEffect, useState } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { resolveSessionProjectId } from "@/lib/adapters/starcaster-app";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";
import {
  BUG_REPORT_CORNER_OPTIONS,
  BUG_REPORT_ICON_OPTIONS,
  BUG_REPORT_MAX_SCREENSHOTS,
  BUG_REPORT_MAX_SCREENSHOT_MB,
  BUG_REPORT_SHOW_ON_OPTIONS,
  BUG_REPORT_SHOW_ON_SITE,
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
 * the page and how big) / Placement (which corner, and which pages — SC-804's
 * "Show on", beside Corner because both answer "where does the icon appear"). No Frame axis: the module
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

const SITE_WIDE_PATH = "/api/public/bug-report/site-wide";

type SiteWideEntry = { moduleId: string; pageId: string; pageSlug: string; pageName: string };
type SiteWideState =
  | { kind: "loading" }
  | { kind: "unknown"; reason: string }
  | { kind: "ready"; siteWide: SiteWideEntry | null; others: SiteWideEntry[] };

function pageLabel(entry: SiteWideEntry): string {
  const name = entry.pageName.trim() || "Untitled page";
  return `"${name}" (/${entry.pageSlug.replace(/^\//, "")})`;
}

/**
 * What the panel says under "Show on: Every page of the site" (SC-804). Pure,
 * so each wording is testable without a server.
 *
 * It always says the icon appears on the LIVE site once published — the
 * Builder does not paint it onto the other pages while they are edited — and,
 * when another module is also site-wide, names that module's page and which
 * one wins (the most recently published page; lib/bugReportSiteWide.js).
 */
export function describeSiteWide(moduleId: string, state: SiteWideState): string[] {
  // Short lines on purpose: this note shares the Placement column's control
  // track, and one long line widened Corner and Show on along with it.
  const lines = ["Shows on every page of the live site once published.", "Other pages do not show it while you edit them."];
  if (state.kind === "loading") return lines;
  // Any extra line below is a warning, rare enough to be allowed its width.
  if (state.kind === "unknown") {
    lines.push(`Could not check whether another Bug Report module is already site-wide: ${state.reason}`);
    return lines;
  }
  const { siteWide, others } = state;
  const elsewhere = [siteWide, ...others].filter((entry): entry is SiteWideEntry => Boolean(entry) && entry!.moduleId !== moduleId);
  if (!elsewhere.length) return lines;
  if (siteWide && siteWide.moduleId !== moduleId) {
    lines.push(`Another Bug Report module is already showing on every page, on ${pageLabel(siteWide)}. Only one shows: the one on the most recently published page.`);
  } else {
    lines.push(`Also set to every page: ${elsewhere.map(pageLabel).join(", ")}. Only one shows: the one on the most recently published page.`);
  }
  return lines;
}

function SiteWideNote({ moduleId }: { moduleId: string }) {
  const [state, setState] = useState<SiteWideState>({ kind: "loading" });
  useEffect(() => {
    const projectId = resolveSessionProjectId();
    if (!projectId) { setState({ kind: "unknown", reason: "no project is selected." }); return; }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${SITE_WIDE_PATH}?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          data?: { siteWide?: SiteWideEntry | null; others?: SiteWideEntry[] };
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!response.ok || !body.ok) {
          setState({ kind: "unknown", reason: body.error?.message || `the server answered ${response.status}.` });
          return;
        }
        setState({ kind: "ready", siteWide: body.data?.siteWide ?? null, others: Array.isArray(body.data?.others) ? body.data!.others! : [] });
      } catch (e) {
        if (!cancelled) setState({ kind: "unknown", reason: e instanceof Error ? e.message : "the server could not be reached." });
      }
    })();
    return () => { cancelled = true; };
  }, [moduleId]);
  return (
    <span className="builder-bug-report-settings-note" data-bug-report-site-wide-note>
      {describeSiteWide(moduleId, state).map((line) => <span key={line} style={{ display: "block" }}>{line}</span>)}
    </span>
  );
}

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
          },
          {
            key: "showOn",
            label: "Show on",
            width: "select-md",
            control: "select",
            options: BUG_REPORT_SHOW_ON_OPTIONS,
            fallback: "page",
            rendersVia: "lib/bugReportSiteWide.js → BuilderTemplatePreview siteWideBugReport"
          }
        ],
        [
          {
            key: "siteWideNote",
            label: "Every page",
            width: "full",
            control: "custom",
            visibleWhen: (settings) => settings.showOn === BUG_REPORT_SHOW_ON_SITE,
            render: (ctx) => <SiteWideNote moduleId={String(ctx.module.id ?? "")} />
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
