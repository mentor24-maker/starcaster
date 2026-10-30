// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubstackMinerPanel, {
  decisionWhyText,
  emptyText,
  foundInNotes,
  headerCounts,
  notesReadText,
  parseSeedLines,
  postsReadSummaryText,
  searchSummaryText,
  seedSummaryText,
  snowballSummaryText,
  suggestSummaryText,
  statsNotes,
  subscriberSummaryText,
  visibleCandidates,
  keywordsGrowSummaryText,
  widerEmptyText,
  widerSourceText,
  alsoMentions,
  latestPosts,
  postDateText,
  type Candidate,
  type RecentPost,
  type WiderKeyword,
} from "./substack-miner-panel";
import { PROJECT_SWITCH_EVENT } from "../substack-notes/substack-notes-panel";
import { reasonTally } from "./substack-decision-dialog";

/**
 * Substack Miner 4/7 (86bcfprxq). The screen is driven against a fake
 * /api/acquire/substack-miner that keeps one store PER PROJECT — writers and
 * contacts both — so "still showing the old project's rows" after a switch is
 * distinguishable from "empty", and every decision is read back from the
 * fake's store (a remount is the reload) rather than from the screen's state.
 * The fake's approve makes ONE contact per publication, as the server does
 * (lib/acquire/SubstackContactCapture.js, tested in
 * scripts/builder/substackContactCapture.test.js).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seq = 0;
function writer(overrides: Partial<Candidate>): Candidate {
  seq += 1;
  const handle = overrides.handle || `writer${seq}`;
  return {
    id: `w${seq}`,
    handle,
    publicationUrl: `https://${handle}.substack.com`,
    name: handle,
    description: "",
    subscriberText: "",
    keywordsHit: [],
    foundVia: "web_search",
    recommendedBy: [],
    lastSeenAt: `2026-10-0${(seq % 9) + 1}T12:00:00Z`,
    status: "candidate",
    contactId: "",
    note: "",
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

type FakeContact = { id: string; substack: string; firstName: string; email?: string; subscribedAt?: string };
type Store = { writers: Candidate[]; keywords: string[]; saved: boolean; contacts: FakeContact[]; statsFail?: boolean; postsReads?: number; wider?: WiderKeyword[]; removed?: string[] };

/** The settings as the server answers them: a wider keyword already searched for or removed is left out. */
function settingsOf(store: Store, updatedAt = "") {
  const searched = new Set(store.keywords.map((k) => k.toLowerCase()));
  const removed = new Set((store.removed || []).map((k) => k.toLowerCase()));
  return {
    keywords: [...store.keywords], maxResultsPerKeyword: 20, pauseMsBetweenFetches: 1500, saved: store.saved, updatedAt,
    widerKeywords: (store.wider || []).filter((w) => !searched.has(w.keyword.toLowerCase()) && !removed.has(w.keyword.toLowerCase())).map((w) => ({ ...w })),
    removedKeywords: [...(store.removed || [])],
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

const MOVES: Record<string, string[]> = { candidate: ["approved", "rejected"], approved: ["rejected"], rejected: ["candidate"] };

async function fakeApi(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(String(options.body)) : null;
  const project = activeProject;
  requests.push({ method, path, body, project });
  const store = stores[project];
  if (path.startsWith("/api/acquire/substack-miner/candidates?") && method === "GET") {
    return { ok: true, data: store.writers.map((w) => ({ ...w })) };
  }
  if (path === "/api/acquire/substack-miner/settings" && method === "GET") {
    return { ok: true, data: settingsOf(store) };
  }
  if (path === "/api/acquire/substack-miner/settings" && method === "PUT") {
    store.keywords = body.keywords;
    store.saved = true;
    return { ok: true, data: settingsOf(store, "x") };
  }
  if (path === "/api/acquire/substack-miner/keywords/grow" && method === "POST") {
    const learned: WiderKeyword[] = [
      { keyword: "metamodernism", sources: [{ kind: "post", handle: "a" }, { kind: "post", handle: "b" }, { kind: "post", handle: "a" }], firstSeenAt: "x" },
      { keyword: "polymath", sources: [{ kind: "reason", handle: "a" }], firstSeenAt: "x" },
    ];
    const removed = new Set((store.removed || []).map((k) => k.toLowerCase()));
    const added = learned.filter((l) => !removed.has(l.keyword) && !(store.wider || []).some((w) => w.keyword === l.keyword));
    store.wider = [...(store.wider || []), ...added];
    return { ok: true, data: { approved: 2, added: added.map((a) => a.keyword), grew: 0, alreadySearched: 0, removedBefore: learned.length - added.length - 0, overCap: 0, topicsSkipped: "the AI did not answer: credit balance too low" } };
  }
  if (path === "/api/acquire/substack-miner/keywords/remove" && method === "POST") {
    store.removed = [...(store.removed || []), body.keyword];
    store.wider = (store.wider || []).filter((w) => w.keyword !== body.keyword);
    return { ok: true, data: settingsOf(store, "x") };
  }
  if (path === "/api/acquire/substack-miner/candidates/import" && method === "POST") {
    const result = { added: 0, merged: 0, refused: 0, refusals: [] as any[] };
    body.candidates.forEach((row: { handle: string; whyFit?: string }, index: number) => {
      if (!/^[a-z0-9-]+$/.test(row.handle)) {
        result.refused += 1;
        result.refusals.push({ index, handle: row.handle, error: `handle "${row.handle}" is not a Substack handle` });
        return;
      }
      const have = store.writers.find((w) => w.handle === row.handle);
      if (have) { result.merged += 1; return; }
      store.writers.push(writer({ handle: row.handle, description: row.whyFit || "", foundVia: "seed" }));
      result.added += 1;
    });
    return { ok: true, data: result };
  }
  if (path === "/api/acquire/substack-miner/run" && method === "POST") {
    return { ok: true, data: { engine: "Google", keywordsSearched: store.keywords, keywordsNotSearched: [], resultsSeen: 4, droppedNotSubstack: 1, handlesFound: 3, added: 2, merged: 1, unreadablePages: [], searchErrors: [], refused: [] } };
  }
  if (path === "/api/acquire/substack-miner/read-posts" && method === "POST") {
    // The first click reads; the second finds every writer read this week.
    store.postsReads = (store.postsReads || 0) + 1;
    if (store.postsReads > 1) return { ok: true, data: { writers: 3, due: 0, recent: 3, read: [], failed: [], notReached: 0 } };
    return { ok: true, data: { writers: 3, due: 3, recent: 0, read: [{ handle: "a", name: "A", posts: 8 }, { handle: "b", name: "B", posts: 0 }], failed: [{ handle: "c", name: "Cee", reason: "its newest posts answered HTTP 404" }], notReached: 0 } };
  }
  if (path === "/api/acquire/substack-miner/snowball" && method === "POST") {
    return { ok: true, data: { sourcesRequested: 1, sourcesRead: 1, sources: [], notRead: [], linksFound: 5, added: 5, merged: 0, skippedNotSubstack: 0, refused: [] } };
  }
  if (path === "/api/acquire/substack-miner/stats" && method === "GET") {
    if (store.statsFail) fail("substack_notes_items is not available");
    const approved = store.writers.filter((w) => w.status === "approved");
    const marked = new Set(store.contacts.filter((c) => c.subscribedAt).map((c) => c.id));
    return { ok: true, data: {
      found: store.writers.length,
      approved: approved.length,
      rejected: store.writers.filter((w) => w.status === "rejected").length,
      inContacts: store.writers.filter((w) => w.contactId).length,
      engaged: 0,
      subscribed: approved.filter((w) => marked.has(w.contactId)).length,
      approvedWithContact: approved.filter((w) => w.contactId).length,
      truncated: false,
      unknown: [],
    } };
  }
  if (path === "/api/acquire/substack-miner/subscribers/import" && method === "POST") {
    const lines = String(body.csv).trim().split("\n").slice(1).filter(Boolean);
    const d = { rowsRead: lines.length, matched: 0, newlyMarked: 0, alreadyMarked: 0, unmatched: 0, unreadable: 0, approvedWriterMatches: 0, emailColumn: "email", dateColumn: "subscription_date", contactsSearched: store.contacts.length, contactsTruncated: false, approvedWritersKnown: true, problems: [], unmatchedEmails: [] as string[] };
    for (const line of lines) {
      const [email, date] = line.split(",");
      const hit = store.contacts.find((c) => c.email === email.trim().toLowerCase());
      if (!hit) { d.unmatched += 1; d.unmatchedEmails.push(email); continue; }
      d.matched += 1;
      if (store.writers.some((w) => w.status === "approved" && w.contactId === hit.id)) d.approvedWriterMatches += 1;
      if (hit.subscribedAt) { d.alreadyMarked += 1; continue; }
      hit.subscribedAt = date;
      d.newlyMarked += 1;
    }
    return { ok: true, data: d };
  }
  const contact = path.match(/^\/api\/contacts\/([^/]+)$/);
  if (contact && method === "GET") {
    const hit = store.contacts.find((c) => c.id === contact[1]) || fail("Contact not found");
    return { ok: true, data: { ...hit } };
  }
  const one = path.match(/^\/api\/acquire\/substack-miner\/candidates\/([^/]+)$/);
  if (one && method === "PATCH") {
    const found = store.writers.find((w) => w.id === one[1]) || fail("Writer not found in this project");
    if (body.status && body.status !== found.status && !MOVES[found.status].includes(body.status)) {
      fail(`status cannot move from ${found.status} to ${body.status}`);
    }
    if (body.note !== undefined) found.note = body.note;
    if (body.decisionReasons !== undefined) found.decisionReasons = body.decisionReasons;
    if (body.status === "approved") {
      let linked = store.contacts.find((c) => c.substack === found.publicationUrl);
      const mode = linked ? "linked" : "created";
      if (!linked) {
        linked = { id: `c${store.contacts.length + 1}_${project}`, substack: found.publicationUrl, firstName: found.name };
        store.contacts.push(linked);
      }
      found.status = "approved";
      found.contactId = linked.id;
      return { ok: true, data: { ...found, contact: { id: linked.id, name: linked.firstName, mode, contact: { ...linked } } } };
    }
    if (body.status) found.status = body.status;
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
  await act(async () => { root!.render(<SubstackMinerPanel />); });
  await flush();
}

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

function rowFor(handle: string): HTMLTableRowElement | null {
  return container!.querySelector(`tr[data-handle="${handle}"]`);
}

function el<T extends Element>(selector: string): T {
  const found = container!.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector} in: ${text()}`);
  return found;
}

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

/** The Approve/Reject pop-up, which renders on document.body, not in the screen. */
function dialog(): HTMLFormElement | null {
  return document.body.querySelector<HTMLFormElement>(".substack-decision-dialog");
}

/** Click Approve/Reject on a row, then confirm in the pop-up with an optional sentence. */
async function decideRow(label: "Approve" | "Reject", handle: string, note = "") {
  await click(button(label, rowFor(handle)!));
  if (note) type(dialog()!.querySelector<HTMLTextAreaElement>("textarea")!, note);
  await submit(dialog()!);
}

async function show(status: string) {
  type(el<HTMLSelectElement>('select[aria-label="Show"]'), status);
  await flush();
}

let openViewPage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  seq = 0;
  stores = {
    proj_doe: { writers: [], keywords: [], saved: false, contacts: [] },
    proj_delray: { writers: [writer({ handle: "delrayonly", name: "Delray Only" })], keywords: ["tennis"], saved: true, contacts: [] },
  };
  activeProject = "proj_doe";
  requests = [];
  openViewPage = vi.fn();
  (window as unknown as { App: unknown }).App = { api: vi.fn(fakeApi), contacts: { openViewPage }, setActivePage: vi.fn() };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

function post(title: string, postedAt: string, extra: Partial<RecentPost> = {}): RecentPost {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { title, url: `https://x.substack.com/p/${slug}`, postedAt, subtitle: "", excerpt: "", coverImage: "", paid: false, ...extra };
}

describe("Latest posts and Also mentions (upgrade 3/4, 86bcuxwn5)", () => {
  const posts = [
    post("Older one", "2026-10-01T09:00:00Z"),
    post("Newest: junior tennis camps", "2026-10-21T09:00:00Z", { excerpt: "On polymaths and coaching" }),
    post("Middle", "2026-10-10T09:00:00Z"),
    post("Oldest, not shown", "2026-09-01T09:00:00Z", { subtitle: "all about chess" }),
  ];

  it("headers read Writer · Subscribers · Keywords · Latest posts · Also mentions · Last seen · Notes read · Suggested · Actions", async () => {
    stores.proj_doe.writers.push(writer({ handle: "ada" }));
    await mount();
    const headers = [...container!.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Writer", "Subscribers", "Keywords", "Latest posts", "Also mentions", "Last seen", "Notes read", "Suggested", "Actions"]);
  });

  it("shows the newest date and three newest titles, newest first, each opening the post in a new tab", async () => {
    stores.proj_doe.keywords = ["tennis", "coaching", "chess"];
    stores.proj_doe.writers.push(writer({ handle: "ada", keywordsHit: ["tennis"], recentPosts: posts, postsReadAt: "2026-10-22T00:00:00Z" }));
    await mount();
    const row = rowFor("ada")!;
    const links = [...row.querySelectorAll<HTMLAnchorElement>(".substack-miner-post-title")];
    expect(links.map((a) => a.textContent)).toEqual(["Newest: junior tennis camps", "Middle", "Older one"]);
    expect(links[0].getAttribute("href")).toBe("https://x.substack.com/p/newest-junior-tennis-camps");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("title")).toBe("Newest: junior tennis camps");
    expect(row.querySelector(".substack-miner-post-date")!.textContent).toContain("Oct 21, 2026");
    // "chess" is only in the fourth post, which is not shown; tennis is already a Keyword.
    const chips = [...row.querySelectorAll("td:nth-child(5) .substack-miner-chip")].map((c) => c.textContent);
    expect(chips).toEqual(["coaching"]);
  });

  it("matches the wider list too when it exists, and the search list alone when it does not", async () => {
    stores.proj_doe.keywords = ["coaching"];
    stores.proj_doe.wider = [{ keyword: "polymaths", sources: [{ kind: "post", handle: "ada" }], firstSeenAt: "2026-10-22T00:00:00Z" }];
    stores.proj_doe.writers.push(writer({ handle: "ada", recentPosts: posts, postsReadAt: "2026-10-22T00:00:00Z" }));
    await mount();
    expect([...rowFor("ada")!.querySelectorAll("td:nth-child(5) .substack-miner-chip")].map((c) => c.textContent)).toEqual(["coaching", "polymaths"]);
    const c = writer({ recentPosts: posts, postsReadAt: "x" });
    expect(alsoMentions(c, { keywords: ["coaching"] })).toEqual(["coaching"]);
    expect(alsoMentions(c, null)).toEqual([]);
  });

  it("empty cells say why: not read yet, no posts, nothing beyond its keywords", async () => {
    stores.proj_doe.keywords = ["tennis"];
    stores.proj_doe.writers.push(writer({ handle: "unread", postsReadAt: null }));
    stores.proj_doe.writers.push(writer({ handle: "empty", recentPosts: [], postsReadAt: "2026-10-22T00:00:00Z" }));
    stores.proj_doe.writers.push(writer({ handle: "same", keywordsHit: ["tennis"], recentPosts: posts, postsReadAt: "2026-10-22T00:00:00Z" }));
    await mount();
    expect(rowFor("unread")!.querySelector("td:nth-child(4)")!.textContent).toBe("Posts not read yet");
    expect(rowFor("empty")!.querySelector("td:nth-child(4)")!.textContent).toBe("No posts");
    expect(rowFor("same")!.querySelector("td:nth-child(5)")!.textContent).toBe("None beyond its keywords");
  });

  it("the Found via filter still narrows the list, and the most-recommended writer still comes first", async () => {
    stores.proj_doe.writers.push(writer({ handle: "searched", foundVia: "web_search", recommendedBy: [] }));
    stores.proj_doe.writers.push(writer({ handle: "rec1", foundVia: "recommendations", recommendedBy: ["a"] }));
    stores.proj_doe.writers.push(writer({ handle: "rec3", foundVia: "recommendations", recommendedBy: ["a", "b", "c"] }));
    await mount();
    const order = () => [...container!.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-handle"));
    expect(order()).toEqual(["rec3", "rec1", "searched"]);
    type(el<HTMLSelectElement>('select[aria-label="Found via"]'), "recommendations");
    await flush();
    expect(order()).toEqual(["rec3", "rec1"]);
  });

  it("latestPosts sorts newest first and keeps three; postDateText says how long ago", () => {
    expect(latestPosts(writer({ recentPosts: posts })).map((p) => p.title)).toEqual(["Newest: junior tennis camps", "Middle", "Older one"]);
    const now = new Date(2026, 9, 29, 15, 0);
    expect(postDateText(new Date(2026, 9, 21, 9, 0).toISOString(), now)).toMatch(/Oct 21, 2026 · 8 days ago$/);
    expect(postDateText(new Date(2026, 9, 29, 1, 0).toISOString(), now)).toMatch(/· today$/);
    expect(postDateText(new Date(2026, 9, 28, 23, 0).toISOString(), now)).toMatch(/· yesterday$/);
    expect(postDateText("", now)).toBe("");
  });
});

describe("Notes read column (Substack Miner 5/7)", () => {
  it("shows the date an approved writer's Notes were read, Not yet before then, and nothing for a candidate", () => {
    const read = notesReadText(writer({ status: "approved", lastNotesReadAt: "2026-10-09T12:00:00Z" }));
    expect(read).toMatch(/Oct/);
    expect(notesReadText(writer({ status: "approved", lastNotesReadAt: null }))).toBe("Not yet");
    expect(notesReadText(writer({ status: "candidate" }))).toBe("—");
  });
});

describe("Found in Notes (Substack Miner 6/7)", () => {
  const found = { url: "https://substack.com/@ada/note/c-1", text: "Dear Substack, connect me with the polymaths", postedAt: "", keyword: "polymath", foundBy: "notes_search" };

  it("finds the Note a Notes search turned the writer up by, and nothing for a Note merely read", () => {
    expect(foundInNotes(writer({ recentNotes: [found] }))).toEqual({ url: found.url, text: found.text, keyword: "polymath" });
    expect(foundInNotes(writer({ recentNotes: [{ url: found.url, text: "read", postedAt: "2026-10-01T00:00:00Z" }] }))).toBeNull();
  });

  it("a writer found in Notes shows the chip, the Note on hover, and the Note when opened; filtering by Notes search keeps it", async () => {
    stores.proj_doe.writers.push(writer({ handle: "adawrites", name: "Ada Writes", foundVia: "notes_search", recentNotes: [found] }));
    stores.proj_doe.writers.push(writer({ handle: "plain", name: "Plain", foundVia: "web_search" }));
    await mount();
    const chip = el('[data-handle="adawrites"] .substack-miner-found-note summary');
    expect(chip.textContent).toBe("Found in Notes");
    expect(chip.getAttribute("title")).toContain("Dear Substack, connect me with the polymaths");
    expect(el('[data-handle="adawrites"] .substack-miner-found-note-text').textContent).toContain('Found searching Notes for "polymath"');
    expect(container!.querySelector('[data-handle="plain"] .substack-miner-found-note')).toBeNull();
    const select = el('select[aria-label="Found via"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "notes_search";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container!.querySelector('[data-handle="adawrites"]')).not.toBeNull();
    expect(container!.querySelector('[data-handle="plain"]')).toBeNull();
  });
});

describe("Substack Miner screen", () => {
  it("opens on two tabs with the header counts, and says why the list is empty", async () => {
    await mount();
    const tabs = [...container!.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Candidates", "Run"]);
    expect(el('[data-testid="substack-miner-counts"]').textContent).toBe("0 found · 0 approved · 0 rejected · 0 in Contacts · 0 engaged · 0 subscribed");
    expect(text()).toContain("No candidates yet. Paste a link above, or add keywords on the Run tab and click Search the web.");
    await show("approved");
    expect(text()).toContain("Nothing approved yet.");
  });

  it("pasting two lines on the Candidates tab adds two candidates, without leaving the tab", async () => {
    await mount();
    expect(el('[role="tab"][aria-selected="true"]').textContent).toBe("Candidates");
    type(el<HTMLTextAreaElement>("#sm-seeds"), "kindoftsetsy, writes about how the Substack algorithm works\n\nanother-one, good on Notes");
    await submit(el<HTMLFormElement>('form[aria-label="Add writers by link"]'));
    const sent = requests.find((r) => r.path.endsWith("/candidates/import"));
    expect(sent?.body).toEqual({ candidates: [
      { handle: "kindoftsetsy", whyFit: "writes about how the Substack algorithm works" },
      { handle: "another-one", whyFit: "good on Notes" },
    ] });
    expect(text()).toContain("2 added.");
    expect(stores.proj_doe.writers.map((w) => w.foundVia)).toEqual(["seed", "seed"]);
    // How it was found left the list in upgrade 3/4 (it moves to the details page); the store says seed.
    expect(rowFor("kindoftsetsy")).not.toBeNull();
    expect(rowFor("another-one")).not.toBeNull();
  });

  it("a refused line is named by the line Dane typed, and the box keeps his text", async () => {
    await mount();
    type(el<HTMLTextAreaElement>("#sm-seeds"), "good\n\nNot A Handle!, why");
    await submit(el<HTMLFormElement>('form[aria-label="Add writers by link"]'));
    expect(text()).toContain("1 added.");
    expect(text()).toContain('Line 3 (Not A Handle!) was not added');
    expect(el<HTMLTextAreaElement>("#sm-seeds").value).toContain("Not A Handle!");
  });

  it("approving makes one contact, says Added to Contacts with a link, and the link opens it", async () => {
    stores.proj_doe.writers = [writer({ handle: "kindoftsetsy", name: "Kind of Tsetsy" })];
    await mount();
    await decideRow("Approve", "kindoftsetsy");
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toEqual({ status: "approved", note: "" });
    expect(dialog()).toBeNull();
    expect(stores.proj_doe.contacts).toHaveLength(1);
    // Approved rows leave the Candidates filter; the decision is on the Approved one.
    await show("approved");
    const row = rowFor("kindoftsetsy")!;
    expect(row.textContent).toContain("Added to Contacts");
    await click(row.querySelector<HTMLAnchorElement>(".substack-miner-contact a")!);
    expect(openViewPage).toHaveBeenCalledWith(expect.objectContaining({ id: stores.proj_doe.contacts[0].id }));
    expect(el('[data-testid="substack-miner-counts"]').textContent).toBe("1 found · 1 approved · 0 rejected · 1 in Contacts · 0 engaged · 0 subscribed");
  });

  it("a second writer with the same publication links the same contact", async () => {
    stores.proj_doe.writers = [
      writer({ handle: "one", publicationUrl: "https://shared.substack.com" }),
      writer({ handle: "two", publicationUrl: "https://shared.substack.com" }),
    ];
    await mount();
    await decideRow("Approve", "one");
    await decideRow("Approve", "two");
    expect(stores.proj_doe.contacts).toHaveLength(1);
    await show("approved");
    expect(rowFor("two")!.textContent).toContain("Linked to a contact already in Contacts");
  });

  it("after a reload an approved row still links to its contact, fetched by id", async () => {
    stores.proj_doe.contacts = [{ id: "c_saved", substack: "https://saved.substack.com", firstName: "Saved" }];
    stores.proj_doe.writers = [writer({ handle: "saved", status: "approved", contactId: "c_saved" })];
    await mount();
    await show("approved");
    const row = rowFor("saved")!;
    expect(row.textContent).toContain("In Contacts");
    await click(row.querySelector<HTMLAnchorElement>(".substack-miner-contact a")!);
    expect(requests.some((r) => r.path === "/api/contacts/c_saved")).toBe(true);
    expect(openViewPage).toHaveBeenCalledWith(expect.objectContaining({ id: "c_saved" }));
  });

  it("rejecting hides the row from Candidates, shows it under Rejected, and a reload keeps it", async () => {
    stores.proj_doe.writers = [writer({ handle: "notforus" })];
    await mount();
    await decideRow("Reject", "notforus");
    expect(rowFor("notforus")).toBeNull();
    await reload();
    expect(rowFor("notforus")).toBeNull();
    await show("rejected");
    expect(rowFor("notforus")).not.toBeNull();
    expect(stores.proj_doe.writers[0].status).toBe("rejected");
  });

  it("the table has no Note column; Approve asks why, and Cancel changes nothing", async () => {
    stores.proj_doe.writers = [writer({ handle: "asked", name: "Asked Writer" })];
    await mount();
    expect([...container!.querySelectorAll("th")].map((th) => th.textContent)).not.toContain("Note");
    expect(rowFor("asked")!.querySelector("input")).toBeNull();

    await click(button("Approve", rowFor("asked")!));
    const box = dialog()!;
    expect(box.getAttribute("data-decision")).toBe("approved");
    expect(box.querySelector("label[for=sm-decision-note]")!.textContent).toBe("Why did you Approve?");
    expect(box.textContent).toContain("Approve: Asked Writer");
    await click(button("Cancel", box));
    expect(dialog()).toBeNull();
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(stores.proj_doe.writers[0].status).toBe("candidate");

    await click(button("Reject", rowFor("asked")!));
    expect(dialog()!.querySelector("label[for=sm-decision-note]")!.textContent).toBe("Why did you Disapprove?");
  });

  it("the sentence and the ticked reasons are saved, shown under the writer, and offered next time with a count", async () => {
    stores.proj_doe.writers = [writer({ handle: "first" }), writer({ handle: "second" }), writer({ handle: "third" })];
    await mount();

    await click(button("Approve", rowFor("first")!));
    expect(dialog()!.textContent).toContain("No reasons yet for approving a writer");
    type(dialog()!.querySelector<HTMLTextAreaElement>("textarea")!, "kind and deep");
    type(document.body.querySelector<HTMLInputElement>("#sm-decision-new-reason")!, "polymath");
    await click(button("Add", dialog()!));
    type(document.body.querySelector<HTMLInputElement>("#sm-decision-new-reason")!, "writes Notes daily");
    await click(button("Add", dialog()!));
    await submit(dialog()!);
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({
      status: "approved", note: "kind and deep", decisionReasons: ["polymath", "writes Notes daily"],
    });
    expect(stores.proj_doe.writers[0].decisionReasons).toEqual(["polymath", "writes Notes daily"]);

    // Offered for the next approval, unticked, with how often each was used.
    await click(button("Approve", rowFor("second")!));
    const rows = [...dialog()!.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(rows).toEqual(["polymath1×", "writes Notes daily1×"]);
    expect([...dialog()!.querySelectorAll<HTMLInputElement>("tbody input")].every((i) => !i.checked)).toBe(true);
    await click(dialog()!.querySelector<HTMLInputElement>("tbody input")!);
    await submit(dialog()!);
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({ status: "approved", note: "", decisionReasons: ["polymath"] });

    // An approving reason is never offered for a rejection.
    await click(button("Reject", rowFor("third")!));
    expect(dialog()!.querySelectorAll("tbody tr")).toHaveLength(0);
    await click(button("Cancel", dialog()!));

    // After a reload the reasons are under the writer's name.
    await reload();
    await show("approved");
    expect(rowFor("first")!.querySelector('[data-testid="substack-miner-why"]')!.textContent)
      .toBe("Why approved: polymath, writes Notes daily — kind and deep");
  });

  it("a failed save keeps the pop-up open with what was typed and says why", async () => {
    stores.proj_doe.writers = [writer({ handle: "stuck", status: "approved" })];
    await mount();
    await show("approved");
    // The fake refuses approved -> approved; force a refusal by deleting the writer under the screen.
    stores.proj_doe.writers = [];
    await click(button("Reject", rowFor("stuck")!));
    type(dialog()!.querySelector<HTMLTextAreaElement>("textarea")!, "not a fit after all");
    await submit(dialog()!);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("not a fit after all");
    expect(dialog()!.textContent).toContain("Writer not found in this project");
  });

  it("on screen: Show All lists everyone, Not Approved hides the approved, and Not is greyed out on All", async () => {
    stores.proj_doe.writers = [
      writer({ handle: "waiting" }),
      writer({ handle: "yes", status: "approved" }),
      writer({ handle: "no", status: "rejected" }),
    ];
    await mount();
    const shown = () => [...container!.querySelectorAll("tr[data-handle]")].map((r) => r.getAttribute("data-handle")).sort();
    const not = () => el<HTMLInputElement>('input[aria-label="Not"]');
    expect(shown()).toEqual(["waiting"]);
    expect([...el<HTMLSelectElement>('select[aria-label="Show"]').options].map((o) => o.text)).toEqual(["Candidates", "Approved", "Rejected", "All"]);
    await show("all");
    expect(shown()).toEqual(["no", "waiting", "yes"]);
    expect(not().disabled).toBe(true);
    await show("approved");
    expect(not().disabled).toBe(false);
    await click(not());
    expect(shown()).toEqual(["no", "waiting"]);
    await show("all");
    expect(shown()).toEqual(["no", "waiting", "yes"]);
  });

  it("Suggested shows the word and Agree; the word opens the reasons; Agree decides with them (86bch3f2v)", async () => {
    const suggestion = { action: "approved" as const, reasons: ["polymath", "writes Notes daily"], confidence: "high" as const, why: "Writes across fields like the ones you approved.", basedOn: 30 };
    stores.proj_doe.writers = [
      writer({ handle: "guessed", name: "Guessed Writer", suggestion }),
      writer({ handle: "nosuggestion" }),
    ];
    await mount();
    const cell = rowFor("guessed")!.querySelector(".substack-miner-suggested-cell")!;
    expect(cell.textContent).toContain("Approve");
    expect(cell.textContent).toContain("high");
    expect(rowFor("nosuggestion")!.querySelector(".substack-miner-suggested-cell")!.textContent).toBe("—");

    await click(cell.querySelector<HTMLButtonElement>(".substack-miner-suggested-word")!);
    const box = document.body.querySelector<HTMLElement>(".substack-suggestion-dialog")!;
    expect(box.textContent).toContain("Suggested: Approve Guessed Writer");
    expect([...box.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["polymath", "writes Notes daily"]);
    expect(box.textContent).toContain("Writes across fields like the ones you approved.");
    expect(box.textContent).toContain("learned from 30 of your decisions");
    await click(button("Agree", box));
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({ status: "approved", decisionReasons: ["polymath", "writes Notes daily"] });
    expect(document.body.querySelector(".substack-suggestion-dialog")).toBeNull();
    expect(stores.proj_doe.writers[0].status).toBe("approved");
    expect(stores.proj_doe.contacts).toHaveLength(1);
  });

  it("Agree in the row rejects with the suggested reasons; a decided writer shows no suggestion", async () => {
    stores.proj_doe.writers = [
      writer({ handle: "nope", suggestion: { action: "rejected", reasons: ["AI hype"], confidence: "medium", why: "", basedOn: 30 } }),
      writer({ handle: "already", status: "approved", suggestion: { action: "rejected", reasons: [], confidence: "low", why: "", basedOn: 30 } }),
    ];
    await mount();
    expect(rowFor("nope")!.querySelector(".substack-miner-suggested-word")!.getAttribute("data-action")).toBe("rejected");
    await click(button("Agree", rowFor("nope")!));
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({ status: "rejected", decisionReasons: ["AI hype"] });
    await show("approved");
    expect(rowFor("already")!.querySelector(".substack-miner-suggested-cell")!.textContent).toBe("—");
  });

  it("switching project shows that project's rows, not this one's", async () => {
    stores.proj_doe.writers = [writer({ handle: "doeonly" })];
    await mount();
    expect(rowFor("doeonly")).not.toBeNull();
    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    expect(rowFor("doeonly")).toBeNull();
    expect(rowFor("delrayonly")).not.toBeNull();
    expect(text()).toContain("1 found");
  });

  it("the Run tab saves keywords, then searches and says what it did", async () => {
    await mount();
    await click(button("Run"));
    expect(button("Search the web").disabled).toBe(true);
    type(el<HTMLTextAreaElement>("#sm-keywords"), "substack growth\nnotes");
    expect(text()).toContain("Save the keywords first");
    await submit(el<HTMLFormElement>('form[aria-label="Keywords"]'));
    expect(stores.proj_doe.keywords).toEqual(["substack growth", "notes"]);
    await click(button("Search the web"));
    expect(text()).toContain("Searched 2 keywords with Google: 4 results, 3 writers found — 2 new, 1 already here.");
  });

  it("Read writers' posts says how many were read, names each one not read, and says nothing was due the second time (86bcuxwhy)", async () => {
    await mount();
    await click(button("Run"));
    await click(button("Read writers' posts"));
    expect(text()).toContain("Read posts for 2 writers; 1 could not be read; 1 has no posts yet.");
    expect(text()).toContain("Cee: not read — its newest posts answered HTTP 404.");
    await click(button("Read writers' posts"));
    expect(text()).toContain("Nothing to read: every writer was read in the last 7 days (3 writers).");
  });

  it("the recommendations button waits for an approved writer, and names the reason", async () => {
    await mount();
    await click(button("Run"));
    expect(text()).toContain("Nothing approved yet. Approve a writer on the Candidates tab");
    expect(button("Read recommendations of approved writers").disabled).toBe(true);
  });
});

describe("Substack Miner 7/7: is the push working", () => {
  const CSV = "email,subscription_date\ndane@alphire.agency,2026-10-01\nnobody-matches@example.com,2026-10-01";

  it("importing the How-to-test CSV reports 2 read, 1 matched, 1 newly marked, 1 unmatched; again reports already marked", async () => {
    stores.proj_doe.contacts = [{ id: "c_alphire", substack: "", firstName: "Dane", email: "dane@alphire.agency" }];
    await mount();
    await click(button("Run"));
    type(el<HTMLTextAreaElement>("#sm-subscribers"), CSV);
    await submit(el<HTMLFormElement>('form[aria-label="Import subscribers"]'));
    const sent = requests.find((r) => r.path.endsWith("/subscribers/import"));
    expect(sent?.body).toEqual({ csv: CSV });
    expect(text()).toContain("2 rows read: 1 matched a contact (1 newly marked, 0 already marked), 1 unmatched.");
    expect(text()).toContain("None of the matched contacts is an approved writer's, so Subscribed does not change.");
    await submit(el<HTMLFormElement>('form[aria-label="Import subscribers"]'));
    expect(text()).toContain("(0 newly marked, 1 already marked)");
  });

  it("Subscribed in the header counts an approved writer whose contact was marked", async () => {
    stores.proj_doe.contacts = [{ id: "c_w", substack: "https://w.substack.com", firstName: "W", email: "w@example.com" }];
    stores.proj_doe.writers = [writer({ handle: "w", status: "approved", contactId: "c_w" })];
    await mount();
    expect(el('[data-testid="substack-miner-counts"]').textContent).toContain("0 subscribed");
    expect(text()).toContain("Subscribed is 0: none of the approved writers' contacts is marked");
    await click(button("Run"));
    type(el<HTMLTextAreaElement>("#sm-subscribers"), "email,subscription_date\nw@example.com,2026-10-01");
    await submit(el<HTMLFormElement>('form[aria-label="Import subscribers"]'));
    expect(el('[data-testid="substack-miner-counts"]').textContent).toContain("1 subscribed");
    expect(text()).not.toContain("Subscribed is 0");
  });

  it("when the counts cannot be read the header shows ? and says why, never 0", async () => {
    stores.proj_doe.statsFail = true;
    await mount();
    expect(el('[data-testid="substack-miner-counts"]').textContent).toBe("0 found · 0 approved · 0 rejected · 0 in Contacts · ? engaged · ? subscribed");
    expect(text()).toContain("Engaged and Subscribed could not be counted: substack_notes_items is not available");
  });

  it("a project switch drops a half-pasted subscriber list", async () => {
    await mount();
    await click(button("Run"));
    type(el<HTMLTextAreaElement>("#sm-subscribers"), CSV);
    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    expect(el<HTMLTextAreaElement>("#sm-subscribers").value).toBe("");
  });
});

describe("Substack Miner helpers", () => {
  it("sorts by recommended-by count, most first", () => {
    const rows = [writer({ handle: "a" }), writer({ handle: "b", recommendedBy: ["x", "y"] }), writer({ handle: "c", recommendedBy: ["x"] })];
    expect(visibleCandidates(rows, "candidate", "").map((r) => r.handle)).toEqual(["b", "c", "a"]);
    expect(visibleCandidates(rows, "candidate", "seed")).toEqual([]);
  });

  it("All shows every writer; Not flips the status choice and keeps Found via (86bch1yyk)", () => {
    const rows = [
      writer({ handle: "c1", status: "candidate", foundVia: "seed" }),
      writer({ handle: "a1", status: "approved", foundVia: "seed" }),
      writer({ handle: "r1", status: "rejected", foundVia: "web_search" }),
    ];
    const handles = (list: Candidate[]) => list.map((r) => r.handle).sort();
    expect(handles(visibleCandidates(rows, "all", ""))).toEqual(["a1", "c1", "r1"]);
    expect(handles(visibleCandidates(rows, "approved", "", true))).toEqual(["c1", "r1"]);
    expect(handles(visibleCandidates(rows, "candidate", "", true))).toEqual(["a1", "r1"]);
    expect(handles(visibleCandidates(rows, "approved", "seed", true))).toEqual(["c1"]);
    expect(visibleCandidates(rows, "all", "", true)).toEqual([]);
    expect(emptyText([], "all", "")).toContain("No writers yet");
    expect(emptyText(rows, "all", "notes_search")).toBe('No writers found via notes search. Try another "Found via" choice.');
    expect(emptyText([writer({ status: "approved" })], "approved", "", true))
      .toBe("Every writer found is approved, so nothing is left once those are taken out. Untick Not to see them.");
  });

  it("counts found, approved, rejected and in Contacts", () => {
    const rows = [writer({ status: "approved", contactId: "c1" }), writer({ status: "rejected", contactId: "c2" }), writer({})];
    expect(headerCounts(rows)).toEqual({ found: 3, approved: 1, rejected: 1, inContacts: 2 });
  });

  it("an empty table names the filter that emptied it", () => {
    const rows = [writer({ status: "approved" })];
    expect(emptyText([], "candidate", "")).toContain("No candidates yet");
    expect(emptyText(rows, "candidate", "")).toContain("every writer found has been approved or rejected");
    expect(emptyText(rows, "rejected", "seed")).toBe("Nothing rejected found via pasted link.");
  });

  it("parses seed lines, keeping commas inside the reason", () => {
    expect(parseSeedLines("a, one, two\n\n@b")).toEqual({ rows: [{ handle: "a", whyFit: "one, two" }, { handle: "@b" }], lines: [1, 3] });
  });

  it("the suggestion summary counts both ways, names what was skipped, and says when to run again", () => {
    const lines = suggestSummaryText({
      basedOn: 30, approvedExamples: 18, rejectedExamples: 12, undecided: 40, alreadySuggested: 5,
      suggested: [{ name: "A", action: "approved", confidence: "high" }, { name: "B", action: "rejected", confidence: "low" }],
      notSuggested: [{ name: "C", reason: "the AI did not answer: timeout" }],
      postsUnread: [{ name: "D", reason: "its newest posts answered HTTP 404" }],
      notReached: 7,
    });
    expect(lines[0]).toBe("Learned from 30 decisions (18 approved, 12 rejected). Suggested 2 of 40 undecided writers: 1 approve, 1 reject. 5 already had a suggestion.");
    expect(lines).toContain("C was not suggested: the AI did not answer: timeout.");
    expect(lines).toContain("D was judged from its description only — its newest posts answered HTTP 404.");
    expect(lines.at(-1)).toBe("7 not reached in this run — click Suggest decisions again for the rest.");
  });

  it("the posts summary names the writers left for next time", () => {
    expect(postsReadSummaryText({ writers: 5, due: 5, read: [{ name: "A", posts: 3 }], failed: [], notReached: 4 })).toEqual([
      "Read posts for 1 writer.",
      "4 writers not reached — the run ran out of time. Click Read writers' posts again for the rest.",
    ]);
    expect(postsReadSummaryText({ writers: 3, due: 1, recent: 2, read: [], failed: [{ name: "Gone", reason: "its newest posts answered HTTP 404" }], notReached: 0 })[0])
      .toBe("Read posts for 0 writers; 1 could not be read. 2 other writers were read in the last 7 days and skipped.");
    expect(postsReadSummaryText({ writers: 0, due: 0, read: [], failed: [], notReached: 0 })).toEqual(["Nothing to read: there are no writers yet, other than rejected ones."]);
  });

  it("run summaries account for everything the server reported", () => {
    const search = searchSummaryText({ keywordsSearched: ["k"], keywordsNotSearched: ["late"], resultsSeen: 1, handlesFound: 1, added: 1, merged: 0, droppedNotSubstack: 0, unreadablePages: [{ handle: "h", reason: "HTTP 500" }], searchErrors: [{ keyword: "k2", error: "quota" }], refused: [] });
    expect(search.join(" ")).toContain("late");
    expect(search.join(" ")).toContain("h: front page not read (HTTP 500)");
    expect(search.join(" ")).toContain('"k2" failed: quota');
    const snow = snowballSummaryText({ sourcesRequested: 2, sourcesRead: 1, sources: [{ handle: "bad", read: "failed", httpStatus: 404, reason: "not found" }], notRead: [], linksFound: 0, added: 0, merged: 0, skippedNotSubstack: 2, refused: [] });
    expect(snow.join(" ")).toContain("bad: recommendations page could not be read (HTTP 404)");
    expect(snow.join(" ")).toContain("2 recommendations on a publication's own domain were skipped");
    expect(seedSummaryText({ added: 0, merged: 1, refusals: [] }, [])[0]).toContain("1 already here");
    const fromProfile = seedSummaryText({ added: 1, merged: 0, refusals: [{ index: 1, handle: "@reader", error: "they have no Substack publication of their own" }], resolved: [{ index: 0, profile: "@ankairos", handle: "magickalchemyandai", name: "Philosophy & AI" }] }, [2, 4]);
    expect(fromProfile).toContain('Line 2: @ankairos writes "Philosophy & AI" at magickalchemyandai.substack.com, so they were added under that publication.');
    expect(fromProfile.join(" ")).toContain("Line 4 (@reader) was not added");
    const fromLink = seedSummaryText({ added: 1, merged: 0, refusals: [], resolved: [{ index: 0, link: "https://www.lennysnewsletter.com/p/x", handle: "lenny", name: "Lenny's Newsletter" }] }, [1]);
    expect(fromLink).toContain(`Line 1: that link is from "Lenny's Newsletter" at lenny.substack.com, so the writer was added under that publication.`);
    const subs = subscriberSummaryText({ rowsRead: 3, matched: 1, newlyMarked: 1, alreadyMarked: 0, unmatched: 1, unreadable: 1, emailColumn: "Email", dateColumn: "", approvedWriterMatches: 1, problems: [{ line: 4, reason: "the email is blank" }], unmatchedEmails: ["x@y.co"], contactsTruncated: true, contactsSearched: 5000 }).join(" ");
    expect(subs).toContain("1 could not be read");
    expect(subs).toContain("no subscription-date column, so contacts newly marked carry today's date");
    expect(subs).toContain("1 matched row belongs to an approved writer");
    expect(subs).toContain("Line 4 was skipped: the email is blank.");
    expect(subs).toContain("x@y.co");
    expect(subs).toContain("Only the first 5,000 contacts were searched");
    expect(statsNotes({ found: 1, approved: 1, rejected: 0, inContacts: 1, engaged: null, subscribed: 0, approvedWithContact: 1, truncated: false, unknown: [{ count: "engaged", reason: "The Substack Notes actions could not be read: x" }] }, "").join(" "))
      .toContain("Engaged could not be counted.");
  });

  it("when no approved writer has a contact, Subscribed-is-0 says so instead of asking for an import", () => {
    const none = statsNotes({ found: 2, approved: 2, rejected: 0, inContacts: 0, engaged: 0, subscribed: 0, approvedWithContact: 0, truncated: false, unknown: [] }, "").join(" ");
    expect(none).toContain("none of the 2 approved writers has a contact yet");
    expect(none).not.toContain("Import the subscriber list");
    const some = statsNotes({ found: 1, approved: 1, rejected: 0, inContacts: 1, engaged: 0, subscribed: 0, approvedWithContact: 1, truncated: false, unknown: [] }, "").join(" ");
    expect(some).toContain("Import the subscriber list");
  });
});

describe("decision reasons (86bch0j99)", () => {
  it("reasonTally counts each decision separately, merges case and spacing, most used first", () => {
    const ws = [
      { status: "approved", decisionReasons: ["Polymath", "kind"] },
      { status: "approved", decisionReasons: ["polymath ", "polymath"] },
      { status: "approved", decisionReasons: ["deep  thinker"] },
      { status: "rejected", decisionReasons: ["off-topic", "kind"] },
      { status: "candidate", decisionReasons: ["polymath"] },
      { status: "approved" },
    ];
    expect(reasonTally(ws, "approved")).toEqual([
      { reason: "Polymath", count: 2 },
      { reason: "deep thinker", count: 1 },
      { reason: "kind", count: 1 },
    ]);
    expect(reasonTally(ws, "rejected")).toEqual([{ reason: "kind", count: 1 }, { reason: "off-topic", count: 1 }]);
  });

  it("decisionWhyText says why only for a decided writer with something to say", () => {
    expect(decisionWhyText(writer({ status: "approved", decisionReasons: ["a", "b"], note: "c" }))).toBe("Why approved: a, b — c");
    expect(decisionWhyText(writer({ status: "rejected", note: "spam" }))).toBe("Why rejected: spam");
    expect(decisionWhyText(writer({ status: "approved" }))).toBe("");
    expect(decisionWhyText(writer({ status: "candidate", note: "maybe" }))).toBe("");
  });
});

describe("Substack Miner upgrade 2/4: the wider keyword list (86bcuxwkr)", () => {
  const wider = () => [...container!.querySelectorAll<HTMLLIElement>(".substack-miner-wider-item")].map((li) => li.dataset.keyword);

  it("Grow keywords now fills the card with where each came from; Add to search moves one into the search list and it survives a reload", async () => {
    stores.proj_doe.keywords = ["notes"];
    stores.proj_doe.saved = true;
    stores.proj_doe.writers = [writer({ handle: "a", status: "approved", postsReadAt: "2026-10-29T00:00:00Z" })];
    await mount();
    await click(button("Run"));
    await click(button("Grow keywords now"));
    expect(wider()).toEqual(["metamodernism", "polymath"]);
    expect(text()).toContain("from 2 approved writers' posts");
    expect(text()).toContain("from your reasons");
    expect(text()).toContain("Topics from posts and notes were skipped: the AI did not answer: credit balance too low. Keywords from your reasons were still added.");

    const item = container!.querySelector<HTMLLIElement>('[data-keyword="metamodernism"]')!;
    await click(button("Add to search", item));
    const put = requests.filter((r) => r.method === "PUT" && r.path.endsWith("/settings")).pop();
    expect(put?.body).toEqual({ keywords: ["notes", "metamodernism"] });
    expect(wider()).toEqual(["polymath"]);
    expect(el<HTMLTextAreaElement>("#sm-keywords").value).toBe("notes\nmetamodernism");

    await reload();
    await click(button("Run"));
    expect(el<HTMLTextAreaElement>("#sm-keywords").value).toBe("notes\nmetamodernism");
    expect(wider()).toEqual(["polymath"]);
  });

  it("Remove drops a keyword, and growing again does not bring it back", async () => {
    stores.proj_doe.writers = [writer({ handle: "a", status: "approved", postsReadAt: "2026-10-29T00:00:00Z" })];
    await mount();
    await click(button("Run"));
    await click(button("Grow keywords now"));
    await click(button("Remove", container!.querySelector<HTMLLIElement>('[data-keyword="polymath"]')!));
    expect(wider()).toEqual(["metamodernism"]);
    expect(text()).toContain('Removed "polymath". It will not be learned again.');
    await click(button("Grow keywords now"));
    expect(wider()).toEqual(["metamodernism"]);
  });

  it("the empty card names the cause", async () => {
    await mount();
    await click(button("Run"));
    expect(text()).toContain("No wider keywords yet — they are learned from approved writers, and you have 0 approved.");
    expect(widerEmptyText([writer({ status: "approved" }), writer({ status: "approved" }), writer({ status: "candidate" })]))
      .toContain("the posts of your 2 approved writers have not been read yet");
    expect(widerEmptyText([writer({ status: "approved", postsReadAt: "x" })])).toContain("click Grow keywords now");
  });

  it("widerSourceText counts each writer once per kind; keywordsGrowSummaryText names a skipped AI call", () => {
    expect(widerSourceText({ keyword: "k", firstSeenAt: "", sources: [{ kind: "post", handle: "a" }, { kind: "post", handle: "a" }, { kind: "note", handle: "b" }] }))
      .toBe("from 1 approved writer's posts, from why you approved one writer");
    expect(keywordsGrowSummaryText({ approved: 0 })).toEqual(["Nothing learned: there are no approved writers yet. Approve some writers first."]);
    expect(keywordsGrowSummaryText({ approved: 3, added: ["x"], grew: 2, alreadySearched: 1, removedBefore: 1, overCap: 4 })).toEqual([
      "Learned from 3 approved writers: 1 new keyword; 2 keywords already listed found again; 1 already in your search list; 1 you removed before, left out.",
      "4 keywords not added — the wider list is full (300). Remove some to make room.",
    ]);
  });
});
