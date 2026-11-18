// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MomentsView, { clock, lengthText, momentsSentence, notesLine, type Moments } from "./moments-view";

/**
 * Reel Spinner 2e (SC-830): every empty state names its reason (landmine 17),
 * the stale-notes line offers "Score again", and asking for it says it is
 * waiting for the Mac Mini — read off the answer, never assumed.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view(extra: Partial<Moments> = {}): Moments {
  return {
    sourceId: "src-1",
    driveUrl: "https://drive.google.com/file/d/d1/view",
    projectName: "Dane of Earth",
    notesMissing: "",
    notesError: "",
    state: "done",
    error: "",
    summary: "A talk about junior tennis.",
    moments: [
      { start_s: 754, end_s: 790, lengthS: 36, score: 91, reasons: ["clear and warm"], project: "Delray", mood: "", quote: "Every kid can play." },
      { start_s: 12, end_s: 20, lengthS: 8, score: 55, reasons: [], project: "", mood: "", quote: "" },
    ],
    model: "m",
    scoredAt: "2026-11-17T10:00:00Z",
    notesState: "current",
    rescoreRequestedAt: "",
    canRescore: true,
    ...extra,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let answer: Record<string, unknown> = {};
let rescoreAnswer: Record<string, unknown> = {};
let calls: { path: string; method: string }[] = [];
let pageShown = "";

beforeEach(() => {
  calls = [];
  pageShown = "";
  (window as unknown as { App: unknown }).App = {
    api: async (path: string, options: RequestInit = {}) => {
      calls.push({ path, method: String(options.method || "GET") });
      return path.endsWith("/rescore") ? rescoreAnswer : answer;
    },
    setActivePage: (id: string) => { pageShown = id; },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  delete (window as unknown as { App?: unknown }).App;
});

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(data: Moments | null, ok = true, message = "") {
  answer = ok ? { ok: true, data } : { ok: false, error: { message } };
  act(() => root?.render(<MomentsView sourceId="src-1" />));
  await flush();
}

const q = (id: string) => container?.querySelector(`[data-testid="${id}"]`) || null;

describe("helpers", () => {
  it("says a time as a clock and a length in words", () => {
    expect(clock(754)).toBe("12:34");
    expect(clock(3723)).toBe("1:02:03");
    expect(lengthText(8)).toBe("8 s");
    expect(lengthText(65)).toBe("1 min 5 s");
  });

  it("names a reason for every empty list", () => {
    expect(momentsSentence({ state: "not_yet", error: "", moments: [] })).toMatch(/^Not scored yet/);
    expect(momentsSentence({ state: "failed", error: "the model timed out", moments: [] })).toBe("Scoring failed: the model timed out");
    expect(momentsSentence({ state: "failed", error: "", moments: [] })).toBe("Scoring failed: no reason was recorded");
    expect(momentsSentence({ state: "done", error: "", moments: [] })).toMatch(/nothing in this recording stood out/);
  });

  it("never reads 'could not tell' as current", () => {
    expect(notesLine({ notesState: "current", notesError: "" })).toBe("");
    expect(notesLine({ notesState: "stale", notesError: "" })).toMatch(/older Reel Spinner notes/);
    expect(notesLine({ notesState: "unknown", notesError: "used_by missing" })).toMatch(/Could not tell.*used_by missing/);
    expect(notesLine({ notesState: "unrecorded", notesError: "" })).toMatch(/cannot be told/);
  });
});

describe("MomentsView", () => {
  it("shows the summary and each moment with score, quote, reason and where it starts", async () => {
    await mount(view());
    expect(calls).toEqual([{ path: "/api/studio/sources/src-1/moments", method: "GET" }]);
    expect(q("studio-moments-summary")?.textContent).toBe("A talk about junior tennis.");
    const items = [...(container?.querySelectorAll('[data-testid="studio-moment"]') || [])];
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("91");
    expect(items[0].textContent).toContain("12:34–13:10 · 36 s · Delray");
    expect(items[0].textContent).toContain("Every kid can play.");
    expect(items[0].textContent).toContain("clear and warm");
    expect(items[0].textContent).toContain("starts at 12:34");
    expect(items[0].querySelector("a")?.getAttribute("href")).toBe("https://drive.google.com/file/d/d1/view");
    expect(q("studio-moments-rescore")).toBeNull();
    expect(q("studio-moments-notes-line")).toBeNull();
  });

  it("not scored yet says so, with nothing to score again", async () => {
    await mount(view({ state: "not_yet", moments: [], summary: "", canRescore: false, notesState: "not_scored" }));
    expect(q("studio-moments-empty")?.textContent).toMatch(/^Not scored yet/);
    expect(q("studio-moments-rescore")).toBeNull();
  });

  it("a failed score says why and offers Score again", async () => {
    await mount(view({ state: "failed", error: "the model timed out", moments: [], summary: "" }));
    expect(q("studio-moments-empty")?.textContent).toBe("Scoring failed: the model timed out");
    expect(q("studio-moments-rescore")).not.toBeNull();
  });

  it("no notes switched on names the project and links to Assets › Context", async () => {
    await mount(view({ notesMissing: "No Reel Spinner notes are switched on in Dane of Earth.", state: "not_yet", moments: [], canRescore: false }));
    const note = q("studio-moments-no-notes");
    expect(note?.textContent).toContain("No Reel Spinner notes are switched on in Dane of Earth.");
    const link = note?.querySelector("a");
    expect(link?.textContent).toBe("Assets › Context");
    act(() => link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(pageShown).toBe("assetsContextPage");
  });

  it("a read that failed says so, never 'not scored yet'", async () => {
    await mount(null, false, "Could not read the moments: relation missing");
    expect(container?.textContent).toContain("Moments not shown: Could not read the moments: relation missing");
    expect(container?.textContent).not.toContain("Not scored yet");
  });

  it("stale notes: says so, Score again asks once, then shows it is waiting for the Mac Mini", async () => {
    await mount(view({ notesState: "stale" }));
    expect(q("studio-moments-notes-line")?.textContent).toMatch(/older Reel Spinner notes/);
    rescoreAnswer = { ok: true, data: { sourceId: "src-1", rescoreRequestedAt: "2026-11-17T22:00:00Z" } };
    act(() => (q("studio-moments-rescore") as HTMLButtonElement).click());
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toEqual([{ path: "/api/studio/sources/src-1/moments/rescore", method: "POST" }]);
    expect(q("studio-moments-waiting")?.textContent).toBe("Asked to score again — waiting for the Mac Mini.");
    expect(q("studio-moments-rescore")).toBeNull();
  });

  it("a refused rescore says it was not asked, and does not claim to be waiting", async () => {
    await mount(view({ notesState: "stale" }));
    rescoreAnswer = { ok: false, error: { message: "database said no" } };
    act(() => (q("studio-moments-rescore") as HTMLButtonElement).click());
    await flush();
    expect(container?.textContent).toContain("Not asked to score again: database said no");
    expect(q("studio-moments-waiting")).toBeNull();
  });

  it("a rescore already asked for reads as waiting on load", async () => {
    await mount(view({ notesState: "stale", rescoreRequestedAt: "2026-11-17T21:00:00Z" }));
    expect(q("studio-moments-waiting")).not.toBeNull();
    expect(q("studio-moments-rescore")).toBeNull();
  });
});
