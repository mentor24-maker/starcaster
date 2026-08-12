import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The other half of the Site Search work: `lib/builder-client/site-search.test.ts`
 * proves the ranking is right, and this proves the modules actually reach the
 * page — that the type survives normalisation, that the box is a real form with
 * a labelled input, and that Standard 5's designed empty states render instead
 * of a blank box.
 *
 * Server-rendered on purpose. Every one of these states is what a visitor sees
 * BEFORE any effect has run — the moment where a module with no empty state
 * shows nothing at all.
 */

function render(type: string, settings: Record<string, string> = {}) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Search",
          layout: "single",
          modules: [{ id: "search-1", type, column: "main", text: "", settings }]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

describe("Site Search box", () => {
  it("survives normalisation instead of collapsing to a text module", () => {
    // Landmine #1: an unregistered type is silently coerced to "text", which
    // would render the (empty) module text and none of this markup.
    const html = render("site-search");
    expect(html).toContain("builder-site-search-form");
  });

  it("is a real search form with a labelled input", () => {
    const html = render("site-search");
    expect(html).toContain('role="search"');
    expect(html).toContain('type="search"');
    // Standard 8: the input carries a real label, not just a placeholder.
    expect(html).toContain("builder-site-search-label");
    expect(html).toMatch(/<label[^>]+for="([^"]+)"/);
    const id = /<label[^>]+for="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
  });

  it("uses the operator's placeholder and button label", () => {
    const html = render("site-search", { placeholder: "Find a court", buttonLabel: "Go" });
    expect(html).toContain('placeholder="Find a court"');
    expect(html).toContain(">Go</button>");
  });

  it("drops the button when the operator turns it off", () => {
    expect(render("site-search", { showButton: "false" })).not.toContain("builder-site-search-submit");
    expect(render("site-search", { showButton: "true" })).toContain("builder-site-search-submit");
  });

  it("takes its accent from the setting, and falls back when it is empty", () => {
    expect(render("site-search", { accentColor: "#ba0c2f" })).toContain("#ba0c2f");
    // A2: empty means "follow the theme", which resolves to the shared default.
    expect(render("site-search", { accentColor: "" })).toContain("#0f4f8f");
  });
});

describe("Site Search results", () => {
  it("survives normalisation", () => {
    expect(render("site-search-results")).toContain("builder-site-search-panel");
  });

  it("prompts for a query rather than rendering a blank box", () => {
    // Standard 5 — with no query in the URL there is nothing to list, and this
    // is the state a visitor lands on when they open the search page directly.
    const html = render("site-search-results");
    expect(html).toContain("Type something above to search this site.");
  });

  it("carries its own search box by default, and can drop it", () => {
    expect(render("site-search-results")).toContain("builder-site-search-form");
    expect(render("site-search-results", { showSearchField: "false" })).not.toContain("builder-site-search-form");
  });

  it("never emits an empty results list", () => {
    const html = render("site-search-results");
    expect(html).not.toContain("builder-site-search-results");
  });
});

