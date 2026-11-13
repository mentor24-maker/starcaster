// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderTemplateNameDialog } from "./builder-template-name-dialog";
import { BLANK_TEMPLATE_NAME_MESSAGE } from "@/lib/builder-template-name";

/**
 * SC-803: Save as Template asks for a name. Before this, pressing it created
 * "<page name> Template" without asking.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
});

function render(props: Partial<Parameters<typeof BuilderTemplateNameDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <BuilderTemplateNameDialog initialName="Home Template" isSaving={false} onSave={onSave} onCancel={onCancel} {...props} />
    )
  );
  return { onSave, onCancel };
}

function nameInput() {
  const input = document.querySelector<HTMLInputElement>(".builder-template-name-dialog input[type=text]");
  if (!input) throw new Error("name box not rendered");
  return input;
}

function typeName(value: string) {
  const input = nameInput();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".builder-template-name-dialog button")].find(
    (b) => b.textContent?.trim() === label
  );
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

describe("BuilderTemplateNameDialog", () => {
  it("opens with the suggested name filled in and selected", () => {
    render();
    const input = nameInput();
    expect(input.value).toBe("Home Template");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Home Template".length);
  });

  it("saves exactly the name typed, trimmed", () => {
    const { onSave, onCancel } = render();
    typeName("  My test template ");
    act(() => button("Save").click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("My test template");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cancel creates nothing", () => {
    const { onSave, onCancel } = render();
    act(() => button("Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape creates nothing", () => {
    const { onSave, onCancel } = render();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a blank name with a plain message and saves nothing", () => {
    const { onSave } = render();
    typeName("   ");
    act(() => button("Save").click());
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(BLANK_TEMPLATE_NAME_MESSAGE);
  });
});
