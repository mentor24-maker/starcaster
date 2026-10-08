// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YoutubeOutreachPanel, {
  PROJECT_SWITCH_EVENT,
  repeatSummary,
  settingsPatchFromForm,
  settingsToForm,
  splitList,
  targetPatchFromForm,
  targetToForm,
  withScheme,
  followedSummary,
  type OutreachComment,
  type OutreachSettings,
  type Target,
} from "./youtube-outreach-panel";

/**
 * YouTube outreach 2/7 (86bcda63z). The screen is driven against a fake
 * /api/youtube-outreach that keeps one list PER PROJECT, so "still showing the
 * old client's list" after a switch is distinguishable from "empty", and every
 * save is read back from the fake's store rather than from the screen's state.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function target(id: string, title: string, overrides: Partial<Target> = {}): Target {
  return {
    id,
    accountKey: "dane_of_earth",
    videoUrl: `https://www.youtube.com/watch?v=${id}`,
    videoId: id,
    videoTitle: title,
    channelName: `${title} channel`,
    detailsError: "",
    objective: "join_conversation",
    commentPlacement: "top_level",
    replyToCommentId: "",
    messageTypes: ["insight", "question"],
    commentLength: "medium",
    linkPolicy: "never",
    linkUrl: "",
    mentionPolicy: "never",
    repeatMode: "once",
    repeatEveryDays: null,
    repeatMaxTimes: null,
    repeatUntil: null,
    priority: "normal",
    notes: "",
    status: "active",
    createdAt: "2026-10-07T00:00:00Z",
    ...overrides,
  };
}

function defaults(): OutreachSettings {
  return {
    accountKey: "dane_of_earth",
    maxCommentsPerDay: 10,
    minMinutesBetween: 45,
    jitterMinutes: 15,
    activeStartHour: 8,
    activeEndHour: 22,
    timeZone: "",
    oneCommentPerVideo: true,
    avoidChannels: [],
    avoidWords: [],
    voice: "",
    saved: false,
    updatedAt: "",
  };
}

type Store = { targets: Target[]; settings: OutreachSettings; comments: OutreachComment[] };
let draftSeq = 0;
/** What the fake "agent" writes next; a string starting "REFUSE:" is a server refusal instead. */
let nextDraft = "Slowing the toss down in that clip fixed my serve. Does it work for a kick serve too?";

function makeComment(t: Target, text: string): OutreachComment {
  draftSeq += 1;
  return {
    id: `c${draftSeq}`,
    targetId: t.id,
    videoId: t.videoId,
    videoTitle: t.videoTitle,
    channelName: t.channelName,
    followed: {
      objective: t.objective, commentLength: t.commentLength, messageTypes: t.messageTypes,
      linkPolicy: t.linkPolicy, mentionPolicy: t.mentionPolicy,
    },
    draftText: text,
    finalText: "",
    status: "draft",
    approvedAt: null,
    rejectedAt: null,
    createdAt: `2026-10-07T12:00:0${draftSeq}Z`,
  };
}
let stores: Record<string, Store> = {};
let activeProject = "proj_doe";
let requests: { method: string; path: string; body: any; project: string }[] = [];
let container: HTMLDivElement | null = null;
let root: Root | null = null;

function fail(message: string): never {
  throw new Error(message);
}

