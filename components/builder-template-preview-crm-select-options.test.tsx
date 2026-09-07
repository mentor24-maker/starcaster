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
const FORM_HEADING = "Get in touch";

const DEFAULT_FIELDS = [
  { key: "email", label: "Email", type: "email", required: true },
  { key: "court", label: CONFIGURED_DROPDOWN_LABEL, type: "select", required: false, options: ["Clay", "Hard"] },
  { key: "how_heard", label: EMPTY_DROPDOWN_LABEL, type: "select", required: true, options: [] }
];

function stubCrmForm(fields: unknown[] = DEFAULT_FIELDS) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).includes("/api/crm/forms/")) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        data: {
          id: "form_1",
          heading: FORM_HEADING,
          submitLabel: "Send",
          successMessage: "Thanks",
          errorMessage: "Sorry",
          crmConfigId: "crm_1",
          fields
        }
      })
    };
  }));
}

async function renderCrmForm(liveSite: boolean, fields: unknown[] = DEFAULT_FIELDS) {
  stubCrmForm(fields);
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

/**
 * Round 3 send-back, same ticket.
 *
 * `ContactFormPreview` is a different module from the CRM form above — it is
 * the `contact-form` type in the palette, and it renders its own fixed fields
 * without fetching anything. In "Custom" mode it printed a sentence written
 * for whoever is designing the page: "Custom form builder coming soon." It
 * took no `liveSite` prop at all, so a visitor read it word for word on the
 * published site. Two clicks reach it — the module is in the palette under
 * "Contact Forms", and Custom sits in its settings dropdown next to Squeeze
 * and Standard, with nothing to say it publishes a note about the Builder.
 *
 * `npm run check:builder-notes` cannot catch this one: "coming soon" is not in
 * its phrase list, which is the blind spot round 1 reported and this is a live
 * instance of it.
 *
 * The module must NOT stand down on a live page the way an empty CRM dropdown
 * does — the standard fields under the note are a real, working form. Only the
 * sentence goes.
 */

async function renderContactForm(liveSite: boolean, formMode: string) {
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
            modules: [{ id: "m-contact-form", type: "contact-form", column: "main", text: "", settings: { formMode } }]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  await act(async () => { await Promise.resolve(); });
}

const COMING_SOON = "Custom form builder coming soon";

describe("the contact form's Custom-mode note never reaches a visitor", () => {
  it("says nothing about the Builder on a published page", async () => {
    await renderContactForm(true, "custom");
    expect(text()).not.toContain(COMING_SOON);
    expect(text()).not.toContain("Standard fields are shown for now");
  });

  it("still renders the working form underneath it", async () => {
    // The note is the only thing that goes. These fields collect real leads.
    await renderContactForm(true, "custom");
    expect(text()).toContain("First name");
    expect(text()).toContain("Email");
    expect(container?.querySelector("form.builder-contact-form")).not.toBeNull();
    expect(container?.querySelector("button.builder-contact-form-submit")).not.toBeNull();
  });

  it("still shows the note on the Builder canvas", async () => {
    // The other half: deleting the sentence would pass the test above and
    // leave whoever picked "Custom" with no explanation of what they got.
    await renderContactForm(false, "custom");
    expect(text()).toContain(COMING_SOON);
  });
});

describe("a form with nothing left to fill in is not a form", () => {
  /*
   * Ticket 86bbvqcbk, finding 3, from the round-5 review of 86bbugd2e.
   *
   * The filter above leaves an option-less dropdown out of a published form.
   * If EVERY field on the form is one, `visibleFields` is empty and the form
   * used to render anyway: a heading and a Submit button over nothing, and a
   * click posted, wrote an empty contact row and thanked the visitor for it.
   *
   * Unreachable in production when it was found — 2 crm_forms rows, 0 with a
   * select field — and `saveForm` refuses a form with no fields at all, so it
   * takes this specific shape to reach. Guarded rather than argued about.
   */
  const ALL_EMPTY_DROPDOWNS = [
    { key: "how_heard", label: EMPTY_DROPDOWN_LABEL, type: "select", required: true, options: [] },
    { key: "interest", label: "What are you after?", type: "select", required: false, options: [] }
  ];

  it("renders nothing at all to a visitor — no heading, no Submit", async () => {
    await renderCrmForm(true, ALL_EMPTY_DROPDOWNS);
    expect(text()).not.toContain(FORM_HEADING);
    expect(container?.querySelector("form.builder-contact-form")).toBeNull();
    expect(container?.querySelector("button.builder-contact-form-submit")).toBeNull();
  });

  it("still draws the whole form on the Builder canvas", async () => {
    // The other half. The canvas is the only place this is fixable, so hiding
    // it there too would leave the operator with a form that silently is not
    // on their page.
    await renderCrmForm(false, ALL_EMPTY_DROPDOWNS);
    expect(text()).toContain(FORM_HEADING);
    expect(container?.querySelector("button.builder-contact-form-submit")).not.toBeNull();
  });

  it("leaves a form with one usable field alone", async () => {
    // The guard is "nothing left", not "something was dropped".
    await renderCrmForm(true);
    expect(text()).toContain(FORM_HEADING);
    expect(text()).toContain("Email");
  });
});
