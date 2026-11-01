// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BuilderSharedPagesButton,
  BuilderSharedPagesIsland,
  SHARED_PAGES_BUTTON_LABEL,
  groupSharedPages,
  importedPageText,
  type SharedPageRecord
} from "./builder-shared-pages";

/**
 * Task 86bcw3m94: the Pages screen's "Shared by Project" button. Dane's rule
 * is the first thing tested — no shared pages, no button — and then that the
 * list is grouped by the project sharing them and Import says what it made.
 */

const mockFetch = vi.fn();
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: (...args: unknown[]) => mockFetch(...args),
}));

beforeAll(() => {
  // jsdom does not implement the modal half of <dialog>.
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

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

function findButton(match: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(match)) as HTMLButtonElement | undefined;
}

const page = (id: string, name: string, source: [string, string], extra: Partial<SharedPageRecord> = {}): SharedPageRecord => ({
  id, name, slug: name.toLowerCase(), isPublished: true, sourceProjectId: source[0], sourceProjectName: source[1], ...extra,
});
const ALPHA: [string, string] = ["proj-a", "Alpha"];
const BRAVO: [string, string] = ["proj-b", "Bravo"];

describe("BuilderSharedPagesButton", () => {
  it("renders NOTHING when no page is shared with this project", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [] }));
    render(<BuilderSharedPagesButton />);
    await flush();
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/shared/pages", expect.anything());
    expect(findButton(SHARED_PAGES_BUTTON_LABEL)).toBeUndefined();
    expect(container!.innerHTML).toBe("");
  });

  it("renders nothing while loading, nor when the read fails", async () => {
    let resolve: (v: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<BuilderSharedPagesButton />);
    expect(container!.innerHTML).toBe("");
    resolve(jsonResponse({ error: { message: "boom" } }, false, 500));
    await flush();
    expect(container!.innerHTML).toBe("");
  });

  it("shows the button once one page is shared, and lists it grouped by project", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [page("p1", "About", ALPHA), page("p2", "FAQ", BRAVO), page("p3", "Team", ALPHA, { isPublished: false })] }));
    render(<BuilderSharedPagesButton />);
    await flush();
    const open = findButton(SHARED_PAGES_BUTTON_LABEL);
    expect(open?.textContent).toBe("Shared by Project");
    act(() => open!.click());
    const headings = Array.from(document.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headings).toEqual(["From Alpha", "From Bravo"]);
    expect(document.body.textContent).toContain("/about");
    expect(document.body.textContent).toContain("Draft");
  });

  it("Import posts to that page and says what it made, including the frame left behind", async () => {
    const onImported = vi.fn();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ items: [page("p1", "About", ALPHA)] }))
      .mockResolvedValueOnce(jsonResponse({ data: { page: { id: "new-1", name: "About", slug: "about-2" }, frameLeftOut: 2 } }, true, 201));
    render(<BuilderSharedPagesButton onImported={onImported} />);
    await flush();
    act(() => findButton(SHARED_PAGES_BUTTON_LABEL)!.click());
    act(() => findButton("Import")!.click());
    await flush();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/admin/shared/pages/p1/import", { method: "POST" });
    expect(onImported).toHaveBeenCalledTimes(1);
    const status = document.querySelector('[role="status"]')?.textContent ?? "";
    expect(status).toContain('Imported "About" from Alpha at /about-2, as an unpublished draft.');
    expect(status).toContain("header, menu and footer sections (2) were left behind");
  });

  it("a refused import shows the server's sentence and re-reads the list", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ items: [page("p1", "About", ALPHA)] }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "That page is no longer shared with this project" } }, false, 404))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    render(<BuilderSharedPagesButton />);
    await flush();
    act(() => findButton(SHARED_PAGES_BUTTON_LABEL)!.click());
    act(() => findButton("Import")!.click());
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("no longer shared");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe("helpers", () => {
  it("groups by source project in first-seen order", () => {
    const groups = groupSharedPages([page("1", "A", BRAVO), page("2", "B", ALPHA), page("3", "C", BRAVO)]);
    expect(groups.map((g) => [g.projectName, g.pages.map((p) => p.id)])).toEqual([["Bravo", ["1", "3"]], ["Alpha", ["2"]]]);
  });

  it("an import with no frame says nothing about one", () => {
    const text = importedPageText(page("1", "About", ALPHA), { page: { id: "n", name: "About", slug: "about" }, frameLeftOut: 0 });
    expect(text).toBe('Imported "About" from Alpha at /about, as an unpublished draft.');
  });
});

describe("BuilderSharedPagesIsland (the Pages screen mount)", () => {
  it("re-reads when the active project changes", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [] }));
    render(<BuilderSharedPagesIsland />);
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event("projectContext:session-changed")); });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