async function fakeApi(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(String(options.body)) : null;
  const project = activeProject;
  requests.push({ method, path, body, project });
  const store = stores[project];
  if (path === "/api/youtube-outreach/targets" && method === "GET") return { ok: true, data: store.targets };
  if (path === "/api/youtube-outreach/settings" && method === "GET") return { ok: true, data: store.settings };
  if (path.startsWith("/api/youtube-outreach/comments?") && method === "GET") {
    const query = new URLSearchParams(path.split("?")[1]);
    const statuses = (query.get("status") || "").split(",").filter(Boolean);
    const targetId = query.get("targetId") || "";
    return {
      ok: true,
      data: store.comments.filter((c) => (!statuses.length || statuses.includes(c.status)) && (!targetId || c.targetId === targetId)),
    };
  }
  const drafts = path.match(/^\/api\/youtube-outreach\/targets\/([^/]+)\/drafts$/);
  if (drafts && method === "POST") {
    const t = store.targets.find((x) => x.id === drafts[1]) || fail("Target not found in this project");
    if (nextDraft.startsWith("REFUSE:")) fail(nextDraft.slice(7));
    const made = makeComment(t, nextDraft);
    store.comments = [made, ...store.comments];
    return { ok: true, data: { ...made } };
  }
  const decision = path.match(/^\/api\/youtube-outreach\/comments\/([^/]+)\/(approve|reject|redraft)$/);
  if (decision && method === "POST") {
    const c = store.comments.find((x) => x.id === decision[1]) || fail("Comment not found in this project");
    if (c.status !== "draft") fail(`This comment is ${c.status}, not waiting for approval, so it cannot be changed here.`);
    if (decision[2] === "approve") {
      if (/https?:\/\//.test(body.text)) fail("Not approved: it contains a link, and this video's link setting is Never.");
      Object.assign(c, { status: "approved", finalText: body.text, approvedAt: "2026-10-07T12:30:00Z" });
      return { ok: true, data: { ...c } };
    }
    if (decision[2] === "reject") {
      Object.assign(c, { status: "rejected", rejectedAt: "2026-10-07T12:30:00Z" });
      return { ok: true, data: { ...c } };
    }
    const t = store.targets.find((x) => x.id === c.targetId)!;
    const made = makeComment(t, `${nextDraft} (again)`);
    c.status = "rejected";
    store.comments = [made, ...store.comments];
    return { ok: true, data: { ...made } };
  }
  if (path === "/api/youtube-outreach/targets" && method === "POST") {
    const id = String(body.videoUrl).split("v=")[1];
    if (store.targets.some((t) => t.id === id)) fail(`This video (${id}) is already on the dane_of_earth list.`);
    const created = target(id, "Rick Astley - Never Gonna Give You Up");
    store.targets = [created, ...store.targets];
    return { ok: true, data: created };
  }
  if (path === "/api/youtube-outreach/settings" && method === "PUT") {
    if (Number(body.activeStartHour) >= Number(body.activeEndHour)) {
      fail(`activeStartHour (${body.activeStartHour}) must be earlier than activeEndHour (${body.activeEndHour})`);
    }
    store.settings = {
      ...store.settings,
      ...body,
      maxCommentsPerDay: Number(body.maxCommentsPerDay),
      saved: true,
      updatedAt: "2026-10-07T12:00:00Z",
    };
    return { ok: true, data: store.settings };
  }
  const action = path.match(/^\/api\/youtube-outreach\/targets\/([^/]+)(?:\/(pause|resume))?$/);
  if (action) {
    const found = store.targets.find((t) => t.id === action[1]) || fail("Target not found in this project");
    if (action[2]) {
      found.status = action[2] === "pause" ? "paused" : "active";
      return { ok: true, data: { ...found } };
    }
    if (method === "PATCH") {
      if (body.commentPlacement !== "reply_specific" && body.replyToCommentId) {
        fail("replyToCommentId is only used when commentPlacement is reply_specific");
      }
      if (body.repeatMode !== "repeat" && body.repeatEveryDays !== null) {
        fail("repeatEveryDays is only used when repeatMode is repeat");
      }
      Object.assign(found, body);
      return { ok: true, data: { ...found } };
    }
    if (method === "DELETE") {
      store.targets = store.targets.filter((t) => t.id !== found.id);
      return { ok: true, data: found };
    }
  }
  return fail(`unexpected ${method} ${path}`);
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<YoutubeOutreachPanel />); });
  await flush();
}

function text(): string {
  return container?.textContent || "";
}

function button(label: string, scope: ParentNode = container!): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === label);
  if (!found) throw new Error(`no button "${label}" in: ${text()}`);
  return found as HTMLButtonElement;
}

function row(id: string): HTMLTableRowElement {
  const found = container!.querySelector(`tr[data-target-id="${id}"]`);
  if (!found) throw new Error(`no row ${id}`);
  return found as HTMLTableRowElement;
}

/** Set a controlled input's value the way React's onChange sees it. */
function type(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => { el.click(); });
  await flush();
}

async function submit(form: HTMLFormElement) {
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}

