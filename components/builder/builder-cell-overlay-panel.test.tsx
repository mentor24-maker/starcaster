// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createEmptySection, type BuilderTemplateSection } from "@/lib/builder-template";
import { BuilderSectionCard } from "./builder-section-card";

// React only flushes `act` quietly when the environment says it is a test
// one; without it every mount prints a warning that reads like a failure.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * THE OVERLAY GROUP IN THE CELL PANEL.
 *
 * The row panel got this group when 86bbqb05p shipped; a cell had no way to
 * carry a tint at all, so a two-column band could only be dimmed whole.
 *
 * These mount the real SECTION CARD, not the cell panel on its own, and that
 * is the point. The panel is a set of props — passing it a working picker
 * proves nothing about whether the editor writes anywhere. The writer lives in
 * the card (`updateCellOverlay`), it has to land on `cellOverlayScreens[this
 * column]` and nowhere else, and the two mistakes actually available are both
 * invisible to the compiler: writing to the cell's FILL instead of its overlay
 * (identical `BackgroundSettings` on both), and writing to the wrong column.
 */

type Mounted = {
  choose(label: string, value: string): BuilderTemplateSection;
  /** The `<select>` under a named label in the left cell's panel — see `optionsOf`. */
  selectFor(label: string): HTMLSelectElement;
  labels(): string[];
  groupTitles(): string[];
};

