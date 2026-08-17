import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Which menu item gets the active highlight.
 *
 * Home is deliberately exempt: "/" is where the site starts rather than
 * somewhere you navigated to, so a lit-up Home reads as a stuck button.
 * Every other page still highlights its own item.
 *
 * The pathname comes from `lib/builder-client/adapters/navigation.ts`, which
 * reads `window.location.pathname` and falls back to "/" when there is no
 * window — so the home case is the default here and the others stub a window.
 */

function navMarkup(navItems: unknown[]) {
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
              settings: { navItems: JSON.stringify(navItems) }
            }
          ]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

const ITEMS = [
  { id: "home", label: "Home", href: "/" },
  { id: "about", label: "About", href: "/about" },
  { id: "contact", label: "Contact", href: "#" }
];

function activeLabels(html: string) {
  // Anchors only — the preview also emits a <style> block that names
  // `.site-nav-link-active` as a selector.
  return Array.from(html.matchAll(/<a\b[^>]*\bsite-nav-link-active\b[^>]*>([^<]*)/g)).map(
    (match) => match[1]
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the active menu item", () => {
  it("leaves Home unhighlighted on the home page", () => {
    const html = navMarkup(ITEMS);

    expect(html).toContain(">Home<");
    expect(activeLabels(html)).toEqual([]);
    expect(html).not.toContain('aria-current="page"');
  });

  it("highlights an ordinary page's own item", () => {
    vi.stubGlobal("window", { location: { pathname: "/about", search: "" } });

    expect(activeLabels(navMarkup(ITEMS))).toEqual(["About"]);
  });

  it("leaves Home unhighlighted from an ordinary page too", () => {
    vi.stubGlobal("window", { location: { pathname: "/about", search: "" } });

    expect(activeLabels(navMarkup(ITEMS))).not.toContain("Home");
  });

  it("treats the /home slug as home as well", () => {
    expect(activeLabels(navMarkup([{ id: "home", label: "Home", href: "/home" }]))).toEqual([]);
  });
});
