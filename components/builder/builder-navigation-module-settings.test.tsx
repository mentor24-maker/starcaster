import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderNavigationModuleSettings } from "./builder-navigation-module-settings";
import { createEmptyModule } from "@/lib/builder-template";

const ITEMS = JSON.stringify([
  { id: "home", label: "Home", href: "/", width: "25" },
  { id: "play", label: "Play", href: "/play", width: "25" },
  { id: "book", label: "Book a Court", href: "/book", parentId: "play" },
  { id: "about", label: "About", href: "/about", width: "25" }
]);

function navHtml(settings: Record<string, string> = {}) {
  const module = { ...createEmptyModule("navigation"), settings: { navItems: ITEMS, ...settings } };
  return renderToStaticMarkup(
    <BuilderNavigationModuleSettings
      module={module as never}
      onUpdateModule={() => {}}
      onUpdateModuleBackground={() => {}}
    />
  );
}

/**
 * The Navigation panel's Links list (panel sweep 3/15).
 *
 * Asserted on rendered markup rather than on the source, for the reason the
 * Social suite gives: the declaration that puts this list under
 * `check_panels` is one attribute, and a refactor can drop it without
 * breaking anything a diff would draw attention to. An undeclared manager is
 * invisible to the check, and an invisible manager is how two staggered
 * panels shipped in one week.
 *
 * The geometry itself is not testable here — nothing in this repo tests CSS,
 * and W0 is geometry that only a browser can resolve. `npm run check:panels`
 * is what measures it. This suite guards the one thing that decides whether
 * that check looks at this panel at all.
 */
describe("Navigation settings editor", () => {
  it("declares its Links list so check_panels measures it", () => {
    const html = navHtml();
    expect(html).toContain('data-lattice-columns="4"');
    expect(html).toContain("builder-nav-items-manager");
  });

  it("declares the fifth column when custom sizing adds one", () => {
    // The Width column exists only under custom sizing, so the default menu
    // renders a four-column list and says nothing at all about the
    // five-column one. `seed_fixture.mjs` seeds a custom-sizing menu for the
    // same reason.
    const html = navHtml({ navItemSizing: "custom" });
    expect(html).toContain('data-lattice-columns="5"');
    expect(html).toContain("builder-nav-item-width-wrap");
  });

  it("titles every column it declares", () => {
    // The count in the declaration is what check_panels holds each row to, so
    // a title added without bumping it (or the reverse) fails the check for a
    // reason that reads like a layout bug. Kept honest here instead.
    const html = navHtml();
    for (const title of ["Parent Page", "Page Name", "Slug", "Action"]) {
      expect(html).toContain(`>${title}<`);
    }
  });
});