beforeEach(() => {
  stores = {
    proj_doe: { targets: [], settings: defaults(), comments: [] },
    proj_delray: { targets: [target("delray1", "Delray serve clinic")], settings: defaults(), comments: [] },
  };
  draftSeq = 0;
  nextDraft = "Slowing the toss down in that clip fixed my serve. Does it work for a kick serve too?";
  activeProject = "proj_doe";
  requests = [];
  (window as unknown as { App: unknown }).App = { api: vi.fn(fakeApi) };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

describe("YouTube outreach screen", () => {
  it("names why the list is empty, then adds a pasted link as a row", async () => {
    await mount();
    expect(text()).toContain("No target videos yet. Paste a YouTube link above to add the first one.");

    type(container!.querySelector<HTMLInputElement>("#yto-add-url")!, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-add")!);

    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    const added = row("dQw4w9WgXcQ").textContent || "";
    expect(added).toContain("Rick Astley - Never Gonna Give You Up");
    expect(added).toContain("Join the conversation");
    expect(added).toContain("Active");
    expect(text()).not.toContain("No target videos yet");
  });

  it("shows the server's refusal when a video is added twice", async () => {
    stores.proj_doe.targets = [target("dQw4w9WgXcQ", "Rick")];
    await mount();
    type(container!.querySelector<HTMLInputElement>("#yto-add-url")!, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-add")!);
    expect(text()).toContain("The video was not added: This video (dQw4w9WgXcQ) is already on the dane_of_earth list.");
  });

  it("saves an edited setting to the server and shows it on the row", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await click(button("Edit", row("abc")));
    type(container!.querySelector<HTMLSelectElement>("#yto-length")!, "short");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-editor")!);

    expect(stores.proj_doe.targets[0].commentLength).toBe("short");
    expect(row("abc").textContent).toContain("Short");
    expect(container!.querySelector("form.yt-outreach-editor")).toBeNull();

    // A fresh mount reads the store again — the reload in the ticket's test.
    act(() => root?.unmount());
    container?.remove();
    await mount();
    expect(row("abc").textContent).toContain("Short");
  });

  it("does not send a repeat schedule typed before switching back to Once", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await click(button("Edit", row("abc")));
    type(container!.querySelector<HTMLSelectElement>("#yto-repeat")!, "repeat");
    type(container!.querySelector<HTMLInputElement>("#yto-every")!, "7");
    type(container!.querySelector<HTMLInputElement>("#yto-max-times")!, "3");
    // Switching back to Once must not send the 7 it typed, or the store refuses.
    type(container!.querySelector<HTMLSelectElement>("#yto-repeat")!, "once");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-editor")!);
    const patch = requests.find((r) => r.method === "PATCH")!.body;
    expect(patch.repeatEveryDays).toBeNull();
    expect(patch.repeatMaxTimes).toBeNull();
    expect(container!.querySelector("form.yt-outreach-editor")).toBeNull();
  });

  it("pauses and resumes a row", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await click(button("Pause", row("abc")));
    expect(stores.proj_doe.targets[0].status).toBe("paused");
    expect(row("abc").textContent).toContain("Paused");
    await click(button("Resume", row("abc")));
    expect(row("abc").textContent).toContain("Active");
  });

  it("deletes a row only after confirming", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await click(button("Delete", row("abc")));
    expect(stores.proj_doe.targets).toHaveLength(1);
    await click(button("Delete", row("abc")));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(stores.proj_doe.targets).toHaveLength(0);
    expect(text()).toContain("No target videos yet");
  });

  it("saves account settings, says when nothing was saved yet, and survives a reload", async () => {
    await mount();
    await click(button("Account settings"));
    expect(text()).toContain("Nothing has been saved for this account yet");
    type(container!.querySelector<HTMLInputElement>("#yto-max-per-day")!, "5");
    type(container!.querySelector<HTMLTextAreaElement>("#yto-avoid-words")!, "crypto\n giveaway \n");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-settings")!);

    expect(stores.proj_doe.settings.maxCommentsPerDay).toBe(5);
    expect(stores.proj_doe.settings.avoidWords).toEqual(["crypto", "giveaway"]);

    act(() => root?.unmount());
    container?.remove();
    await mount();
    await click(button("Account settings"));
    expect(container!.querySelector<HTMLInputElement>("#yto-max-per-day")!.value).toBe("5");
    expect(text()).toContain("These limits apply to every video on the list.");
  });

  it("shows the server's refusal on account settings and keeps the form open", async () => {
    await mount();
    await click(button("Account settings"));
    type(container!.querySelector<HTMLInputElement>("#yto-start-hour")!, "23");
    type(container!.querySelector<HTMLInputElement>("#yto-end-hour")!, "9");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-settings")!);
    expect(text()).toContain("Not saved: activeStartHour (23) must be earlier than activeEndHour (9)");
    expect(container!.querySelector("form.yt-outreach-settings")).not.toBeNull();
  });

  it("shows the new project's list after a project switch, not the old one's", async () => {
    stores.proj_doe.targets = [target("abc", "Dane of Earth video")];
    await mount();
    expect(text()).toContain("Dane of Earth video");
    await click(button("Edit", row("abc")));

    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();

    expect(text()).not.toContain("Dane of Earth video");
    expect(text()).toContain("Delray serve clinic");
    expect(container!.querySelector("form.yt-outreach-editor")).toBeNull();
    expect(requests.filter((r) => r.project === "proj_delray" && r.method === "GET")).toHaveLength(3); // list, settings, approvals
  });

  it("drops a settings save that answers after a project switch", async () => {
    stores.proj_doe.settings = { ...defaults(), maxCommentsPerDay: 3, saved: true, updatedAt: "2026-10-01T00:00:00Z" };
    stores.proj_delray.settings = { ...defaults(), maxCommentsPerDay: 20, saved: true, updatedAt: "2026-10-02T00:00:00Z" };
    let answer: (() => void) | null = null;
    (window as unknown as { App: unknown }).App = {
      api: vi.fn((path: string, options: RequestInit = {}) => {
        if ((options.method || "GET").toUpperCase() !== "PUT") return fakeApi(path, options);
        // Hold the save's reply until after the switch, as a slow network would.
        return new Promise((resolve, reject) => {
          answer = () => { fakeApi(path, options).then(resolve, reject); };
        });
      }),
    };
    await mount();
    await click(button("Account settings"));
    type(container!.querySelector<HTMLInputElement>("#yto-max-per-day")!, "5");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-settings")!);
    expect(answer).not.toBeNull();

    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    // The save was SENT under Dane of Earth, so it lands there…
    activeProject = "proj_doe";
    await act(async () => { answer!(); });
    activeProject = "proj_delray";
    await flush();
    expect(stores.proj_doe.settings.maxCommentsPerDay).toBe(5);

    // …but its reply must not become Delray's form.
    expect(text()).not.toContain("Account settings saved.");
    await click(button("Account settings"));
    expect(container!.querySelector<HTMLInputElement>("#yto-max-per-day")!.value).toBe("20");
    expect(stores.proj_delray.settings.maxCommentsPerDay).toBe(20);
  });

  it("names the settings read when only that one fails, and still shows the list", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    (window as unknown as { App: unknown }).App = {
      api: vi.fn(async (path: string, options: RequestInit = {}) => {
        if (path === "/api/youtube-outreach/settings") throw new Error("The settings table is not available");
        return fakeApi(path, options);
      }),
    };
    await mount();
    expect(text()).toContain("The account settings could not be read: The settings table is not available");
    expect(text()).not.toContain("The outreach list could not be read");
    expect(row("abc").textContent).toContain("First video");
    expect(button("Account settings").disabled).toBe(true);
  });

  it("adds a link pasted without https://", async () => {
    await mount();
    const input = container!.querySelector<HTMLInputElement>("#yto-add-url")!;
    expect(input.type).toBe("text");
    type(input, "youtube.com/watch?v=dQw4w9WgXcQ");
    await submit(container!.querySelector<HTMLFormElement>("form.yt-outreach-add")!);
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(row("dQw4w9WgXcQ")).toBeTruthy();
  });

  it("labels the safety settings with what they actually do", async () => {
    await mount();
    await click(button("Account settings"));
    expect(text()).toContain("Never comment on a video more than once, unless that video is set to repeat");
    expect(text()).not.toContain("in one day");
    expect(text()).toContain("Blank uses this project's own time zone.");
    expect(text()).not.toContain("server's clock");
  });

  it("says the read failed rather than showing an empty list", async () => {
    (window as unknown as { App: unknown }).App = {
      api: vi.fn(async () => { throw new Error("The youtube_outreach_targets table is not available"); }),
    };
    await mount();
    expect(text()).toContain("The outreach list could not be read: The youtube_outreach_targets table is not available");
    expect(text()).not.toContain("No target videos yet");
  });
});

