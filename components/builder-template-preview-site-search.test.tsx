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
