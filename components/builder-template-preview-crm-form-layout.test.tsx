// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";
import { CRM_FORM_STYLES_EVENT } from "./builder/builder-crm-form-module-settings";

/**
 * Task SC-860 — a form can put its labels above the boxes, a question can be
 * half width so two share a row, and required questions carry a mark.
 *
 * jsdom does no layout, so these pin the MARKUP the stylesheet keys on
 * (`is-labels-above`, `is-half`, `.builder-crm-form-required`); the geometry
 * — two boxes side by side, stacking on a phone — is the `crm-form-*` render
 * contracts' job in scripts/ui/render-contracts.mjs.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

const FIELDS = [
  { key: "first_name", label: "First", type: "text", required: true, width: "half" },
  { key: "last_name", label: "Last", type: "text", required: true, width: "half" },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "company", label: "Company", type: "text", required: false }
];

async function renderForm(styles: Record<string, string>, fields: unknown[] = FIELDS) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).includes("/api/crm/forms/")) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        data: { id: "form_1", heading: "", submitLabel: "Send", successMessage: "", errorMessage: "", crmConfigId: "crm_1", styles, fields }
      })
    };
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Row", layout: "single", modules: [{ id: "m", type: "crm-form", column: "main", text: "", settings: { crmFormId: "form_1" } }] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const form = () => container!.querySelector<HTMLFormElement>("form.builder-crm-form")!;
const fieldFor = (name: string) => container!.querySelector(`[name="${name}"]`)!.closest(".builder-contact-form-field")!;

describe("CRM form layout (SC-860)", () => {
  it("labels above: the form says so and the two half questions are marked half", async () => {
    await renderForm({ labelPosition: "above" });
    expect(form().classList.contains("is-labels-above")).toBe(true);
    expect(fieldFor("first_name").classList.contains("is-half")).toBe(true);
    expect(fieldFor("last_name").classList.contains("is-half")).toBe(true);
    expect(fieldFor("email").classList.contains("is-half")).toBe(false);
  });

  it("labels beside (every form saved before SC-860): no half questions, one row each", async () => {
    await renderForm({});
    expect(form().classList.contains("is-labels-above")).toBe(false);
    expect(container!.querySelectorAll(".is-half").length).toBe(0);
  });

  it("a required question's label ends in an asterisk; an optional one does not", async () => {
    await renderForm({ labelPosition: "above" });
    const mark = (name: string) => fieldFor(name).querySelector(".builder-crm-form-required");
    expect(mark("first_name")?.textContent).toBe("*");
    expect(mark("first_name")?.getAttribute("aria-hidden")).toBe("true");
    expect(mark("email")).not.toBeNull();
    expect(mark("company")).toBeNull();
  });

  it("Required Mark: None shows no mark, and the box is still required", async () => {
    await renderForm({ requiredMarker: "none" });
    expect(container!.querySelectorAll(".builder-crm-form-required").length).toBe(0);
    expect(container!.querySelector<HTMLInputElement>('[name="email"]')!.required).toBe(true);
  });

  it("labels above stretch the label so Label Align still works", async () => {
    await renderForm({ labelPosition: "above", labelAlign: "center" });
    const label = fieldFor("email").querySelector<HTMLElement>("span")!;
    expect(label.style.alignSelf).toBe("stretch");
    expect(label.style.textAlign).toBe("center");
  });

  it("the canvas follows a width changed in the panel without a reload", async () => {
    await renderForm({ labelPosition: "above" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(CRM_FORM_STYLES_EVENT, {
        detail: { formId: "form_1", styles: { labelPosition: "above" }, fieldWidths: { email: "half", first_name: "full" } }
      }));
    });
    expect(fieldFor("email").classList.contains("is-half")).toBe(true);
    expect(fieldFor("first_name").classList.contains("is-half")).toBe(false);
  });
});