describe("drafts and approval", () => {
  function draftCard(id: string): HTMLElement {
    const found = container!.querySelector(`article[data-comment-id="${id}"]`);
    if (!found) throw new Error(`no draft card ${id} in: ${text()}`);
    return found as HTMLElement;
  }

  async function writeDraftFor(id: string) {
    await click(button("Write a draft", row(id)));
  }

  it("names why the Approvals tab is empty", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await click(button("Approvals"));
    expect(text()).toContain("Nothing waiting for approval. Click Write a draft on a target video to make one.");
  });

  it("Write a draft puts the draft on the Approvals tab with the settings it followed", async () => {
    stores.proj_doe.targets = [target("abc", "First video", { commentLength: "short", objective: "appreciation" })];
    await mount();
    await writeDraftFor("abc");

    expect(requests.some((r) => r.method === "POST" && r.path === "/api/youtube-outreach/targets/abc/drafts")).toBe(true);
    const card = draftCard("c1");
    expect(card.textContent).toContain("First video");
    expect(card.textContent).toContain("Show appreciation · Short");
    expect(card.querySelector("textarea")!.value).toBe(nextDraft);
    expect(button("Approvals (1)")).toBeTruthy();
    expect(text()).not.toContain("Nothing waiting for approval");
  });

  it("edit then Approve saves the edited words, and it reads back approved after a reload", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await writeDraftFor("abc");
    type(draftCard("c1").querySelector("textarea")!, "My own edited wording for this comment.");
    await click(button("Approve", draftCard("c1")));

    expect(stores.proj_doe.comments[0].status).toBe("approved");
    expect(stores.proj_doe.comments[0].finalText).toBe("My own edited wording for this comment.");

    // Reload: a fresh mount reads only from the server.
    act(() => root?.unmount());
    container?.remove();
    await mount();
    await click(button("Approvals"));
    expect(draftCard("c1").textContent).toContain("Approved — waiting to post");
    expect(draftCard("c1").textContent).toContain("My own edited wording for this comment.");
    expect(draftCard("c1").querySelector("textarea")).toBeNull();
  });

  it("an Approve the server refuses shows the rule on the card and leaves it a draft", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await writeDraftFor("abc");
    type(draftCard("c1").querySelector("textarea")!, "See https://example.com");
    await click(button("Approve", draftCard("c1")));

    expect(draftCard("c1").textContent).toContain("Not approved: it contains a link, and this video's link setting is Never.");
    expect(stores.proj_doe.comments[0].status).toBe("draft");
    expect(draftCard("c1").querySelector("textarea")).not.toBeNull();
  });

  it("Reject takes it off the tab, and the video's History shows it rejected", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await writeDraftFor("abc");
    await click(button("Reject", draftCard("c1")));

    expect(container!.querySelector('article[data-comment-id="c1"]')).toBeNull();
    expect(text()).toContain("Nothing waiting for approval");

    await click(button("Target videos"));
    await click(button("History", row("abc")));
    const history = container!.querySelector("section.yt-outreach-history")!;
    expect(history.textContent).toContain("Rejected");
    expect(history.textContent).toContain(nextDraft);
  });

  it("Write another replaces the draft on the tab", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await writeDraftFor("abc");
    await click(button("Write another", draftCard("c1")));

    expect(container!.querySelector('article[data-comment-id="c1"]')).toBeNull();
    expect(draftCard("c2").querySelector("textarea")!.value).toBe(`${nextDraft} (again)`);
    expect(stores.proj_doe.comments.find((c) => c.id === "c1")!.status).toBe("rejected");
  });

  it("a refused draft says why on the list, and nothing appears to approve", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    nextDraft = "REFUSE:The draft broke a rule, so it was not kept: it contains a link (x.com), and this video's link setting is Never. Click Write a draft to try again.";
    await mount();
    await writeDraftFor("abc");
    expect(text()).toContain('No draft for "First video": The draft broke a rule, so it was not kept: it contains a link');
    await click(button("Approvals"));
    expect(container!.querySelector("article.yt-outreach-draft")).toBeNull();
  });

  it("shows each target's next draft, or why it is not due, under How often", async () => {
    stores.proj_doe.targets = [
      target("abc", "First video", { nextDraft: { due: false, finished: true, text: "Finished: posted 1 of 1" } }),
      target("def", "Second video", {
        repeatMode: "repeat", repeatEveryDays: 7, repeatMaxTimes: 3,
        nextDraft: { due: false, finished: false, text: "Next draft: Oct 14" },
      }),
      target("ghi", "Third video", { nextDraft: { due: false, finished: false, text: "Not due: waiting for your approval on the last draft" } }),
    ];
    await mount();
    expect(row("abc").querySelector(".yt-outreach-next-draft")?.textContent).toBe("Finished: posted 1 of 1");
    expect(row("def").textContent).toContain("Repeats every 7 days, up to 3 timesNext draft: Oct 14");
    expect(row("ghi").textContent).toContain("Not due: waiting for your approval on the last draft");
  });

  it("offers no Write a draft on a paused target", async () => {
    stores.proj_doe.targets = [target("abc", "First video", { status: "paused" })];
    await mount();
    expect([...row("abc").querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Write a draft");
  });

  it("drops the old project's drafts on a project switch", async () => {
    stores.proj_doe.targets = [target("abc", "First video")];
    await mount();
    await writeDraftFor("abc");
    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    await click(button("Approvals"));
    expect(container!.querySelector('article[data-comment-id="c1"]')).toBeNull();
    expect(text()).toContain("Nothing waiting for approval");
  });

  it("summarises the followed settings in words", () => {
    expect(followedSummary({
      objective: "drive_link", commentLength: "long", messageTypes: ["insight", "question"],
      linkPolicy: "allowed", linkUrl: "https://daneofearth.com", mentionPolicy: "subtle",
    })).toBe("Send people to a link · Long · Share an insight, Ask a question · Link: Allowed (https://daneofearth.com) · Mention: In passing");
  });
});

