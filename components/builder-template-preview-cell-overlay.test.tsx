import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * THE CELL'S OWN TINT SCREEN, ON THE PAGE.
 *
 * A row could be tinted; one column of it could not, so a two-column band with
 * a photo in each column had no way to darken only one of them.
 *
 * These render the real preview rather than calling the style helper, because
 * the helper was already generic and already correct — every failure available
 * here is a wiring one. A field the normalizer drops, a layer that never
 * mounts, and a tint that lands ON TOP of the operator's words all leave
 * `getBuilderRowOverlayScreenStyle` returning exactly the right object.
 */

function renderRows(rows: unknown[]) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections(rows)}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

/** Two columns, a photo behind each, words in the left one. */
function twoColumnRow(extra: Record<string, unknown> = {}) {
  return {
    id: "band",
    title: "Two up",
    layout: "two-column",
    cellBackgrounds: {
      left: { mode: "image", imageUrl: "https://example.com/left.jpg" },
      right: { mode: "image", imageUrl: "https://example.com/right.jpg" }
    },
    modules: [
      { id: "words", type: "text", column: "left", text: "<p>Readable</p>" },
      { id: "other", type: "text", column: "right", text: "<p>Untouched</p>" }
    ],
    ...extra
  };
}

const BLUE_60 = { background: { mode: "color", color: "#123456" }, opacity: 60 };

describe("a cell overlay screen", () => {
  it("paints on the column it was set on", () => {
    const html = renderRows([twoColumnRow({ cellOverlayScreens: { left: BLUE_60 } })]);

    expect(html).toContain("builder-preview-cell-overlay-screen");
    expect(html).toContain("background-color:#123456");
    expect(html).toContain("opacity:0.6");
  });

  it("leaves the OTHER column completely alone — the whole point of the ticket", () => {
    const html = renderRows([twoColumnRow({ cellOverlayScreens: { left: BLUE_60 } })]);

    // One screen, not two: the right column has no overlay set, so it must
    // mount no layer at all rather than a transparent one.
    expect(html.match(/builder-preview-cell-overlay-screen/g)).toHaveLength(1);
  });

  it("mounts nothing on a row that has never been given one", () => {
    expect(renderRows([twoColumnRow()])).not.toContain("builder-preview-cell-overlay-screen");
    // Nor on a row carrying an explicit "no overlay", which is what every
    // column of every existing page normalizes to.
    expect(
      renderRows([twoColumnRow({ cellOverlayScreens: { left: { background: { mode: "none" }, opacity: 100 } } })])
    ).not.toContain("builder-preview-cell-overlay-screen");
  });

  it("marks the cell as layered, so the stylesheet can put the words in front", () => {
    const html = renderRows([twoColumnRow({ cellOverlayScreens: { left: BLUE_60 } })]);

    expect(html).toContain("builder-preview-column-layered");
    /*
     * The layer is emitted BEFORE the modules. Order is not cosmetic here: it
     * is what makes the two stylesheet rungs (screen 1, module 2) describe the
     * arrangement the DOM already has, rather than fighting it.
     *
     * Both indexes are pinned as found first. Comparing them alone is an
     * assertion that CANNOT FAIL for the failure that matters: a layer which
     * never mounts scores -1, and -1 is less than every real index, so
     * deleting the whole `<div>` left this test green. It was caught by
     * break-testing it, which is the only thing that finds an always-true
     * expectation.
     */
    const screenAt = html.indexOf("builder-preview-cell-overlay-screen");
    const wordsAt = html.indexOf("Readable");
    expect(screenAt).toBeGreaterThan(-1);
    expect(wordsAt).toBeGreaterThan(-1);
    expect(screenAt).toBeLessThan(wordsAt);
  });

  it("carries a section overlay and a cell overlay at the same time", () => {
    const html = renderRows([
      twoColumnRow({
        overlayScreen: { background: { mode: "color", color: "#ffffff" }, opacity: 20 },
        cellOverlayScreens: { left: BLUE_60 }
      })
    ]);

    expect(html).toContain("builder-preview-row-overlay-screen");
    expect(html).toContain("builder-preview-cell-overlay-screen");
    expect(html).toContain("background-color:#ffffff");
    expect(html).toContain("background-color:#123456");
  });

  it("survives the normalizer, which is where an unknown field is dropped", () => {
    // Landmine 1 in reverse: this is the check that the field is actually
    // listed in the section normalizer's output object. That object is built
    // key by key and `satisfies BuilderTemplateSection`, so a field merely
    // added to the TYPE reads back as undefined and the setting never persists
    // — with no error anywhere, which is exactly how it would ship.
    const [section] = normalizeLayoutSections([twoColumnRow({ cellOverlayScreens: { left: BLUE_60 } })]);

    expect(section.cellOverlayScreens?.left?.background.mode).toBe("color");
    expect(section.cellOverlayScreens?.left?.background.color).toBe("#123456");
    expect(section.cellOverlayScreens?.left?.opacity).toBe(60);
    // Every column gets an entry, and an unset one reads as "paint nothing".
    expect(section.cellOverlayScreens?.right?.background.mode).toBe("none");
  });

  it("gives a row saved before the field existed a no-op screen per column", () => {
    const [section] = normalizeLayoutSections([twoColumnRow()]);

    expect(Object.keys(section.cellOverlayScreens ?? {}).sort()).toEqual(["left", "right"]);
    for (const column of ["left", "right"]) {
      expect(section.cellOverlayScreens?.[column]?.background.mode).toBe("none");
    }
  });
});
