// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubstackNotesPanel, {
  PROJECT_SWITCH_EVENT,
  plainError,
  settingsPatchFromForm,
  settingsToForm,
  latestMessage,
  splitItems,
  splitLines,
  statusLabel,
  timeAgo,
  watchLines,
  withScheme,
  type NoteItem,
  type NotesSettings,
  type WatchStatus,
} from "./substack-notes-panel";

/**
 * Substack Notes 2/7 (86bcet6g7). The screen is driven against a fake
 * /api/engage/substack-notes that keeps one store PER PROJECT, so "still
 * showing the old client's rows" after a switch is distinguishable from
 * "empty", and every save is read back from the fake's store — a remount is
 * the reload — rather than from the screen's own state.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE_PATH_RE = /^\/(?:@[A-Za-z0-9_.-]+\/)?note\/c-\d+\/?$/;

function defaults(): NotesSettings {
  return {
    accountKey: "dane_of_earth",
    substackUrl: "",
    youtubeChannelId: "",
    maxActionsPerDay: 3,
    minMinutesBetween: 90,
    jitterMinutes: 30,
    activeStartHour: 8,
    activeEndHour: 22,
    timeZone: "",
    voice: "",
    topics: [],
    avoidWords: [],
    linkPolicy: "if_natural",
    saved: false,
    updatedAt: "",
  };
}

let seq = 0;
function item(overrides: Partial<NoteItem>): NoteItem {
  seq += 1;
  return {
    id: `i${seq}`,
    accountKey: "dane_of_earth",
    kind: "note",
    source: "jotted",
    ideaText: "",
    contentUrl: "",
    contentTitle: "",
    targetUrl: "",
    targetText: "",
    draftText: "",
    finalText: "",
    status: "idea",
    postedUrl: "",
    error: "",
    createdAt: "2026-10-08T12:00:00Z",
    updatedAt: "2026-10-08T12:00:00Z",
    ...overrides,
  };
}

type Store = { items: NoteItem[]; settings: NotesSettings; watch?: WatchStatus; latest?: Record<string, any> };

/** What the server's watch-status says when nothing has been checked yet (lib/substackNotesContentWatch.js describeWatch). */
function watchFor(settings: NotesSettings): WatchStatus {
  const off = (key: string, label: string, reason: string) => ({ key, label, watched: false, ok: false, reason, checkedAt: "", since: "", baselineCount: 0 });
  const fresh = (key: string, label: string) => ({ key, label, watched: true, ok: null, reason: "not checked yet", checkedAt: "", since: "", baselineCount: 0 });
  return {
    saved: settings.saved,
    setUp: null,
    checkedAt: "",
    lastPass: null,
    sources: [
      settings.youtubeChannelId ? fresh("youtube", "YouTube") : off("youtube", "YouTube", "no YouTube channel saved in Settings"),
      settings.substackUrl ? fresh("substack", "Substack") : off("substack", "Substack", "no Substack address saved in Settings"),
      fresh("blog", "Blog"),
    ],
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

/** The store's own Note-link rule (lib/substackNotesStore.js noteUrlOrError), in its own words. */
function checkNoteUrl(text: string): string {
  let url: URL | null;
  try { url = new URL(text); } catch { url = null; }
  if (!url || url.hostname !== "substack.com") {
    fail(`targetUrl must be a link to a Note on substack.com (for example https://substack.com/@name/note/c-12345) — got ${JSON.stringify(text)}`);
  }
  if (!NOTE_PATH_RE.test(url.pathname)) fail(`targetUrl is a substack.com link but not to a Note — got ${JSON.stringify(text)}`);
  return text;
}

async function fakeApi(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(String(options.body)) : null;
  const project = activeProject;
  requests.push({ method, path, body, project });
  const store = stores[project];
  if (path === "/api/engage/substack-notes/items" && method === "GET") return { ok: true, data: store.items.map((i) => ({ ...i })) };
  if (path === "/api/engage/substack-notes/settings" && method === "GET") return { ok: true, data: { ...store.settings } };
  if (path === "/api/engage/substack-notes/watch-status" && method === "GET") return { ok: true, data: store.watch || watchFor(store.settings) };
  if (path === "/api/engage/substack-notes/watch-content/latest" && method === "POST") {
    if (!store.latest) fail("Nothing is saved in Substack Notes Settings for this account yet, so there is nothing to watch. Save the settings first.");
    if (store.latest.latestItem && store.latest.latest?.status === "draft") store.items = [store.latest.latestItem, ...store.items];
    return { ok: true, data: store.latest };
  }
  if (path === "/api/engage/substack-notes/items" && method === "POST") {
    if (body.source === "target") checkNoteUrl(body.targetUrl);
    if (body.source !== "target" && !body.ideaText) fail(`ideaText is required when source is ${body.source}`);
    const made = item({ kind: body.kind, source: body.source, ideaText: body.ideaText || "", targetUrl: body.targetUrl || "" });
    store.items = [made, ...store.items];
    return { ok: true, data: { ...made } };
  }
  if (path === "/api/engage/substack-notes/settings" && method === "PUT") {
    if (Number(body.activeStartHour) >= Number(body.activeEndHour)) {
      fail(`activeStartHour (${body.activeStartHour}) must be earlier than activeEndHour (${body.activeEndHour})`);
    }
    store.settings = {
      ...store.settings,
      ...body,
      maxActionsPerDay: Number(body.maxActionsPerDay),
      saved: true,
      updatedAt: `2026-10-08T12:00:0${requests.length % 10}Z`,
    };
    return { ok: true, data: { ...store.settings } };
  }
  const decision = path.match(/^\/api\/engage\/substack-notes\/items\/([^/]+)\/(draft|approve|reject)$/);
  if (decision && method === "POST") {
    const found = store.items.find((i) => i.id === decision[1]) || fail("Item not found in this project");
    if (decision[2] === "draft") {
      found.draftText = `Draft about: ${found.ideaText || found.targetUrl}`;
      found.status = "draft";
    } else if (decision[2] === "approve") {
      const words = body?.text ?? found.draftText;
      // The server's avoid-list rule, in its own words (lib/substackNotesDrafter.js checkNoteText).
      const avoided = store.settings.avoidWords.filter((w) => words && new RegExp(`\\b${w}\\b`, "i").test(words));
      if (avoided.length) fail(`Not approved: it uses "${avoided[0]}", which is on the account's words-to-avoid list.`);
      found.finalText = words || "";
      found.status = "approved";
    } else {
      found.status = "rejected";
    }
    found.updatedAt = `2026-10-08T12:00:${String(requests.length).padStart(2, "0")}Z`;
    return { ok: true, data: { ...found } };
  }
  const one = path.match(/^\/api\/engage\/substack-notes\/items\/([^/]+)$/);
  if (one) {
    const found = store.items.find((i) => i.id === one[1]) || fail("Item not found in this project");
    if (method === "PATCH") {
      Object.assign(found, body);
      return { ok: true, data: { ...found } };
    }
    if (method === "DELETE") {
      store.items = store.items.filter((i) => i.id !== found.id);
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
  await act(async () => { root!.render(<SubstackNotesPanel />); });
  await flush();
}

/** A reload: throw the screen away and read everything from the store again. */
async function reload() {
  act(() => root?.unmount());
  container?.remove();
  await mount();
}

function text(): string {
  return container?.textContent || "";
}

function button(label: string, scope: ParentNode = container!): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(label));
  if (!found) throw new Error(`no button "${label}" in: ${text()}`);
  return found as HTMLButtonElement;
}

function row(id: string): HTMLTableRowElement {
  const found = container!.querySelector(`tr[data-item-id="${id}"]`);
  if (!found) throw new Error(`no row ${id} in: ${text()}`);
  return found as HTMLTableRowElement;
}

function el<T extends Element>(selector: string): T {
  const found = container!.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector} in: ${text()}`);
  return found;
}

/** Set a controlled input's value the way React's onChange sees it. */
function type(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(target);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(target, value);
    target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function click(target: HTMLElement) {
  await act(async () => { target.click(); });
  await flush();
}

async function submit(form: HTMLFormElement) {
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}

beforeEach(() => {
  seq = 0;
  stores = {
    proj_doe: { items: [], settings: defaults() },
    proj_delray: {
      items: [item({ ideaText: "Delray only: clinic recap" })],
      settings: { ...defaults(), maxActionsPerDay: 9, saved: true, updatedAt: "2026-10-01T00:00:00Z" },
    },
  };
  activeProject = "proj_doe";
  requests = [];
  (window as unknown as { App: unknown }).App = { api: vi.fn(fakeApi) };
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

describe("Substack Notes screen", () => {
  it("opens on four tabs and says why each list is empty", async () => {
    await mount();
    const tabs = [...container!.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Ideas", "Engage", "Approvals", "Settings"]);
    expect(text()).toContain("No ideas yet. Type one above and click Add.");
    expect(text()).toContain("No topics yet.");
    await click(button("Engage"));
    expect(text()).toContain("No Notes to engage with yet. Paste a Substack Note link above.");
  });

  it("adds an idea, edits it, and shows the edited text after a reload", async () => {
    await mount();
    type(el<HTMLTextAreaElement>("#sn-idea"), "Why the stars feel closer in winter");
    await submit(el<HTMLFormElement>("form.substack-notes-add"));
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ kind: "note", source: "jotted", ideaText: "Why the stars feel closer in winter" });
    const id = stores.proj_doe.items[0].id;
    expect(row(id).textContent).toContain("Why the stars feel closer in winter");

    await click(button("Edit", row(id)));
    type(el<HTMLTextAreaElement>(`#sn-edit-${id}`), "Why winter stars look sharper");
    await submit(el<HTMLFormElement>("form.substack-notes-row-editor"));
    expect(stores.proj_doe.items[0].ideaText).toBe("Why winter stars look sharper");

    await reload();
    expect(row(id).textContent).toContain("Why winter stars look sharper");
    expect(text()).not.toContain("Why the stars feel closer in winter");
  });

  it("deletes an idea from the server, not just the screen", async () => {
    stores.proj_doe.items = [item({ ideaText: "Delete me" })];
    await mount();
    await click(button("Delete", row(stores.proj_doe.items[0].id)));
    expect(stores.proj_doe.items).toEqual([]);
    expect(text()).toContain("No ideas yet.");
  });

  it("turns a topic from the settings into an idea with source topic", async () => {
    stores.proj_doe.settings = { ...defaults(), topics: ["Night skies", "Making music"], saved: true, updatedAt: "x" };
    await mount();
    await click(button("Use this topic", [...container!.querySelectorAll(".substack-notes-topic-list li")][1]));
    expect(stores.proj_doe.items[0]).toMatchObject({ kind: "note", source: "topic", ideaText: "Making music" });
    expect(row(stores.proj_doe.items[0].id).textContent).toContain("From a topic");
  });

  it("adds Reply, Restack and Like and shows each choice after a reload", async () => {
    await mount();
    await click(button("Engage"));
    const add = async (kind: string, link: string, rough = "") => {
      await click(el<HTMLInputElement>(`#sn-engage-${kind}`));
      type(el<HTMLInputElement>("#sn-note-url"), link);
      if (rough) type(el<HTMLTextAreaElement>("#sn-reply-text"), rough);
      await submit(el<HTMLFormElement>("form.substack-notes-engage-add"));
    };
    await add("reply", "https://substack.com/@someone/note/c-101", "Agree, and add the winter angle");
    await add("restack", "https://substack.com/@someone/note/c-102");
    await add("like", "substack.com/@someone/note/c-103");

    expect(stores.proj_doe.items.map((i) => [i.kind, i.targetUrl, i.ideaText])).toEqual([
      ["like", "https://substack.com/@someone/note/c-103", ""],
      ["restack", "https://substack.com/@someone/note/c-102", ""],
      ["reply", "https://substack.com/@someone/note/c-101", "Agree, and add the winter angle"],
    ]);

    await reload();
    await click(button("Engage"));
    const [like, restack, reply] = stores.proj_doe.items;
    expect(row(reply.id).textContent).toContain("Reply");
    expect(row(reply.id).textContent).toContain("Agree, and add the winter angle");
    expect(row(restack.id).textContent).toContain("Restack");
    expect(row(like.id).textContent).toContain("Like");
    expect(row(like.id).textContent).toContain("Waiting for approval");
    // Ideas are Notes of his own; nothing from the Engage tab leaks into them.
    await click(button("Ideas"));
    expect(text()).toContain("No ideas yet.");
  });

  it("refuses a link that is not a Note and says why, in plain words", async () => {
    await mount();
    await click(button("Engage"));
    await click(el<HTMLInputElement>("#sn-engage-like"));
    type(el<HTMLInputElement>("#sn-note-url"), "https://example.com");
    await submit(el<HTMLFormElement>("form.substack-notes-engage-add"));
    expect(stores.proj_doe.items).toEqual([]);
    expect(text()).toContain("Not added: The link must be a link to a Note on substack.com");
    expect(text()).not.toContain("targetUrl");
    expect(el<HTMLInputElement>("#sn-note-url").value).toBe("https://example.com");
  });

  it("saves settings that survive a reload", async () => {
    await mount();
    await click(button("Settings"));
    expect(text()).toContain("Nothing has been saved for this account yet");
    type(el<HTMLInputElement>("#sn-max-per-day"), "2");
    type(el<HTMLTextAreaElement>("#sn-topics"), "Night skies\nMaking music, slowly\n\n");
    await submit(el<HTMLFormElement>("form.substack-notes-settings"));
    expect(stores.proj_doe.settings.maxActionsPerDay).toBe(2);
    expect(stores.proj_doe.settings.topics).toEqual(["Night skies", "Making music, slowly"]);

    await reload();
    await click(button("Settings"));
    expect(el<HTMLInputElement>("#sn-max-per-day").value).toBe("2");
    expect(text()).not.toContain("Nothing has been saved");
  });

  it("shows the server's refusal when the settings do not save", async () => {
    await mount();
    await click(button("Settings"));
    type(el<HTMLInputElement>("#sn-start-hour"), "23");
    type(el<HTMLInputElement>("#sn-end-hour"), "9");
    await submit(el<HTMLFormElement>("form.substack-notes-settings"));
    expect(text()).toContain("Not saved: Active from (23) must be earlier than Active until (9)");
    expect(stores.proj_doe.settings.saved).toBe(false);
  });

  it("shows the new project's rows and settings after a switch, not this one's", async () => {
    stores.proj_doe.items = [item({ ideaText: "Dane of Earth idea" })];
    await mount();
    expect(text()).toContain("Dane of Earth idea");

    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    expect(text()).toContain("Delray only: clinic recap");
    expect(text()).not.toContain("Dane of Earth idea");
    await click(button("Settings"));
    expect(el<HTMLInputElement>("#sn-max-per-day").value).toBe("9");
  });

  it("drops an add answered after a project switch", async () => {
    await mount();
    let release: () => void = () => {};
    const api = (window as unknown as { App: { api: ReturnType<typeof vi.fn> } }).App.api;
    api.mockImplementationOnce(async (path: string, options: RequestInit) => {
      // Saved under Dane of Earth at once; the ANSWER arrives after the switch.
      const answer = fakeApi(path, options);
      await new Promise<void>((resolve) => { release = resolve; });
      return answer;
    });
    type(el<HTMLTextAreaElement>("#sn-idea"), "Late idea");
    await act(async () => { el<HTMLFormElement>("form.substack-notes-add").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    await act(async () => { release(); });
    await flush();
    expect(stores.proj_doe.items.map((i) => i.ideaText)).toEqual(["Late idea"]);
    expect(text()).toContain("Delray only: clinic recap");
    expect(text()).not.toContain("Late idea");
    expect(text()).not.toContain("Idea added.");
  });

  it("names which read failed", async () => {
    const api = (window as unknown as { App: { api: ReturnType<typeof vi.fn> } }).App.api;
    api.mockImplementation(async (path: string, options: RequestInit) => {
      if (path.endsWith("/settings")) throw new Error("table missing");
      return fakeApi(path, options);
    });
    await mount();
    expect(text()).toContain("The settings could not be read: table missing");
    expect(text()).not.toContain("The ideas and Notes could not be read");
    expect(text()).toContain("No ideas yet.");
  });
});

