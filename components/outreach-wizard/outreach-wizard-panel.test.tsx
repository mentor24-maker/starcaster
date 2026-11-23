// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OutreachWizardPanel, {
  CHANNEL_STORAGE_KEY,
  CHECK_POLL_MS,
  PROJECT_SWITCH_EVENT,
  STAGES_STORAGE_PREFIX,
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

function header(key: string) {
  const b = container!.querySelector<HTMLButtonElement>(`[data-stage="${key}"] .outreach-wizard-stage-toggle`);
  if (!b) throw new Error(`no header for ${key}`);
  return b;
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
  it("shows the five stages with their sentences, and no stage links to another screen — even when the payload names one (SC-916)", async () => {
    await mount();
    const rows = stages();
    expect(rows.map((r) => r.dataset.stage)).toEqual(["connect", "creators", "conversations", "replies", "learn"]);
    expect(rows[0].textContent).toContain("proj_doe: The browser is SIGNED OUT of YouTube.");
    expect(rows[0].getAttribute("aria-current")).toBe("step");
    expect(rows[0].textContent).toContain("Needs you");
    // The fixture's stages still carry an old-style `next` screen; none is drawn.
    expect(container!.querySelectorAll('a[href^="#page="]')).toHaveLength(0);
    expect(container!.querySelectorAll(".outreach-wizard-stage-edit")).toHaveLength(0);
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
    expect(container!.querySelectorAll('a[href^="#page="]')).toHaveLength(0);
  });

  it("the channel switch is the shared tab style, never a button (UI rule C9, 86bcyrqbb)", async () => {
    await mount();
    const bar = container!.querySelector('[role="tablist"]')!;
    expect(bar.classList.contains("tab-bar")).toBe(true);
    const tabs = Array.from(bar.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.length).toBeGreaterThan(1);
    for (const t of tabs) {
      expect(t.className).toBe("tab-btn");
    }
    await act(async () => tab("Substack").click());
    expect(tab("Substack").getAttribute("aria-selected")).toBe("true");
    expect(tab("YouTube").getAttribute("aria-selected")).toBe("false");
  });

  it("a done stage reopens from its header, with no pencil out to another screen (SC-916)", async () => {
    await mount();
    await act(async () => tab("Substack").click());
    expect(container!.querySelectorAll(".outreach-wizard-stage-edit")).toHaveLength(0);
    expect(stages()[1].dataset.expanded).toBe("false");
    await act(async () => header("creators").click());
    expect(stages()[1].dataset.expanded).toBe("true");
    expect(setActivePage).not.toHaveBeenCalled();
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
    // Learn is not the open stage, so it starts collapsed and reads nothing (SC-886).
    expect(lessonReads).toEqual([]);
    await act(async () => header("learn").click());
    await act(async () => {});
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
    // Nothing on the screen leads to another one.
    expect(container!.querySelectorAll('a[href^="#page="]')).toHaveLength(0);
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
    await act(async () => header("creators").click());
    await act(async () => {});
    const stage = container!.querySelector('[data-stage="creators"]')!;
    expect(stage.querySelector("[data-yt-creators]")).not.toBeNull();
    expect(stage.textContent).toContain("No channels found yet.");
    expect(stage.querySelector("a.btn")).toBeNull();
  });
});

