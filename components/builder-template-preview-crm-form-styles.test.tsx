// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";
import { CRM_FORM_STYLES_EVENT } from "./builder/builder-crm-form-module-settings";

/**
 * Ticket 86bcgcnkw, 2026-10-10: the rendered CRM Form drew its colours from a
 * copy of the form's styles kept in the PAGE (`crmFormStyleSnapshot`) whenever
 * one was there, ahead of the form record. That copy was taken when the
 * Builder's form panel was opened, so colours changed in the CRM editor never
 * reached the live site — five production pages carried one, Dane's home page
 * among them. The form record is the only source now; the canvas still follows
 * the panel at once through an event.
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

const SAVED_BACKGROUND = "#ff3300";
const STALE_BACKGROUND = "#00ff00";

async function renderCrmForm(liveSite: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/api/crm/forms/") ? ({
    ok: true,
    json: async () => ({
      data: {
        id: "form_1",
        heading: "Get in touch",
        submitLabel: "Send",
        successMessage: "Thanks",
        errorMessage: "Sorry",
        styles: { backgroundColor: SAVED_BACKGROUND },
        fields: [{ key: "email", label: "Email", type: "email", required: true }]
      }
    })
  }) : ({ ok: false, status: 404, json: async () => ({}) })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          {
            id: "row-1",
            title: "Row",
            layout: "single",
            modules: [{
              id: "m-crm-form",
              type: "crm-form",
              column: "main",
              text: "",
              settings: {
                crmFormId: "form_1",
                crmFormStyleSnapshot: JSON.stringify({ backgroundColor: STALE_BACKGROUND })
              }
            }]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const formBackground = () =>
  (container?.querySelector("form.builder-crm-form") as HTMLFormElement | null)?.style.background ?? "";

describe("a rendered CRM Form takes its colours from the form record", () => {
  it("ignores a style copy left in the page on the live site", async () => {
    await renderCrmForm(true);
    expect(formBackground()).toBe("rgb(255, 51, 0)");
  });

  it("ignores it on the Builder canvas too", async () => {
    await renderCrmForm(false);
    expect(formBackground()).toBe("rgb(255, 51, 0)");
  });

  it("follows the Builder panel's change on the canvas at once", async () => {
    await renderCrmForm(false);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(CRM_FORM_STYLES_EVENT, {
        detail: { formId: "form_1", styles: { backgroundColor: "#0000ff" } }
      }));
    });
    expect(formBackground()).toBe("rgb(0, 0, 255)");
  });
});
