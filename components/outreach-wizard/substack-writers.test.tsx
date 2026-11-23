// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SubstackWriters, { writersEmptyText, writersShown } from "./substack-writers";
import type { Candidate } from "../substack-miner/substack-miner-panel";

/** Substack's Find creators on the Outreach screen (SC-916): the Miner's own endpoints. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function writer(id: string, status: string, extra: Partial<Candidate> = {}): Candidate {
  return { id, handle: id, publicationUrl: `https://${id}.substack.com`, name: `Writer ${id}`, description: "", subscriberText: "", keywordsHit: [], foundVia: "search", recommendedBy: [], lastSeenAt: null, status, contactId: "", note: "", ...extra } as Candidate;
}

let calls: Array<{ path: string; method: string; body: any }> = [];
let list: Candidate[] = [];
let keywords: Record<string, unknown> = { keywords: ["tennis", "coaching"], source: "saved" };
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  calls = [];
  list = [writer("ana", "candidate"), writer("bo", "approved", { decisionReasons: ["on topic"] })];
  keywords = { keywords: ["tennis", "coaching"], source: "saved" };
  (window as any).App = {
    api: async (path: string, options?: RequestInit) => {
      const method = options?.method || "GET";
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      calls.push({ path, method, body });
      if (path === "/api/acquire/substack-miner/candidates?limit=1000") return { ok: true, data: list };
      if (path === "/api/outreach/keywords") return { ok: true, data: keywords };
      if (path === "/api/acquire/substack-miner/candidates/ana" && method === "PATCH") {
        return { ok: true, data: { ...list[0], status: body.status, contact: { id: "c1" } } };
      }
      if (path === "/api/acquire/substack-miner/run") return { ok: true, data: { keywordsSearched: body.keywords, resultsSeen: 4, handlesFound: 2, added: 1, merged: 1 } };
      if (path === "/api/acquire/substack-miner/candidates/import") return { ok: true, data: { added: 1, merged: 0 } };
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  delete (window as any).App;
});

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<SubstackWriters />));
  await act(async () => {});
}

function button(label: string) {
  const b = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent === label || x.getAttribute("aria-label") === label);
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

describe("writersShown", () => {
  it("Undecided is the Miner's candidate status; All keeps every row", () => {
    const rows = [writer("a", "candidate"), writer("b", "approved"), writer("c", "rejected")];
    expect(writersShown(rows, "undecided").map((w) => w.id)).toEqual(["a"]);
    expect(writersShown(rows, "approved").map((w) => w.id)).toEqual(["b"]);
    expect(writersShown(rows, "all")).toHaveLength(3);
    expect(writersEmptyText("undecided")).toContain("Set Status to All");
  });
});

describe("SubstackWriters", () => {
  it("lists the undecided writers and counts every status", async () => {
    await mount();
    expect(container!.querySelector("[data-writer-counts]")!.textContent).toBe("1 waiting for your decision, 1 approved, 0 rejected.");
    expect(container!.querySelector('[data-writer-id="ana"]')).not.toBeNull();
    expect(container!.querySelector('[data-writer-id="bo"]')).toBeNull();
  });

  it("Approve asks why in the Miner's own window, then PATCHes the Miner's writer", async () => {
    await mount();
    await act(async () => button("Approve Writer ana").click());
    // The dialog may render outside the component (a portal), so look in the whole page.
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).find((b) => b.textContent === "Approve")!;
    expect(confirm).toBeTruthy();
    await act(async () => confirm.form!.requestSubmit());
    await act(async () => {});
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe("/api/acquire/substack-miner/candidates/ana");
    expect(patch.body.status).toBe("approved");
    expect(container!.textContent).toContain("Writer ana approved and added to Contacts.");
  });

  it("Find writers sends the wizard's shared keywords to the Miner's search", async () => {
    await mount();
    await act(async () => button("Find writers").click());
    await act(async () => {});
    expect(calls.find((c) => c.path === "/api/acquire/substack-miner/run")!.body).toEqual({ keywords: ["tennis", "coaching"] });
    expect(container!.textContent).toContain("Searched 2 keywords");
  });

  it("with no keywords, Find writers is off and says why", async () => {
    keywords = { keywords: [], source: "none" };
    await mount();
    expect(button("Find writers").disabled).toBe(true);
    expect(container!.textContent).toContain("No keywords yet, so there is nothing to search for.");
  });

  it("a list that cannot be read says so, never 'no writers'", async () => {
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path.startsWith("/api/acquire/substack-miner/candidates")) throw new Error("PostgREST said no");
      return api(path, options);
    };
    await mount();
    expect(container!.textContent).toContain("The Substack writer list could not be read: PostgREST said no");
    expect(container!.textContent).not.toContain("No writers found yet");
  });

  it("a keywords read that fails says so — never 'No keywords yet' (SC-916 send-back)", async () => {
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/keywords") throw new Error("Server said 500");
      return api(path, options);
    };
    await mount();
    const line = container!.querySelector<HTMLElement>("[data-keywords-line]")!;
    expect(line.textContent).toContain("Your keywords could not be read, so Find writers cannot search yet: Server said 500.");
    expect(line.getAttribute("role")).toBe("alert");
    expect(container!.textContent).not.toContain("No keywords yet");
    expect(button("Find writers").disabled).toBe(true);
  });

  it("a save made in another section shows here at once", async () => {
    keywords = { keywords: [], source: "none" };
    await mount();
    expect(button("Find writers").disabled).toBe(true);
    const { announceKeywords } = await import("./youtube-creators");
    await act(async () => announceKeywords({ keywords: ["padel"], source: "saved" }));
    expect(button("Find writers").disabled).toBe(false);
    expect(container!.textContent).toContain("on your keywords: padel.");
  });
});
