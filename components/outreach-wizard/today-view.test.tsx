// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TodayView, { countsFor, todayLine, waitingFrom, walkKey, choicesFor } from "./today-view";
import type { OutreachChannel, OutreachStage } from "./outreach-wizard-panel";

/**
 * SC-642 slice A: the Outreach Today view. The fake api answers each
 * channel's draft list the way its own route does, and records every POST,
 * so "approved with option 2" is checked against what was actually sent.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function st(key: string, state: OutreachStage["state"], extra: Partial<OutreachStage> = {}): OutreachStage {
  return { key, label: key, state, sentence: `${key} sentence`, next: null, ...extra };
}

function channel(key: string, label: string, waiting: number, convos: number, connect: OutreachStage["state"] = "done"): OutreachChannel {
  return {
    key,
    label,
    stages: [
      st("connect", connect),
      st("creators", "done"),
      st("conversations", convos ? "needs_you" : "done", { newCount: convos }),
      st("replies", waiting ? "needs_you" : "done", { waitingCount: waiting }),
      st("learn", "done"),
    ],
  };
}

const three = (prefix: string) => [
  { text: `${prefix} one`, angle: "Agree" },
  { text: `${prefix} two`, angle: "Ask" },
  { text: `${prefix} three`, angle: "Story" },
];

let lists: Record<string, unknown> = {};
let failList = "";
let posts: Array<{ path: string; body: any }> = [];
let failPost = "";
let changed = 0;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  changed = 0;
  posts = [];
  failList = "";
  failPost = "";
  lists = {
    "/api/youtube-outreach/comments?status=draft": [
      { id: "yt1", status: "draft", videoId: "abc", videoTitle: "A video", channelName: "Some Channel", draftOptions: three("yt"), createdAt: "2026-11-20T01:00:00Z" },
    ],
    "/api/engage/reddit-comments/items": [
      { id: "rd1", status: "draft", postTitle: "A post", targetUrl: "https://reddit.com/r/x/1", subreddit: "x", draftOptions: three("rd"), createdAt: "2026-11-19T01:00:00Z" },
      { id: "rd2", status: "posted", postTitle: "Done already", draftOptions: three("no"), createdAt: "2026-11-18T01:00:00Z" },
    ],
    "/api/engage/substack-notes/items": [
      { id: "ss1", status: "draft", kind: "reply", targetText: "Their Note", targetUrl: "https://substack.com/n/1", draftOptions: three("ss"), createdAt: "2026-11-21T01:00:00Z" },
      { id: "ss2", status: "idea", kind: "idea", ideaText: "not a reply yet", createdAt: "2026-11-10T01:00:00Z" },
    ],
  };
  (window as any).App = {
    api: async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        if (failPost) throw new Error(failPost);
        posts.push({ path, body: JSON.parse(String(options.body || "{}")) });
        return { ok: true, data: {} };
      }
      if (path === "/api/outreach/feedback/reasons") return { ok: true, data: { defaults: [], saved: [] } };
      if (failList && path === failList) throw new Error("Server said 500");
      if (!(path in lists)) throw new Error(`unexpected ${path}`);
      return { ok: true, data: lists[path] };
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

const ALL = () => [channel("youtube", "YouTube", 1, 4), channel("substack", "Substack", 1, 0), channel("reddit", "Reddit", 1, 8)];

async function mount(channels: OutreachChannel[], scopeLabel = "All channels") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<TodayView channels={channels} scopeLabel={scopeLabel} onChanged={() => { changed += 1; }} />);
  });
}

function button(label: string): HTMLButtonElement {
  const b = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

async function press(key: string, target: EventTarget = document.body) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

const card = () => container!.querySelector<HTMLElement>("[data-today-reply]");

describe("Today line", () => {
  it("adds up every channel and says the Mini is signed in", () => {
    expect(todayLine(ALL().map(countsFor))).toBe("3 replies waiting for you · 12 new conversations · Mini signed in everywhere");
    expect(todayLine([countsFor(channel("reddit", "Reddit", 1, 1))])).toBe("1 reply waiting for you · 1 new conversation · Mini signed in");
  });

  it("never turns a count it could not take into 0", () => {
    const broken = channel("reddit", "Reddit", 0, 0);
    broken.stages = broken.stages.map((s) => (s.key === "replies" || s.key === "conversations" || s.key === "connect" ? { ...s, state: "cannot_tell" } : s));
    expect(todayLine([countsFor(broken)])).toBe("Replies waiting: cannot tell · New conversations: cannot tell · Mini sign-in: cannot tell");
    expect(todayLine([countsFor(channel("youtube", "YouTube", 2, 1)), countsFor(broken)]))
      .toBe("2 replies waiting for you (cannot tell for Reddit) · 1 new conversation (cannot tell for Reddit) · Mini sign-in: cannot tell for Reddit");
  });

  it("names the channel the Mini is not signed in to", () => {
    const counts = [channel("youtube", "YouTube", 0, 0), channel("reddit", "Reddit", 0, 0, "needs_you")].map(countsFor);
    expect(todayLine(counts)).toContain("Mini not signed in to Reddit");
  });
});

describe("waiting replies", () => {
  it("lists only drafts, oldest first, and skips Substack ideas", () => {
    const rd = waitingFrom("reddit", "Reddit", lists["/api/engage/reddit-comments/items"]);
    expect(rd.map((r) => r.id)).toEqual(["rd1"]);
    const ss = waitingFrom("substack", "Substack", lists["/api/engage/substack-notes/items"]);
    expect(ss.map((r) => r.id)).toEqual(["ss1"]);
    expect(ss[0].boxLabel).toBe("Your Reply");
    expect(ss[0].detail).toBe("Their Note");
  });

  it("an older draft with no options still offers its one wording", () => {
    const [r] = waitingFrom("youtube", "YouTube", [{ id: "old", status: "draft", draftText: "Hello there" }]);
    expect(choicesFor(r)).toEqual([{ index: null, text: "Hello there", angle: "The draft" }]);
  });

  it("keys typed into a box are typing, not commands", () => {
    const box = document.createElement("textarea");
    expect(walkKey({ key: "a", target: box })).toBeNull();
    expect(walkKey({ key: "a", target: document.body })).toEqual({ kind: "approve" });
    expect(walkKey({ key: "ArrowRight", target: document.body })).toEqual({ kind: "skip" });
    expect(walkKey({ key: "1", metaKey: true, target: document.body })).toBeNull();
  });
});

describe("Start walks through the waiting replies", () => {
  it("shows the line, and Start opens the oldest waiting reply first", async () => {
    await mount(ALL());
    expect(container!.querySelector("[data-today-line]")!.textContent).toBe("3 replies waiting for you · 12 new conversations · Mini signed in everywhere");
    await act(async () => button("Start").click());
    expect(card()!.dataset.todayReply).toBe("reddit:rd1");
    expect(card()!.textContent).toContain("Reddit · 3 replies left");
    expect(card()!.textContent).toContain("A post");
  });

  it("keys 1 then A approve the first option, and the next reply appears", async () => {
    await mount(ALL());
    await act(async () => button("Start").click());
    await press("1");
    expect(container!.querySelector<HTMLTextAreaElement>("#outreach-today-box")!.value).toBe("rd one");
    await press("a");
    expect(posts).toEqual([{ path: "/api/engage/reddit-comments/items/rd1/approve", body: { text: "rd one", option: 0 } }]);
    expect(card()!.dataset.todayReply).toBe("youtube:yt1");
    // The next card starts fresh: no box carrying the last reply's words.
    expect(container!.querySelector("#outreach-today-box")).toBeNull();
    expect(container!.textContent).toContain("Approved on Reddit.");
    expect(changed).toBe(1);
  });

  it("approves in two clicks: an option, then Approve", async () => {
    await mount([channel("youtube", "YouTube", 1, 0)], "YouTube");
    await act(async () => button("Start").click());
    const second = card()!.querySelector<HTMLButtonElement>('[data-option="1"]')!;
    await act(async () => second.click());
    await act(async () => button("Approve").click());
    expect(posts).toEqual([{ path: "/api/youtube-outreach/comments/yt1/approve", body: { text: "yt two", option: 1 } }]);
    expect(card()).toBeNull();
    expect(container!.textContent).toContain("That was the last one: 1 approved, 0 rejected, 0 skipped.");
  });

  it("an edit is what gets approved", async () => {
    await mount([channel("youtube", "YouTube", 1, 0)], "YouTube");
    await act(async () => button("Start").click());
    await press("e");
    const box = container!.querySelector<HTMLTextAreaElement>("#outreach-today-box")!;
    expect(box.value).toBe("yt one");
    // Typing in the box: "a" must not approve.
    await press("a", box);
    expect(posts).toEqual([]);
  });

  it("→ skips, leaving it waiting, and R asks why before rejecting", async () => {
    await mount(ALL());
    await act(async () => button("Start").click());
    await press("ArrowRight");
    expect(card()!.dataset.todayReply).toBe("youtube:yt1");
    await press("r");
    const chip = document.querySelector<HTMLButtonElement>('[data-reason="too salesy"]')!;
    expect(chip).not.toBeNull();
    // Keys do nothing while the reason window is open.
    await press("ArrowRight");
    expect(card()!.dataset.todayReply).toBe("youtube:yt1");
    await act(async () => chip.click());
    expect(posts[0].path).toBe("/api/youtube-outreach/comments/yt1/reject");
    expect(posts[0].body.reasons).toEqual(["too salesy"]);
    expect(card()!.dataset.todayReply).toBe("substack:ss1");
    await press("ArrowRight");
    expect(container!.textContent).toContain("That was the last one: 0 approved, 1 rejected, 2 skipped (still waiting for you).");
  });

  it("a refused approve says so and stays on the card", async () => {
    await mount([channel("youtube", "YouTube", 1, 0)], "YouTube");
    await act(async () => button("Start").click());
    failPost = "Not approved: it names Dane of Earth";
    await press("1");
    await press("a");
    expect(card()!.dataset.todayReply).toBe("youtube:yt1");
    expect(card()!.querySelector('[role="alert"]')!.textContent).toBe("Not approved: it names Dane of Earth");
  });

  it("a channel whose list could not be read says so, and the others still walk", async () => {
    failList = "/api/engage/reddit-comments/items";
    await mount(ALL());
    await act(async () => button("Start").click());
    expect(container!.querySelector('[role="alert"]')!.textContent).toBe("Reddit's waiting replies could not be read: Server said 500");
    expect(card()!.dataset.todayReply).toBe("youtube:yt1");
  });

  it("with nothing waiting, Start is off and the line says why", async () => {
    await mount([channel("youtube", "YouTube", 0, 0)], "YouTube");
    expect(button("Start").disabled).toBe(true);
    expect(container!.textContent).toContain("No replies are waiting for you on YouTube");
  });
});
