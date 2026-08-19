// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderPageHistory, type BuilderPageRevision } from "./builder-page-history";

/**
 * Sync 4/7: undoing a whole shared-section push as one action.
 *
 * The backend (propagation_run_id, POST /api/builder/propagation-runs/:id/undo)
 * shipped in #254/#267. What was missing was a durable place to TRIGGER that
 * undo — the only existing entry point was a save-time banner that vanishes
 * once dismissed or the page reloads. This tests the durable one: a
 * `propagate` row in Page History offers "Undo this update" alongside the
 * ordinary per-page "Restore", any time, in any later session.
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
  vi.restoreAllMocks();
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function buttonLabelled(match: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(match)
  );
  if (!found) throw new Error(`No button containing "${match}"`);
  return found as HTMLButtonElement;
}

function findButtonLabelled(match: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(match)
  ) as HTMLButtonElement | undefined;
}

function expandPanel() {
  const toggle = document.querySelector('button[aria-label="Expand Page History"]') as HTMLButtonElement | null;
  if (!toggle) throw new Error("Expand Page History toggle not found");
  toggle.click();
}

async function flush() {
  // Several microtask + one macrotask turn: fetch() resolve -> .json() resolve
  // -> setState -> render is more than one microtask hop.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

const NOW = new Date().toISOString();

const SAVE_ROW: BuilderPageRevision = {
  id: "rev-1",
  pageId: "page-1",
  name: "Home",
  sectionCount: 3,
  moduleCount: 9,
  layoutBytes: 100,
  reason: "save",
  createdAt: NOW,
};

const PROPAGATE_ROW: BuilderPageRevision = {
  id: "rev-2",
  pageId: "page-1",
  name: "Home",
  sectionCount: 3,
  moduleCount: 9,
  layoutBytes: 100,
  reason: "propagate",
  propagationRunId: "run-abc",
  createdAt: NOW,
};

async function openWith(revisions: BuilderPageRevision[], onRestored: () => void = () => {}) {
  mockFetch.mockImplementation(async () => jsonResponse({ revisions }));
  render(<BuilderPageHistory pageId="page-1" pageName="Home" onRestored={onRestored} />);
  act(() => {
    expandPanel();
  });
  await flush();
}

describe("BuilderPageHistory — propagation-run undo", () => {
  it("an ordinary save row offers Restore only", async () => {
    await openWith([SAVE_ROW]);
    expect(buttonLabelled("Restore")).toBeTruthy();
    expect(findButtonLabelled("Undo this update")).toBeUndefined();
  });

  it("a propagate row with a run id offers both Restore and Undo this update", async () => {
    await openWith([PROPAGATE_ROW]);
    expect(buttonLabelled("Restore")).toBeTruthy();
    expect(buttonLabelled("Undo this update")).toBeTruthy();
  });

  it("a propagate row with no run id (recorded before the migration) offers Restore only", async () => {
    await openWith([{ ...PROPAGATE_ROW, propagationRunId: undefined }]);
    expect(buttonLabelled("Restore")).toBeTruthy();
    expect(findButtonLabelled("Undo this update")).toBeUndefined();
  });

  it("declining the confirm dialog issues no request", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await openWith([PROPAGATE_ROW]);
    mockFetch.mockClear();

    act(() => {
      buttonLabelled("Undo this update").click();
    });
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("confirming posts to THIS run's undo endpoint and reports how many pages came back", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRestored = vi.fn();
    let undoUrl = "";
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/undo")) {
        undoUrl = String(url);
        return jsonResponse({ restored: [{ name: "Home" }, { name: "About" }], failed: [] });
      }
      return jsonResponse({ revisions: [PROPAGATE_ROW] });
    });
    render(<BuilderPageHistory pageId="page-1" pageName="Home" onRestored={onRestored} />);
    act(() => expandPanel());
    await flush();

    act(() => buttonLabelled("Undo this update").click());
    await flush();

    expect(undoUrl).toBe("/api/admin/propagation-runs/run-abc/undo");
    expect(document.body.textContent).toContain("2 pages are back to how they were");
    expect(onRestored).toHaveBeenCalled();
  });

  it("a partial undo names the pages it could not restore, not just a failure count", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/undo")) {
        return jsonResponse({ restored: [{ name: "Home" }], failed: [{ name: "About" }] });
      }
      return jsonResponse({ revisions: [PROPAGATE_ROW] });
    });
    render(<BuilderPageHistory pageId="page-1" pageName="Home" onRestored={() => {}} />);
    act(() => expandPanel());
    await flush();

    act(() => buttonLabelled("Undo this update").click());
    await flush();

    const text = document.body.textContent ?? "";
    expect(text).toContain("About");
    expect(text).toContain("could not be restored");
  });

  it("a failed request surfaces its message rather than silently doing nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/undo")) {
        return jsonResponse({ error: "That update has no restore points left to undo." }, false);
      }
      return jsonResponse({ revisions: [PROPAGATE_ROW] });
    });
    render(<BuilderPageHistory pageId="page-1" pageName="Home" onRestored={() => {}} />);
    act(() => expandPanel());
    await flush();

    act(() => buttonLabelled("Undo this update").click());
    await flush();

    expect(document.body.textContent).toContain("no restore points left to undo");
  });
});
