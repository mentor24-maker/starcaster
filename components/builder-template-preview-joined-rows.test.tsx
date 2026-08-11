import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";
import { BuilderSectionControls } from "./builder/builder-section-controls";

const IMAGE = "https://example.com/band.png";

function makeRows(joinSecond: boolean) {
  return normalizeLayoutSections([
    {
      id: "row-1",
      title: "Top",
      layout: "single",
      background: { mode: "image", imageUrl: IMAGE },
      modules: [{ id: "m1", type: "text", column: "main", text: "Top row" }]
    },
    {
      id: "row-2",
      title: "Bottom",
      layout: "single",
      joinWithPrevious: joinSecond,
      background: { mode: "color", color: "#ff0000" },
      modules: [{ id: "m2", type: "text", column: "main", text: "Bottom row" }]
    }
  ]);
}

function render(joinSecond: boolean) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={makeRows(joinSecond)}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

describe("joined rows in the rendered page", () => {
  it("wraps a joined pair in one element that carries the shared background", () => {
    const html = render(true);
    const wrapper = html.slice(html.indexOf("builder-preview-joined-rows"));

    expect(html).toContain("builder-preview-joined-rows");
    // The image belongs to the wrapper, and it appears once — not once per row.
    expect(wrapper.indexOf(IMAGE)).toBeGreaterThan(-1);
    expect(html.split(IMAGE).length - 1).toBe(1);
  });

  it("drops the joined row's own background so the shared one shows through", () => {
    expect(render(true)).not.toContain("#ff0000");
  });

  it("keeps both rows' content", () => {
    const html = render(true);

    expect(html).toContain("Top row");
    expect(html).toContain("Bottom row");
  });

  it("leaves unjoined rows exactly as they were — no wrapper, own backgrounds", () => {
    const html = render(false);

    expect(html).not.toContain("builder-preview-joined-rows");
    expect(html).toContain(IMAGE);
    expect(html).toContain("#ff0000");
  });
});

describe("the control that turns joining on", () => {
  const renderControls = (canJoinPrevious: boolean) =>
    renderToStaticMarkup(
      <BuilderSectionControls
        section={makeRows(false)[1]}
        canJoinPrevious={canJoinPrevious}
        editorDevice="browser"
        onUpdateSection={() => {}}
      />
    );

  it("offers the checkbox on any row that has one above it", () => {
    const html = renderControls(true);

    expect(html).toContain("Share background");
    expect(html).toContain("builder-join-previous-toggle");
  });

  it("hides it on the first row, which has nothing above it to share with", () => {
    expect(renderControls(false)).not.toContain("builder-join-previous-toggle");
  });
});
