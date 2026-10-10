// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderCrmFormModuleSettings,
  CRM_FORM_STYLE_SNAPSHOT_KEY,
  CRM_FORM_STYLES_EVENT
} from "./builder-crm-form-module-settings";

/**
 * Ticket 86bcgcnkw, 2026-10-10. Dane set his form's colours in the CRM editor,
 * then changed Padding in the Builder's Form Appearance panel — and every
 * colour on the form went back to its default. The panel loaded the form's
 * styles once, when it opened, and each change PUT the WHOLE object from that
 * copy, so the Padding save carried the old default colours back over the ones
 * he had just saved. Production's row showed it: Padding 15px, every colour
 * default, written at 18:48:15 while he was in the Builder.
 *
 * The panel now sends only the key that changed (`stylesPatch`), and stops
 * copying the form's styles into the page, where the rendered module preferred
 * that copy over the form on the live site.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FORM_ID = "crmf_test";

/** What the panel loads when it opens: a brand-new form, all defaults. */
const STYLES_WHEN_PANEL_OPENED = {
  headingColor: "theme:heading",
  buttonBackgroundColor: "theme:accent",
  backgroundColor: "theme:background",
  borderColor: "theme:primary",
  padding: "18px"
};

/** What the form holds by the time he changes Padding: colours saved in the CRM editor. */
const STYLES_SAVED_IN_CRM_EDITOR = {
  ...STYLES_WHEN_PANEL_OPENED,
  headingColor: "theme:secondary",
  buttonBackgroundColor: "theme:secondary",
  backgroundColor: "#ff3300"
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let puts: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.useFakeTimers();
  puts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        // The server merges the patch onto what it holds NOW.
        const styles = { ...STYLES_SAVED_IN_CRM_EDITOR, ...(body.stylesPatch || {}), ...(body.styles || {}) };
        return new Response(JSON.stringify({ ok: true, form: { id: FORM_ID, styles } }), { status: 200 });
      }
      if (String(url).endsWith(`/api/crm/forms/${FORM_ID}`)) {
        return new Response(JSON.stringify({ ok: true, form: { id: FORM_ID, name: "Contact", styles: STYLES_WHEN_PANEL_OPENED } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, forms: [{ id: FORM_ID, name: "Contact" }] }), { status: 200 });
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

async function mountPanel(settings: Record<string, string>) {
  let module = { id: "m1", type: "crm-form", settings } as unknown as BuilderTemplateModule;
  const onUpdateModule = (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => {
    module = updater(module);
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderCrmFormModuleSettings
        module={module}
        onUpdateModule={onUpdateModule}
        onUpdateModuleBackground={() => {}}
      />
    );
  });
  await flush();
  return { current: () => module };
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

describe("Builder CRM Form panel saves only what changed (86bcgcnkw)", () => {
  it("a Padding change does not send the colours it loaded when the panel opened", async () => {
    await mountPanel({ crmFormId: FORM_ID });
    await choose(selectUnder("Padding"), "15");
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await flush();

    expect(puts).toHaveLength(1);
    expect(puts[0].styles).toBeUndefined();
    expect(puts[0].stylesPatch).toEqual({ padding: "15px" });
  });

  it("adopts the server's merged styles, so the panel shows colours saved elsewhere", async () => {
    const seen: Array<Record<string, string>> = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail.styles);
    window.addEventListener(CRM_FORM_STYLES_EVENT, listener);
    try {
      await mountPanel({ crmFormId: FORM_ID });
      await choose(selectUnder("Padding"), "15");
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      await flush();
    } finally {
      window.removeEventListener(CRM_FORM_STYLES_EVENT, listener);
    }
    const last = seen[seen.length - 1];
    expect(last.padding).toBe("15px");
    expect(last.headingColor).toBe("theme:secondary");
    expect(last.backgroundColor).toBe("#ff3300");
  });

  it("removes a leftover style copy from the page instead of writing a new one", async () => {
    const panel = await mountPanel({
      crmFormId: FORM_ID,
      [CRM_FORM_STYLE_SNAPSHOT_KEY]: JSON.stringify(STYLES_WHEN_PANEL_OPENED)
    });
    expect(CRM_FORM_STYLE_SNAPSHOT_KEY in panel.current().settings).toBe(false);
  });
});
