// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LearnControls, { evidenceLine, type Lesson, type LearnView } from "./learn-controls";

/**
 * Outreach wizard 13/19 (86bcrmbpm). The Learn stage against a fake
 * /api/outreach/lessons that keeps its own state, so "the screen shows what
 * was saved" is checked by re-reading, never by the click's own echo.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function lesson(id: string, text: string, extra: Partial<Lesson> = {}): Lesson {
  return { id, channel: "reddit", text, enabled: true, source: "suggested", edited: false, why: "from 4 rejections tagged \"too salesy\"", evidence: [], ...extra };
}

type Call = { path: string; method: string; body: Record<string, unknown> | null };

function fakeServer(initial: Lesson[], { failRead = false } = {}) {
  let lessons = initial.slice();
  const calls: Call[] = [];
  const api = async (path: string, options: RequestInit = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(String(options.body)) : null;
    calls.push({ path, method, body });
    if (method === "GET") {
      if (failRead) throw new Error("relation outreach_lessons does not exist — run docs/SQL/outreach_lessons_setup.sql");
      const view: LearnView = {
        channel: "reddit",
        lessons,
        score: { unedited: 6, counted: 20, window: 20, sentence: "Approved without edits, last 20: 6 of 20." },
        scoreError: "",
      };
      return { ok: true, data: view };
    }
    if (path.endsWith("/refresh")) {
      lessons = [...lessons, lesson("n1", "Ask one real question.")];
      return { ok: true, data: { added: 1, replaced: 0 } };
    }
    const id = decodeURIComponent(path.split("/").pop() || "");
    if (method === "DELETE") {
      lessons = lessons.filter((l) => l.id !== id);
      return { ok: true, data: { id, deleted: true } };
    }
    if (path === "/api/outreach/lessons") {
      lessons = [...lessons, lesson("own", String(body?.text), { channel: String(body?.channel), source: "dane", why: "You wrote this one." })];
      return { ok: true, data: {} };
    }
    lessons = lessons.map((l) => (l.id === id ? { ...l, ...(body as Partial<Lesson>), edited: body && "text" in body ? true : l.edited } : l));
    return { ok: true, data: {} };
  };
  return { api, calls, current: () => lessons };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { App?: unknown }).App;
});

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(server: ReturnType<typeof fakeServer>) {
  (window as unknown as { App: unknown }).App = { api: server.api };
  await act(async () => { root.render(<LearnControls channel="reddit" label="Reddit" />); });
  await flush();
}

function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LearnControls", () => {
  it("lists the lessons in plain words with the score, and says which apply to all channels", async () => {
    const server = fakeServer([lesson("a", "Never open with a compliment."), lesson("b", "No exclamation marks.", { channel: "all" })]);
    await mount(server);
    expect(server.calls[0].path).toBe("/api/outreach/lessons?channel=reddit");
    // The score is the stage sentence's job; it is not repeated here.
    expect(host.textContent).not.toContain("Approved without edits");
    const rows = [...host.querySelectorAll("[data-lesson]")];
    expect(rows.map((r) => r.querySelector(".outreach-lesson-text")?.textContent)).toEqual(["Never open with a compliment.", "No exclamation marks."]);
    expect(rows[0].textContent).toContain("Reddit only");
    expect(rows[1].textContent).toContain("All channels");
  });

  it("switching a lesson off sends enabled:false and then shows what the server saved", async () => {
    const server = fakeServer([lesson("a", "Never open with a compliment.")]);
    await mount(server);
    const box = host.querySelector<HTMLInputElement>('[data-lesson="a"] input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    await act(async () => { box.click(); });
    await flush();
    expect(server.calls.find((c) => c.method === "POST")).toEqual({ path: "/api/outreach/lessons/a", method: "POST", body: { enabled: false } });
    expect(host.querySelector<HTMLInputElement>('[data-lesson="a"] input[type="checkbox"]')!.checked).toBe(false);
    expect(host.querySelector('[data-lesson="a"]')?.className).toContain("outreach-lesson--off");
    expect(host.textContent).toContain("Every lesson is switched off");
  });

  it("Why shows the decisions behind a lesson", async () => {
    const server = fakeServer([lesson("a", "Never sound like you are selling.", {
      evidence: [{ feedbackId: "f1", action: "rejected", reasons: ["too salesy"], note: "reads like an ad", createdAt: null }],
    })]);
    await mount(server);
    await act(async () => { button("Why").click(); });
    const why = host.querySelector(".outreach-lesson-why")!;
    expect(why.textContent).toContain('Suggested from 4 rejections tagged "too salesy".');
    expect(why.textContent).toContain("Rejected (too salesy): “reads like an ad”");
  });

  it("edit, delete, add my own, and refresh each reach the server and re-read the list", async () => {
    const server = fakeServer([lesson("a", "Old words."), lesson("b", "Delete me.")]);
    await mount(server);

    await act(async () => { button("Edit", host.querySelector('[data-lesson="a"]')!).click(); });
    setInput(host.querySelector<HTMLInputElement>("#outreach-lesson-a")!, "New words.");
    await act(async () => { button("Save").click(); });
    await flush();
    expect(server.calls.some((c) => c.path === "/api/outreach/lessons/a" && (c.body as { text?: string })?.text === "New words.")).toBe(true);
    expect(host.querySelector('[data-lesson="a"] .outreach-lesson-text')?.textContent).toBe("New words.");

    await act(async () => { button("Delete", host.querySelector('[data-lesson="b"]')!).click(); });
    await flush();
    expect(host.querySelector('[data-lesson="b"]')).toBeNull();

    setInput(host.querySelector<HTMLInputElement>("#outreach-new-lesson-reddit")!, "Two sentences at most.");
    const scope = host.querySelector<HTMLSelectElement>("#outreach-new-lesson-scope-reddit")!;
    await act(async () => {
      scope.value = "all";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { button("Add Lesson").click(); });
    await flush();
    expect(server.calls.find((c) => c.path === "/api/outreach/lessons" && c.method === "POST")?.body).toEqual({ channel: "all", text: "Two sentences at most." });
    expect(host.querySelector('[data-lesson="own"]')?.textContent).toContain("All channels");

    await act(async () => { button("Refresh Lessons").click(); });
    await flush();
    expect(server.calls.find((c) => c.path === "/api/outreach/lessons/refresh")?.body).toEqual({ channel: "reddit" });
    expect(host.textContent).toContain("1 lesson suggested from your recent decisions.");
    expect(host.querySelector('[data-lesson="n1"]')).not.toBeNull();
  });

  it("an empty list says why it is empty; a failed read says why it failed", async () => {
    await mount(fakeServer([]));
    expect(host.textContent).toContain("No lessons for Reddit yet.");

    act(() => root.unmount());
    root = createRoot(host);
    await mount(fakeServer([], { failRead: true }));
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/The lessons could not be read: .*outreach_lessons_setup\.sql/);
  });
});

describe("evidenceLine", () => {
  it("names a skipped reason rather than leaving it blank", () => {
    expect(evidenceLine({ feedbackId: "x", action: "rejected", reasons: [], note: "", createdAt: null })).toBe("Rejected (no reason given)");
    expect(evidenceLine({ feedbackId: "x", action: "approved-edited", reasons: [], note: "", createdAt: null })).toBe("Approved after your edit");
  });
});
