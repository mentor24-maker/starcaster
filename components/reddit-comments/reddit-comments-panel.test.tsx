// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RedditCommentsPanel, {
  PROJECT_SWITCH_EVENT,
  canonLine,
  canonName,
  isCommentLink,
  paceLine,
  postPreview,
  signInLine,
  tabFor,
  withScheme,
  type RedditItem,
} from "./reddit-comments-panel";

/**
 * Reddit comments 3/4 (86bch3jp7). The screen is driven against a fake
 * /api/engage/reddit-comments that keeps one store PER PROJECT, so "still
 * showing the old client's rows" after a switch is distinguishable from
 * "empty", and every save is read back from the fake's store — a remount is
 * the reload — rather than from the screen's own state. The fake refuses the
 * way lib/redditCommentsStore.js does: Reddit's read refused (409
 * POST_TEXT_NEEDED) and a blocklisted phrase on approve (422).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CANON = [
  { docKey: "DANE-OF-EARTH", syncedAt: "2026-10-12T15:00:00Z" },
  { docKey: "VOICE", syncedAt: "2026-10-12T15:00:00Z" },
  { docKey: "DEO", syncedAt: "2026-10-11T15:00:00Z" },
  { docKey: "ECOSYSTEM", syncedAt: "2026-10-12T15:00:00Z" },
];
const BLOCKED = "delve into";
const PACE = { maxCommentsPerDay: 3, minMinutesBetween: 20, jitterMinutes: 10 };
const POST_LINK = "https://www.reddit.com/r/astronomy/comments/abc123/why_stars_twinkle/";

type Store = { items: RedditItem[]; readable: boolean; status?: Record<string, any> | "unreadable"; dropOne?: boolean };
let stores: Record<string, Store>;
let activeProject = "proj_doe";
let requests: Array<{ method: string; path: string; body: any }>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;
let seq = 0;
let drafts = 0;

function item(overrides: Partial<RedditItem>): RedditItem {
  seq += 1;
  return {
    id: `r${seq}`,
    targetUrl: POST_LINK,
    postId: "abc123",
    parentCommentId: "",
    subreddit: "astronomy",
    postTitle: "Why do stars twinkle?",
    postBody: "I always wondered.\nIs it the air?",
    postAuthor: "someone",
    parentCommentAuthor: "",
    parentCommentText: "",
    postReadFrom: "reddit",
    draftText: "",
    finalText: "",
    canonUsed: [],
    status: "idea",
    approvedAt: null,
    postedUrl: "",
    screenshotUrl: "",
    postedAt: null,
    error: "",
    createdAt: "2026-10-12T12:00:00Z",
    updatedAt: "2026-10-12T12:00:00Z",
    ...overrides,
  };
}

function fail(message: string, status = 400, code = ""): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

async function fakeApi(path: string, options: RequestInit = {}): Promise<Record<string, any>> {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(String(options.body)) : undefined;
  requests.push({ method, path, body });
  const store = stores[activeProject];

  if (path === "/api/engage/reddit-comments/items") {
    if (method === "GET") return { ok: true, data: store.items.map((i) => ({ ...i })) };
    if (method === "POST") {
      if (!/reddit\.com\/r\//.test(body.url)) fail(`${body.url} is not a Reddit link — it should start https://www.reddit.com/r/…`);
      const pasted = body.postTitle || body.postBody;
      if (!pasted && !store.readable) {
        fail("The post could not be read from Reddit: Reddit refused the read (403). Paste the post's title and text, then Add again.", 409, "POST_TEXT_NEEDED");
      }
      const made = item(pasted
        ? { targetUrl: body.url, postTitle: body.postTitle || "", postBody: body.postBody || "", postReadFrom: "pasted" }
        : { targetUrl: body.url });
      store.items.unshift(made);
      return { ok: true, data: { ...made } };
    }
  }
  if (path === "/api/engage/reddit-comments/status") {
    if (store.status === "unreadable") fail("status endpoint down", 502);
    return { ok: true, data: store.status || { account: "", pace: PACE, browserCheck: { state: "", message: "", checkedAt: null, signedInAt: null }, browserCheckError: "" } };
  }
  const decision = path.match(/^\/api\/engage\/reddit-comments\/items\/([^/]+)\/(draft|approve|reject)$/);
  if (decision) {
    const found = store.items.find((i) => i.id === decision[1]) || fail("Reddit comment not found in this project", 404);
    if (decision[2] === "draft") {
      drafts += 1;
      // Three options, the way lib/draftOptions.js stores them (9/19). With
      // `dropOne` the second broke a rule twice and was dropped, words unkept.
      const draftOptions = [
        { angle: "adds a personal story", text: `The air bends the light, draft ${drafts}.`, rule: { ok: true } },
        store.dropOne
          ? { angle: "asks a question back", dropped: true, rule: { ok: false, reason: "it names Dane of Earth, and a drafted comment may never mention Dane's own projects" } }
          : { angle: "asks a question back", text: `Have you watched a star near the horizon, draft ${drafts}?`, rule: { ok: true } },
        { angle: "offers a resource", text: `Look up atmospheric seeing, draft ${drafts}.`, rule: { ok: true } },
      ];
      Object.assign(found, {
        status: "draft", draftText: draftOptions[0].text!, draftOptions, chosenOption: null, finalText: "", canonUsed: CANON,
        updatedAt: `2026-10-12T12:00:0${drafts}Z`,
      });
    } else if (decision[2] === "approve") {
      const text = body.text ?? found.draftText;
      if (text.toLowerCase().includes(BLOCKED)) {
        fail(`Not approved: it uses "${BLOCKED}", which is on the AI-ism blocklist.`, 422, "RULE_BROKEN");
      }
      Object.assign(found, { status: "approved", finalText: text, chosenOption: body.option ?? null });
    } else {
      found.status = "rejected";
    }
    return { ok: true, data: { ...found } };
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
  await act(async () => { root!.render(<RedditCommentsPanel />); });
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

function row(id: string): HTMLElement {
  const found = container!.querySelector(`[data-item-id="${id}"]`);
  if (!found) throw new Error(`no row ${id} in: ${text()}`);
  return found as HTMLElement;
}

function el<T extends Element>(selector: string): T {
  const found = container!.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector} in: ${text()}`);
  return found;
}

/** Set a controlled input's value the way React's onChange sees it. */
function type(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")!.set!;
  act(() => {
    setter.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
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

async function addLink(link: string) {
  type(el<HTMLInputElement>("#rc-link"), link);
  await submit(el<HTMLFormElement>("form.reddit-comments-add"));
}

beforeEach(() => {
  seq = 0;
  drafts = 0;
  stores = {
    proj_doe: { items: [], readable: true },
    proj_delray: { items: [item({ postTitle: "Delray only: best tennis drills", subreddit: "tennis" })], readable: true },
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

describe("Reddit comments screen", () => {
  it("opens on three tabs and says why each one is empty", async () => {
    await mount();
    const tabs = [...container!.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["To write", "Approvals", "Posted"]);
    expect(text()).toContain("No Reddit posts added yet — paste a link above.");
    await click(button("Approvals"));
    expect(text()).toContain("No drafts yet — paste a Reddit link above, then click Write with AI on it.");
    await click(button("Posted"));
    expect(text()).toContain("Nothing posted yet");
  });

  it("adds a link and shows the subreddit, title, first lines and a Reddit link", async () => {
    await mount();
    await addLink("www.reddit.com/r/astronomy/comments/abc123/why_stars_twinkle/");
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ url: POST_LINK });
    const id = stores.proj_doe.items[0].id;
    expect(row(id).textContent).toContain("r/astronomy");
    expect(row(id).textContent).toContain("Why do stars twinkle?");
    expect(row(id).textContent).toContain("Is it the air?");
    expect(row(id).querySelector("a")?.getAttribute("href")).toBe(POST_LINK);
    expect(el<HTMLInputElement>("#rc-link").value).toBe("");
  });

  it("when Reddit refuses the read, says why and saves the post pasted by hand", async () => {
    stores.proj_doe.readable = false;
    await mount();
    await addLink(POST_LINK);
    expect(stores.proj_doe.items).toEqual([]);
    expect(text()).toContain("The post could not be read from Reddit: Reddit refused the read (403).");
    expect(el<HTMLInputElement>("#rc-link").value).toBe(POST_LINK);

    type(el<HTMLInputElement>("#rc-paste-title"), "Why do stars twinkle?");
    type(el<HTMLTextAreaElement>("#rc-paste-body"), "Pasted body");
    await submit(el<HTMLFormElement>("form.reddit-comments-add"));
    expect(requests.filter((r) => r.method === "POST").pop()?.body).toEqual({
      url: POST_LINK, postTitle: "Why do stars twinkle?", postBody: "Pasted body",
    });
    await reload();
    expect(row(stores.proj_doe.items[0].id).textContent).toContain("pasted by hand");
  });

  it("refuses a link that is not Reddit with the server's sentence", async () => {
    await mount();
    await addLink("https://example.com/post");
    expect(text()).toContain("https://example.com/post is not a Reddit link — it should start https://www.reddit.com/r/…");
    expect(stores.proj_doe.items).toEqual([]);
  });

  it("Write with AI shows three labelled replies; picking the second fills the box, and Approve sends his edit and the pick", async () => {
    stores.proj_doe.items = [item({})];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Write with AI", row(id)));
    expect(text()).toContain("3 replies to choose from — on Approvals, ready to pick.");
    const options = [...row(id).querySelectorAll<HTMLButtonElement>(".draft-chooser-option")];
    expect(options.map((o) => o.querySelector(".draft-chooser-angle")?.textContent))
      .toEqual(["1adds a personal story", "2asks a question back", "3offers a resource"]);
    expect(row(id).textContent).toContain("Written from: Dane of Earth, Voice, DEO, Ecosystem — canon copied Oct 12");
    // Nothing is approvable until he picks one.
    expect(container!.querySelector(`#rc-draft-${id}-box`)).toBeNull();
    expect(button("Approve", row(id)).disabled).toBe(true);

    await click(options[1]);
    expect(options[1].getAttribute("aria-pressed")).toBe("true");
    const box = el<HTMLTextAreaElement>(`#rc-draft-${id}-box`);
    expect(box.value).toBe("Have you watched a star near the horizon, draft 1?");

    type(box, "Have you watched a star near the horizon? It twinkles most there.");
    await click(button("Approve", row(id)));
    expect(requests.pop()?.body).toEqual({ text: "Have you watched a star near the horizon? It twinkles most there.", option: 1 });
    expect(stores.proj_doe.items[0].status).toBe("approved");
    expect(stores.proj_doe.items[0].chosenOption).toBe(1);

    await reload();
    await click(button("Approvals"));
    expect(row(id).textContent).toContain("Approved — waiting for the Mini to post it");
    expect(row(id).textContent).toContain("It twinkles most there.");
  });

  it("keys 1, 2 and 3 pick an option, but type normally inside the box", async () => {
    stores.proj_doe.items = [item({})];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Write with AI", row(id)));
    const chooser = row(id).querySelector<HTMLElement>(".draft-chooser")!;
    const press = (target: HTMLElement, key: string) => act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    press(chooser.querySelector<HTMLElement>(".draft-chooser-option")!, "3");
    expect(el<HTMLTextAreaElement>(`#rc-draft-${id}-box`).value).toBe("Look up atmospheric seeing, draft 1.");
    press(el<HTMLTextAreaElement>(`#rc-draft-${id}-box`), "1");
    expect(el<HTMLTextAreaElement>(`#rc-draft-${id}-box`).value).toBe("Look up atmospheric seeing, draft 1.");
    press(chooser, "1");
    expect(el<HTMLTextAreaElement>(`#rc-draft-${id}-box`).value).toBe("The air bends the light, draft 1.");
    press(chooser, "4");
    expect(el<HTMLTextAreaElement>(`#rc-draft-${id}-box`).value).toBe("The air bends the light, draft 1.");
  });

  it("names a dropped option and its reason, and shows only the two kept", async () => {
    stores.proj_doe.items = [item({})];
    stores.proj_doe.dropOne = true;
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Write with AI", row(id)));
    expect(text()).toContain("2 replies to choose from");
    expect(row(id).querySelectorAll(".draft-chooser-option").length).toBe(2);
    expect(row(id).textContent).toContain("One option was dropped: it names Dane of Earth");
    expect(row(id).textContent).toContain("press 1 or 2");
    // The second card is the THIRD stored option, and Approve sends its stored index.
    await click(row(id).querySelectorAll<HTMLButtonElement>(".draft-chooser-option")[1]);
    await click(button("Approve", row(id)));
    expect(requests.pop()?.body).toEqual({ text: "Look up atmospheric seeing, draft 1.", option: 2 });
  });

  it("Three More replaces all three", async () => {
    stores.proj_doe.items = [item({})];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Write with AI", row(id)));
    await click(row(id).querySelector<HTMLButtonElement>(".draft-chooser-option")!);
    await click(button("Three More", row(id)));
    expect(text()).toContain("3 replies to choose from — the old ones are replaced.");
    expect([...row(id).querySelectorAll(".draft-chooser-text")].map((o) => o.textContent)).toEqual([
      "The air bends the light, draft 2.", "Have you watched a star near the horizon, draft 2?", "Look up atmospheric seeing, draft 2.",
    ]);
    expect(container!.querySelector(`#rc-draft-${id}-box`)).toBeNull();
  });

  it("shows the server's refusal word for word when an edit breaks a rule", async () => {
    stores.proj_doe.items = [item({ status: "draft", draftText: "Fine words.", canonUsed: CANON })];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Approvals"));
    type(el<HTMLTextAreaElement>(`#rc-draft-${id}`), "Let us delve into the optics.");
    await click(button("Approve", row(id)));
    expect(row(id).querySelector('[role="alert"]')?.textContent)
      .toBe('Not approved: it uses "delve into", which is on the AI-ism blocklist.');
    expect(stores.proj_doe.items[0].status).toBe("draft");
    // His edit is still in the box to fix, not replaced by the old draft.
    expect(el<HTMLTextAreaElement>(`#rc-draft-${id}`).value).toBe("Let us delve into the optics.");
  });

  it("a draft written before options keeps its single box, and Write another turns it into three", async () => {
    stores.proj_doe.items = [item({ status: "draft", draftText: "First try.", canonUsed: CANON })];
    const id = stores.proj_doe.items[0].id;
    await mount();
    await click(button("Approvals"));
    expect(el<HTMLTextAreaElement>(`#rc-draft-${id}`).value).toBe("First try.");
    await click(button("Write another", row(id)));
    expect(row(id).querySelectorAll(".draft-chooser-option").length).toBe(3);
  });

  it("rejects from the server and says how many rejected rows are hidden", async () => {
    stores.proj_doe.items = [item({})];
    await mount();
    await click(button("Reject", row(stores.proj_doe.items[0].id)));
    expect(stores.proj_doe.items[0].status).toBe("rejected");
    await reload();
    expect(text()).toContain("1 rejected comment is not shown.");
    expect(text()).toContain("Nothing waiting to be written");
  });

  it("empties the screen on a project switch and shows the new project's rows", async () => {
    stores.proj_doe.items = [item({ postTitle: "Dane of Earth post" })];
    await mount();
    expect(text()).toContain("Dane of Earth post");
    type(el<HTMLInputElement>("#rc-link"), POST_LINK);

    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    expect(text()).toContain("Delray only: best tennis drills");
    expect(text()).not.toContain("Dane of Earth post");
    expect(el<HTMLInputElement>("#rc-link").value).toBe("");
  });

  it("drops an add answered after a project switch", async () => {
    await mount();
    let release: () => void = () => {};
    const api = (window as unknown as { App: { api: ReturnType<typeof vi.fn> } }).App.api;
    api.mockImplementationOnce(async (path: string, options: RequestInit) => {
      const answer = await fakeApi(path, options);
      await new Promise<void>((resolve) => { release = resolve; });
      return answer;
    });
    type(el<HTMLInputElement>("#rc-link"), POST_LINK);
    await act(async () => { el<HTMLFormElement>("form.reddit-comments-add").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    await act(async () => { release(); });
    await flush();
    expect(text()).toContain("Delray only: best tennis drills");
    expect(text()).not.toContain("Why do stars twinkle?");
  });

  it("lists posted and failed rows on Posted with their proof and reason", async () => {
    stores.proj_doe.items = [
      item({ status: "posted", finalText: "Posted words", postedUrl: "https://www.reddit.com/r/astronomy/comments/abc123/x/def456/", screenshotUrl: "https://cdn.example/shot.png", postedAt: "2026-10-13T10:00:00Z" }),
      item({ status: "failed", finalText: "Failed words", error: "Reddit said the thread is locked." }),
    ];
    await mount();
    await click(button("Posted"));
    const [posted, failed] = stores.proj_doe.items;
    expect(row(posted.id).textContent).toContain("Posted words");
    expect(row(posted.id).querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/shot.png");
    expect(row(failed.id).textContent).toContain("Failed to post");
    expect(row(failed.id).textContent).toContain("Reddit said the thread is locked.");
  });

  it("shows the Mini's sign-in and pace at the top, and why an approved comment waits", async () => {
    stores.proj_doe.status = {
      account: "danetest",
      pace: PACE,
      browserCheck: { state: "signed_in", message: "Mini: signed in to Reddit as danetest.", checkedAt: new Date(Date.now() - 5 * 60000).toISOString(), signedInAt: null },
      browserCheckError: "",
    };
    stores.proj_doe.items = [item({ status: "approved", finalText: "Waiting words", waitReason: "Waiting for tomorrow's allowance — 3 of 3 comments a day already posted today (UTC)." })];
    await mount();
    expect(el(".reddit-comments-signin").textContent).toBe("Mini: signed in to Reddit as danetest, checked 5 minutes ago.");
    expect(el(".reddit-comments-pace").textContent).toContain("at most 3 comments a day, at least 20 minutes apart");
    await click(button("Approvals"));
    expect(row(stores.proj_doe.items[0].id).textContent).toContain("Waiting for tomorrow's allowance");
  });

  it("a status that cannot be read says so and still shows the comments", async () => {
    stores.proj_doe.status = "unreadable";
    stores.proj_doe.items = [item({ postTitle: "Still listed" })];
    await mount();
    expect(text()).toContain("Still listed");
    expect(el(".reddit-comments-signin").textContent).toContain("could not be read: status endpoint down");
  });

  it("a comment the Mini could not prove sits on Posted as a hand check, with its link", async () => {
    stores.proj_doe.items = [item({
      status: "posting", needsHandCheck: true, finalText: "Maybe live",
      postedUrl: "https://www.reddit.com/r/astronomy/comments/abc123/comment/def456/",
      error: "OpenClaw says it posted, but Reddit blocked this server (403), so the link could not be checked.",
    })];
    await mount();
    await click(button("Posted"));
    const r = row(stores.proj_doe.items[0].id);
    expect(r.textContent).toContain("Check this one by hand");
    expect(r.textContent).toContain("Reddit blocked this server");
    expect([...r.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("https://www.reddit.com/r/astronomy/comments/abc123/comment/def456/");
    await click(button("Approvals"));
    expect(text()).not.toContain("Maybe live");
  });

  it("says which read failed when the list cannot be read", async () => {
    (window as unknown as { App: { api: ReturnType<typeof vi.fn> } }).App.api.mockRejectedValueOnce(new Error("database unreachable"));
    await mount();
    expect(text()).toContain("The Reddit comments could not be read: database unreachable");
    expect(text()).not.toContain("No Reddit posts added yet");
  });
});

describe("helpers", () => {
  it("canonLine names each document and the newest copy date", () => {
    expect(canonLine(CANON)).toBe("Written from: Dane of Earth, Voice, DEO, Ecosystem — canon copied Oct 12");
    expect(canonLine([{ docKey: "AIISM-BLOCKLIST", syncedAt: null }])).toBe("Written from: AI-ism blocklist — when the canon was copied is not recorded.");
    expect(canonLine([])).toBe("Written from: no canon was recorded for this draft.");
  });

  it("canonName keeps DEO in capitals inside longer keys", () => {
    expect(["DEO-CHARACTERISTICS", "DEO-DATA-THESIS", "NEW-THING"].map(canonName))
      .toEqual(["DEO characteristics", "DEO data thesis", "New thing"]);
  });

  it("tabFor puts each status on one tab, and rejected on none", () => {
    expect(["idea", "draft", "approved", "posting", "posted", "failed", "rejected"].map((s) => tabFor(s)))
      .toEqual(["write", "approvals", "approvals", "approvals", "posted", "posted", null]);
  });

  it("tabFor moves a posting row the Mini could not prove onto Posted", () => {
    expect(tabFor("posting", true)).toBe("posted");
    expect(tabFor("approved", true)).toBe("approvals");
  });

  it("signInLine says signed in with when, and never reads silence or an old reading as fine", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const check = (state: string, checkedAt: string | null, message = "") => ({
      account: "danetest", pace: PACE, browserCheckError: "",
      browserCheck: { state, message, checkedAt, signedInAt: null },
    }) as any;
    expect(signInLine(check("signed_in", "2026-10-13T11:48:00Z", "Mini: signed in to Reddit as danetest."), now))
      .toEqual({ tone: "ok", state: "signed_in", text: "Mini: signed in to Reddit as danetest, checked 12 minutes ago." });
    expect(signInLine(check("signed_out", "2026-10-13T11:48:00Z", "Reddit on the Mini is signed out of danetest. Sign in again in the dane-of-earth browser."), now).tone).toBe("alarm");
    expect(signInLine(check("", null), now).state).toBe("unknown");
    expect(signInLine(check("signed_in", "2026-10-13T08:00:00Z", "Mini: signed in to Reddit as danetest."), now).state).toBe("stale");
    expect(signInLine({ account: "", pace: null, browserCheck: null, browserCheckError: "database down" }, now).text)
      .toContain("could not be read: database down");
  });

  it("paceLine states the pace, and says nothing posts until an account is named", () => {
    expect(paceLine({ account: "danetest", pace: PACE, browserCheck: null, browserCheckError: "" }))
      .toBe("The Mini posts as u/danetest at most 3 comments a day, at least 20 minutes apart (plus up to 10 minutes at random).");
    expect(paceLine({ account: "", pace: PACE, browserCheck: null, browserCheckError: "" }))
      .toContain("No Reddit account has been chosen for it to post as yet");
  });

  it("postPreview keeps the first lines and trims long ones", () => {
    expect(postPreview("a\nb\nc\nd")).toBe("a\nb\nc");
    expect(postPreview("x".repeat(300), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("withScheme and isCommentLink read pasted links", () => {
    expect(withScheme("reddit.com/r/x")).toBe("https://reddit.com/r/x");
    expect(isCommentLink(POST_LINK)).toBe(false);
    expect(isCommentLink(`${POST_LINK}def456/`)).toBe(true);
  });
});