describe("Substack Notes approvals (3/7)", () => {
  it("says why Approvals is empty", async () => {
    await mount();
    await click(button("Approvals"));
    expect(text()).toContain("Nothing waiting for approval. Click Write a draft on an idea, or add a Note to engage with.");
  });

  it("writes a draft from an idea; an edit then Approve reads approved with the edited text after a reload", async () => {
    stores.proj_doe.items = [item({ ideaText: "Why the stars feel closer in winter" })];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Write a draft", row(id)));
    expect(requests.some((r) => r.method === "POST" && r.path.endsWith(`/items/${id}/draft`))).toBe(true);
    expect(text()).toContain("A draft Note is waiting on the Approvals tab.");

    await click(button("Approvals"));
    const box = el<HTMLTextAreaElement>(`#sn-draft-${id}`);
    expect(box.value).toBe("Draft about: Why the stars feel closer in winter");
    type(box, "Winter stars look closer because the air is drier.");
    await click(button("Approve", el(`article[data-item-id="${id}"]`)));
    expect(stores.proj_doe.items[0]).toMatchObject({ status: "approved", finalText: "Winter stars look closer because the air is drier." });

    await reload();
    expect(row(id).textContent).toContain("Approved — waiting to post");
    expect(row(id).querySelector(".substack-notes-words")?.textContent).toBe("Will post: Winter stars look closer because the air is drier.");
    await click(button("Approvals"));
    expect(container!.querySelector(`article[data-item-id="${id}"]`)).toBeNull();
  });

  it("shows a Like on Approvals with just Approve and Reject, and no text box", async () => {
    stores.proj_doe.items = [item({ kind: "like", source: "target", targetUrl: "https://substack.com/@a/note/c-9" })];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Approvals (1)"));
    const card = el<HTMLElement>(`article[data-item-id="${id}"]`);
    expect(card.querySelector("textarea")).toBeNull();
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Reject", "Approve"]);
    await click(button("Approve", card));
    expect(requests.find((r) => r.path.endsWith("/approve"))?.body).toEqual({});
    expect(stores.proj_doe.items[0].status).toBe("approved");
  });

  it("Reject takes it off Approvals and leaves its row marked Rejected", async () => {
    stores.proj_doe.items = [item({ ideaText: "Night music", status: "draft", draftText: "Some words" })];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Approvals"));
    await click(button("Reject", el(`article[data-item-id="${id}"]`)));
    expect(stores.proj_doe.items[0].status).toBe("rejected");
    expect(container!.querySelector(`article[data-item-id="${id}"]`)).toBeNull();
    await click(button("Ideas"));
    expect(row(id).textContent).toContain("Rejected");
    expect(row(id).querySelector(".substack-notes-words")?.textContent).toBe("Rejected draft: Some words");
  });

  it("shows an approved reply's words on its Engage row, and nothing for a like", async () => {
    stores.proj_doe.items = [
      item({ kind: "reply", source: "target", targetUrl: "https://substack.com/@a/note/c-1", status: "approved", draftText: "First go", finalText: "Edited reply" }),
      item({ kind: "like", source: "target", targetUrl: "https://substack.com/@a/note/c-2", status: "approved" }),
    ];
    const [reply, like] = stores.proj_doe.items.map((i) => i.id);
    await mount();
    await click(button("Engage"));
    expect(row(reply).querySelector(".substack-notes-words")?.textContent).toBe("Will post: Edited reply");
    expect(row(like).querySelector(".substack-notes-words")).toBeNull();
  });

  it("shows the server's reason when an edit breaks a rule, and the draft stays waiting", async () => {
    stores.proj_doe.settings = { ...defaults(), avoidWords: ["synergy"], saved: true, updatedAt: "x" };
    stores.proj_doe.items = [item({ ideaText: "Teams", status: "draft", draftText: "Good words" })];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Approvals"));
    type(el<HTMLTextAreaElement>(`#sn-draft-${id}`), "Pure synergy");
    await click(button("Approve", el(`article[data-item-id="${id}"]`)));
    expect(text()).toContain("which is on the account's words-to-avoid list");
    expect(text()).not.toContain("Not approved: Not approved");
    expect(stores.proj_doe.items[0].status).toBe("draft");
    expect(el(`article[data-item-id="${id}"]`)).toBeTruthy();
  });

  it("lets Dane paste the text of the Note a reply answers", async () => {
    stores.proj_doe.items = [item({ kind: "reply", source: "target", targetUrl: "https://substack.com/@a/note/c-9" })];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Engage"));
    expect(row(id).textContent).toContain("Their Note: not read yet");
    await click(button("Paste their Note", row(id)));
    type(el<HTMLTextAreaElement>(`#sn-edit-${id}`), "Winter is the best season for stargazing.");
    await submit(el<HTMLFormElement>("form.substack-notes-row-editor"));
    expect(stores.proj_doe.items[0].targetText).toBe("Winter is the best season for stargazing.");
    expect(stores.proj_doe.items[0].ideaText).toBe("");
  });
});

