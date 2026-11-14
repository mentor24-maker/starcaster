// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Assets › Context, slice 1 (SC-808), driven through the real component
 * against a fake App.api that keeps entries per project:
 *
 *  - an empty project says so in a sentence (landmine 17), never a blank table;
 *  - New entry → title + rich text → Save adds a row, and the HTML sent is the
 *    HTML the editor produced (formatting intact);
 *  - Edit loads the stored HTML back into the editor; Delete asks first;
 *  - a project switch shows the other project's entries, not the old ones;
 *  - a server refusal (the table not yet created) is shown, not an empty list.
 *
 * The rich-text editor is replaced by a textarea: it is the Builder's own,
 * tested in builder-rich-text-editor.test.tsx; what this file tests is that
 * the page hands it the stored HTML and saves what it gives back.
 */
vi.mock("../builder-rich-text-editor", () => ({
  BuilderRichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="rich-text" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import ContextManager, { EMPTY_TEXT, PROJECT_SWITCH_EVENT, type ContextEntry } from "./context-manager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RICH = "<h2>Brand voice</h2><ul><li><strong>Warm</strong></li><li>Plain</li></ul>";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let activeProject = "proj_a";
let byProject: Record<string, ContextEntry[]> = {};
let sent: { method: string; path: string; body: any }[] = [];
let refuseRead = "";
let nextId = 1;
let holdWrite: Promise<void> | null = null;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<ContextManager />); });
  await flush();
}

function button(text: string): HTMLButtonElement {
  const found = [...(container?.querySelectorAll("button") || [])].find((b) => b.textContent === text);
  if (!found) throw new Error(`no "${text}" button`);
  return found as HTMLButtonElement;
}

async function click(el: Element) {
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
}

