import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The published side of the text module's vertical rhythm (2026-08-15).
 *
 * The operator set a footer column's line height to 1.2 and nothing moved,
 * twice: the editor was writing line-height onto a `<span>` (which can only
 * push a line box taller, never shorter), and the gap he was actually looking
 * at was the paragraph MARGIN, which no control reached at all. These assert
 * the module's own settings survive all the way into the markup the public
 * site serves.
 */

function renderText(settings: Record<string, string>) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Footer Menu",
          layout: "single",
          modules: [
            {
              id: "m1",
              type: "text",
              column: "main",
              text: "<p>Program Guide</p><p>Weekly Schedule</p>",
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

describe("text module vertical rhythm", () => {
  it("adds nothing at all to an untouched block", () => {
    const html = renderText({});

    expect(html).not.toContain("--bx-para-gap");
    expect(html).not.toContain("line-height");
  });

  it("publishes the paragraph gap as the custom property the stylesheet reads", () => {
    // The stylesheet's `margin: 0 0 var(--bx-para-gap, 0.9rem)` is what turns
    // this into a narrower gap; without the property it keeps the 0.9rem it
    // shipped with, which is the whole of the spacing in a footer link list.
    expect(renderText({ paragraphGap: "4" })).toContain("--bx-para-gap:4px");
  });

  it("publishes line height on the block, where it can tighten as well as loosen", () => {
    expect(renderText({ lineHeight: "1.2" })).toContain("line-height:1.2");
  });

  it("carries both at once without disturbing the frame", () => {
    const html = renderText({ lineHeight: "1.3", paragraphGap: "0", borderWidth: "2" });

    expect(html).toContain("line-height:1.3");
    expect(html).toContain("--bx-para-gap:0px");
    expect(html).toContain("border:2px solid");
  });
});
