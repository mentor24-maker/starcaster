import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The mega panel's extra column.
 *
 * It used to be one hard-coded image-plus-heading tile; it now holds any
 * module from the palette. Live tenant menus (Delray Beach Tennis Center's
 * "VISIT DELRAY TENNIS") still carry the tile, so both paths are tested here
 * together — the point of the change is that generalizing the column did not
 * move a menu that already had one.
 */

function megaMenu(topLevelExtras: Record<string, unknown>) {
  const navItems = JSON.stringify([
    { id: "teams", label: "Teams & Leagues", href: "/teams", ...topLevelExtras },
    { id: "junior", label: "Junior Teams", href: "/teams/junior", parentId: "teams" }
  ]);

  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Header",
          layout: "single",
          modules: [
            {
              id: "nav-1",
              type: "navigation",
              column: "main",
              text: "",
              settings: { navItems, navDropdownStyle: "mega" }
            }
          ]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

describe("the mega menu's extra column", () => {
  it("renders a module chosen from the palette", () => {
    const html = megaMenu({
      featureModule: {
        id: "cta-1",
        type: "button",
        column: "",
        name: "Join CTA",
        text: "Join the club",
        settings: { url: "/join" }
      }
    });

    expect(html).toContain("site-nav-mega-feature-module");
    expect(html).toContain("Join the club");
  });

  it("still renders the original tile where no module has been chosen", () => {
    const html = megaMenu({
      featureImage: "/uploads/tennis.jpg",
      featureHeading: "Visit Delray Tennis"
    });

    expect(html).toContain("site-nav-mega-feature");
    expect(html).toContain("Visit Delray Tennis");
    expect(html).toContain("tennis.jpg");
    expect(html).not.toContain("site-nav-mega-feature-module");
  });

  it("prefers the module when an item carries both", () => {
    const html = megaMenu({
      featureImage: "/uploads/tennis.jpg",
      featureHeading: "Visit Delray Tennis",
      featureModule: {
        id: "heading-1",
        type: "heading",
        column: "",
        name: "Highlight",
        text: "Book a court",
        settings: { level: "h3" }
      }
    });

    expect(html).toContain("Book a court");
    expect(html).not.toContain("Visit Delray Tennis");
  });

  it("renders no extra column when the item has neither", () => {
    const html = megaMenu({});

    expect(html).toContain("site-nav-mega-panel");
    expect(html).not.toContain("site-nav-mega-feature");
  });
});

describe("the open-panel lift class", () => {
  it("is absent while no panel is open — the bar must not outrank its neighbours at rest", () => {
    const html = megaMenu({});
    expect(html).toContain("site-nav--mega");
    expect(html).not.toContain("site-nav--panel-open");
  });
});