describe("Stages open and close from their header (SC-886)", () => {
  const expanded = () => stages().map((r) => r.dataset.expanded === "true");

  it("only the open stage starts expanded; a collapsed stage keeps its header and sentence", async () => {
    await mount();
    expect(expanded()).toEqual([true, false, false, false, false]);
    const replies = stages()[3];
    expect(replies.textContent).toContain("Replies");
    expect(replies.textContent).toContain("0 comments.");
    expect(header("replies").getAttribute("aria-expanded")).toBe("false");
    const controls = header("replies").getAttribute("aria-controls")!;
    const body = container!.querySelector<HTMLElement>(`#${controls}`)!;
    expect(body.hidden).toBe(true);
    expect(body.childElementCount).toBe(0);
    // The open stage's body really is open.
    expect(header("connect").getAttribute("aria-expanded")).toBe("true");
    expect(stages()[0].querySelector<HTMLElement>(".outreach-wizard-stage-body")!.hidden).toBe(false);
  });

  it("the header is a real button, so Enter and Space work the same as a click", async () => {
    await mount();
    const b = header("connect");
    // A native <button type="button"> turns Enter and Space into a click in
    // every browser; jsdom does not synthesise that, so what is asserted is
    // the element itself, and that the click it produces toggles.
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("type")).toBe("button");
    await act(async () => b.click());
    expect(expanded()[0]).toBe(false);
    expect(stages()[0].querySelector<HTMLElement>(".outreach-wizard-stage-body")!.hidden).toBe(true);
    await act(async () => b.click());
    expect(expanded()[0]).toBe(true);
  });

  it("with every stage done, all start collapsed", async () => {
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/overview") {
        const o = overviewFor(activeProject);
        o.channels[0].stages = o.channels[0].stages.map((x) => ({ ...x, state: "done" as const }));
        return { ok: true, data: o };
      }
      return api(path, options);
    };
    await mount();
    expect(expanded()).toEqual([false, false, false, false, false]);
    expect(container!.textContent).toContain("Every YouTube stage is done.");
  });

  it("remembers Dane's choices per channel across a reload", async () => {
    await mount();
    await act(async () => header("connect").click());
    await act(async () => header("replies").click());
    expect(expanded()).toEqual([false, false, false, true, false]);
    expect(JSON.parse(window.localStorage.getItem(`${STAGES_STORAGE_PREFIX}youtube`)!)).toEqual({ connect: false, replies: true });

    // Another channel is untouched by YouTube's choices.
    await act(async () => tab("Substack").click());
    expect(expanded()).toEqual([false, false, true, false, false]);
    await act(async () => tab("YouTube").click());

    act(() => root!.unmount());
    container!.remove();
    await mount();
    expect(expanded()).toEqual([false, false, false, true, false]);
  });

  it("with storage throwing, renders the default and no error", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    try {
      await mount();
      expect(expanded()).toEqual([true, false, false, false, false]);
      expect(container!.querySelector('[role="alert"]')).toBeNull();
      // Toggling still works for this visit, it is just not remembered.
      await act(async () => header("replies").click());
      expect(expanded()[3]).toBe(true);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("a damaged saved value falls back to the default", async () => {
    window.localStorage.setItem(`${STAGES_STORAGE_PREFIX}youtube`, "{not json");
    await mount();
    expect(expanded()).toEqual([true, false, false, false, false]);
  });

  it("a collapsed Find conversations makes no conversations request; opening it does", async () => {
    const reads: string[] = [];
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/overview") {
        const o = overviewFor(activeProject);
        o.channels[0].stages[2] = { ...o.channels[0].stages[2], state: "needs_you", next: null, inline: true };
        return { ok: true, data: o };
      }
      if (path.startsWith("/api/outreach/youtube/conversations")) {
        reads.push(path);
        return { ok: true, data: { videos: [], newCount: 0, reading: { state: "current", sentence: "S." }, skippedCount: 0, commentedCount: 0 } };
      }
      return api(path, options);
    };
    await mount();
    expect(expanded()[2]).toBe(false);
    expect(reads).toEqual([]);
    await act(async () => header("conversations").click());
    await act(async () => {});
    expect(reads.length).toBeGreaterThan(0);
  });
});

