// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RepliesControls, { LIST_LIMIT, decidedFrom, ideasFrom, wordlessIdeasFrom } from "./replies-controls";
import type { OutreachChannel, OutreachStage } from "./outreach-wizard-panel";

/**
 * Write replies on the Outreach screen (SC-916 send-back): only words are
 * drafted, restacks and likes are decided here, and decided replies can be
 * found here.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/engage/substack-notes/items";

const SUBSTACK_ROWS = [
  { id: "n1", status: "idea", kind: "note", ideaText: "an idea" },
  { id: "r1", status: "idea", kind: "reply", targetText: "their Note", targetUrl: "https://substack.com/n/1" },
  { id: "rs1", status: "idea", kind: "restack", targetText: "a Note to restack", targetUrl: "https://substack.com/n/2" },
  { id: "lk1", status: "idea", kind: "like", targetUrl: "https://substack.com/n/3" },
  { id: "d1", status: "draft", kind: "reply" },
  { id: "p1", status: "posted", kind: "reply", finalText: "posted words", targetUrl: "https://substack.com/n/4", postedAt: "2026-11-20T01:00:00Z" },
  { id: "x1", status: "rejected", kind: "note", draftText: "rejected words", contentTitle: "A post", updatedAt: "2026-11-21T01:00:00Z" },
];

let calls: Array<{ path: string; method: string; body: any }> = [];
let changed = 0;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  calls = [];
  changed = 0;
  (window as any).App = {
    api: async (path: string, options?: RequestInit) => {
      const method = options?.method || "GET";
      calls.push({ path, method, body: options?.body ? JSON.parse(String(options.body)) : null });
      if (path === "/api/outreach/feedback/reasons") return { ok: true, data: { defaults: [], saved: [] } };
      if (method === "GET" && path === `${BASE}?status=idea&limit=${LIST_LIMIT}`) return { ok: true, data: SUBSTACK_ROWS.filter((r) => r.status === "idea") };
      if (method === "GET" && path === `${BASE}?limit=${LIST_LIMIT}`) return { ok: true, data: SUBSTACK_ROWS };
      if (method === "POST") return { ok: true, data: {} };
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

const substack: OutreachChannel = { key: "substack", label: "Substack", stages: [] };
function repliesStage(extra: Record<string, unknown>): OutreachStage {
  return { key: "replies", label: "Write replies", state: "needs_you", sentence: "s", next: null, inline: true, waitingCount: 0, ...extra } as OutreachStage;
}

async function mount(stage: OutreachStage) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<RepliesControls channel={substack} stage={stage} onWalk={() => {}} onChanged={() => { changed += 1; }} />));
}

function button(label: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

describe("the lists", () => {
  it("only a Substack Note or reply idea is drafted; other channels draft every idea", () => {
    expect(ideasFrom(SUBSTACK_ROWS, "substack").map((r) => r.id)).toEqual(["n1", "r1"]);
    expect(ideasFrom([{ id: "a", status: "idea" }], "reddit").map((r) => r.id)).toEqual(["a"]);
    expect(wordlessIdeasFrom(SUBSTACK_ROWS).map((r) => r.id)).toEqual(["rs1", "lk1"]);
  });

  it("decided replies are every approved, posting, posted, failed and rejected row, newest first", () => {
    expect(decidedFrom(SUBSTACK_ROWS).map((r) => r.id)).toEqual(["x1", "p1"]);
  });
});

describe("RepliesControls on Substack", () => {
  it("Write drafts drafts the Notes and replies only — never a restack or a like", async () => {
    await mount(repliesStage({ toWriteCount: 2, toDecideCount: 2 }));
    await act(async () => button("Write 2 drafts").click());
    await act(async () => {});
    const drafted = calls.filter((c) => c.method === "POST").map((c) => c.path);
    expect(drafted).toEqual([`${BASE}/n1/draft`, `${BASE}/r1/draft`]);
    expect(calls[0].path).toBe(`${BASE}?status=idea&limit=${LIST_LIMIT}`);
    expect(container!.textContent).toContain("2 drafts written.");
    expect(container!.textContent).not.toContain("Approvals tab");
  });

  it("restacks and likes are approved right here, as they are", async () => {
    await mount(repliesStage({ toWriteCount: 0, toDecideCount: 2 }));
    expect(container!.textContent).toContain("2 restacks and likes are waiting for your Approve or Reject.");
    await act(async () => button("Show restacks and likes").click());
    await act(async () => {});
    const items = container!.querySelectorAll("[data-wordless-item]");
    expect(Array.from(items).map((el) => el.getAttribute("data-wordless-item"))).toEqual(["rs1", "lk1"]);
    const approve = items[0].querySelector<HTMLButtonElement>("button")!;
    expect(approve.textContent).toBe("Approve");
    await act(async () => approve.click());
    await act(async () => {});
    expect(calls.filter((c) => c.method === "POST")).toEqual([{ path: `${BASE}/rs1/approve`, method: "POST", body: {} }]);
    expect(container!.textContent).toContain("Restack approved.");
    expect(container!.querySelectorAll("[data-wordless-item]")).toHaveLength(1);
    expect(changed).toBe(1);
  });

  it("Show decided replies lists the replies already approved or rejected", async () => {
    await mount(repliesStage({ toWriteCount: 0, toDecideCount: 0 }));
    await act(async () => button("Show decided replies").click());
    await act(async () => {});
    const items = Array.from(container!.querySelectorAll<HTMLElement>("[data-decided-item]"));
    expect(items.map((el) => el.dataset.status)).toEqual(["rejected", "posted"]);
    expect(items[0].textContent).toContain("rejected words");
    expect(items[1].textContent).toContain("posted words");
    expect(items[1].querySelector("a")!.getAttribute("href")).toBe("https://substack.com/n/4");
  });

  it("a decided list that cannot be read says so, never 'none yet'", async () => {
    (window as any).App.api = async () => { throw new Error("Server said 500"); };
    await mount(repliesStage({ toWriteCount: 0, toDecideCount: 0 }));
    await act(async () => button("Show decided replies").click());
    await act(async () => {});
    expect(container!.textContent).toContain("The decided replies could not be read: Server said 500");
    expect(container!.textContent).not.toContain("have been approved or rejected yet");
  });
});
