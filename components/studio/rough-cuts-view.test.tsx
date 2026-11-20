// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RoughCutsView, {
  emptySentence, editTitle, lengthLine, verdictLine, type Group, type RoughCut, type RoughCuts,
} from "./rough-cuts-view";

/**
 * Reel Spinner 4c (SC-835): each button writes its verdict and the screen
 * shows what the database then holds — the same picture a reload gives; a
 * send-back with no note is refused on screen and never sent; every empty
 * screen says why (landmine 17).
 *
 * The fake App.api below is a tiny database: verdicts change its rows, and a
 * GET builds the answer from those rows, so "survives a reload" is tested by
 * unmounting the screen and mounting a fresh one.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GROUP_OF: Record<string, Group> = {
  review: "waiting", approved: "approved", finished: "approved", skipped: "skipped", sent_back: "sent_back",
};

function edit(id: string, extra: Partial<RoughCut> = {}): RoughCut {
  return {
    id,
    sourceId: "src-1",
    recordingName: "IMG_1962.MOV",
    recordedAt: "2026-11-10T15:00:00Z",
    recordingLengthS: 149,
    kind: "full",
    momentIndex: null,
    status: "review",
    group: "waiting",
    lengthS: 123,
    savedS: 26,
    moment: null,
    watchUrl: `https://drive.google.com/file/d/rc-${id}/view`,
    music: { trackId: "", label: "No music picked" },
    daneNote: "",
    recutCount: 0,
    updatedAt: "",
    ...extra,
  };
}

let rows: RoughCut[] = [];
let making = 0;
let calls: { path: string; method: string; body: unknown }[] = [];
let refuseWrites = "";

function answer(): RoughCuts {
  const counts = { waiting: 0, approved: 0, skipped: 0, sent_back: 0, making };
  const edits = rows.map((r) => ({ ...r, group: GROUP_OF[r.status] }));
  for (const e of edits) counts[e.group] += 1;
  return { edits, counts, truncated: false, readLimit: 1000, momentsError: "" };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  rows = [];
  making = 0;
  calls = [];
  refuseWrites = "";
  (window as unknown as { App: unknown }).App = {
    api: async (path: string, options: RequestInit = {}) => {
      const method = String(options.method || "GET");
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ path, method, body });
      if (method === "GET") return { ok: true, data: answer() };
      if (refuseWrites) return { ok: false, error: { message: refuseWrites } };
      const id = decodeURIComponent(path.split("/")[4]);
      const row = rows.find((r) => r.id === id);
      if (!row) return { ok: false, error: { message: "That edit does not exist in this project" } };
      if (body.status) row.status = body.status;
      if (body.daneNote !== undefined) row.daneNote = body.daneNote;
      const yt = row.youtube || { title: "", description: "", tags: [], missing: "" };
      if (body.youtubeTitle !== undefined) yt.title = body.youtubeTitle;
      if (body.youtubeDescription !== undefined) yt.description = body.youtubeDescription;
      if (body.youtubeTags !== undefined) yt.tags = body.youtubeTags;
      row.youtube = yt;
      return { ok: true, data: { id, status: row.status, daneNote: row.daneNote } };
    },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(): Promise<void> {
  await act(async () => { root!.render(<RoughCutsView />); });
  await flush();
}

/** Unmount and mount a brand new screen — what Cmd+R does to it. */
async function reload(): Promise<void> {
  act(() => root?.unmount());
  root = createRoot(container!);
  await mount();
}

function q(sel: string): HTMLElement | null {
  return container!.querySelector(sel);
}

function cards(): HTMLElement[] {
  return Array.from(container!.querySelectorAll<HTMLElement>('[data-testid="studio-roughcut"]'));
}

function button(scope: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!found) throw new Error(`no ${label} button`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await flush();
}

