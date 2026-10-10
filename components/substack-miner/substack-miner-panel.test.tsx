// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubstackMinerPanel, {
  emptyText,
  headerCounts,
  parseSeedLines,
  searchSummaryText,
  seedSummaryText,
  snowballSummaryText,
  statsNotes,
  subscriberSummaryText,
  visibleCandidates,
  type Candidate,
} from "./substack-miner-panel";
import { PROJECT_SWITCH_EVENT } from "../substack-notes/substack-notes-panel";

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
type Store = { writers: Candidate[]; keywords: string[]; saved: boolean; contacts: FakeContact[]; statsFail?: boolean };
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
    return { ok: true, data: { keywords: [...store.keywords], maxResultsPerKeyword: 20, pauseMsBetweenFetches: 1500, saved: store.saved, updatedAt: "" } };
  }
  if (path === "/api/acquire/substack-miner/settings" && method === "PUT") {
    store.keywords = body.keywords;
    store.saved = true;
    return { ok: true, data: { keywords: [...store.keywords], maxResultsPerKeyword: 20, pauseMsBetweenFetches: 1500, saved: true, updatedAt: "x" } };
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

describe("Substack Miner screen", () => {
  it("opens on two tabs with the header counts, and says why the list is empty", async () => {
    await mount();
    const tabs = [...container!.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Candidates", "Run"]);
    expect(el('[data-testid="substack-miner-counts"]').textContent).toBe("0 found · 0 approved · 0 rejected · 0 in Contacts · 0 engaged · 0 subscribed");
    expect(text()).toContain("No candidates yet. Add keywords on the Run tab and click Search the web.");
    await show("approved");
    expect(text()).toContain("Nothing approved yet.");
  });

  it("pasting two seed lines adds two candidates found via seed", async () => {
    await mount();
    await click(button("Run"));
    type(el<HTMLTextAreaElement>("#sm-seeds"), "kindoftsetsy, writes about how the Substack algorithm works\n\nanother-one, good on Notes");
    await submit(el<HTMLFormElement>('form[aria-label="Paste a seed list"]'));
    const sent = requests.find((r) => r.path.endsWith("/candidates/import"));
    expect(sent?.body).toEqual({ candidates: [
      { handle: "kindoftsetsy", whyFit: "writes about how the Substack algorithm works" },
      { handle: "another-one", whyFit: "good on Notes" },
    ] });
    expect(text()).toContain("2 added.");
    expect(stores.proj_doe.writers.map((w) => w.foundVia)).toEqual(["seed", "seed"]);
    await click(button("Candidates"));
    expect(rowFor("kindoftsetsy")?.textContent).toContain("Seed list");
    expect(rowFor("another-one")).not.toBeNull();
  });

  it("a refused seed line is named by the line Dane typed, and the box keeps his text", async () => {
    await mount();
    await click(button("Run"));
    type(el<HTMLTextAreaElement>("#sm-seeds"), "good\n\nNot A Handle!, why");
    await submit(el<HTMLFormElement>('form[aria-label="Paste a seed list"]'));
    expect(text()).toContain("1 added.");
    expect(text()).toContain('Line 3 (Not A Handle!) was not added');
    expect(el<HTMLTextAreaElement>("#sm-seeds").value).toContain("Not A Handle!");
  });

  it("approving makes one contact, says Added to Contacts with a link, and the link opens it", async () => {
    stores.proj_doe.writers = [writer({ handle: "kindoftsetsy", name: "Kind of Tsetsy" })];
    await mount();
    await click(button("Approve", rowFor("kindoftsetsy")!));
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toEqual({ status: "approved" });
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
    await click(button("Approve", rowFor("one")!));
    await click(button("Approve", rowFor("two")!));
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
    await click(button("Reject", rowFor("notforus")!));
    expect(rowFor("notforus")).toBeNull();
    await reload();
    expect(rowFor("notforus")).toBeNull();
    await show("rejected");
    expect(rowFor("notforus")).not.toBeNull();
    expect(stores.proj_doe.writers[0].status).toBe("rejected");
  });

  it("a note typed before Approve travels with it, and is saved on its own when the box is left", async () => {
    stores.proj_doe.writers = [writer({ handle: "noted" }), writer({ handle: "other" })];
    await mount();
    const box = rowFor("other")!.querySelector<HTMLInputElement>("input")!;
    type(box, "maybe later");
    await act(async () => { box.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    await flush();
    expect(stores.proj_doe.writers[1].note).toBe("maybe later");

    type(rowFor("noted")!.querySelector<HTMLInputElement>("input")!, "great on Notes");
    await click(button("Approve", rowFor("noted")!));
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({ status: "approved", note: "great on Notes" });
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

  it("counts found, approved, rejected and in Contacts", () => {
    const rows = [writer({ status: "approved", contactId: "c1" }), writer({ status: "rejected", contactId: "c2" }), writer({})];
    expect(headerCounts(rows)).toEqual({ found: 3, approved: 1, rejected: 1, inContacts: 2 });
  });

  it("an empty table names the filter that emptied it", () => {
    const rows = [writer({ status: "approved" })];
    expect(emptyText([], "candidate", "")).toContain("No candidates yet");
    expect(emptyText(rows, "candidate", "")).toContain("every writer found has been approved or rejected");
    expect(emptyText(rows, "rejected", "seed")).toBe("Nothing rejected found via seed list.");
  });

  it("parses seed lines, keeping commas inside the reason", () => {
    expect(parseSeedLines("a, one, two\n\n@b")).toEqual({ rows: [{ handle: "a", whyFit: "one, two" }, { handle: "@b" }], lines: [1, 3] });
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
});