describe("form helpers", () => {
  it("blanks the fields whose mode is off", () => {
    const form = targetToForm(target("x", "X"));
    const patch = targetPatchFromForm({
      ...form,
      commentPlacement: "top_level",
      replyToCommentId: "UgxSomething",
      linkPolicy: "never",
      linkUrl: "https://example.com",
      repeatMode: "once",
      repeatEveryDays: "7",
    });
    expect(patch.replyToCommentId).toBe("");
    expect(patch.linkUrl).toBe("");
    expect(patch.repeatEveryDays).toBeNull();
  });

  it("keeps them when the mode is on", () => {
    const form = targetToForm(target("x", "X"));
    const patch = targetPatchFromForm({
      ...form,
      commentPlacement: "reply_specific",
      replyToCommentId: " UgxSomething ",
      linkPolicy: "if_natural",
      linkUrl: "https://example.com",
      repeatMode: "repeat",
      repeatEveryDays: "7",
      repeatMaxTimes: "3",
      repeatUntil: "",
    });
    expect(patch).toMatchObject({
      replyToCommentId: "UgxSomething",
      linkUrl: "https://example.com",
      repeatEveryDays: "7",
      repeatMaxTimes: "3",
      repeatUntil: null,
    });
  });

  it("splits avoid lists on lines and commas and drops blanks", () => {
    expect(splitList("a\n b ,c\n\n")).toEqual(["a", "b", "c"]);
    const patch = settingsPatchFromForm({ ...settingsToForm(defaults()), avoidChannels: "Spam TV\n" });
    expect(patch.avoidChannels).toEqual(["Spam TV"]);
  });

  it("adds https:// to a link pasted without it, and leaves a full link alone", () => {
    expect(withScheme("youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(withScheme(" www.youtube.com/watch?v=x ")).toBe("https://www.youtube.com/watch?v=x");
    expect(withScheme("http://youtube.com/watch?v=x")).toBe("http://youtube.com/watch?v=x");
    expect(withScheme("https://youtu.be/x")).toBe("https://youtu.be/x");
    expect(withScheme("")).toBe("");
  });

  it("describes repeats in words", () => {
    expect(repeatSummary({ repeatMode: "once", repeatEveryDays: null, repeatMaxTimes: null })).toBe("One-off");
    expect(repeatSummary({ repeatMode: "repeat", repeatEveryDays: 7, repeatMaxTimes: 3 })).toBe("Repeats every 7 days, up to 3 times");
  });
});