/** A two-column row, expanded, with both cell panels open. */
function mount(initial?: BuilderTemplateSection): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let latest = initial ?? createEmptySection("two-column");

  const noop = () => undefined;
  act(() => {
    root.render(
      <BuilderSectionCard
        section={latest}
        sectionIndex={0}
        editorDevice="browser"
        isCollapsed={false}
        expandedModuleIds={[]}
        cellModules={[]}
        products={[]}
        onToggleCollapsed={noop}
        onMoveUp={noop}
        onMoveDown={noop}
        onRemove={noop}
        onCloneSection={noop}
        onSaveSection={noop}
        onUpdateSection={(updater) => {
          latest = updater(latest);
        }}
        onUpdateCellBackground={noop}
        onUpdateCellBorderWidth={noop}
        onUpdateCellBorderColor={noop}
        onUpdateCellBorderRadius={noop}
        onToggleModuleExpanded={noop}
        onUpdateModule={noop}
        onUpdateModuleBackground={noop}
        onMoveModule={noop}
        onDropModule={noop}
        onRemoveModule={noop}
        onCloneModule={noop}
        onSaveModule={noop}
        onSaveCellModules={noop}
        onInsertCellModule={noop}
        onInsertSavedModule={noop}
        onOpenGallery={noop}
        onOpenRichTextGallery={noop}
        onOpenButtonBackgroundGallery={noop}
        onOpenSocialIconGallery={noop}
        onUploadMediaForModule={noop}
        onUploadButtonBackgroundMedia={noop}
        onOpenSectionBackgroundGallery={noop}
        onUploadSectionBackgroundMedia={noop}
        onOpenModulePalette={noop}
        onToggleCanonical={noop}
      />
    );
  });

  /*
   * A cell's Styles panel starts collapsed, so nothing below exists until it
   * is opened — exactly as the operator opens it, by clicking the header.
   */
  act(() => {
    for (const button of [...host.querySelectorAll("button")]) {
      if ((button.getAttribute("aria-label") || "").startsWith("Expand Styles")) {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    }
  });

  /**
   * The Overlay Type picker inside a CELL panel, not the row's.
   *
   * Scoped by `.builder-cell-style-settings` deliberately: the row panel now
   * carries a control with the very same label, so an unscoped lookup would
   * find the row's picker first and every assertion below would pass while
   * the cell had no group at all.
   */
  function cellPanels(): Element[] {
    return [...host.querySelectorAll(".builder-cell-style-settings")];
  }

  function rowFor(label: string, panel: Element): Element | undefined {
    return [...panel.querySelectorAll(".builder-module-field, .builder-setting-row")].find(
      (row) =>
        (row.querySelector(".builder-module-field-label, .builder-setting-label")?.textContent || "")
          .trim() === label
    );
  }

  /**
   * The one `<select>` under a NAMED label, in the FIRST cell panel — the left
   * column. Which column a write landed in is itself one of the assertions
   * below, so the panel is picked by position and the control by its label.
   *
   * Every lookup in this file goes through here, and that is the fix for a
   * test that could not fail. "Offers the paintable modes" used to take the
   * first `<select>` in the panel that offered `gradient` — but the **Frame**
   * group renders before Overlay and its cell-FILL picker offers gradient too,
   * so the assertion was measuring the fill and would have stayed green with
   * `allowVideo` switched on in the Overlay group. Break-tested that way, and
   * it does fail now.
   */
  function selectFor(label: string): HTMLSelectElement {
    const panel = cellPanels()[0];
    if (!panel) throw new Error("no cell style panel rendered");
    const select = rowFor(label, panel)?.querySelector("select");
    if (!select) throw new Error(`no select labelled "${label}" in the cell panel`);
    return select as HTMLSelectElement;
  }

  return {
    labels: () =>
      cellPanels().flatMap((panel) =>
        [...panel.querySelectorAll(".builder-module-field-label, .builder-setting-label")].map((el) =>
          (el.textContent || "").trim()
        )
      ),
    groupTitles: () =>
      cellPanels().flatMap((panel) =>
        [...panel.querySelectorAll(".builder-schema-group-title")].map((el) =>
          (el.textContent || "").trim()
        )
      ),
    selectFor: (label) => selectFor(label),
    choose(label, value) {
      const select = selectFor(label);
      act(() => {
        // React listens at the root, so the value has to be set through the
        // native setter it patched over — assigning `.value` directly is
        // swallowed and the handler never sees the change.
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(
          select,
          value
        );
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return latest;
    }
  };
}

describe("the cell panel's Overlay group", () => {
  it("renders an Overlay group, the same one the row panel carries", () => {
    expect(mount().groupTitles()).toContain("Overlay");
  });

  it("offers the paintable modes, and not video", () => {
    // By LABEL, not "the first select offering gradient" — the Frame group's
    // cell-fill picker renders first and offers gradient as well, so the
    // loose lookup measured the fill and this assertion could not fail.
    const modes = [...mount().selectFor("Overlay Type").options].map((option) => option.value);

    for (const mode of ["none", "color", "gradient", "image"]) expect(modes).toContain(mode);
    // A video screen over a background is a second <video>; the row panel
    // leaves it out for the same reason.
    expect(modes).not.toContain("video");
  });

  it("writes the chosen type to the cell's OVERLAY, not to the cell's fill", () => {
    const next = mount().choose("Overlay Type", "color");

    expect(next.cellOverlayScreens?.left?.background.mode).toBe("color");
    // The fill is the mistake available here: same type, same picker, one
    // wrong prop. It must be untouched.
    expect(next.cellBackgrounds.left.mode).toBe("none");
  });

  it("writes to the column whose panel was used, and leaves the other alone", () => {
    const next = mount().choose("Overlay Type", "gradient");

    expect(next.cellOverlayScreens?.left?.background.mode).toBe("gradient");
    expect(next.cellOverlayScreens?.right?.background.mode).toBe("none");
  });

  it("keeps the strength the operator already set when he changes the type", () => {
    const section = {
      ...createEmptySection("two-column"),
      cellOverlayScreens: {
        left: { background: { mode: "color", color: "#123456" }, opacity: 60 },
        right: { background: { mode: "none" }, opacity: 100 }
      }
    } as unknown as BuilderTemplateSection;

    // He sets 60 once and changes the type twice. Snapping back to 100 is the
    // silent edit the row panel's own writer was built to avoid.
    expect(mount(section).choose("Overlay Type", "gradient").cellOverlayScreens?.left?.opacity).toBe(60);
  });

  it("does not crash on a row saved before the field existed", () => {
    const bare = createEmptySection("two-column") as unknown as Record<string, unknown>;
    delete bare.cellOverlayScreens;

    const next = mount(bare as unknown as BuilderTemplateSection).choose("Overlay Type", "color");
    expect(next.cellOverlayScreens?.left?.background.mode).toBe("color");
  });

  it("shows the overlay's Opacity only once a type has been chosen", () => {
    const section = {
      ...createEmptySection("two-column"),
      cellOverlayScreens: { left: { background: { mode: "color", color: "#123456" }, opacity: 60 } }
    } as unknown as BuilderTemplateSection;
    /*
     * COUNT, never presence. The cell's Frame group has carried its own
     * "Opacity" — the whole cell's — since long before this ticket, and there
     * are two columns, so a bare `toContain("Opacity")` is true on a section
     * with no overlay anywhere. An assertion that cannot fail is worse than
     * no assertion: it reads as cover for the gated field and gives none.
     */
    const opacities = (mounted: ReturnType<typeof mount>) =>
      mounted.labels().filter((label) => label === "Opacity").length;

    expect(opacities(mount(section))).toBe(opacities(mount()) + 1);
  });
});
