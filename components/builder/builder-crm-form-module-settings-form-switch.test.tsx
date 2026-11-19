// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderCrmFormModuleSettings } from "./builder-crm-form-module-settings";

/**
 * SC-860, review round 2. The Form Appearance panel waits 500ms before saving,
 * so several quick changes go out as one. If the module was switched to
 * another form inside that wait, the old form's leftover changes went out
 * under the NEW form's id the moment the new form was edited, and a reply
 * still in flight for the old form painted the old form's questions over the
 * new one. Now a switch sends the waiting save to the form it was made on at
 * once, and a reply for a form the panel no longer shows changes nothing.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FORMS: Record<string, { id: string; name: string; styles: Record<string, string>; fields: unknown[] }> = {
  crmf_a: {
    id: "crmf_a", name: "Form A", styles: { labelPosition: "above", padding: "18px" },
    fields: [{ key: "city", label: "City", type: "text" }]
  },
  crmf_b: {
    id: "crmf_b", name: "Form B", styles: { labelPosition: "above", padding: "18px" },
    fields: [{ key: "email", label: "Email", type: "email" }]
  }
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let puts: Array<{ id: string; body: Record<string, unknown> }> = [];
/** When set, PUT replies wait until the test releases them. */
let holdPuts: Array<() => void> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  puts = [];
  holdPuts = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const match = String(url).match(/\/api\/crm\/forms\/([^/?]+)$/);
      if (match && init?.method === "PUT") {
        const id = decodeURIComponent(match[1]);
        const body = JSON.parse(String(init.body));
        puts.push({ id, body });
        const form = FORMS[id];
        const reply = () => new Response(JSON.stringify({
          ok: true,
          form: { ...form, styles: { ...form.styles, ...(body.stylesPatch || {}) } }
        }), { status: 200 });
        if (holdPuts) {
          const held = holdPuts;
          return new Promise<Response>((resolve) => held.push(() => resolve(reply())));
        }
        return reply();
      }
      if (match) return new Response(JSON.stringify({ ok: true, form: FORMS[decodeURIComponent(match[1])] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, forms: Object.values(FORMS).map(({ id, name }) => ({ id, name })) }), { status: 200 });
    })
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function showForm(crmFormId: string) {
  const module = { id: "m1", type: "crm-form", settings: { crmFormId } } as unknown as BuilderTemplateModule;
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(
      <BuilderCrmFormModuleSettings module={module} onUpdateModule={() => {}} onUpdateModuleBackground={() => {}} />
    );
  });
  await flush();
}

function selectUnder(label: string): HTMLSelectElement {
  const field = [...container!.querySelectorAll(".builder-module-field")].find((node) =>
    node.textContent?.trim().startsWith(label)
  );
  const select = field?.querySelector("select");
  if (!select) throw new Error(`no select under "${label}"`);
  return select as HTMLSelectElement;
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const questionLabels = () =>
  [...container!.querySelectorAll("select[aria-label^='Width of ']")].map((s) => s.getAttribute("aria-label"));

describe("Builder CRM Form panel, switched to another form mid-save (SC-860)", () => {
  it("sends the old form's waiting change to the old form, and none of it to the new one", async () => {
    await showForm("crmf_a");
    await choose(selectUnder("City"), "half");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await showForm("crmf_b");
    await choose(selectUnder("Padding"), "15");
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await flush();

    expect(puts.map((p) => p.id)).toEqual(["crmf_a", "crmf_b"]);
    expect(puts[0].body.fieldLayoutPatch).toEqual({ city: "half" });
    expect(puts[1].body.fieldLayoutPatch).toBeUndefined();
    expect(puts[1].body.stylesPatch).toEqual({ padding: "15px" });
  });

  it("a reply for the old form, arriving after the switch, does not paint its questions over the new form", async () => {
    await showForm("crmf_a");
    holdPuts = [];
    await choose(selectUnder("Padding"), "15");
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await flush();
    expect(puts.map((p) => p.id)).toEqual(["crmf_a"]);

    await showForm("crmf_b");
    expect(questionLabels()).toEqual(["Width of Email"]);

    const release = holdPuts;
    holdPuts = null;
    await act(async () => {
      release.forEach((go) => go());
    });
    await flush();
    expect(questionLabels()).toEqual(["Width of Email"]);
  });
});
