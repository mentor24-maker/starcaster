// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Ticket 86bbugd2e, round 2.
 *
 * The sweep for this ticket fixed eight modules that showed builder-time
 * content to visitors, and recorded the CRM form as already clean. It was not:
 * `CrmFormFieldControl` still carried the exact shape the ticket asked for —
 * `x.length ? x : PLACEHOLDER` — so a dropdown whose Options box was left
 * empty offered every visitor "Option one" and "Option two".
 *
 * That is worse than the demo tags Dane photographed, which were only read: a
 * visitor could pick one and submit it into the tenant's CRM as real contact
 * data. And it is the DEFAULT state of a new dropdown, not a misconfiguration
 * — the Options box is free text whose own placeholder reads "Option one,
 * Option two", and lib/crmConfigStore.js defaults `options` to [].
 *
 * The fix leaves the field out of a published form altogether rather than
 * drawing it empty, so both halves are asserted here: nothing leaks to a
 * visitor, and the canvas still shows the field to whoever is designing it.
 *
 * This file uses the jsdom client instrument rather than the SSR one in
 * builder-template-preview-builder-affordances.test.tsx because the CRM form
 * renders nothing but "Loading form…" until its fetch resolves, and effects do
 * not run under renderToStaticMarkup.
 *
 * Round 3 note: the configured dropdown below is stubbed with real `options`,
 * and until round 3 the API could not actually produce that shape — the store
 * stripped `options` in both directions, so the live guard was deleting every
 * dropdown rather than only the empty ones. The stub is honest now.
 * scripts/builder/crmFormFieldOptions.test.js is what holds it honest: it
 * asserts the options survive the store, which no render-level test can see.
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
  vi.restoreAllMocks();
});

const EMPTY_DROPDOWN_LABEL = "How did you hear about us?";
const CONFIGURED_DROPDOWN_LABEL = "Preferred court";

/** A real tenant form: one ordinary field, one configured dropdown, one with its Options box left blank. */
function stubCrmForm() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).includes("/api/crm/forms/")) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        data: {
          id: "form_1",
          heading: "Get in touch",
          submitLabel: "Send",
          successMessage: "Thanks",
          errorMessage: "Sorry",
          crmConfigId: "crm_1",
          fields: [
            { key: "email", label: "Email", type: "email", required: true },
            { key: "court", label: CONFIGURED_DROPDOWN_LABEL, type: "select", required: false, options: ["Clay", "Hard"] },
            { key: "how_heard", label: EMPTY_DROPDOWN_LABEL, type: "select", required: true, options: [] }
          ]
        }
      })
    };
  }));
}

async function renderCrmForm(liveSite: boolean) {
  stubCrmForm();
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
            modules: [{ id: "m-crm-form", type: "crm-form", column: "main", text: "", settings: { crmFormId: "form_1" } }]
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

const text = () => document.body.textContent ?? "";

describe("a dropdown's sample options never reach a visitor", () => {
  it("offers a visitor no 'Option one' / 'Option two' on a published form", async () => {
    await renderCrmForm(true);
    expect(text()).not.toContain("Option one");
    expect(text()).not.toContain("Option two");
  });

  it("leaves out the dropdown itself, label and all, rather than drawing it empty", async () => {
    // An empty <select> the tenant also marked required cannot be satisfied,
    // and constraint validation would then block the whole form for everyone.
    await renderCrmForm(true);
    expect(text()).not.toContain(EMPTY_DROPDOWN_LABEL);
    expect(container?.querySelectorAll("select").length).toBe(1);
  });

  it("still renders the rest of the form, including a dropdown that HAS options", async () => {
    // The fix must drop one dead field, not the form around it.
    await renderCrmForm(true);
    expect(text()).toContain("Get in touch");
    expect(text()).toContain("Email");
    expect(text()).toContain(CONFIGURED_DROPDOWN_LABEL);
    expect(text()).toContain("Clay");
    expect(text()).toContain("Hard");
  });

  it("still shows the sample options on the Builder canvas", async () => {
    // The other half of the rule. Deleting the samples would pass the tests
    // above and leave whoever is designing the page a blank control.
    await renderCrmForm(false);
    expect(text()).toContain(EMPTY_DROPDOWN_LABEL);
    expect(text()).toContain("Option one");
    expect(text()).toContain("Option two");
  });
});
