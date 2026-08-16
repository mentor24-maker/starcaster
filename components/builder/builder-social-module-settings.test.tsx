import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderSocialModuleSettings } from "./builder-social-module-settings";
import { createEmptyModule } from "@/lib/builder-template";

const ITEMS = JSON.stringify([
  { id: "fb", label: "Facebook", href: "https://facebook.com/delray", iconUrl: "/images/fb.svg", backgroundColor: "#1877f2" },
  { id: "ig", label: "Instagram", href: "", iconUrl: "", backgroundColor: "#c13584" }
]);

function socialHtml(settings: Record<string, string> = {}) {
  const module = { ...createEmptyModule("social"), settings };
  return renderToStaticMarkup(
    <BuilderSocialModuleSettings
      module={module as never}
      onUpdateModule={() => {}}
      onUpdateModuleBackground={() => {}}
      onOpenGallery={() => {}}
    />
  );
}

/**
 * The Social editor, rebuilt 2026-08-15 to the Feature Cards shape (operator:
 * "update the Social Media module to reflect all the UI rules. It looks
 * pretty rough now").
 *
 * Asserted on rendered markup rather than on the source, for the reason the
 * Slideshow suite gives: "settings left, items right" is a pair of class
 * names a refactor can drop without breaking anything a diff would show, and
 * the panel this replaced looked perfectly reasonable in TSX while printing
 * its Label input over the word Background.
 */
describe("Social settings editor", () => {
  it("is a two-column panel: module settings left, platforms right", () => {
    const html = socialHtml({ socialItems: ITEMS });
    expect(html).toContain("builder-cards-panel-settings");
    expect(html).toContain("builder-cards-panel-items");
    // The settings half borrows the generator's column, which is what makes
    // its strips one-control-per-row and shares the label track (W0).
    expect(html).toContain("builder-schema-panel-column");
  });

  it("puts the platform list in ONE lattice grid the check can see", () => {
    const html = socialHtml({ socialItems: ITEMS });
    // Without data-lattice-pairs the list is invisible to check_panels, and
    // an invisible manager is how two staggered panels shipped in one week.
    expect(html).toContain('data-lattice-pairs="2"');
    // One head row per platform, named — no per-item wrapper, which would
    // take a single grid cell and break the shared tracks.
    expect([...html.matchAll(/builder-card-editor-head/g)]).toHaveLength(2);
    expect(html).toContain(">Facebook<");
    expect(html).toContain(">Instagram<");
    expect([...html.matchAll(/aria-label="Facebook (label|link)"/g)]).toHaveLength(2);
  });

  it("has no collapses left in it (A0)", () => {
    const html = socialHtml({ socialItems: ITEMS });
    // Border & Shadow used to be a <details>, and the settings sat behind two
    // collapsible sub-panels. Everything is on its axis, in the open.
    expect(html).not.toContain("hanging-details");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("builder-cell-panel-header");
    for (const shadowField of ["Shadow Color", "Shadow X", "Shadow Blur", "Shadow Spread"]) {
      expect(html).toContain(`>${shadowField}<`);
    }
  });

  it("names its axes and orders them Structure → Placement → Frame (D8/D9)", () => {
    const html = socialHtml({ socialItems: ITEMS });
    const at = ["Structure", "Placement", "Frame"].map((title) =>
      html.indexOf(`builder-schema-group-title">${title}<`)
    );
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("offers the module's spacing as matched rows (E4b)", () => {
    const html = socialHtml({ socialItems: ITEMS });
    expect(html).toContain(">V Margin<");
    expect(html).toContain(">H Margin<");
    // A 0–160 margin counts in fives (W8): 33 options, not 161.
    const at = html.indexOf(">V Margin<");
    const chunk = html.slice(html.indexOf("<select", at), html.indexOf("</select>", at));
    expect([...chunk.matchAll(/<option/g)]).toHaveLength(33);
  });

  it("renders every field through the shared strip components (E1/E2)", () => {
    const html = socialHtml({ socialItems: ITEMS });
    expect(html).toContain("builder-module-field-strip");
    // W9: the shape this replaced leaned on `label.field` boxes and bespoke
    // setting rows, both of which stretch.
    expect(html).not.toContain('class="field');
    expect(html).not.toContain("builder-setting-row");
  });

  it("still renders a platform with no icon and no link", () => {
    // R4: the empty state is part of the panel. Instagram above has neither.
    const html = socialHtml({ socialItems: ITEMS });
    expect(html).toContain("Choose From Gallery");
    expect(html).toContain("Change Icon");
  });
});
