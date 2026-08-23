import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALREADY_UNDONE_MESSAGE,
  confirmUndoMessage,
  describeUndoOutcome,
  fetchPropagationRunScope,
  performPropagationUndo,
} from "./propagation-undo";

/**
 * The ONE copy of the undo flow both entry points share (save-time banner,
 * Page History row). The sentences here are doctrine copy — a partial undo
 * that reports plain success is the PR #21 failure — so they are pinned as
 * behavior, not left to drift in two components.
 */

const mockFetch = vi.fn();
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: (...args: unknown[]) => mockFetch(...args),
}));

afterEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function page(name: string, pageId = name.toLowerCase()) {
  return { pageId, name };
}

describe("fetchPropagationRunScope", () => {
  it("reads pages and the undone flag from the run GET", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ pages: [{ pageId: "1", name: "Home" }], undone: true }));
    const scope = await fetchPropagationRunScope("run-abc");
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/propagation-runs/run-abc", { cache: "no-store" });
    expect(scope.pages).toEqual([{ pageId: "1", name: "Home" }]);
    expect(scope.undone).toBe(true);
  });

  it("a missing undone flag reads as NOT undone, never as undone", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ pages: [] }));
    const scope = await fetchPropagationRunScope("run-abc");
    expect(scope.undone).toBe(false);
  });

  it("a failed GET surfaces the server's message", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "Could not load that update" }, false));
    await expect(fetchPropagationRunScope("run-abc")).rejects.toThrow("Could not load that update");
  });
});

describe("confirmUndoMessage", () => {
  it("names the pages that still have restore points and their count", () => {
    const text = confirmUndoMessage({ pages: [page("Home"), page("About")], undone: false });
    expect(text).toContain("2 pages still have restore points");
    expect(text).toContain("Home, About");
    expect(text).toContain("WHOLE page");
    expect(text).toContain("can itself be undone");
  });

  it("caps a 46-page run's name list instead of printing a wall", () => {
    const pages = Array.from({ length: 46 }, (_, i) => page(`Page ${i + 1}`));
    const text = confirmUndoMessage({ pages, undone: false });
    expect(text).toContain("46 pages still have restore points");
    expect(text).toContain("and 36 more");
    expect(text).not.toContain("Page 11,");
  });

  it("carries the section name when the caller knows it (save-time banner)", () => {
    const text = confirmUndoMessage({ pages: [page("Home")], undone: false }, "Footer");
    expect(text).toContain('Undo the update to "Footer"?');
    expect(text).toContain("1 page still has restore points");
  });
});

describe("performPropagationUndo + describeUndoOutcome", () => {
  it("a clean undo yields the success sentence with the real count", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ restored: [{ name: "Home" }, { name: "About" }], failed: [] }));
    const outcome = await performPropagationUndo("run-abc");
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/propagation-runs/run-abc/undo", { method: "POST" });
    const summary = describeUndoOutcome(outcome);
    expect(summary.kind).toBe("success");
    expect(summary.text).toBe("Undone. 2 pages are back to how they were.");
  });

  it("a partial undo NAMES its casualties — never a plain success", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ restored: [{ name: "Home" }], failed: [{ name: "About" }, {}] })
    );
    const summary = describeUndoOutcome(await performPropagationUndo("run-abc"));
    expect(summary.kind).toBe("partial");
    expect(summary.text).toContain("Put back 1 page, but 2 could not be restored: About, (unnamed)");
    expect(summary.text).toContain("restore those from the page itself");
  });

  it("a failed request throws the server's message", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "That update has no restore points left to undo." }, false));
    await expect(performPropagationUndo("run-abc")).rejects.toThrow("no restore points left");
  });
});

describe("ALREADY_UNDONE_MESSAGE", () => {
  it("tells the operator how to redo, not just that it is done", () => {
    expect(ALREADY_UNDONE_MESSAGE).toContain("already undone");
    expect(ALREADY_UNDONE_MESSAGE).toContain("restore the pages");
  });
});
