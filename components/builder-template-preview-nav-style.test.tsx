import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The other half of doctrine E7 for the Navigation module: `builder-nav-style.test.ts`
 * proves the settings turn into the right values, and this proves those values
 * reach the page a visitor sees.
 *
 * Worth having as a rendered test rather than a unit one, because the bug the
 * overhaul fixed lived exactly in the gap between them — `navBold` produced a
 * perfectly good `font-weight` that the stylesheet then overrode on every link,
 * and no unit test could have noticed.
 */

const NAV_ITEMS = JSON.stringify([
  { id: "home", label: "Home", href: "/" },
  { id: "about", label: "About", href: "/about" },
  { id: "team", label: "Team", href: "/team", parentId: "about" }
]);

function renderMenu(settings: Record<string, string> = {}, rowExtras: Record<string, unknown> = {}) {
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
              settings: { navItems: NAV_ITEMS, ...settings }
            }
          ],
          ...rowExtras
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

describe("the menu carries its own style to the page", () => {
  it("emits the bar's variables even when nothing has been set", () => {
    const html = renderMenu();

    expect(html).toContain("--site-nav-padding:8px 8px");
    expect(html).toContain("--site-nav-radius:26px");
    expect(html).toContain("--site-nav-border-width:1px");
    expect(html).toContain("--site-nav-border-color:#e6ecf2");
    expect(html).toContain("--site-nav-link-weight:700");
  });

  it("publishes bar padding, radius and border from the Placement and Border columns", () => {
    const html = renderMenu({
      navPaddingV: "18",
      navPaddingH: "24",
      navBarRadius: "4",
      navBorderWidth: "2",
      navBorderStyle: "dashed",
      navBorderColor: "#ff0000"
    });

    expect(html).toContain("--site-nav-padding:18px 24px");
    expect(html).toContain("--site-nav-radius:4px");
    expect(html).toContain("--site-nav-border-width:2px");
    expect(html).toContain("--site-nav-border-style:dashed");
    expect(html).toContain("--site-nav-border-color:#ff0000");
  });

  it("publishes the text controls that had no control before", () => {
    const html = renderMenu({
      navWeight: "400",
      navItalic: "true",
      navUnderline: "hover",
      navTextTransform: "uppercase",
      navLetterSpacing: "3"
    });

    expect(html).toContain("--site-nav-link-weight:400");
    expect(html).toContain("--site-nav-link-style:italic");
    expect(html).toContain("--site-nav-link-decoration:none");
    expect(html).toContain("--site-nav-link-hover-decoration:underline");
    expect(html).toContain("--site-nav-link-transform:uppercase");
    expect(html).toContain("--site-nav-link-spacing:3px");
  });

  it("names the hover effect as a class, since a transform is not a value", () => {
    expect(renderMenu()).toContain("site-nav--hover-lift");
    expect(renderMenu({ navHoverEffect: "grow" })).toContain("site-nav--hover-grow");
  });

  it("switches the bar shadow off outright", () => {
    expect(renderMenu({ navShadow: "false" })).toContain("--site-nav-shadow:none");
  });

  it("keeps link padding and radius on the LINK, which is what the live site always did", () => {
    // The preview used to put both on the <nav>, so the builder and the
    // published page disagreed about what these two controls did.
    const html = renderMenu({ navLinkPaddingV: "6", navLinkPaddingH: "20", navBorderRadius: "2" });

    expect(html).toContain("--site-nav-link-padding:6px 20px");
    expect(html).toContain("--site-nav-link-radius:2px");
    // ...and not as the bar's own padding/radius, which keep their defaults.
    expect(html).toContain("--site-nav-padding:8px 8px");
    expect(html).toContain("--site-nav-radius:26px");
  });

  it("hides the dropdown arrow when asked", () => {
    expect(renderMenu()).toContain("site-nav-dropdown-arrow");
    expect(renderMenu({ navShowArrow: "false" })).not.toContain("site-nav-dropdown-arrow");
  });

  it("nudges the whole bar with the offset pair", () => {
    expect(renderMenu({ horizontalOffset: "10", verticalOffset: "5" }))
      .toContain("transform:translate(10px, -5px)");
  });

  it("lets the module Background paint over the bar's default fill", () => {
    const html = renderMenu({ backgroundMode: "color", backgroundColor: "#123456" });
    expect(html).toContain("#123456");
  });
});

describe("the row and cell around a menu", () => {
  it("paints the row background the operator chose — it used to be discarded", () => {
    const html = renderMenu({}, { background: { mode: "color", color: "#021e3e" } });
    expect(html).toContain("#021e3e");
  });

  it("narrows the row when he narrows it", () => {
    const html = renderMenu({}, { widthMode: "contained", widthPercent: "60" });
    expect(html).toContain("max-width:60%");
  });

  it("still renders a row he never touched flush", () => {
    const html = renderMenu();
    expect(html).not.toContain("max-width:");
  });
});
