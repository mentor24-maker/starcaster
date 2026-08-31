import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultBackgroundSettings,
  normalizeLayoutSections,
  resolveRenderTheme
} from "@/lib/builder-template";
import type { BuilderThemeStyles } from "./builder/builder-utils";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * PARALLAX MUST NOT DELETE THE THEME'S PHOTO TINT (review round 3 of #481).
 *
 * A theme's "Photo overlay tint" is composited onto the SECTION element as
 * `linear-gradient(tint, tint), url(photo)`, together with the inverse white
 * text colour — the tint is the only thing making that text readable on a
 * photo. Parallax mounts a positioned child painting the same photo, and an
 * element's own background paints BENEATH its positioned descendants, so the
 * layer covered the tint with the raw picture. Measured in a real browser at
 * mean RGB [166, 11, 17] with parallax off and [44, 53, 63] with it on, white
 * text in both.
 *
 * The render contract `image-parallax-carries-the-tint-it-covers` proves this
 * in a browser. These hold the wiring still without one: which surfaces hand a
 * tint down, and — just as important — which deliberately do not.
 */

const TINT_GRADIENT_STOPS = "rgba(255, 0, 0, 0.75), rgba(255, 0, 0, 0.75)";
const PHOTO = "https://cdn.example.com/photo.jpg";

/** A theme carrying an unmistakable photo overlay tint, and nothing else. */
const TINTED_THEME: BuilderThemeStyles = {
  treatments: { heroOverlay: "#ff0000", heroOverlayOpacity: 0.75 }
} as BuilderThemeStyles;

function renderSection(
  background: Record<string, unknown>,
  themeStyles?: BuilderThemeStyles
): string {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Photo row",
          layout: "single",
          background,
          modules: [{ id: "m1", type: "text", column: "main", text: "<p>Text on a photo</p>" }]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      theme={resolveRenderTheme(null, null)}
      themeStyles={themeStyles}
    />
  );
}

/** The same row, holding a menu — which never wears the hero treatment. */
function renderNavigationSection(
  background: Record<string, unknown>,
  themeStyles?: BuilderThemeStyles
): string {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-nav",
          title: "Menu row",
          layout: "single",
          background,
          modules: [{ id: "m1", type: "navigation", column: "main" }]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      theme={resolveRenderTheme(null, null)}
      themeStyles={themeStyles}
    />
  );
}

/** The parallax layer's own element, or "" when none was rendered. */
function layerTag(html: string): string {
  return html.match(/<div[^>]*builder-preview-image-background[^>]*>/)?.[0] ?? "";
}

/** The row itself. */
function sectionTag(html: string): string {
  return html.match(/<section[^>]*builder-preview-section-layout[^>]*>/)?.[0] ?? "";
}

/**
 * The tint an element is wearing, or null. One level of nesting by hand:
 * `rgba(...)` carries its own brackets, so a lazy match stops at the first
 * colour's closing one.
 */
function tintOf(tag: string): string | null {
  const match = /linear-gradient\(\s*(rgba?\([^)]*\))\s*,\s*(rgba?\([^)]*\))\s*\)/.exec(tag);
  return match ? `${match[1]}, ${match[2]}` : null;
}

const PARALLAX_PHOTO = { mode: "image", imageUrl: PHOTO, parallax: true, parallaxSpeed: 0.3 };

describe("parallax carries the tint it covers", () => {
  it("composites the row's theme tint onto the drifting copy", () => {
    const html = renderSection(PARALLAX_PHOTO, TINTED_THEME);

    // The row is genuinely tinted — without this the assertion below could
    // pass on a page that simply has no tint to lose.
    expect(tintOf(sectionTag(html))).toBe(TINT_GRADIENT_STOPS);
    expect(tintOf(layerTag(html))).toBe(TINT_GRADIENT_STOPS);
  });

  it("matches the row on an UNTHEMED page too, which is not the same as no tint", () => {
    // Surprising and pre-existing: `heroTint` falls back to the default hex
    // colour, so every image row already wears a white 45% wash whether a
    // theme is assigned or not. That wash is a tint like any other, and the
    // layer was covering it with the bare photo on every page in the product
    // — not only themed ones. The invariant is "the layer wears what the row
    // wears", never "the layer wears a theme's tint".
    const html = renderSection(PARALLAX_PHOTO, undefined);
    const rowTint = tintOf(sectionTag(html));

    expect(rowTint).toBe("rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.45)");
    expect(tintOf(layerTag(html))).toBe(rowTint);
  });

  it("still paints the picture underneath the tint, not instead of it", () => {
    // Order matters: the gradient goes in FRONT. A layer that painted only the
    // tint would be a flat colour band, which passes every "is it tinted"
    // assertion above.
    const tag = layerTag(renderSection(PARALLAX_PHOTO, TINTED_THEME));

    expect(tag).toContain(`linear-gradient(${TINT_GRADIENT_STOPS}), url(`);
  });

  it("mounts no layer at all when parallax is off, tinted or not", () => {
    const html = renderSection({ mode: "image", imageUrl: PHOTO }, TINTED_THEME);

    expect(layerTag(html)).toBe("");
    // ...and the row keeps wearing the tint itself, which is what it has
    // always done and what criterion 3 turns on.
    expect(tintOf(sectionTag(html))).toBe(TINT_GRADIENT_STOPS);
  });

  it("invents no tint on a navigation row, which never wears one", () => {
    // A menu-only row is excluded from `heroStyle` — it renders flush by
    // design. Its layer has to be excluded on exactly the same condition, or
    // parallax would ADD a tint to a row that has none, which is the same bug
    // pointing the other way.
    const html = renderNavigationSection(PARALLAX_PHOTO, TINTED_THEME);

    expect(tintOf(sectionTag(html))).toBeNull();
    expect(layerTag(html)).not.toBe("");
    expect(tintOf(layerTag(html))).toBeNull();
  });
});