describe("Substack Notes helpers", () => {
  it("adds https:// to a pasted link without one", () => {
    expect(withScheme("substack.com/@a/note/c-1")).toBe("https://substack.com/@a/note/c-1");
    expect(withScheme("https://substack.com/@a/note/c-1")).toBe("https://substack.com/@a/note/c-1");
    expect(withScheme("  ")).toBe("");
  });

  it("splits lists by line only, so a topic may hold a comma", () => {
    expect(splitLines("a, b\n\n c \n")).toEqual(["a, b", "c"]);
  });

  it("round-trips the settings form", () => {
    const s = { ...defaults(), topics: ["x", "y"], avoidWords: ["z"], substackUrl: "daneofearth.substack.com" };
    const patch = settingsPatchFromForm(settingsToForm(s));
    expect(patch).toMatchObject({ topics: ["x", "y"], avoidWords: ["z"], maxActionsPerDay: "3", linkPolicy: "if_natural", substackUrl: "https://daneofearth.substack.com" });
  });

  it("puts Notes on the Ideas tab and everything else on Engage", () => {
    const { ideas, engage } = splitItems([item({ kind: "note" }), item({ kind: "reply" }), item({ kind: "like" })]);
    expect(ideas.map((i) => i.kind)).toEqual(["note"]);
    expect(engage.map((i) => i.kind)).toEqual(["reply", "like"]);
  });

  it("says a like waits for approval, a Note waits to be drafted", () => {
    expect(statusLabel({ kind: "like", status: "idea" })).toBe("Waiting for approval");
    expect(statusLabel({ kind: "note", status: "idea" })).toBe("Waiting to be drafted");
  });

  it("swaps code field names for the labels on screen", () => {
    expect(plainError("maxActionsPerDay must be between 0 and 50")).toBe("Most actions per day must be between 0 and 50");
  });
});