function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("rough cuts: what each line says", () => {
  it("names a full edit and a short by where it starts", () => {
    expect(editTitle({ kind: "full", moment: null })).toBe("Full edit");
    expect(editTitle({ kind: "short", moment: { startS: 753, endS: 790, score: 92, reasons: [], quote: "" } }))
      .toBe("Short from 12:33");
  });

  it("says how long it is and how much was taken out, or that the saving is unknown", () => {
    expect(lengthLine({ lengthS: 123, savedS: 26 })).toBe("2 min 3 s long · 26 s taken out");
    expect(lengthLine({ lengthS: 47, savedS: null })).toContain("time saved not known");
  });

  it("says what happened to one he has answered", () => {
    expect(verdictLine({ status: "approved", group: "approved", daneNote: "" })).toContain("Approved");
    expect(verdictLine({ status: "on_youtube", group: "approved", daneNote: "" })).toBe("Approved — on YouTube.");
    expect(verdictLine({ status: "sent_back", group: "sent_back", daneNote: "trim the start" }))
      .toBe('Sent back: "trim the start"');
    expect(verdictLine({ status: "review", group: "waiting", daneNote: "" })).toBe("");
    // Reel Spinner 4d: a re-cut says which note it answers; a hand-back says why it was not re-cut.
    expect(verdictLine({ status: "review", group: "waiting", daneNote: "start two seconds later", recutCount: 1 }))
      .toBe('Re-cut from your note: "start two seconds later"');
    expect(verdictLine({ status: "review", group: "waiting", daneNote: "make it purple", recutCount: 0, recutProblem: "could not re-cut from your note: colour is not an edit" }))
      .toBe("Could not re-cut from your note: colour is not an edit");
    expect(verdictLine({ status: "review", group: "waiting", daneNote: "x", recutCount: 3, recutProblem: "re-cut 3 times; tell an agent session what is still wrong" }))
      .toBe("Re-cut 3 times; tell an agent session what is still wrong");
  });

  it("every empty screen names its reason", () => {
    const counts = (c: Partial<RoughCuts["counts"]>) => ({
      counts: { waiting: 0, approved: 0, skipped: 0, sent_back: 0, making: 0, ...c },
    });
    expect(emptySentence(counts({}), "waiting")).toContain("the Mac Mini has not made any");
    expect(emptySentence(counts({ making: 2 }), "waiting")).toContain("the Mac Mini is making 2");
    expect(emptySentence(counts({ approved: 1 }), "waiting")).toContain("Nothing waiting for you");
    expect(emptySentence(counts({ waiting: 1 }), "waiting")).toBe("");
    expect(emptySentence(counts({ waiting: 1 }), "skipped")).toBe("Nothing skipped.");
  });
});

