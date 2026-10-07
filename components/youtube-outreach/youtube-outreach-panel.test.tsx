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

type Store = { targets: Target[]; settings: OutreachSettings };
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
    proj_doe: { targets: [], settings: defaults() },
    proj_delray: { targets: [target("delray1", "Delray serve clinic")], settings: defaults() },
  };
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
    expect(requests.filter((r) => r.project === "proj_delray" && r.method === "GET")).toHaveLength(2);
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

  it("describes repeats in words", () => {
    expect(repeatSummary({ repeatMode: "once", repeatEveryDays: null, repeatMaxTimes: null })).toBe("One-off");
    expect(repeatSummary({ repeatMode: "repeat", repeatEveryDays: 7, repeatMaxTimes: 3 })).toBe("Repeats every 7 days, up to 3 times");
  });
});
