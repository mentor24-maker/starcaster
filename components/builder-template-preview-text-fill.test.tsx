import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * WHERE A TEXT BLOCK'S FILL IS PAINTED (operator, 2026-08-15: "I want the
 * background color constrained by the boundary").
 *
 * He was looking at the Delray footer: a green "Visit our Pro Shop" block
 * with a border and a 20px radius, whose colour was a plain rectangle behind
 * the frame instead of the inside of it. The fill was on the module WRAPPER
 * — full column width, square corners, outside the padding — while the
 * border, the radius and the Width setting were all one box further in.
 *
 * These assert on the published markup, because that is the surface he was
 * looking at and the wrapper/frame split is invisible from the settings.
 */

function renderText(settings: Record<string, string>) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Footer",
          layout: "single",
          modules: [
            {
              id: "m1",
              type: "text",
              column: "main",
              text: "<p>Visit our Pro Shop.</p>",
              settings
            }
          ]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

/** The style attribute of the element carrying `className`. */
function styleOf(html: string, className: string) {
  const at = html.indexOf(className);
  expect(at).toBeGreaterThan(-1);
  const tagStart = html.lastIndexOf("<div", at);
  const tag = html.slice(tagStart, html.indexOf(">", at) + 1);
  return /style="([^"]*)"/.exec(tag)?.[1] ?? "";
}

const FILLED = {
  backgroundMode: "color",
  backgroundColor: "#c8f169",
  borderWidth: "2",
  borderColor: "#2f5d1f",
  borderRadius: "20",
  paddingTop: "10",
  paddingLeft: "10",
  size: "66"
};

describe("a text module's background", () => {
  it("is painted on the frame — the box with the border and the radius", () => {
    const frame = styleOf(renderText(FILLED), "builder-preview-text");
    expect(frame).toContain("#c8f169");
    expect(frame).toContain("border-radius:20px");
    expect(frame).toContain("2px solid #2f5d1f");
    // The Width setting sizes this same box, so the fill is as wide as the
    // block, not as wide as the column behind it.
    expect(frame).toContain("width:66%");
  });

  it("is NOT painted on the module wrapper any more", () => {
    const wrapper = styleOf(renderText(FILLED), "builder-preview-module");
    expect(wrapper).not.toContain("#c8f169");
  });

  it("leaves an untouched block with no fill anywhere", () => {
    const html = renderText({});
    expect(styleOf(html, "builder-preview-text")).not.toContain("background");
    expect(styleOf(html, "builder-preview-module")).not.toContain("background");
  });

  it("still paints the wrapper for a module type that has no frame", () => {
    // The exclusion is per type: heading has no frame div to hold a fill, so
    // its wrapper keeps painting one. A blanket change would have quietly
    // dropped the background from every other module.
    const html = renderToStaticMarkup(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          {
            id: "row-1",
            title: "Header",
            layout: "single",
            modules: [
              {
                id: "m1",
                type: "heading",
                column: "main",
                text: "About",
                settings: { backgroundMode: "color", backgroundColor: "#c8f169" }
              }
            ]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );
    expect(styleOf(html, "builder-preview-module")).toContain("#c8f169");
  });
});
