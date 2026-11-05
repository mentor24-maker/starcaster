// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Task 86bcynjv7 — "Choose one" (`radio`) and "Choose several" (`checkboxes`).
 *
 * Imported forms ask multiple-choice questions with every choice on the page
 * (first case: Strands Movie, "What is the main skill you bring to the team?",
 * 11 choices). These two types read the same Options list a Dropdown does, and
 * follow the dropdown's rule for an empty list: dropped from a published form,
 * shown with sample choices on the Builder canvas.
 *
 * Same jsdom instrument as builder-template-preview-crm-select-options.test.tsx,
 * for the same reason — the form renders nothing until its fetch resolves.
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

const SKILL = "What is the main skill you bring?";
const INTERESTS = "Which do you enjoy?";
const EMPTY_RADIO = "Pick a day";
const EMPTY_BOXES = "Pick some days";

const FIELDS = [
  { key: "email", label: "Email", type: "email", required: true },
  { key: "skill", label: SKILL, type: "radio", required: true, options: ["Acting", "Writing", "Music"] },
  { key: "interests", label: INTERESTS, type: "checkboxes", required: true, options: ["Writing", "Music", "Film"] },
  { key: "day", label: EMPTY_RADIO, type: "radio", required: true, options: [] },
  { key: "days", label: EMPTY_BOXES, type: "checkboxes", required: false, options: [] },
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
const inputs = (name: string) => Array.from(container!.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
const fieldsetFor = (legend: string) =>
  Array.from(container!.querySelectorAll("fieldset")).find((f) => f.querySelector("legend")?.textContent === legend) ?? null;

function click(input: HTMLInputElement) {
  act(() => { input.click(); });
}

describe("Choose one renders every option as a round button", () => {
  it("draws one radio per option, all sharing the field's name, under a legend", async () => {
    await renderCrmForm(true);
    const radios = inputs("skill");
    expect(radios.map((r) => r.type)).toEqual(["radio", "radio", "radio"]);
    expect(radios.map((r) => r.value)).toEqual(["Acting", "Writing", "Music"]);
    const fieldset = fieldsetFor(SKILL);
    expect(fieldset).not.toBeNull();
    expect(fieldset!.querySelectorAll('input[type="radio"]').length).toBe(3);
  });

  it("lets only one be picked", async () => {
    await renderCrmForm(true);
    const [acting, writing] = inputs("skill");
    click(acting);
    click(writing);
    expect(inputs("skill").map((r) => r.checked)).toEqual([false, true, false]);
  });

  it("marks a required question required, so the browser refuses an empty answer", async () => {
    await renderCrmForm(true);
    expect(inputs("skill").every((r) => r.required)).toBe(true);
  });
});

describe("Choose several renders tick boxes", () => {
  it("draws one checkbox per option and allows several", async () => {
    await renderCrmForm(true);
    const [writing, music, film] = inputs("interests");
    expect(inputs("interests").every((b) => b.type === "checkbox")).toBe(true);
    click(writing);
    click(music);
    expect(inputs("interests").map((b) => b.checked)).toEqual([true, true, false]);
    click(writing);
    expect(inputs("interests").map((b) => b.checked)).toEqual([false, true, false]);
    expect(film.checked).toBe(false);
  });

  it("requires at least one tick — and only until one is ticked", async () => {
    await renderCrmForm(true);
    expect(inputs("interests").every((b) => b.required)).toBe(true);
    click(inputs("interests")[2]);
    expect(inputs("interests").some((b) => b.required)).toBe(false);
  });

  it("submits the choices as one readable value, in the order the options are listed", async () => {
    await renderCrmForm(true);
    act(() => {
      const email = container!.querySelector<HTMLInputElement>('input[name="email"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(email, "a@b.co");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(inputs("skill")[1]);
    click(inputs("interests")[1]);
    click(inputs("interests")[0]);
    const form = container!.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve();
    });
    expect(posted).toHaveLength(1);
    const data = posted[0].data as Record<string, unknown>;
    expect(data.skill).toBe("Writing");
    expect(data.interests).toBe("Writing, Music");
    expect(posted[0].email).toBe("a@b.co");
  });
});

describe("a choice question with no options never reaches a visitor", () => {
  it("leaves out an option-less Choose one / Choose several on a published form", async () => {
    await renderCrmForm(true);
    expect(text()).not.toContain(EMPTY_RADIO);
    expect(text()).not.toContain(EMPTY_BOXES);
    expect(text()).not.toContain("Option one");
    expect(inputs("day")).toHaveLength(0);
    expect(inputs("days")).toHaveLength(0);
  });

  it("still shows them on the Builder canvas, with the sample choices", async () => {
    await renderCrmForm(false);
    expect(text()).toContain(EMPTY_RADIO);
    expect(text()).toContain(EMPTY_BOXES);
    expect(inputs("day")).toHaveLength(2);
    expect(inputs("days")).toHaveLength(2);
  });

  it("leaves the dropdown exactly as it was", async () => {
    await renderCrmForm(true);
    const select = container!.querySelector<HTMLSelectElement>('select[name="court"]');
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((o) => o.value)).toEqual(["", "Clay", "Hard"]);
    expect(select!.closest("label.builder-contact-form-field")).not.toBeNull();
  });
});
