// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultBackgroundSettings,
  normalizeLayoutSections,
  type BuilderTemplateModule
} from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Task 86bchh04f. The Event Manager's edit form renders BELOW the events
 * table, so on a long list the pencil opened it off-screen and read as doing
 * nothing, and Update Event left the admin at the bottom of the page. Edit now
 * moves the page to the form with the cursor in Event Name; a successful save
 * moves it back to the top of the table, where "Event updated." appears.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EVENT = {
  id: "e1",
  title: "Junior Clinic",
  slug: "junior-clinic",
  status: "published",
  startsAt: "2026-11-02T14:00:00.000Z",
  endsAt: "2026-11-02T15:00:00.000Z",
  allDay: false,
  timezone: "America/New_York",
};

function stubApi(putOk: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href.startsWith("/api/events/e1") && init?.method === "PUT") {
      return putOk
        ? { ok: true, status: 200, json: async () => ({ ok: true, data: EVENT }) }
        : { ok: false, status: 400, json: async () => ({ ok: false, error: { message: "Slug already taken." } }) };
    }
    if (href.startsWith("/api/events")) return { ok: true, status: 200, json: async () => ({ events: [EVENT] }) };
    if (href.startsWith("/api/event-categories")) return { ok: true, status: 200, json: async () => ({ categories: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false, media: "", onchange: null,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent: () => false,
      }),
    });
  }
}

/** jsdom has no layout, so scrollIntoView does not exist — record who asked. */
function recordScrolls(): Element[] {
  const scrolled: Element[] = [];
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value(this: Element) { scrolled.push(this); },
  });
  return scrolled;
}

const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

async function renderManager() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const module = { id: "m-events", type: "event-manager", column: "main", text: "", settings: {} } as unknown as BuilderTemplateModule;
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([{ id: "row-1", title: "Row", layout: "single", modules: [module] }])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite
      />
    );
  });
  await settle();
  return container;
}

async function clickEdit(host: HTMLElement) {
  const edit = host.querySelector<HTMLButtonElement>('button[aria-label="Edit"]');
  if (!edit) throw new Error("no Edit button rendered — the fixture event did not load, so nothing here was measured");
  await act(async () => edit.click());
  await settle();
}

async function clickUpdate(host: HTMLElement) {
  const form = host.querySelector<HTMLFormElement>("form.builder-event-manager-form");
  if (!form) throw new Error("the edit form is not open");
  await act(async () => form.requestSubmit());
  await settle();
}

describe("Event Manager — Edit and Update move the page (86bchh04f)", () => {
  it("Edit scrolls to the form and puts the cursor in Event Name", async () => {
    stubApi(true);
    const scrolled = recordScrolls();
    const host = await renderManager();
    await clickEdit(host);

    const form = host.querySelector("form.builder-event-manager-form");
    expect(form).not.toBeNull();
    expect(scrolled.at(-1)).toBe(form);
    expect(document.activeElement).toBe(host.querySelector("#event-title"));
  });

  it("a successful Update scrolls back to the top of the table and focuses its heading", async () => {
    stubApi(true);
    const scrolled = recordScrolls();
    const host = await renderManager();
    await clickEdit(host);
    await clickUpdate(host);

    const heading = host.querySelector(".builder-event-manager-module .builder-admin-data-table-title");
    expect(host.querySelector("form.builder-event-manager-form")).toBeNull();
    expect(scrolled.at(-1)).toBe(heading);
    expect(document.activeElement).toBe(heading);
    expect(host.textContent).toContain("Event updated.");
  });

  it("a refused Update stays on the form with its error", async () => {
    stubApi(false);
    const scrolled = recordScrolls();
    const host = await renderManager();
    await clickEdit(host);
    const before = scrolled.length;
    await clickUpdate(host);

    expect(host.querySelector("form.builder-event-manager-form")).not.toBeNull();
    expect(host.textContent).toContain("Slug already taken.");
    expect(scrolled.length).toBe(before);
  });
});