describe("Site Search box — the operator's styles reach the page", () => {
  /**
   * These assert on CSS CUSTOM PROPERTIES rather than finished declarations,
   * because that is the contract: the renderer publishes variables and
   * `_builder-react-overrides.css` consumes them. An unset setting must emit
   * NO variable at all, so the stylesheet's own fallback decides — that is
   * what keeps "empty means follow the theme" true (A2).
   */

  it("emits no style variables at all for an untouched box", () => {
    const html = render("site-search");
    // Radius and button fill are always published; nothing else is, so a box
    // that predates these controls renders exactly as it did before.
    for (const v of [
      "--site-search-field-basis",
      "--site-search-field-shrink",
      "--site-search-btn-text",
      "--site-search-btn-size",
      "--site-search-btn-weight",
      "--site-search-btn-border-color",
      "--site-search-label-color",
      "--site-search-label-size",
      "--site-search-label-weight"
    ]) {
      expect(html, v).not.toContain(v);
    }
    expect(html).toContain("--site-search-btn-border-width:0px");
  });

  it("pins the field to a width, and lets 0 mean grow to fill", () => {
    const fixed = render("site-search", { fieldWidth: "320" });
    expect(fixed).toContain("--site-search-field-basis:320px");
    expect(fixed).toContain("--site-search-field-grow:0");

    const fluid = render("site-search", { fieldWidth: "0" });
    expect(fluid).not.toContain("--site-search-field-basis");
    expect(fluid).not.toContain("--site-search-field-grow");
  });

  it("stops a pinned field from shrinking, which is what wrapped the button", () => {
    // Live bug: a module box shrink-wraps inside its column (a 713px column
    // held a 302px box), so a field allowed to shrink collapsed to 302px and
    // pushed the button onto its own line. Refusing to shrink makes the box
    // grow instead. `max-width: 100%` in the stylesheet keeps that safe.
    expect(render("site-search", { fieldWidth: "400" })).toContain("--site-search-field-shrink:0");
    // An unpinned field must still shrink, or it cannot give way on a narrow
    // column — so the variable is absent and the stylesheet's default of 1 wins.
    expect(render("site-search", { fieldWidth: "0" })).not.toContain("--site-search-field-shrink");
    expect(render("site-search")).not.toContain("--site-search-field-shrink");
  });

  it("sizes the field's height, and clamps a silly value", () => {
    expect(render("site-search", { fieldHeight: "64" })).toContain("--site-search-field-height:64px");
    expect(render("site-search", { fieldHeight: "9999" })).toContain("--site-search-field-height:96px");
    expect(render("site-search", { fieldHeight: "1" })).toContain("--site-search-field-height:24px");
  });

  it("styles the button's text", () => {
    const html = render("site-search", {
      buttonTextColor: "#112233",
      buttonFontSize: "20",
      buttonBold: "false"
    });
    expect(html).toContain("--site-search-btn-text:#112233");
    expect(html).toContain("--site-search-btn-size:20px");
    expect(html).toContain("--site-search-btn-weight:400");
  });

  it("styles the button's border", () => {
    const html = render("site-search", {
      buttonBorderWidth: "3",
      buttonBorderStyle: "dashed",
      buttonBorderColor: "#ba0c2f"
    });
    expect(html).toContain("--site-search-btn-border-width:3px");
    expect(html).toContain("--site-search-btn-border-style:dashed");
    expect(html).toContain("--site-search-btn-border-color:#ba0c2f");
  });

  it("keeps the label hidden but present by default", () => {
    const html = render("site-search");
    expect(html).toContain("builder-site-search-label");
    // Standard 8: hidden means visually hidden, never absent from the markup.
    expect(html).not.toContain("is-visible");
    expect(html).toMatch(/<label[^>]+for="/);
  });

  it("shows the label with its own words and styles", () => {
    const html = render("site-search", {
      showLabel: "true",
      labelText: "Find a court",
      labelColor: "#334455",
      labelFontSize: "18",
      labelBold: "true"
    });
    expect(html).toContain("is-visible");
    expect(html).toContain("Find a court");
    expect(html).toContain("--site-search-label-color:#334455");
    expect(html).toContain("--site-search-label-size:18px");
    expect(html).toContain("--site-search-label-weight:700");
  });

  it("places the label above or beside the field", () => {
    const above = render("site-search", { showLabel: "true", labelPosition: "above" });
    expect(above).toContain("is-above");
    expect(above).toContain("has-label-above");

    const inline = render("site-search", { showLabel: "true", labelPosition: "inline" });
    expect(inline).toContain("is-inline");
    expect(inline).not.toContain("has-label-above");
  });

  it("falls back to the placeholder for the hidden label, so it is never empty", () => {
    const html = render("site-search", { placeholder: "Look things up" });
    expect(html).toContain(">Look things up</label>");
  });

  it("gives the results module's own box the same controls", () => {
    // One component renders both boxes; this proves the second panel's
    // settings actually reach it rather than being editable and inert.
    const html = render("site-search-results", { fieldWidth: "260", showLabel: "true", labelText: "Search" });
    expect(html).toContain("--site-search-field-basis:260px");
    expect(html).toContain("is-visible");
  });
});
