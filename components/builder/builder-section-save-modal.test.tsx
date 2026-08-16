// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderSectionSaveModal } from "./builder-section-save-modal";
import { describeCanonicalOverwrite } from "@/lib/shared-block-usage";

/**
 * The dialog that stopped Save on a page section from silently meaning "file a
 * duplicate". What must not regress is that BOTH saves are offered and neither
 * is the default: the operator lost an edit to that assumption on 2026-08-16.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function buttonLabelled(match: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(match)
  );
  if (!found) throw new Error(`No button containing "${match}"`);
  return found as HTMLButtonElement;
}

const impact = describeCanonicalOverwrite("Footer Menu", {
  following: 2,
  independent: 1,
  pages: 2,
  pageLabels: ["Home", "About"]
});

describe("BuilderSectionSaveModal", () => {
  it("offers both saves, and names the original in each", () => {
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    expect(buttonLabelled("Overwrite")).toBeTruthy();
    expect(buttonLabelled("Save as a new section")).toBeTruthy();
    expect(buttonLabelled("Cancel")).toBeTruthy();
    expect(document.body.textContent).toContain("Footer Menu");
  });

  it("lists the pages an overwrite rewrites, before the click", () => {
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    const items = Array.from(document.querySelectorAll(".builder-choice-dialog-list li")).map(
      (item) => item.textContent
    );
    expect(items).toEqual(["Home", "About"]);
  });

  it("routes each button to its own choice", () => {
    const clicked: string[] = [];
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => clicked.push("cancel")}
        onOverwrite={() => clicked.push("overwrite")}
        onSaveAsNew={() => clicked.push("new")}
      />
    );

    act(() => buttonLabelled("Overwrite").click());
    act(() => buttonLabelled("Save as a new section").click());
    act(() => buttonLabelled("Cancel").click());

    expect(clicked).toEqual(["overwrite", "new", "cancel"]);
  });

  it("closes on Escape but not on a stray backdrop click", () => {
    const clicked: string[] = [];
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => clicked.push("cancel")}
        onOverwrite={() => clicked.push("overwrite")}
        onSaveAsNew={() => clicked.push("new")}
      />
    );

    act(() => {
      (document.querySelector(".builder-gallery-overlay") as HTMLElement).click();
    });
    expect(clicked).toEqual([]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(clicked).toEqual(["cancel"]);
  });
});
