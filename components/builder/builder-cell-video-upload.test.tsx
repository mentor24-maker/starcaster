// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createDefaultBackgroundSettings,
  createEmptySection,
  type BuilderTemplateSection
} from "@/lib/builder-template";
import { BuilderSectionCard } from "./builder-section-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * GETTING A VIDEO INTO A CELL, AND NAMING THE CELL WHEN YOU WARN ABOUT ONE.
 *
 * Both of these are the round-3 send-back on 86bbqa7a8, and both are failures
 * of the same kind: the cell panel inherited a control set written when the
 * only surface that could play video was a ROW.
 *
 * 1. The row panel hands the picker an upload callback, so its Video File row
 *    shows "Choose Video" AND "Upload Video". The cell handed it neither, so a
 *    project whose library holds no video showed the operator an empty gallery
 *    with no way to add anything — with the cell already switched to Video and
 *    nothing to fill it.
 * 2. The missing-poster warning read "this section" on a panel that is one
 *    column, sending him to fix the wrong box.
 *
 * Mounted through the real SECTION CARD rather than the panel alone, for the
 * reason the overlay tests spell out: a panel handed working props proves
 * nothing about whether the card wires them, and the wrong-column write is
 * invisible to the compiler.
 */

type Mounted = {
  host: HTMLElement;
  uploads: Array<{ column: string; file: File | null }>;
  cellPanels(): Element[];
  buttonLabels(panel: Element): string[];
  warningText(panel: Element): string;
};

function videoSection(): BuilderTemplateSection {
  const section = createEmptySection("two-column");
  return {
    ...section,
    cellBackgrounds: {
      ...section.cellBackgrounds,
      left: { ...createDefaultBackgroundSettings(), mode: "video", videoUrl: "/clip.mp4" }
    }
  };
}

/** A two-column row whose LEFT cell is already on Video, both Styles panels open. */
function mount(options: { withUploadHandler?: boolean } = {}): Mounted {
  const { withUploadHandler = true } = options;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let latest = videoSection();
  const uploads: Array<{ column: string; file: File | null }> = [];

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
        onUpdateCellBackground={(column, updater) => {
          latest = {
            ...latest,
            cellBackgrounds: {
              ...latest.cellBackgrounds,
              [column]: updater(
                latest.cellBackgrounds?.[column] ?? createDefaultBackgroundSettings()
              )
            }
          };
        }}
        onUploadCellBackgroundMedia={
          withUploadHandler ? (column, file) => uploads.push({ column, file }) : undefined
        }
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

  // A cell's Styles panel starts collapsed — open it the way the operator does.
  act(() => {
    for (const button of [...host.querySelectorAll("button")]) {
      if ((button.getAttribute("aria-label") || "").startsWith("Expand Styles")) {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    }
  });

  return {
    host,
    uploads,
    cellPanels: () => [...host.querySelectorAll(".builder-cell-style-settings")],
    buttonLabels: (panel) =>
      [...panel.querySelectorAll(".builder-media-actions button, .builder-media-actions label span")]
        .map((node) => (node.textContent || "").trim())
        .filter(Boolean),
    warningText: (panel) =>
      (panel.querySelector(".builder-video-background-warning")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
  };
}

describe("a cell's video background can be filled from an empty library", () => {
  it("offers Upload Video beside Choose Video, the way the row panel does", () => {
    const ui = mount();
    const labels = ui.buttonLabels(ui.cellPanels()[0]);

    expect(labels).toContain("Choose Video");
    expect(labels).toContain("Upload Video");
  });

  it("sends the upload to THIS cell's column, not the row and not the neighbour", () => {
    const ui = mount();
    const panel = ui.cellPanels()[0];
    const input = panel.querySelector<HTMLInputElement>(".builder-upload-input");
    expect(input).toBeTruthy();
    // The video button is the one that takes video files — a control accepting
    // image/* here would be the image row, and the assertion would be measuring
    // the wrong button entirely.
    expect(input?.getAttribute("accept")).toBe("video/*");

    act(() => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(ui.uploads).toHaveLength(1);
    expect(ui.uploads[0]?.column).toBe("left");
  });

  it("draws no Upload button at all where no handler was supplied", () => {
    // The saved-section editor and the module repository have no upload
    // pipeline. A no-op handler would render a button that silently does
    // nothing, which is worse than not offering it.
    const ui = mount({ withUploadHandler: false });
    const labels = ui.buttonLabels(ui.cellPanels()[0]);

    expect(labels).toContain("Choose Video");
    expect(labels).not.toContain("Upload Video");
  });
});

describe("the missing-poster warning names the surface it is standing on", () => {
  it("says column on a cell panel, never section", () => {
    const ui = mount();
    const warning = ui.warningText(ui.cellPanels()[0]);

    expect(warning).toContain("this column will be blank");
    expect(warning).not.toContain("this section");
  });
});
