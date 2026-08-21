// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderPageHistory, type BuilderPageRevision } from "./builder-page-history";

/**
 * Sync 4/7: undoing a whole shared-section push as one action.
 *
 * The backend (propagation_run_id, POST /api/builder/propagation-runs/:id/undo)
 * shipped in #254/#267. This is the durable entry point: a `propagate` row in
 * Page History offers "Undo This Update" alongside per-page "Restore", any
 * time, in any later session — which is exactly why it must be honest about
 * scope (the confirm names what still HAS restore points) and about state
 * (an already-undone run must never silently replay old snapshots).
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

type MockOptions = {
  revisions?: BuilderPageRevision[];
  scope?: { pages?: Array<{ pageId: string; name: string }>; undone?: boolean };
  undo?: { restored?: Array<{ name?: string }>; failed?: Array<{ name?: string }>; error?: string; ok?: boolean };
  onUndoUrl?: (url: string) => void;
};

/** Routes the three endpoints the panel now talks to. */
function mockEndpoints({ revisions = [], scope, undo, onUndoUrl }: MockOptions) {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.includes("/undo")) {
      onUndoUrl?.(path);
      const ok = undo?.ok ?? !undo?.error;
      return jsonResponse(
        undo?.error ? { error: undo.error } : { restored: undo?.restored ?? [], failed: undo?.failed ?? [] },
        ok
      );
    }
    if (path.includes("/propagation-runs/")) {
      return jsonResponse({ pages: scope?.pages ?? [{ pageId: "page-1", name: "Home" }], undone: scope?.undone ?? false });
    }
    return jsonResponse({ revisions });
  });
}

async function openWith(options: MockOptions, onRestored: () => void = () => {}) {
  mockEndpoints(options);
  render(<BuilderPageHistory pageId="page-1" pageName="Home" onRestored={onRestored} />);
  act(() => {
    expandPanel();
  });
  await flush();
  await flush();
}

