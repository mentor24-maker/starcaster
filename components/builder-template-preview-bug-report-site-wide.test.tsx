import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderTemplatePreview } from "./builder-template-preview";
import { describeSiteWide } from "./builder/builder-bug-report-module-settings";
import { readSiteWideBugReport, type SiteWideBugReport } from "./builder/builder-bug-report-module";
import {
  createDefaultBackgroundSettings,
  createEmptyModule,
  normalizeBuilderModuleSettingsForType,
  normalizeLayoutSections,
  type BuilderTemplateModule
} from "@/lib/builder-template";

/**
 * Bug Report "Show on: Every page of the site" (SC-804), on the page side.
 *
 * The server picks the site-wide module and sends it beside the page; the page
 * shows it once and its own Bug Report modules stand down. `previewMode` keeps
 * the trigger inline (no portal) so the static markup holds every icon there is.
 */

const SITE_WIDE: SiteWideBugReport = {
  moduleId: "site-wide-module",
  settings: { blockColor: "#c0392b", iconBlock: "true", showOn: "site" },
  pageId: "1",
  pageSlug: "",
  pageName: "Home"
};

function module(type: BuilderTemplateModule["type"], settings: Record<string, string> = {}) {
  return { id: `${type}-1`, type, column: "main", text: "<p>Hello</p>", settings: normalizeBuilderModuleSettingsForType(type, settings) };
}

function render(modules: ReturnType<typeof module>[], { liveSite, siteWide }: { liveSite: boolean; siteWide: SiteWideBugReport | null }) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      liveSite={liveSite}
      previewMode
      siteWideBugReport={siteWide}
      pageBackground={createDefaultBackgroundSettings()}
      layoutSections={normalizeLayoutSections([{ id: "row-1", title: "Row", layout: "single", modules }])}
    />
  );
}

const icons = (html: string) => (html.match(/class="builder-bug-report-trigger /g) || []).length;

describe("site-wide Bug Report on a live page", () => {
  it("shows the icon on a page with no Bug Report module", () => {
    const html = render([module("text")], { liveSite: true, siteWide: SITE_WIDE });
    expect(icons(html)).toBe(1);
    expect(html).toContain("--bug-report-block-color:#c0392b");
  });

  it("overrides the page's own module: one icon, the site-wide settings", () => {
    const html = render([module("bug-report", { blockColor: "#1e8449" })], { liveSite: true, siteWide: SITE_WIDE });
    expect(icons(html)).toBe(1);
    expect(html).toContain("--bug-report-block-color:#c0392b");
    expect(html).not.toContain("#1e8449");
  });

  it("with nothing site-wide, a page shows exactly its own module, as before", () => {
    const html = render([module("bug-report", { blockColor: "#1e8449" })], { liveSite: true, siteWide: null });
    expect(icons(html)).toBe(1);
    expect(html).toContain("#1e8449");
    expect(icons(render([module("text")], { liveSite: true, siteWide: null }))).toBe(0);
  });

  it("is ignored in the Builder: each page is edited as it is", () => {
    expect(icons(render([module("text")], { liveSite: false, siteWide: SITE_WIDE }))).toBe(0);
    const own = render([module("bug-report", { blockColor: "#1e8449" })], { liveSite: false, siteWide: SITE_WIDE });
    expect(icons(own)).toBe(1);
    expect(own).toContain("#1e8449");
  });
});

describe("a new Bug Report module", () => {
  it("defaults to This page only", () => {
    expect(createEmptyModule("bug-report").settings.showOn).toBe("page");
  });
});

describe("readSiteWideBugReport", () => {
  it("accepts a well-formed record and refuses anything else", () => {
    expect(readSiteWideBugReport(SITE_WIDE)?.settings.blockColor).toBe("#c0392b");
    expect(readSiteWideBugReport(null)).toBeNull();
    expect(readSiteWideBugReport({ moduleId: "x" })).toBeNull();
    expect(readSiteWideBugReport([])).toBeNull();
  });
});

describe("the panel's Every page note", () => {
  const home = { moduleId: "a", pageId: "1", pageSlug: "", pageName: "Home" };
  const about = { moduleId: "b", pageId: "2", pageSlug: "about", pageName: "About" };

  it("always says it shows on the live site once published", () => {
    expect(describeSiteWide("a", { kind: "ready", siteWide: null, others: [] })[0]).toMatch(/every page of the live site once published/);
  });

  it("names the other module's page when another module is the one showing", () => {
    const lines = describeSiteWide("b", { kind: "ready", siteWide: home, others: [] });
    expect(lines[2]).toMatch(/Another Bug Report module is already showing on every page, on "Home" \(\/\)/);
  });

  it("names the other pages when this one wins but others are also set", () => {
    const lines = describeSiteWide("a", { kind: "ready", siteWide: home, others: [about] });
    expect(lines[2]).toMatch(/Also set to every page: "About" \(\/about\)/);
  });

  it("says nothing more when this module is the only site-wide one", () => {
    expect(describeSiteWide("a", { kind: "ready", siteWide: home, others: [] })).toHaveLength(2);
  });

  it("says when it could not check, rather than implying there is no other", () => {
    expect(describeSiteWide("a", { kind: "unknown", reason: "the server answered 503." })[2]).toMatch(/Could not check/);
  });
});
