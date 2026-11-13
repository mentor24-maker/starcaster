// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderTemplateList } from "./builder-template-list";
import { BUILT_IN_TEMPLATE_NAME_NOTE, isSavableTemplateId } from "@/lib/builder-template-name";
import type { BuilderTemplateRecord } from "@/lib/builder-template";

/**
 * SC-803: renaming a template in Builder › Templates › Template Details.
 *
 * A saved template's name box takes typing and Enter saves it. The built-in
 * "Standard Right-Form" template (id `standard-right-form`, no database row)
 * could take typing too, and its save was refused by the store with
 * "id is required" — so its box is read-only now and says why.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

const template = (id: string, name: string): BuilderTemplateRecord =>
  ({
    id,
    name,
    templateKind: "modular",
    emailFunction: "",
    pageBackground: { mode: "none" },
    theme: {},
    layoutSections: [],
    createdAt: "",
    updatedAt: ""
  }) as unknown as BuilderTemplateRecord;

function render(draftId: string, draftName: string) {
  const onSetDraftName = vi.fn();
  const onSaveTemplate = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <BuilderTemplateList
        templates={[template("standard-right-form", "Standard Right-Form"), template("47", "Home Template")]}
        selectedTemplateId={draftId}
        draftId={draftId}
        draftName={draftName}
        onSaveTemplate={onSaveTemplate}
        templateKind="modular"
        emailFunction=""
        pageBackground={{ mode: "none" } as never}
        theme={{} as never}
        isSaving={false}
        onSelectTemplate={() => {}}
        onPreviewTemplate={() => {}}
        onDeleteTemplate={() => {}}
        onSetDraftName={onSetDraftName}
        onSetTemplateKind={() => {}}
        onSetEmailFunction={() => {}}
        onUpdatePageBackground={() => {}}
        onUpdateTheme={() => {}}
        onPreviewDraft={() => {}}
        onNewTemplate={() => {}}
        onTemplateEditorFocus={() => {}}
      />
    )
  );
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Expand Template Details"]');
  act(() => toggle!.click());
  const input = [...container.querySelectorAll<HTMLLabelElement>("label.field")]
    .find((label) => label.textContent?.includes("Template name"))!
    .querySelector("input")!;
  return { input, onSetDraftName, onSaveTemplate };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Template Details name box", () => {
  it("a saved template takes a new name and Enter saves it", () => {
    const { input, onSetDraftName, onSaveTemplate } = render("47", "Home Template");
    expect(input.readOnly).toBe(false);
    type(input, "Renamed");
    expect(onSetDraftName).toHaveBeenCalledWith("Renamed");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSaveTemplate).toHaveBeenCalledTimes(1);
    expect(container!.textContent).not.toContain(BUILT_IN_TEMPLATE_NAME_NOTE);
  });

  it("the built-in template's box is read-only and says why", () => {
    const { input, onSetDraftName, onSaveTemplate } = render("standard-right-form", "Standard Right-Form");
    expect(input.readOnly).toBe(true);
    type(input, "Renamed");
    expect(onSetDraftName).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSaveTemplate).not.toHaveBeenCalled();
    expect(container!.textContent).toContain(BUILT_IN_TEMPLATE_NAME_NOTE);
  });
});

describe("isSavableTemplateId", () => {
  it("matches what the store can save: numeric ids and new (empty) ones", () => {
    expect(isSavableTemplateId("47")).toBe(true);
    expect(isSavableTemplateId("")).toBe(true);
    expect(isSavableTemplateId("standard-right-form")).toBe(false);
  });
});