describe("BuilderPageHistory — propagation-run undo", () => {
  it("an ordinary save row offers Restore only", async () => {
    await openWith({ revisions: [SAVE_ROW] });
    expect(buttonLabelled("Restore")).toBeTruthy();
    expect(findButtonLabelled("Undo This Update")).toBeUndefined();
  });

  it("a propagate row with a run id offers both Restore and Undo This Update", async () => {
    await openWith({ revisions: [PROPAGATE_ROW] });
    expect(buttonLabelled("Restore")).toBeTruthy();
    expect(buttonLabelled("Undo This Update")).toBeTruthy();
  });

  it("a propagate row with no run id (recorded before the migration) offers Restore only", async () => {
    await openWith({ revisions: [{ ...PROPAGATE_ROW, propagationRunId: undefined }] });
    expect(buttonLabelled("Restore")).toBeTruthy();
    expect(findButtonLabelled("Undo This Update")).toBeUndefined();
  });

  it("declining the confirm dialog issues no undo request", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const undoCalls: string[] = [];
    await openWith({ revisions: [PROPAGATE_ROW], onUndoUrl: (url) => undoCalls.push(url) });

    act(() => {
      buttonLabelled("Undo This Update").click();
    });
    await flush();

    expect(undoCalls).toEqual([]);
  });

  it("the confirm names the pages that still have restore points, from the server, not from memory", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openWith({
      revisions: [PROPAGATE_ROW],
      scope: { pages: [{ pageId: "1", name: "Home" }, { pageId: "2", name: "About" }] },
    });

    act(() => buttonLabelled("Undo This Update").click());
    await flush();

    const confirmText = String(confirmSpy.mock.calls.at(-1)?.[0] ?? "");
    expect(confirmText).toContain("2 pages still have restore points");
    expect(confirmText).toContain("Home, About");
  });

  it("confirming posts to THIS run's undo endpoint and reports how many pages came back", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRestored = vi.fn();
    let undoUrl = "";
    await openWith(
      {
        revisions: [PROPAGATE_ROW],
        undo: { restored: [{ name: "Home" }, { name: "About" }], failed: [] },
        onUndoUrl: (url) => { undoUrl = url; },
      },
      onRestored
    );

    act(() => buttonLabelled("Undo This Update").click());
    await flush();
    await flush();

    expect(undoUrl).toBe("/api/admin/propagation-runs/run-abc/undo");
    expect(document.body.textContent).toContain("2 pages are back to how they were");
    expect(onRestored).toHaveBeenCalled();
  });

  it("a partial undo names the pages it could not restore, not just a failure count", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await openWith({
      revisions: [PROPAGATE_ROW],
      undo: { restored: [{ name: "Home" }], failed: [{ name: "About" }] },
    });

    act(() => buttonLabelled("Undo This Update").click());
    await flush();
    await flush();

    const text = document.body.textContent ?? "";
    expect(text).toContain("About");
    expect(text).toContain("could not be restored");
  });

  it("a failed request surfaces its message rather than silently doing nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await openWith({
      revisions: [PROPAGATE_ROW],
      undo: { error: "That update has no restore points left to undo." },
    });

    act(() => buttonLabelled("Undo This Update").click());
    await flush();

    expect(document.body.textContent).toContain("no restore points left to undo");
  });

  it("a run the server reports as already undone renders a disabled Undone button, not a live one", async () => {
    await openWith({ revisions: [PROPAGATE_ROW], scope: { undone: true } });

    const button = buttonLabelled("Undone");
    expect(button.disabled).toBe(true);
    expect(findButtonLabelled("Undo This Update")).toBeUndefined();
  });

  it("an undo discovered stale at click time is refused: no POST, the button flips to Undone", async () => {
    // Load-time says "not undone"; by click time another session undid it.
    // A second undo would replay old snapshots over everything edited since —
    // the exact operator disaster from review finding 4.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const undoCalls: string[] = [];
    let scopeCalls = 0;
    mockFetch.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes("/undo")) {
        undoCalls.push(path);
        return jsonResponse({ restored: [], failed: [] });
      }
      if (path.includes("/propagation-runs/")) {
        scopeCalls += 1;
        return jsonResponse({ pages: [{ pageId: "page-1", name: "Home" }], undone: scopeCalls > 1 });
      }
      return jsonResponse({ revisions: [PROPAGATE_ROW] });
    });
    render(<BuilderPageHistory pageId="page-1" pageName="Home" onRestored={() => {}} />);
    act(() => expandPanel());
    await flush();
    await flush();

    act(() => buttonLabelled("Undo This Update").click());
    await flush();
    await flush();

    expect(undoCalls).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("already undone");
    expect(buttonLabelled("Undone").disabled).toBe(true);
  });

  it("after a successful undo the run's button reads Undone and cannot replay", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const undoCalls: string[] = [];
    await openWith({
      revisions: [PROPAGATE_ROW],
      undo: { restored: [{ name: "Home" }], failed: [] },
      onUndoUrl: (url) => undoCalls.push(url),
    });

    act(() => buttonLabelled("Undo This Update").click());
    await flush();
    await flush();

    expect(undoCalls).toHaveLength(1);
    expect(buttonLabelled("Undone").disabled).toBe(true);
    expect(findButtonLabelled("Undo This Update")).toBeUndefined();
  });
});

describe("BuilderPageHistory — day grouping", () => {
  it("non-consecutive groups sharing a label all render their rows (no duplicate React keys)", async () => {
    // Today / Earlier / Today is legal: groupByDay only merges CONSECUTIVE
    // rows and an unparseable date labels its group "Earlier". A bare label
    // key made React fold the two Today groups together and drop rows — in
    // the one panel whose whole job is a complete trail.
    // React tolerates duplicate keys on MOUNT (it only warns) and corrupts
    // the tree on UPDATE — so counting rows after one render is an assertion
    // that cannot fail. The warning is the reliable, immediate signal.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows: BuilderPageRevision[] = [
      { ...SAVE_ROW, id: "rev-a", createdAt: NOW },
      { ...SAVE_ROW, id: "rev-b", createdAt: "not-a-date" },
      { ...SAVE_ROW, id: "rev-c", createdAt: NOW },
    ];
    await openWith({ revisions: rows });

    const renderedRows = document.querySelectorAll(".builder-page-history-row");
    expect(renderedRows).toHaveLength(3);
    const headings = Array.from(document.querySelectorAll(".builder-page-history-day-heading")).map(
      (h) => h.textContent
    );
    expect(headings).toEqual(["Today", "Earlier", "Today"]);

    const keyWarnings = consoleError.mock.calls.filter((call) =>
      call.some((arg) => String(arg).includes("same key"))
    );
    expect(keyWarnings).toEqual([]);
  });
});