describe("Substack Notes new-content watch (4/7)", () => {
  const NOW = Date.parse("2026-10-09T18:00:00Z");

  function watching(overrides: Partial<WatchStatus> = {}): WatchStatus {
    return {
      saved: true,
      setUp: true,
      checkedAt: new Date(NOW - 9 * 60000).toISOString(),
      lastPass: null,
      sources: [
        { key: "youtube", label: "YouTube", watched: true, ok: true, reason: "", checkedAt: "", since: "2026-10-01T00:00:00Z", baselineCount: 15 },
        { key: "substack", label: "Substack", watched: true, ok: true, reason: "", checkedAt: "", since: "2026-10-01T00:00:00Z", baselineCount: 1 },
        { key: "blog", label: "Blog", watched: true, ok: true, reason: "", checkedAt: "", since: "2026-10-01T00:00:00Z", baselineCount: 0 },
      ],
      ...overrides,
    };
  }

  it("says what it watches and when it last checked, and how much was already out when it began", () => {
    const lines = watchLines(watching(), NOW);
    expect(lines.summary).toBe("Watching: YouTube ✓, Substack ✓, Blog ✓ (last checked 9 minutes ago)");
    expect(lines.details.join(" ")).toContain("recorded as seen and not drafted: YouTube 15, Substack 1, Blog 0");
  });

  it("names the reason a source is not watched, or could not be read", () => {
    const status = watching();
    status.sources[1] = { ...status.sources[1], watched: false, ok: false, reason: "no Substack address saved in Settings", since: "" };
    status.sources[0] = { ...status.sources[0], ok: false, reason: "YouTube's feed for this channel answered 404" };
    const lines = watchLines(status, NOW);
    expect(lines.summary).toBe("Watching: YouTube ✗, Substack off, Blog ✓ (last checked 9 minutes ago)");
    expect(lines.details).toContain("Substack: not watched — no Substack address saved in Settings.");
    expect(lines.details).toContain("YouTube: could not be read last time — YouTube's feed for this channel answered 404.");
  });

  it("says when it has not checked yet, when the database is not set up, and when Settings are not saved", () => {
    expect(watchLines(watching({ checkedAt: "" }), NOW).summary).toContain("not checked yet — the first check runs within 15 minutes");
    expect(watchLines(watching({ setUp: false }), NOW).details[0]).toContain("substack_notes_content_unique.sql");
    expect(watchLines(watching({ saved: false }), NOW).summary).toContain("save the Settings tab first");
  });

  it("says when new pieces are waiting for room under the daily maximum", () => {
    const lines = watchLines(watching({ lastPass: { waitingForRoom: 2 } }), NOW);
    expect(lines.details).toContain("2 new pieces are waiting for room under the daily maximum, and will be drafted on a later check.");
  });

  it("shows the watch line on the Ideas tab, with the reason for a source that is off", async () => {
    stores.proj_doe.settings = { ...defaults(), youtubeChannelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw", saved: true, updatedAt: "x" };
    await mount();
    const card = el<HTMLElement>(".substack-notes-watch");
    expect(card.textContent).toContain("Watching: YouTube not checked yet, Substack off, Blog not checked yet");
    expect(card.textContent).toContain("Substack: not watched — no Substack address saved in Settings.");
  });

  it("says which read failed when the watch line cannot be read, without hiding the rest of the screen", async () => {
    const api = (window as unknown as { App: { api: ReturnType<typeof vi.fn> } }).App.api;
    api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/api/engage/substack-notes/watch-status") throw new Error("Service unavailable");
      return fakeApi(path, options);
    });
    await mount();
    expect(el<HTMLElement>(".substack-notes-watch").textContent).toContain("What is being watched for new content could not be read: Service unavailable");
    expect(text()).toContain("No ideas yet.");
  });

  it("Draft a Note for my latest piece: posts, says what it did, and the draft is on Approvals after the reload", async () => {
    stores.proj_doe.settings = { ...defaults(), youtubeChannelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw", saved: true, updatedAt: "x" };
    const made = item({ source: "new_content", contentUrl: "https://www.youtube.com/watch?v=7sKHiuE7J-Y", contentTitle: "Robotics with Gemini", draftText: "New video out.", status: "draft" });
    stores.proj_doe.latest = { latest: { status: "draft", entry: { url: made.contentUrl, title: made.contentTitle } }, latestItem: made, notDrafted: [], failed: [] };
    await mount();
    await click(button("Settings"));
    await click(button("Draft a Note for my latest piece"));
    expect(requests.some((r) => r.method === "POST" && r.path === "/api/engage/substack-notes/watch-content/latest")).toBe(true);
    expect(text()).toContain('A draft Note about "Robotics with Gemini" is waiting on the Approvals tab.');
    await click(button("Approvals"));
    expect(text()).toContain("New content: Robotics with Gemini");
  });

  it("the latest-piece button waits for saved Settings", async () => {
    await mount();
    await click(button("Settings"));
    expect(button("Draft a Note for my latest piece").disabled).toBe(true);
    expect(text()).toContain("Save the settings above first");
  });

  it("says plainly when the latest piece already has a Note, or nothing was found", () => {
    const made = item({ source: "new_content", contentTitle: "Old video", status: "approved" });
    expect(latestMessage({ latest: { status: "exists", entry: { title: "Old video" } }, latestItem: made }))
      .toBe('Your latest piece, "Old video", already has a Note (approved — waiting to post), so no second one was made.');
    expect(latestMessage({ latest: { status: "none" }, watch: { sources: [{ key: "blog", label: "Blog", watched: false, ok: false, reason: "the site has no blog post page" }] } }))
      .toBe("No video, article or post was found to draft from (Blog: the site has no blog post page).");
  });

  it("reads elapsed time the way a person says it", () => {
    expect(timeAgo(new Date(NOW - 20000).toISOString(), NOW)).toBe("just now");
    expect(timeAgo(new Date(NOW - 60000).toISOString(), NOW)).toBe("1 minute ago");
    expect(timeAgo(new Date(NOW - 3 * 3600000).toISOString(), NOW)).toBe("3 hours ago");
    expect(timeAgo(new Date(NOW - 3 * 86400000).toISOString(), NOW)).toBe("3 days ago");
    expect(timeAgo("", NOW)).toBe("");
  });
});
