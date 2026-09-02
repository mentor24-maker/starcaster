import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBlogCardManagerModuleSettings } from "./builder-blog-card-manager-module-settings";
import { createEmptyModule } from "@/lib/builder-template";

/**
 * THE CARD MANAGER'S PANEL MUST CONTAIN THE DESIGNER, NOT A POINTER TO IT.
 *
 * Until 2026-09-02 this panel rendered one sentence — "Configure the card
 * template using the interactive designer in the canvas above" — and there was
 * no designer in the canvas above. `renderModulePreview` in
 * builder-module-card.tsx carries a branch for every sibling admin module
 * (media-manager, blog-post-manager, blog-category-manager, event-manager,
 * crm-contacts-table) and never had one for this type, so the working controls
 * rendered only through the public renderer — on a page that is not published.
 *
 * The cost: task 86bbt52fa shipped fifteen new card controls that the operator
 * then could not find, and the module's own note sent him looking for them in
 * a place that does not exist. This test fails if anything ever swaps the
 * designer back out for a description of it.
 */
const MODULE = createEmptyModule("blog-card-manager", "main");

function markup() {
  return renderToStaticMarkup(
    <BuilderBlogCardManagerModuleSettings module={MODULE} onUpdateModule={() => {}} />
  );
}

describe("the Card Manager settings panel", () => {
  it("renders the designer itself", () => {
    // Server-rendered, so the designer is in its loading state — which is
    // exactly the point: the COMPONENT is mounted here, not a paragraph about
    // it. A panel that only described the designer renders neither.
    expect(markup()).toContain("builder-blog-card-manager-module");
  });

  it("does not send the operator to a designer that is not there", () => {
    expect(markup()).not.toContain("designer in the canvas above");
  });

  it("keeps the note that says how far a change reaches", () => {
    // Saving here rewrites the card template for the WHOLE project, not this
    // one module — an operator who does not know that finds out by changing
    // every Post Feed on the site at once.
    expect(markup()).toContain("saved project-wide");
  });
});
