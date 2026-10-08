// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubstackNotesPanel, {
  PROJECT_SWITCH_EVENT,
  plainError,
  settingsPatchFromForm,
  settingsToForm,
  splitItems,
  splitLines,
  statusLabel,
  withScheme,
  type NoteItem,
  type NotesSettings,
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

type Store = { items: NoteItem[]; settings: NotesSettings };
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
  it("opens on three tabs and says why each list is empty", async () => {
    await mount();
    const tabs = [...container!.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Ideas", "Engage", "Settings"]);
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
