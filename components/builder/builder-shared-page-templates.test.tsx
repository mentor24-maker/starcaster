// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderSharedPageTemplates, BuilderSharedPageTemplatesIsland, SHARED_TEMPLATES_EMPTY_TEXT } from "./builder-shared-page-templates";

/**
 * Task 86bcu6ubh: page templates another project shares with this one are
 * listed "from <project>" on the Templates page, email templates left out.
 * Import hands back the template AND the sections it was built from, so both
 * of this project's lists can take them at once. An empty group says WHY it is
 * empty (CLAUDE.md landmine 17).
 */

const mockFetch = vi.fn();
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: (...args: unknown[]) => mockFetch(...args),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  mockFetch.mockReset();
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 404) {
  return { ok, status, json: async () => body };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(match: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(match));
  if (!found) throw new Error(`No button containing "${match}"`);
  return found as HTMLButtonElement;
}

const frame = (id: string) => ({ id: `ref-${id}`, title: id, canonical: true, savedSectionId: id, modules: [] });
const SHARED = {
  id: "41",
  name: "Landing",
  templateKind: "modular",
  emailFunction: "",
  pageBackground: {},
  theme: {},
  layoutSections: [frame("sec-head"), { id: "body", title: "Body", modules: [] }, frame("sec-foot")],
  createdAt: "",
  updatedAt: "",
  sourceProjectId: "proj-a",
  sourceProjectName: "Alpha",
};
const EMAIL = { ...SHARED, id: "42", name: "Welcome email", templateKind: "email", layoutSections: [] };

describe("BuilderSharedPageTemplates", () => {
  it("lists shared page templates with where they came from and how many shared sections they use, and leaves email templates out", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED, EMAIL], items: [SHARED, EMAIL] }));
    render(<BuilderSharedPageTemplates initiallyCollapsed={false} />);
    await flush();

    expect(mockFetch.mock.calls[0][0]).toBe("/api/admin/shared/page_templates");
    const text = container!.textContent ?? "";
    expect(text).toContain("Shared with this project");
    expect(text).toContain("Landing");
    expect(text).toContain("from Alpha");
    expect(text).not.toContain("Welcome email");
    const row = Array.from(container!.querySelectorAll("tbody tr"))[0];
    expect(row.querySelectorAll("td")[2].textContent).toBe("2");
    expect(button("Import")).toBeTruthy();
  });

  it("does not ask the server until the group is opened", async () => {
    render(<BuilderSharedPageTemplates />);
    await flush();
    expect(mockFetch).not.toHaveBeenCalled();
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [], items: [] }));
    act(() => button("Shared with this project").click());
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("an empty list says why it is empty", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [EMAIL], items: [EMAIL] }));
    render(<BuilderSharedPageTemplates initiallyCollapsed={false} />);
    await flush();
    expect(container!.textContent).toContain(SHARED_TEMPLATES_EMPTY_TEXT);
  });

  it("Import posts to the import route and hands back the template and the sections it brought", async () => {
    const onImported = vi.fn();
    const result = {
      template: { ...SHARED, id: "901", name: "Landing (2)" },
      savedSections: [{ id: "saved_section_1", name: "Header (2)" }, { id: "saved_section_2", name: "Footer" }],
      droppedReferences: 0,
    };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: result, ...result }, true, 201));
    render(<BuilderSharedPageTemplates initiallyCollapsed={false} onImported={onImported} />);
    await flush();

    act(() => button("Import").click());
    await flush();

    expect(mockFetch.mock.calls[1][0]).toBe("/api/admin/shared/page_templates/41/import");
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(onImported).toHaveBeenCalledWith(result);
    expect(container!.textContent).toContain('Imported "Landing (2)" from Alpha with the 2 sections it is built from');
  });

  it("a refused import shows the server's sentence, adds nothing, and reloads the list", async () => {
    const onImported = vi.fn();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: { message: "That template is no longer shared with this project, so it cannot be imported." } }, false, 404))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [], items: [] }));
    render(<BuilderSharedPageTemplates initiallyCollapsed={false} onImported={onImported} />);
    await flush();

    act(() => button("Import").click());
    await flush();
    await flush();

    expect(onImported).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("no longer shared with this project");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(container!.textContent).toContain(SHARED_TEMPLATES_EMPTY_TEXT);
  });
});

describe("BuilderSharedPageTemplatesIsland (the Templates page mount)", () => {
  afterEach(() => {
    delete (window as unknown as { App?: unknown }).App;
  });

  it("after an import, asks the Templates page table to reload so the new template shows there", async () => {
    const refresh = vi.fn();
    (window as unknown as { App: unknown }).App = { builder: { refresh } };
    const result = { template: { ...SHARED, id: "901" }, savedSections: [], droppedReferences: 0 };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: result }, true, 201));
    render(<BuilderSharedPageTemplatesIsland />);
    act(() => button("Shared with this project").click());
    await flush();
    act(() => button("Import").click());
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("starts over when the active project changes, so it never shows the previous project's shares", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }));
    render(<BuilderSharedPageTemplatesIsland />);
    act(() => button("Shared with this project").click());
    await flush();
    expect(container!.textContent).toContain("from Alpha");
    act(() => {
      window.dispatchEvent(new CustomEvent("projectContext:session-changed", { detail: { projectId: "proj-c" } }));
    });
    await flush();
    expect(container!.textContent).not.toContain("from Alpha");
    expect(button("Shared with this project").getAttribute("aria-expanded")).toBe("false");
  });
});
