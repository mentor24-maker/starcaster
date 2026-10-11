// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Ticket 86bcgdm83.
 *
 * The site importer turns what it cannot rebuild (a form, a video, a table,
 * an embed) into a `code` module showing a screenshot, labelled "Imported
 * form" and captioned "Imported form — rebuild with a real module." Both are
 * notes for whoever rebuilds the page. The caption used to be stored in the
 * module's text, so it was page content and visitors read it on 24 live pages.
 *
 * Both halves are tested: silent for a visitor, still there in the Builder.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

const placeholderSettings = {
  snippetMode: "html",
  label: "Imported form",
  importClass: "form",
  importSourceId: "el-1",
  importPlaceholder: "Imported form — rebuild with a real module."
};

async function renderCode(settings: Record<string, string>, liveSite: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Row", layout: "single",
            modules: [{ id: "m-code", type: "code", column: "main",
              text: '<img src="https://blob.test/crop.png" alt="Screenshot of imported form" />',
              settings }] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
}

const text = () => document.body.textContent ?? "";

describe("an imported placeholder's builder notes", () => {
  it("shows a visitor the screenshot and neither the caption nor the label", async () => {
    await renderCode(placeholderSettings, true);
    expect(text()).not.toContain("rebuild with a real module");
    expect(text()).not.toContain("Imported form");
    expect(document.querySelector(".builder-preview-code-label")).toBeNull();
  });

  it("still shows the caption and the label inside the Builder", async () => {
    await renderCode(placeholderSettings, false);
    expect(text()).toContain("Imported form — rebuild with a real module.");
    expect(document.querySelector(".builder-only-note")?.textContent).toContain("rebuild with a real module");
    expect(document.querySelector(".builder-preview-code-label")?.textContent).toBe("Imported form");
  });

  it("leaves a hand-made code module's label alone on the live site", async () => {
    await renderCode({ snippetMode: "html", label: "Our menu" }, true);
    expect(document.querySelector(".builder-preview-code-label")?.textContent).toBe("Our menu");
  });
});