function change(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function submit() {
  const form = container!.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}

function rows() {
  return [...container!.querySelectorAll("tbody tr")].map((tr) => tr.querySelector(".context-manager-title")?.textContent);
}

beforeEach(() => {
  activeProject = "proj_a";
  byProject = {};
  sent = [];
  refuseRead = "";
  nextId = 1;
  holdWrite = null;
  (window as unknown as { App: unknown }).App = {
    api: async (path: string, options: RequestInit = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(String(options.body)) : null;
      sent.push({ method, path, body });
      const list = (byProject[activeProject] ||= []);
      if (method === "GET") {
        if (refuseRead) return { ok: false, error: { message: refuseRead } };
        return { ok: true, data: { entries: [...list], total: list.length } };
      }
      if (method !== "GET" && holdWrite) await holdWrite;
      if (method === "POST") {
        if (!String(body.title || "").trim()) return { ok: false, error: { message: "An entry needs a title." } };
        const entry: ContextEntry = {
          id: `00000000-0000-0000-0000-00000000000${nextId++}`,
          title: body.title, kind: "note", bodyHtml: body.bodyHtml, updatedAt: "2026-11-14T20:00:00Z",
        };
        list.unshift(entry);
        return { ok: true, data: { entry } };
      }
      const id = decodeURIComponent(path.split("/").pop() || "");
      const at = list.findIndex((e) => e.id === id);
      if (at < 0) return { ok: false, error: { message: "That context entry is not in this project." } };
      if (method === "PATCH") {
        list[at] = { ...list[at], ...body };
        return { ok: true, data: { entry: list[at] } };
      }
      const [removed] = list.splice(at, 1);
      return { ok: true, data: { entry: removed } };
    },
  };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("Assets › Context", () => {
  it("says the project has no entries, in a sentence, instead of a blank table", async () => {
    await mount();
    expect(container!.textContent).toContain(EMPTY_TEXT);
    expect(container!.querySelector("table")).toBeNull();
  });

  it("saves a new entry with its formatting, and the row appears", async () => {
    await mount();
    await click(button("New entry"));
    change(container!.querySelector("input[name='title']") as HTMLInputElement, "Brand voice");
    change(container!.querySelector("[data-testid='rich-text']") as HTMLTextAreaElement, RICH);
    await submit();

    const post = sent.find((s) => s.method === "POST")!;
    expect(post.path).toBe("/api/context");
    expect(post.body).toEqual({ title: "Brand voice", bodyHtml: RICH });
    expect(rows()).toEqual(["Brand voice"]);
    expect(container!.querySelector("form")).toBeNull();
  });

  it("Edit loads the stored HTML into the editor and saves the change with PATCH", async () => {
    byProject.proj_a = [{ id: "00000000-0000-0000-0000-0000000000aa", title: "Pricing", kind: "note", bodyHtml: RICH, updatedAt: "2026-11-14T20:00:00Z" }];
    await mount();
    await click(button("Edit"));
    const editor = container!.querySelector("[data-testid='rich-text']") as HTMLTextAreaElement;
    expect(editor.value).toBe(RICH);
    change(container!.querySelector("input[name='title']") as HTMLInputElement, "Pricing 2026");
    await submit();
    const patch = sent.find((s) => s.method === "PATCH")!;
    expect(patch.path).toBe("/api/context/00000000-0000-0000-0000-0000000000aa");
    expect(patch.body).toEqual({ title: "Pricing 2026", bodyHtml: RICH });
    expect(rows()).toEqual(["Pricing 2026"]);
  });

  it("Delete asks first; Keep leaves it, Yes removes it and the empty sentence returns", async () => {
    byProject.proj_a = [{ id: "00000000-0000-0000-0000-0000000000bb", title: "Old note", kind: "note", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z" }];
    await mount();
    await click(button("Delete"));
    expect(sent.some((s) => s.method === "DELETE")).toBe(false);
    await click(button("Keep"));
    expect(rows()).toEqual(["Old note"]);
    await click(button("Delete"));
    await click(button("Yes, delete"));
    expect(sent.filter((s) => s.method === "DELETE")).toHaveLength(1);
    expect(container!.textContent).toContain(EMPTY_TEXT);
  });

  it("a title is required before anything is sent", async () => {
    await mount();
    await click(button("New entry"));
    await submit();
    expect(sent.some((s) => s.method === "POST")).toBe(false);
    expect(container!.textContent).toContain("An entry needs a title.");
  });

  it("a project switch shows the new project's entries, not the old ones", async () => {
    byProject.proj_a = [{ id: "00000000-0000-0000-0000-0000000000cc", title: "A only", kind: "note", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z" }];
    byProject.proj_b = [{ id: "00000000-0000-0000-0000-0000000000dd", title: "B only", kind: "note", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z" }];
    await mount();
    expect(rows()).toEqual(["A only"]);
    activeProject = "proj_b";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    expect(rows()).toEqual(["B only"]);
  });

  it("a save still in flight when the project switches does not report or reload under the new project", async () => {
    byProject.proj_b = [{ id: "00000000-0000-0000-0000-0000000000ee", title: "B only", kind: "note", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z" }];
    await mount();
    await click(button("New entry"));
    change(container!.querySelector("input[name='title']") as HTMLInputElement, "Written in A");
    let release: () => void = () => {};
    holdWrite = new Promise<void>((resolve) => { release = resolve; });
    const form = container!.querySelector("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    activeProject = "proj_b";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    const readsAfterSwitch = sent.filter((s) => s.method === "GET").length;
    // The write lands in the project it was sent from.
    activeProject = "proj_a";
    await act(async () => { release(); });
    await flush();
    activeProject = "proj_b";
    expect(container!.textContent).not.toContain('Saved "Written in A"');
    expect(sent.filter((s) => s.method === "GET").length).toBe(readsAfterSwitch);
    expect(rows()).toEqual(["B only"]);
  });

  it("a delete still in flight when the project switches does not report under the new project", async () => {
    byProject.proj_a = [{ id: "00000000-0000-0000-0000-0000000000ff", title: "A note", kind: "note", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z" }];
    await mount();
    let release: () => void = () => {};
    holdWrite = new Promise<void>((resolve) => { release = resolve; });
    await click(button("Delete"));
    act(() => { button("Yes, delete").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    activeProject = "proj_b";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    activeProject = "proj_a";
    await act(async () => { release(); });
    await flush();
    expect(container!.textContent).not.toContain('Deleted "A note"');
  });

  it("a refused read is shown as the reason, never as an empty project", async () => {
    refuseRead = "The context entries table is not in this database yet, so nothing can be read or saved. It is created by docs/SQL/context_entries_setup.sql.";
    await mount();
    expect(container!.textContent).toContain("context_entries_setup.sql");
    expect(container!.textContent).not.toContain(EMPTY_TEXT);
  });
});
