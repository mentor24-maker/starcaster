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

// The real upload talks to Vercel Blob from a CDN-loaded SDK; what this file
// tests is what the page asks it to do, and what the page does with the answer.
const uploadToBlob = vi.fn(async (file: File, options: { pathname?: string }) => `https://store1.public.blob.vercel-storage.com/${options.pathname}-x1y2`);
vi.mock("../../lib/builder-client/media-blob-upload", () => ({
  uploadToBlob: (file: File, options: { pathname?: string }) => uploadToBlob(file, options),
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
let refuseFileRecord = "";
let fileDeleteResult: { removed: boolean; error?: string } | null = null;

const MB = 1024 * 1024;
function fakeFile(name: string, size: number, type = ""): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

async function pick(...files: File[]) {
  const input = container!.querySelector("[data-testid='context-file-input']") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}

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
  refuseFileRecord = "";
  fileDeleteResult = null;
  uploadToBlob.mockClear();
  (window as unknown as { App: unknown }).App = {
    projectContext: { getSessionProjectId: () => activeProject },
    getSessionToken: () => "tok_123",
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
      if (method === "POST" && body.kind === "file") {
        if (refuseFileRecord) return { ok: false, error: { message: refuseFileRecord } };
        const entry: ContextEntry = {
          id: `00000000-0000-0000-0000-00000000000${nextId++}`,
          title: body.title || body.file.name, kind: "file", bodyHtml: "", updatedAt: "2026-11-15T20:00:00Z",
          fileUrl: body.file.url, fileName: body.file.name, fileSize: body.file.size, fileType: "application/pdf",
        };
        list.unshift(entry);
        return { ok: true, data: { entry } };
      }
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
      return { ok: true, data: { entry: removed, file: removed.kind === "file" ? (fileDeleteResult || { removed: true }) : null } };
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

  describe("files (SC-809)", () => {
    it("a 20MB PDF uploads to this project's folder and appears as a PDF of 20 MB with a working link", async () => {
      await mount();
      await pick(fakeFile("Price list.pdf", 20 * MB, "application/pdf"));

      expect(uploadToBlob).toHaveBeenCalledTimes(1);
      const [, options] = uploadToBlob.mock.calls[0] as unknown as [File, Record<string, any>];
      expect(options.pathname).toMatch(/^APP\/Assets\/Context\/proj_a\/\d+_Price_list\.pdf$/);
      expect(options.handleUploadUrl).toBe("/api/context/blob-upload");
      expect(options.contentType).toBe("application/pdf");
      expect(options.headers).toEqual({ "X-Project-ID": "proj_a", Authorization: "Bearer tok_123" });

      const post = sent.find((s) => s.method === "POST")!;
      expect(post.body.kind).toBe("file");
      expect(post.body.file).toMatchObject({ name: "Price list.pdf", size: 20 * MB });

      const row = container!.querySelector("tbody tr")!;
      const cells = [...row.querySelectorAll("td")].map((td) => td.textContent);
      expect(cells.slice(0, 3)).toEqual(["Price list.pdf", "PDF", "20 MB"]);
      const link = row.querySelector("a")!;
      expect(link.getAttribute("href")).toBe(post.body.file.url);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(container!.textContent).toContain('Uploaded "Price list.pdf".');
    });

    it("an .exe is refused before any upload, naming the type", async () => {
      await mount();
      await pick(fakeFile("setup.exe", 1000, "application/x-msdownload"));
      expect(uploadToBlob).not.toHaveBeenCalled();
      expect(sent.some((s) => s.method === "POST")).toBe(false);
      expect(container!.querySelector("[role='alert']")!.textContent).toBe("This file type is not accepted: .exe");
    });

    it("a file over 50MB is refused before any upload, naming the size", async () => {
      await mount();
      await pick(fakeFile("huge.pdf", 62 * MB));
      expect(uploadToBlob).not.toHaveBeenCalled();
      expect(container!.textContent).toContain("This file is 62 MB, and the limit is 50 MB.");
    });

    it("dropping files on the page uploads them, and one bad file does not stop the good one", async () => {
      await mount();
      const host = container!.querySelector(".context-manager")!;
      const drop = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      drop.dataTransfer = { files: [fakeFile("notes.md", 2048), fakeFile("archive.zip", 2048)], types: ["Files"] };
      await act(async () => { host.dispatchEvent(drop); });
      await flush();
      expect(uploadToBlob).toHaveBeenCalledTimes(1);
      expect(rows()).toEqual(["notes.md"]);
      expect(container!.textContent).toContain("archive.zip: This file type is not accepted: .zip");
    });

    it("a refused upload token shows the server's reason, not the storage library's generic sentence", async () => {
      uploadToBlob.mockRejectedValueOnce(new Error("Vercel Blob: Failed to retrieve the client token"));
      const realApi = (window as any).App.api;
      (window as any).App.api = async (path: string, options: RequestInit = {}) => {
        if (path === "/api/context/blob-upload") {
          sent.push({ method: "POST", path, body: JSON.parse(String(options.body)) });
          // The real App.api throws a refusal, carrying the server's message and status.
          throw Object.assign(new Error("File storage (Vercel Blob) is not set up on this server, so files cannot be uploaded here."), { status: 503 });
        }
        return realApi(path, options);
      };
      await mount();
      await pick(fakeFile("r.pdf", 100));
      const ask = sent.find((s) => s.path === "/api/context/blob-upload")!;
      const [, options] = uploadToBlob.mock.calls[0] as unknown as [File, Record<string, any>];
      expect(ask.body.payload.pathname).toBe(options.pathname);
      expect(container!.querySelector("[role='alert']")!.textContent).toBe(
        "r.pdf was not uploaded: File storage (Vercel Blob) is not set up on this server, so files cannot be uploaded here.",
      );
    });

    it("an upload that stored the file but could not record it says where the file is", async () => {
      refuseFileRecord = "The context entries table is not in this database yet.";
      await mount();
      await pick(fakeFile("a.csv", 100));
      const alert = container!.querySelector("[role='alert']")!.textContent || "";
      expect(alert).toContain("a.csv was uploaded but could not be added to the list");
      expect(alert).toContain("https://store1.public.blob.vercel-storage.com/APP/Assets/Context/proj_a/");
    });

    it("deleting a file whose stored copy could not be removed says it was left behind", async () => {
      byProject.proj_a = [{
        id: "00000000-0000-0000-0000-000000000a01", title: "Deck", kind: "file", bodyHtml: "", updatedAt: "2026-11-15T20:00:00Z",
        fileUrl: "https://store1.public.blob.vercel-storage.com/APP/Assets/Context/proj_a/1_deck.pdf", fileName: "deck.pdf", fileSize: 3 * MB,
      }];
      fileDeleteResult = { removed: false, error: "Vercel Blob delete failed: 503. It is still stored at https://store1.public.blob.vercel-storage.com/APP/Assets/Context/proj_a/1_deck.pdf" };
      await mount();
      await click(button("Delete"));
      await click(button("Yes, delete"));
      expect(container!.textContent).toContain('Deleted "Deck" from the list, but its stored file was left behind: Vercel Blob delete failed: 503');
      expect(container!.textContent).toContain(EMPTY_TEXT);
    });

    it("deleting a file that was removed cleanly just says deleted", async () => {
      byProject.proj_a = [{
        id: "00000000-0000-0000-0000-000000000a02", title: "Deck", kind: "file", bodyHtml: "", updatedAt: "2026-11-15T20:00:00Z",
        fileUrl: "https://store1.public.blob.vercel-storage.com/APP/Assets/Context/proj_a/1_deck.pdf", fileName: "deck.pdf", fileSize: 3 * MB,
      }];
      await mount();
      await click(button("Delete"));
      await click(button("Yes, delete"));
      expect(container!.textContent).toContain('Deleted "Deck".');
      expect(container!.textContent).not.toContain("left behind");
    });

    it("a file is uploaded into the folder of the project active at the time, so another project never sees it", async () => {
      await mount();
      activeProject = "proj_b";
      await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
      await flush();
      await pick(fakeFile("b.png", 5000));
      const [, options] = uploadToBlob.mock.calls[0] as unknown as [File, Record<string, any>];
      expect(options.pathname).toMatch(/^APP\/Assets\/Context\/proj_b\//);
      activeProject = "proj_a";
      await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
      await flush();
      expect(rows()).toEqual([]);
      expect(container!.textContent).toContain(EMPTY_TEXT);
    });
  });

  describe("which tools read an entry (SC-826)", () => {
    function useBox(title: string): HTMLInputElement {
      const tr = [...container!.querySelectorAll("tbody tr")].find((r) => r.querySelector(".context-manager-title")?.textContent === title);
      const box = tr?.querySelector("input[data-use='reel-spinner']") as HTMLInputElement | null;
      if (!box) throw new Error(`no Reel Spinner switch on "${title}"`);
      return box;
    }

    it("switching Reel Spinner on saves usedBy, then shows what the server READ BACK", async () => {
      byProject.proj_a = [{ id: "n1", title: "Channel", kind: "note", bodyHtml: "<p>x</p>", updatedAt: "2026-11-14T20:00:00Z", usedBy: [] }];
      await mount();
      expect(container!.textContent).toContain("Reel Spinner reads this");
      expect(useBox("Channel").checked).toBe(false);
      sent = [];
      await click(useBox("Channel"));
      expect(sent[0]).toEqual({ method: "PATCH", path: "/api/context/n1", body: { usedBy: ["reel-spinner"] } });
      expect(sent[1]?.method).toBe("GET");
      expect(useBox("Channel").checked).toBe(true);

      await click(useBox("Channel"));
      expect(sent[2]).toEqual({ method: "PATCH", path: "/api/context/n1", body: { usedBy: [] } });
      expect(useBox("Channel").checked).toBe(false);
    });

    it("a refused switch shows the reason and stays as the server has it", async () => {
      byProject.proj_a = [{ id: "n1", title: "Channel", kind: "note", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z", usedBy: [] }];
      await mount();
      const realApi = (window as any).App.api;
      (window as any).App.api = async (path: string, options: RequestInit = {}) => (
        String(options.method || "GET").toUpperCase() === "PATCH"
          ? { ok: false, error: { message: "They are added by docs/SQL/context_entries_used_by.sql." } }
          : realApi(path, options)
      );
      await click(useBox("Channel"));
      expect(container!.textContent).toContain("context_entries_used_by.sql");
      expect(useBox("Channel").checked).toBe(false);
    });

    it("a switched-on file Reel Spinner cannot read says so beside the switch; a .md file does not", async () => {
      byProject.proj_a = [
        { id: "f1", title: "Deck", kind: "file", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z", fileName: "deck.pdf", usedBy: ["reel-spinner"] },
        { id: "f2", title: "Notes", kind: "file", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z", fileName: "notes.md", usedBy: ["reel-spinner"] },
        { id: "f3", title: "Off deck", kind: "file", bodyHtml: "", updatedAt: "2026-11-14T20:00:00Z", fileName: "off.pdf", usedBy: [] },
      ];
      await mount();
      const warnings = [...container!.querySelectorAll(".context-manager-use-warning")].map((w) => w.closest("tr")?.querySelector(".context-manager-title")?.textContent);
      expect(warnings).toEqual(["Deck"]);
      expect(container!.textContent).toContain("Reel Spinner cannot read .pdf files");
    });
  });
});