describe("Write replies is worked on this screen (SC-916)", () => {
  function withReplies(patch: (o: OutreachOverview) => void, extra: (path: string, options?: RequestInit) => any) {
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/overview") {
        const o = overviewFor(activeProject);
        patch(o);
        return { ok: true, data: o };
      }
      const hit = await extra(path, options);
      if (hit !== undefined) return hit;
      return api(path, options);
    };
  }

  it("Work through the waiting replies starts the Today walk-through, here", async () => {
    const reads: string[] = [];
    withReplies((o) => {
      o.channels[0].stages[3] = { ...o.channels[0].stages[3], state: "needs_you", sentence: "2 comments waiting.", waitingCount: 2, next: null, inline: true };
    }, (path) => {
      if (path === "/api/youtube-outreach/comments?status=draft") {
        reads.push(path);
        return { ok: true, data: [{ id: "c1", status: "draft", draftText: "Nice point.", videoTitle: "A video", createdAt: "2026-11-01" }] };
      }
      return undefined;
    });
    await mount();
    await act(async () => header("replies").click());
    const button = Array.from(container!.querySelectorAll<HTMLButtonElement>('[data-stage="replies"] button')).find((b) => b.textContent === "Work through 2 waiting replies");
    expect(button).toBeTruthy();
    expect(button!.className).toContain("btn-primary");
    await act(async () => button!.click());
    await act(async () => {});
    expect(reads).toEqual(["/api/youtube-outreach/comments?status=draft"]);
    expect(container!.querySelector('[data-today-reply="youtube:c1"]')).not.toBeNull();
    expect(setActivePage).not.toHaveBeenCalled();
  });

  it("Write drafts drafts each idea through the channel's own endpoint, and says how it went", async () => {
    withReplies((o) => {
      o.channels[2].stages[3] = { ...o.channels[2].stages[3], state: "needs_you", sentence: "2 posts waiting to be written.", waitingCount: 0, toWriteCount: 2, next: null, inline: true } as OutreachStage;
    }, (path) => {
      if (path === "/api/engage/reddit-comments/items?status=idea&limit=1000") {
        return { ok: true, data: [{ id: "i1", status: "idea" }, { id: "i2", status: "idea" }, { id: "d1", status: "draft" }] };
      }
      if (path === "/api/engage/reddit-comments/items/i2/draft") throw new Error("The post is still being read");
      return undefined;
    });
    await mount();
    await act(async () => tab("Reddit").click());
    await act(async () => header("replies").click());
    const button = Array.from(container!.querySelectorAll<HTMLButtonElement>('[data-stage="replies"] button')).find((b) => b.textContent === "Write 2 drafts")!;
    await act(async () => button.click());
    await act(async () => {});
    expect(posts.map((p) => p.path)).toEqual(["/api/engage/reddit-comments/items/i1/draft"]);
    const text = container!.querySelector('[data-replies="reddit"]')!.textContent;
    expect(text).toContain("1 draft written, 1 not.");
    expect(text).toContain("One was not drafted: The post is still being read");
  });

  it("with nothing waiting, says where replies come from", async () => {
    await mount();
    await act(async () => header("replies").click());
    expect(container!.querySelector('[data-replies="youtube"]')!.textContent).toContain("Replies are written from Find conversations");
  });
});

describe("Substack's Find creators is worked on this screen (SC-916)", () => {
  it("lists the Miner's writers in the stage instead of linking to the Miner", async () => {
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/overview") {
        const o = overviewFor(activeProject);
        o.channels[1].stages = o.channels[1].stages.map((x) => ({ ...x, next: null, inline: true }));
        return { ok: true, data: o };
      }
      if (path === "/api/acquire/substack-miner/candidates?limit=1000") {
        return { ok: true, data: [{ id: "w1", handle: "ana", name: "Ana Writes", status: "candidate", keywordsHit: ["tennis"], publicationUrl: "https://ana.substack.com" }] };
      }
      if (path === "/api/outreach/keywords") return { ok: true, data: { keywords: ["tennis"], source: "saved" } };
      return api(path, options);
    };
    await mount();
    await act(async () => tab("Substack").click());
    await act(async () => header("creators").click());
    await act(async () => {});
    const stage = container!.querySelector('[data-stage="creators"]')!;
    expect(stage.querySelector("[data-substack-writers]")).not.toBeNull();
    expect(stage.querySelector('[data-writer-id="w1"]')).not.toBeNull();
    expect(stage.querySelector('a[href^="#page="]')).toBeNull();
  });
});

