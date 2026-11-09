// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Task 86bcynpyf — "Dropdown list (choose several)" (`multiselect`).
 *
 * A button that looks like the single dropdown and opens a list of tick
 * boxes. Same jsdom instrument as builder-template-preview-crm-choice-fields
 * .test.tsx: the form renders nothing until its fetch resolves.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let posted: Array<Record<string, unknown>> = [];

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  posted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const INTERESTS = "What do you enjoy?";
const EMPTY = "Pick some days";

const FIELDS = [
  { key: "email", label: "Email", type: "email", required: true },
  { key: "interests", label: INTERESTS, type: "multiselect", required: true, options: ["Writing", "Music", "Film"] },
  { key: "days", label: EMPTY, type: "multiselect", required: false, options: [] },
  { key: "court", label: "Preferred court", type: "select", required: false, options: ["Clay", "Hard"] }
];

function stubCrmForm(fields: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).includes("/api/crm/contact-submit")) {
      posted.push(JSON.parse(String(init?.body ?? "{}")));
      return { ok: true, json: async () => ({ ok: true, data: { message: "Thanks" } }) };
    }
    if (!String(url).includes("/api/crm/forms/")) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        data: { id: "form_1", heading: "Join", submitLabel: "Send", successMessage: "Thanks", errorMessage: "Sorry", crmConfigId: "crm_1", fields }
      })
    };
  }));
}

async function renderCrmForm(liveSite: boolean, fields: unknown[] = FIELDS) {
  stubCrmForm(fields);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Row", layout: "single", modules: [{ id: "m-crm-form", type: "crm-form", column: "main", text: "", settings: { crmFormId: "form_1" } }] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const text = () => document.body.textContent ?? "";
const fieldFor = (label: string) =>
  Array.from(container!.querySelectorAll<HTMLElement>(".builder-crm-form-multiselect-field"))
    .find((f) => f.querySelector("span")?.textContent === label) ?? null;
const buttonFor = (label: string) => fieldFor(label)!.querySelector<HTMLButtonElement>(".builder-crm-form-multiselect-button")!;
const boxes = (name: string) => Array.from(container!.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`));
const key = (el: Element, k: string) =>
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

describe("Dropdown list (choose several)", () => {
  it("is closed at first, showing a placeholder, and opens a tick box per option", async () => {
    await renderCrmForm(true);
    const button = buttonFor(INTERESTS);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toBe("Select…");
    expect(boxes("interests")).toHaveLength(0);
    act(() => { button.click(); });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(boxes("interests").map((b) => b.value)).toEqual(["Writing", "Music", "Film"]);
  });

  it("lets two be chosen and the closed box shows both, in option order", async () => {
    await renderCrmForm(true);
    const button = buttonFor(INTERESTS);
    act(() => { button.click(); });
    act(() => { boxes("interests")[1].click(); });
    act(() => { boxes("interests")[0].click(); });
    expect(boxes("interests").map((b) => b.checked)).toEqual([true, true, false]);
    // Click outside closes it.
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(boxes("interests")).toHaveLength(0);
    expect(button.textContent).toBe("Writing, Music");
  });

  it("works from the keyboard: ArrowDown opens, Enter toggles without submitting, Escape closes", async () => {
    await renderCrmForm(true);
    const button = buttonFor(INTERESTS);
    button.focus();
    key(button, "ArrowDown");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(boxes("interests")[0]);
    key(boxes("interests")[2], "Enter");
    expect(boxes("interests")[2].checked).toBe(true);
    expect(posted).toHaveLength(0);
    key(boxes("interests")[2], "Escape");
    expect(boxes("interests")).toHaveLength(0);
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe("Film");
  });

  it("is required until one is chosen", async () => {
    await renderCrmForm(true);
    const proxy = fieldFor(INTERESTS)!.querySelector<HTMLInputElement>(".builder-crm-form-multiselect-proxy")!;
    expect(proxy.required).toBe(true);
    expect(proxy.checkValidity()).toBe(false);
    act(() => { buttonFor(INTERESTS).click(); });
    act(() => { boxes("interests")[0].click(); });
    expect(proxy.checkValidity()).toBe(true);
  });

  it("submits the choices as one readable value", async () => {
    await renderCrmForm(true);
    act(() => {
      const email = container!.querySelector<HTMLInputElement>('input[name="email"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(email, "a@b.co");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { buttonFor(INTERESTS).click(); });
    act(() => { boxes("interests")[2].click(); });
    act(() => { boxes("interests")[0].click(); });
    const form = container!.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve();
    });
    expect(posted).toHaveLength(1);
    expect((posted[0].data as Record<string, unknown>).interests).toBe("Writing, Film");
  });

  it("names its question for assistive tech", async () => {
    await renderCrmForm(true);
    const field = fieldFor(INTERESTS)!;
    const labelId = field.querySelector("span")!.id;
    expect(labelId).not.toBe("");
    expect(buttonFor(INTERESTS).getAttribute("aria-labelledby")).toContain(labelId);
  });
});

describe("an option-less multiselect never reaches a visitor", () => {
  it("is left out of a published form", async () => {
    await renderCrmForm(true);
    expect(text()).not.toContain(EMPTY);
    expect(fieldFor(EMPTY)).toBeNull();
  });

  it("still shows on the Builder canvas with the sample choices", async () => {
    await renderCrmForm(false);
    expect(text()).toContain(EMPTY);
    act(() => { buttonFor(EMPTY).click(); });
    expect(boxes("days").map((b) => b.value)).toEqual(["Option one", "Option two"]);
  });

  it("leaves the single dropdown exactly as it was", async () => {
    await renderCrmForm(true);
    const select = container!.querySelector<HTMLSelectElement>('select[name="court"]');
    expect(select).not.toBeNull();
    expect(select!.multiple).toBe(false);
    expect(Array.from(select!.options).map((o) => o.value)).toEqual(["", "Clay", "Hard"]);
    expect(select!.closest("label.builder-contact-form-field")).not.toBeNull();
  });
});
