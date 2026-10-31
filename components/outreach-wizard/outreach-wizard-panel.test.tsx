// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OutreachWizardPanel, {
  CHANNEL_STORAGE_KEY,
  CHECK_POLL_MS,
  PROJECT_SWITCH_EVENT,
  openStageIndex,
  type OutreachChannel,
  type OutreachOverview,
  type OutreachStage,
} from "./outreach-wizard-panel";

/**
 * Outreach wizard 1/19 (86bcrmb8x). The screen is driven against a fake
 * /api/outreach/overview that answers PER PROJECT, so "still showing the old
 * project" after a switch is distinguishable from a fresh read.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function st(key: string, state: OutreachStage["state"], sentence: string, page = "engageSubstackNotesPage"): OutreachStage {
  return { key, label: key[0].toUpperCase() + key.slice(1), state, sentence, next: { label: `Go to ${key}`, page } };
}

function channel(key: string, label: string, stages: OutreachStage[]): OutreachChannel {
  return { key, label, stages };
}

function overviewFor(project: string): OutreachOverview {
  return {
    generatedAt: "2026-10-26T20:00:00Z",
    channels: [
      channel("youtube", "YouTube", [
        st("connect", "needs_you", `${project}: The browser is SIGNED OUT of YouTube.`, "engageYoutubeOutreachPage"),
        st("creators", "not_started", "No list yet."),
        st("conversations", "not_started", "0 videos."),
        st("replies", "not_started", "0 comments."),
        st("learn", "not_started", "Nothing learnt."),
      ]),
      channel("substack", "Substack", [
        st("connect", "done", "Signed in as Dane of Earth, checked 4 minutes ago."),
        st("creators", "done", "17 writers approved.", "acquireSubstackPage"),
        st("conversations", "cannot_tell", "Cannot tell. The Substack Notes list could not be read: boom."),
        st("replies", "not_started", "0 Notes."),
        st("learn", "not_started", "Nothing learnt."),
      ]),
      { ...channel("reddit", "Reddit", [
        st("connect", "needs_you", "No Reddit account chosen."),
        st("creators", "not_started", "No subreddits."),
        st("conversations", "needs_you", "0 links pasted."),
        st("replies", "not_started", "0 comments."),
        st("learn", "not_started", "Nothing learnt."),
      ]), account: redditAccount },
    ],
  };
}

// Outreach wizard 2/19: the Mini sees Exotic-Break-7850; nothing is chosen yet.
let redditAccount: OutreachChannel["account"] = {
  expectedAccount: "",
  observedAccount: "Exotic-Break-7850",
  confirmedAt: null,
  checkRequestedAt: null,
  browserCheckedAt: "2026-10-26T19:50:00Z",
  pace: { maxCommentsPerDay: 3, minMinutesBetween: 20 },
};
let posts: Array<{ path: string; body: any }> = [];

let activeProject = "proj_doe";
let failNext = "";
let calls = 0;
let lessonReads: string[] = [];
let limitReads = 0;
let miniLimit: Record<string, unknown> = { status: "ok", limit: 40, used: 3, reached: false, reachedAt: null, sentence: "" };
let setActivePage: ReturnType<typeof vi.fn>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  activeProject = "proj_doe";
  failNext = "";
  calls = 0;
  lessonReads = [];
  limitReads = 0;
  miniLimit = { status: "ok", limit: 40, used: 3, reached: false, reachedAt: null, sentence: "" };
  posts = [];
  redditAccount = { ...redditAccount!, expectedAccount: "" };
  window.localStorage.clear();
  setActivePage = vi.fn();
  (window as any).App = {
    setActivePage,
    api: async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const body = JSON.parse(String(options.body || "{}"));
        posts.push({ path, body });
        if (path.endsWith("/choose")) redditAccount = { ...redditAccount!, expectedAccount: body.account };
        if (path === "/api/browser-view/open") {
          return { ok: true, data: { session: { id: "bvs_9" }, pass: "P", viewerUrl: "wss://mini.example/live/live" } };
        }
        return { ok: true, data: {} };
      }
      // Outreach wizard 13/19: the Learn stage reads its own lessons. `calls`
      // counts overview reads only.
      if (path.startsWith("/api/outreach/lessons?")) {
        lessonReads.push(path);
        return { ok: true, data: { channel: "x", lessons: [], score: null, scoreError: "" } };
      }
      // AI Quota 5/5: the Mini's daily AI limit, read beside the overview.
      if (path === "/api/ai-quota/mini-limit") {
        limitReads += 1;
        return { ok: true, data: miniLimit };
      }
      calls += 1;
      if (path !== "/api/outreach/overview") throw new Error(`unexpected ${path}`);
      if (failNext) {
        const why = failNext;
        failNext = "";
        throw new Error(why);
      }
      return { ok: true, data: overviewFor(activeProject) };
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
  await act(async () => {
    root!.render(<OutreachWizardPanel />);
  });
  await act(async () => {});
}

function stages() {
  return Array.from(container!.querySelectorAll<HTMLLIElement>(".outreach-wizard-stage"));
}

function tab(label: string) {
  const b = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((x) => x.textContent === label);
  if (!b) throw new Error(`no tab ${label}`);
  return b;
}

describe("openStageIndex", () => {
  it("is the first stage that is not done, and -1 when every stage is", () => {
    expect(openStageIndex([st("a", "done", ""), st("b", "cannot_tell", ""), st("c", "needs_you", "")])).toBe(1);
    expect(openStageIndex([st("a", "done", "")])).toBe(-1);
  });
});

describe("OutreachWizardPanel", () => {
  it("shows the five stages with their sentences, and exactly one primary button on the open stage", async () => {
    await mount();
    const rows = stages();
    expect(rows.map((r) => r.dataset.stage)).toEqual(["connect", "creators", "conversations", "replies", "learn"]);
    expect(rows[0].textContent).toContain("proj_doe: The browser is SIGNED OUT of YouTube.");
    expect(rows[0].getAttribute("aria-current")).toBe("step");
    expect(rows[0].textContent).toContain("Needs you");
    const primaries = container!.querySelectorAll(".btn-primary");
    expect(primaries).toHaveLength(1);
    expect(rows[0].contains(primaries[0])).toBe(true);
    expect(primaries[0].getAttribute("href")).toBe("#page=engageYoutubeOutreachPage");
    // Collapsed stages still say where they stand.
    expect(rows[3].textContent).toContain("0 comments.");
  });

  it("opens the first stage not done — a 'cannot tell' stage is never drawn as done", async () => {
    await mount();
    await act(async () => tab("Substack").click());
    const rows = stages();
    expect(rows[2].getAttribute("aria-current")).toBe("step");
    expect(rows[2].textContent).toContain("Cannot tell");
    expect(rows[2].textContent).toContain("could not be read: boom");
    expect(rows[1].textContent).toContain("✓");
    expect(rows[2].textContent).not.toContain("✓");
    expect(container!.querySelectorAll(".btn-primary")).toHaveLength(1);
  });

  it("the button opens the screen for that step", async () => {
    await mount();
    const button = container!.querySelector<HTMLAnchorElement>(".btn-primary")!;
    await act(async () => button.click());
    expect(setActivePage).toHaveBeenCalledWith("engageYoutubeOutreachPage");
  });

  it("every stage but the open one has a pencil back to its screen — done stages included (86bcuar8y)", async () => {
    await mount();
    await act(async () => tab("Substack").click());
    const rows = stages();
    const pencil = (row: HTMLLIElement) => row.querySelector<HTMLAnchorElement>(".outreach-wizard-stage-edit");
    // The open stage (conversations) has its button and no pencil; every other row has one.
    expect(rows.map((r) => !!pencil(r))).toEqual([true, true, false, true, true]);
    const done = pencil(rows[1])!;
    expect(done.getAttribute("href")).toBe("#page=acquireSubstackPage");
    expect(done.getAttribute("aria-label")).toBe("Go to creators");
    await act(async () => done.click());
    expect(setActivePage).toHaveBeenCalledWith("acquireSubstackPage");
  });

  it("remembers the last channel per viewer, and survives storage that throws", async () => {
    await mount();
    await act(async () => tab("Reddit").click());
    expect(window.localStorage.getItem(CHANNEL_STORAGE_KEY)).toBe("reddit");
    act(() => root!.unmount());
    container!.remove();
    await mount();
    expect(container!.querySelector(".outreach-wizard-channel")!.getAttribute("data-channel")).toBe("reddit");

    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    act(() => root!.unmount());
    container!.remove();
    await mount();
    expect(container!.querySelector(".outreach-wizard-channel")!.getAttribute("data-channel")).toBe("youtube");
    spy.mockRestore();
  });

  it("says why when the whole read fails", async () => {
    failNext = "Server said 500";
    await mount();
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain("could not be read: Server said 500");
    expect(stages()).toHaveLength(0);
  });

  it("reads again on a project switch", async () => {
    await mount();
    activeProject = "proj_other";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await act(async () => {});
    expect(calls).toBe(2);
    expect(stages()[0].textContent).toContain("proj_other:");
  });

  it("says nothing about the Mini's AI limit until it has stopped something (AI Quota 5/5)", async () => {
    await mount();
    expect(limitReads).toBeGreaterThan(0);
    expect(container!.textContent).not.toContain("Stopped for today");
  });

  it("leads with the stopped sentence once the Mini's AI limit is reached (AI Quota 5/5)", async () => {
    miniLimit = { status: "ok", limit: 1, used: 1, reached: true, reachedAt: "2026-10-30T09:12:00.000Z", sentence: "Stopped for today: the Mini's AI limit (1 request) was reached at 3:12 AM." };
    await mount();
    await act(async () => {});
    const alert = container!.querySelector(".outreach-wizard-panel > [role=alert]");
    expect(alert?.textContent).toContain("Stopped for today: the Mini's AI limit (1 request) was reached at 3:12 AM.");
    expect(alert?.textContent).toContain("Settings › AI Quota");
  });

  it("the Learn stage shows its lessons on the wizard itself, for the channel picked (13/19)", async () => {
    await mount();
    const learn = container!.querySelector('[data-stage="learn"]')!;
    expect(learn.querySelector("[data-learn]")?.getAttribute("data-learn")).toBe("youtube");
    expect(lessonReads).toEqual(["/api/outreach/lessons?channel=youtube"]);
    expect(learn.textContent).toContain("No lessons for YouTube yet.");
  });
});

describe("Connect: the account each channel posts as (Outreach wizard 2/19)", () => {
  function button(label: string) {
    const b = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent === label);
    if (!b) throw new Error(`no button ${label}`);
    return b;
  }

  it("names who the Mini is signed in as, and Post as this account chooses it", async () => {
    await mount();
    await act(async () => tab("Reddit").click());
    const connect = stages()[0];
    expect(connect.textContent).not.toContain("Posting as");
    await act(async () => button("Post as this account").click());
    await act(async () => {});
    expect(posts).toEqual([{ path: "/api/outreach/accounts/reddit/choose", body: { account: "Exotic-Break-7850" } }]);
    expect(stages()[0].textContent).toContain("Posting as Exotic-Break-7850.");
    // Once chosen, the button offering the same account goes away.
    expect(Array.from(container!.querySelectorAll("button")).some((b) => b.textContent === "Post as this account")).toBe(false);
    // Still exactly one primary on the screen.
    expect(container!.querySelectorAll(".btn-primary")).toHaveLength(1);
  });

  it("I'll sign in as someone else takes a different name, and Check now asks the Mini", async () => {
    await mount();
    await act(async () => tab("Reddit").click());
    await act(async () => button("I'll sign in as someone else").click());
    const input = container!.querySelector<HTMLInputElement>("#outreach-account-reddit")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "DaneOfEarth");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.form!.requestSubmit(); });
    await act(async () => {});
    expect(posts[0]).toEqual({ path: "/api/outreach/accounts/reddit/choose", body: { account: "DaneOfEarth" } });
    expect(container!.textContent).toContain("Click Connect Reddit, sign the Mini's browser in as DaneOfEarth");
    await act(async () => button("Check now").click());
    await act(async () => {});
    expect(posts[1].path).toBe("/api/outreach/accounts/reddit/check");
    expect(container!.textContent).toContain("Check asked for at");
  });

  it("shows Reddit's pace with its plain defaults, and saves it", async () => {
    await mount();
    await act(async () => tab("Reddit").click());
    expect(container!.querySelector<HTMLInputElement>("#outreach-reddit-per-day")!.value).toBe("3");
    expect(container!.querySelector<HTMLInputElement>("#outreach-reddit-gap")!.value).toBe("20");
    await act(async () => button("Save pace").click());
    await act(async () => {});
    expect(posts[0]).toEqual({ path: "/api/outreach/accounts/reddit/pace", body: { maxCommentsPerDay: 3, minMinutesBetween: 20 } });
  });

  it("Connect opens the sign-in window; closing it runs the check at once and then offers 'Post as this account?'", async () => {
    const sockets: any[] = [];
    (window as any).WebSocket = class {
      readyState = 0;
      sent: string[] = [];
      onopen: any; onmessage: any; onclose: any; onerror: any;
      constructor(public url: string) { sockets.push(this); }
      send(d: string) { this.sent.push(d); }
      close() { this.readyState = 3; }
    };
    redditAccount = { ...redditAccount!, expectedAccount: "DaneOfEarth" };
    await mount();
    await act(async () => tab("Reddit").click());
    await act(async () => button("Connect Reddit").click());
    expect(posts[0]).toEqual({ path: "/api/browser-view/open", body: { site: "reddit" } });
    expect(sockets[0].url).toBe("wss://mini.example/live/live");
    await act(async () => { sockets[0].readyState = 1; sockets[0].onopen(); });
    await act(async () => sockets[0].onmessage({ data: JSON.stringify({ type: "frame", data: "AA", metadata: { deviceWidth: 10, deviceHeight: 10 } }) }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await act(async () => button("Close").click());
    await act(async () => {});
    expect(container!.textContent).toContain("You closed the window.");
    expect(posts.map((p) => p.path)).toEqual([
      "/api/browser-view/open",
      "/api/browser-view/bvs_9/close",
      "/api/outreach/accounts/reddit/check",
    ]);
    // The reading in hand predates the close, so it is not an answer yet.
    expect(container!.querySelector("[data-after-window]")!.textContent).toContain("Checking which account");
    // The Mini answers: it sees Exotic-Break-7850.
    redditAccount = { ...redditAccount!, browserCheckedAt: new Date(Date.now() + 1000).toISOString() };
    await act(async () => { vi.advanceTimersByTime(CHECK_POLL_MS); });
    await act(async () => {});
    vi.useRealTimers();
    const after = container!.querySelector("[data-after-window]");
    expect(after?.textContent).toContain("Signed in as Exotic-Break-7850. Post as this account?");
    delete (window as any).WebSocket;
  });
});

describe("YouTube's Find creators (Outreach wizard 15/19)", () => {
  it("works the creator list on this screen when the stage is inline, and nowhere else", async () => {
    await mount();
    expect(container!.querySelector("[data-yt-creators]")).toBeNull();

    const original = overviewFor;
    const inlineOverview = (project: string): OutreachOverview => {
      const o = original(project);
      const yt = o.channels[0];
      yt.stages[1] = { ...yt.stages[1], next: null, inline: true };
      return o;
    };
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/overview") return { ok: true, data: inlineOverview(activeProject) };
      if (path === "/api/outreach/youtube/creators") return { ok: true, data: { creators: [], keywords: { keywords: [], source: "none" } } };
      return api(path, options);
    };
    act(() => root!.unmount());
    container!.remove();
    await mount();
    const stage = container!.querySelector('[data-stage="creators"]')!;
    expect(stage.querySelector("[data-yt-creators]")).not.toBeNull();
    expect(stage.textContent).toContain("No channels found yet.");
    expect(stage.querySelector("a.btn")).toBeNull();
  });
});