describe("rough cuts screen", () => {
  it("shows each rough cut waiting, with its watch link, score and reasons", async () => {
    rows = [
      edit("full-1"),
      edit("short-1", {
        kind: "short", momentIndex: 0, lengthS: 47, savedS: 4,
        moment: { startS: 753, endS: 800, score: 92, reasons: ["names the project"], quote: "Every kid can play." },
      }),
    ];
    await mount();
    expect(q('[data-testid="studio-roughcuts-waiting"]')!.textContent).toBe("2 waiting for you");
    expect(cards()).toHaveLength(2);
    const short = cards()[1];
    expect(short.textContent).toContain("Short from 12:33");
    expect(short.textContent).toContain("names the project");
    expect(short.querySelector('[aria-label="Score 92 out of 100"]')).not.toBeNull();
    expect(cards()[0].querySelector("a")!.getAttribute("href")).toBe("https://drive.google.com/file/d/rc-full-1/view");
  });

  it.each([
    ["Approve", "approved", "studio-roughcuts-approved", "1 approved"],
    ["Skip", "skipped", "studio-roughcuts-skipped", "1 skipped"],
  ])("%s writes %s, and it survives a reload", async (label, status, countId, countText) => {
    rows = [edit("e1")];
    await mount();
    await click(button(cards()[0], label));
    expect(calls.find((c) => c.method === "POST")).toEqual({
      path: "/api/studio/rough-cuts/e1/review", method: "POST", body: { status },
    });
    // Gone from waiting, counted under its new group — read back, not assumed.
    expect(cards()).toHaveLength(0);
    expect(q('[data-testid="studio-roughcuts-empty"]')!.textContent).toContain("Nothing waiting for you");
    expect(q(`[data-testid="${countId}"]`)!.textContent).toBe(countText);

    await reload();
    expect(q('[data-testid="studio-roughcuts-waiting"]')!.textContent).toBe("0 waiting for you");
    await click(q(`[data-testid="${countId}"]`)!);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].querySelector('[data-testid="studio-roughcut-verdict"]')).not.toBeNull();
    // No verdict buttons once answered. An approved cut keeps Save text: its
    // YouTube text is his to change until it starts uploading (6a).
    const labels = Array.from(cards()[0].querySelectorAll("button")).map((b) => b.textContent);
    expect(labels.filter((l) => ["Approve", "Skip", "Send back"].includes(String(l)))).toEqual([]);
  });

  it("Send back needs a note: without one it is refused on screen and nothing is sent", async () => {
    rows = [edit("e1")];
    await mount();
    await click(button(cards()[0], "Send back"));
    const note = q('[data-testid="studio-roughcut-note"]') as HTMLTextAreaElement;
    typeInto(note, "   ");
    await click(button(cards()[0], "Send back"));
    expect(q('[role="alert"]')!.textContent).toBe("Say what to change before sending it back.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(rows[0].status).toBe("review");
  });

  it("Send back with a note writes the verdict and the note, and both survive a reload", async () => {
    rows = [edit("e1")];
    await mount();
    await click(button(cards()[0], "Send back"));
    typeInto(q('[data-testid="studio-roughcut-note"]') as HTMLTextAreaElement, "  start at the second sentence ");
    await click(button(cards()[0], "Send back"));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      status: "sent_back", daneNote: "start at the second sentence",
    });
    await reload();
    await click(q('[data-testid="studio-roughcuts-sent_back"]')!);
    expect(cards()[0].textContent).toContain('Sent back: "start at the second sentence"');
  });

  it("a refused verdict says so on that rough cut and leaves it waiting", async () => {
    rows = [edit("e1")];
    refuseWrites = "An edit cannot move from approved to skipped: approved is the end of the line";
    await mount();
    await click(button(cards()[0], "Skip"));
    expect(q('[role="alert"]')!.textContent).toContain("Not saved: An edit cannot move");
    expect(cards()).toHaveLength(1);
  });

  it("after a refusal the list is read again, so stale buttons do not stay", async () => {
    rows = [edit("e1")];
    refuseWrites = "Not in review any more";
    await mount();
    const readsBefore = calls.filter((c) => c.method === "GET").length;
    // Someone else's answer landed first: the row has moved on.
    rows[0].status = "approved";
    await click(button(cards()[0], "Skip"));
    expect(calls.filter((c) => c.method === "GET").length).toBe(readsBefore + 1);
    expect(cards()).toHaveLength(0);
  });

  it("each card names its music, read-only", async () => {
    rows = [edit("e1", { music: { trackId: "inspired", label: "Inspired, Kevin MacLeod" } }), edit("e2")];
    await mount();
    const music = cards().map((c) => c.querySelector('[data-testid="studio-roughcut-music"]')!.textContent);
    expect(music).toEqual(["Music: Inspired, Kevin MacLeod", "Music: No music picked"]);
  });

  it("shows the Mini's YouTube text in boxes, and a changed title survives a reload", async () => {
    rows = [edit("e1", { youtube: { title: "Why a court can start a neighbourhood", description: "About WaveCenter.", tags: ["WaveCenter", "tennis"], missing: "" } })];
    await mount();
    const title = q('[data-testid="studio-roughcut-title"]') as HTMLInputElement;
    expect(title.value).toBe("Why a court can start a neighbourhood");
    expect((q('[data-testid="studio-roughcut-tags"]') as HTMLInputElement).value).toBe("WaveCenter, tennis");
    expect(button(cards()[0], "Save text").disabled).toBe(true);
    typeInto(title, "Why a tennis court can start a neighbourhood");
    await click(button(cards()[0], "Save text"));
    // Only the box he changed is sent, and no verdict with it.
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ youtubeTitle: "Why a tennis court can start a neighbourhood" });
    expect(rows[0].status).toBe("review");
    await reload();
    expect((q('[data-testid="studio-roughcut-title"]') as HTMLInputElement).value).toBe("Why a tennis court can start a neighbourhood");
  });

  it("Approve sends what is in the boxes with the verdict", async () => {
    rows = [edit("e1", { youtube: { title: "Old", description: "Body.", tags: ["a"], missing: "" } })];
    await mount();
    typeInto(q('[data-testid="studio-roughcut-tags"]') as HTMLInputElement, "a, b ,, c");
    await click(button(cards()[0], "Approve"));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ status: "approved", youtubeTags: ["a", "b", "c"] });
  });

  it("an empty box says why it is empty", async () => {
    rows = [edit("e1", { youtube: { title: "", description: "", tags: [], missing: "YouTube text not written yet: no end card for DEO in Reel Spinner — end cards" } })];
    await mount();
    expect(q('[data-testid="studio-roughcut-youtube-missing"]')!.textContent).toContain("no end card for DEO");
  });

  it("with nothing made, says the Mac Mini has not made any", async () => {
    await mount();
    expect(q('[data-testid="studio-roughcuts-empty"]')!.textContent).toContain("the Mac Mini has not made any");
  });
});