describe("Getting started on a new channel (SC-916)", () => {
  it("shows only while the channel has counted zero approved replies, and Go to opens the stage", async () => {
    let approved: number | undefined = 0;
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/overview") {
        const o = overviewFor(activeProject);
        o.channels[0].stages[3] = { ...o.channels[0].stages[3], approvedCount: approved } as OutreachStage;
        return { ok: true, data: o };
      }
      if (path === "/api/outreach/keywords" && options?.method === "PUT") {
        const body = JSON.parse(String(options.body));
        puts.push(body);
        return { ok: true, data: { keywords: body.keywords, source: "saved" } };
      }
      if (path === "/api/outreach/keywords") return { ok: true, data: { keywords: ["tennis"], source: "substack_miner" } };
      return api(path, options);
    };
    const puts: any[] = [];
    await mount();
    const path = container!.querySelector('[data-first-run="youtube"]')!;
    expect(path).not.toBeNull();
    // YouTube has no account read in this fixture, so its first two steps cannot be told.
    expect(path.querySelector('[data-step="connect"]')!.getAttribute("data-state")).toBe("cannot_tell");
    expect(path.querySelector('[data-step="keywords"]')!.getAttribute("data-state")).toBe("now");
    expect(path.querySelector('[data-step="keywords"]')!.textContent).toContain("Started from the Substack Miner's keywords");
    expect(path.querySelector<HTMLInputElement>("#first-run-keywords-youtube")!.value).toBe("tennis");
    await act(async () => path.querySelector<HTMLFormElement>('[data-step="keywords"] form')!.requestSubmit());
    await act(async () => {});
    expect(puts).toEqual([{ keywords: ["tennis"] }]);
    expect(path.textContent).toContain("Keywords saved.");
    expect(path.querySelector('[data-step="keywords"]')!.getAttribute("data-state")).toBe("done");
    expect(path.querySelector('[data-step="creators"]')!.getAttribute("data-state")).toBe("cannot_tell");
    // A reply count that could not be read is not "new": the path goes away.
    approved = undefined;
    act(() => root!.unmount());
    container!.remove();
    await mount();
    expect(container!.querySelector("[data-first-run]")).toBeNull();
  });

  it("Go to opens the stage that does the step", async () => {
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path === "/api/outreach/overview") {
        const o = overviewFor(activeProject);
        o.channels[2].stages[1] = { ...o.channels[2].stages[1], approvedCount: 0 } as OutreachStage;
        o.channels[2].stages[3] = { ...o.channels[2].stages[3], approvedCount: 0 } as OutreachStage;
        return { ok: true, data: o };
      }
      if (path === "/api/outreach/keywords") return { ok: true, data: { keywords: ["tennis"], source: "saved" } };
      if (path.startsWith("/api/outreach/reddit/subreddits")) return { ok: true, data: { subreddits: [] } };
      return api(path, options);
    };
    await mount();
    await act(async () => tab("Reddit").click());
    await act(async () => {});
    const path = container!.querySelector('[data-first-run="reddit"]')!;
    // Reddit: the Mini sees an account, none chosen yet — that is the step now.
    expect(path.querySelector('[data-step="connect"]')!.getAttribute("data-state")).toBe("done");
    expect(path.querySelector('[data-step="account"]')!.getAttribute("data-state")).toBe("now");
    expect(path.querySelector('[data-step="account"] [data-step-next]')!.textContent).toContain("Saved at once");
    await act(async () => header("connect").click());
    expect(stages()[0].dataset.expanded).toBe("false");
    await act(async () => path.querySelector<HTMLButtonElement>('[data-show-stage="connect"]')!.click());
    expect(stages()[0].dataset.expanded).toBe("true");
  });
});
