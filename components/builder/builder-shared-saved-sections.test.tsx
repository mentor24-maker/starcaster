// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderSharedSavedSections, SHARED_SECTIONS_EMPTY_TEXT } from "./builder-shared-saved-sections";

/**
 * Task 86bcu6tzk: sections another project shares with this one are listed
 * "from <project>", can be imported, and cannot be edited. An empty group says
 * WHY it is empty (CLAUDE.md landmine 17), and a refused import says so in
 * words and reloads the list rather than leaving a stale button up.
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

const SHARED = {
  id: "sec-a",
  name: "Header",
  isPrivate: false,
  createdAt: "",
  updatedAt: "",
  section: { id: "s1", title: "Header", layout: "1-col", modules: [{ id: "m1" }, { id: "m2" }] },
  sourceProjectId: "proj-a",
  sourceProjectName: "Alpha",
};

describe("BuilderSharedSavedSections", () => {
  it("lists shared sections with where they came from, and offers Import but no edit", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }));
    render(<BuilderSharedSavedSections initiallyCollapsed={false} />);
    await flush();

    expect(mockFetch.mock.calls[0][0]).toBe("/api/admin/shared/saved_sections");
    const text = container!.textContent ?? "";
    expect(text).toContain("Shared with this project");
    expect(text).toContain("Header");
    expect(text).toContain("from Alpha");
    expect(button("Import")).toBeTruthy();
    expect(container!.querySelector('[aria-label="Edit saved section"]')).toBeNull();
  });

  it("does not ask the server until the group is opened", async () => {
    render(<BuilderSharedSavedSections />);
    await flush();
    expect(mockFetch).not.toHaveBeenCalled();
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [], items: [] }));
    act(() => button("Shared with this project").click());
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("an empty list says why it is empty", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [], items: [] }));
    render(<BuilderSharedSavedSections initiallyCollapsed={false} />);
    await flush();
    expect(container!.textContent).toContain(SHARED_SECTIONS_EMPTY_TEXT);
  });

  it("Import posts to the import route and hands the new copy to the project's list", async () => {
    const onImported = vi.fn();
    const copy = { ...SHARED, id: "saved_section_new", name: "Header (2)" };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: copy, savedSection: copy }, true, 201));
    render(<BuilderSharedSavedSections initiallyCollapsed={false} onImported={onImported} />);
    await flush();

    act(() => button("Import").click());
    await flush();

    expect(mockFetch.mock.calls[1][0]).toBe("/api/admin/shared/saved_sections/sec-a/import");
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(onImported).toHaveBeenCalledWith(copy);
    expect(container!.textContent).toContain('Imported "Header (2)" from Alpha');
  });

  it("a refused import shows the server's sentence, adds nothing, and reloads the list", async () => {
    const onImported = vi.fn();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: { message: "That section is no longer shared with this project, so it cannot be imported." } }, false, 404))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [], items: [] }));
    render(<BuilderSharedSavedSections initiallyCollapsed={false} onImported={onImported} />);
    await flush();

    act(() => button("Import").click());
    await flush();
    await flush();

    expect(onImported).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("no longer shared with this project");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(container!.textContent).toContain(SHARED_SECTIONS_EMPTY_TEXT);
  });
});
