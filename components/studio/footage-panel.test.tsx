// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FootagePanel, { PROJECT_SWITCH_EVENT, timestamp, transcriptSentence } from "./footage-panel";

/**
 * Review round 1 of Studio 8/8 (86bbjv68z) found two defects by driving the
 * screen, neither of which showed an error:
 *
 *  1. Switching client left the previous client's footage on screen under the
 *     new client's name — the panel reloaded only when its page was SHOWN, and
 *     a project switch neither shows nor hides it.
 *  2. A preview that failed once said "No preview yet" forever: clicking
 *     Refresh sent zero thumbnail requests. docs/STUDIO.md tells the operator
 *     to wait for Drive and Refresh, so the screen's own button did nothing.
 *
 * Both fixtures below are shaped so that dropping the fix fails loudly: both
 * projects HAVE footage (so "still showing the old list" is distinguishable
 * from "empty"), and the preview fails before it succeeds.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function footage(title: string, ids: string[]) {
  return {
    totalSources: ids.length,
    shownSources: ids.length,
    undated: 0,
    newestAddedAt: "2026-09-10T00:00:00Z",
    stateCounts: { probed: ids.length },
    lanes: [{ lane: "iphone", count: ids.length }],
    truncated: false,
    readLimit: 1000,
    sessions: [{
      id: `session-${title}`,
      title,
      recordedAt: "2026-09-01T15:00:00Z",
      state: "new",
      sources: ids.map((id) => ({
        id,
        lane: "iphone",
        layerRole: "subject",
        durationS: 12,
        width: 1920,
        height: 1080,
        state: "probed",
        date: "2026-09-01T15:00:00Z",
        dateSource: "recorded",
        hasDriveFile: true,
        fileName: `${id}.MOV`,
        driveUrl: `https://drive.google.com/file/d/drv-${id}/view`,
        transcript: { state: "not_yet", reason: "" } as { state: string; reason: string },
      })),
    }],
  };
}

const CATALOG: Record<string, ReturnType<typeof footage>> = {
  proj_fixture: footage("Fixture shoot", ["fx-1", "fx-2"]),
  proj_delray: footage("Delray match", ["dl-1"]),
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let activeProject = "proj_fixture";
let footageReads: string[] = [];
let thumbnailRequests: string[] = [];
let thumbnailsWork = false;
let transcriptReads: string[] = [];
const TRANSCRIPT = {
  sourceId: "fx-1",
  state: "done",
  language: "en",
  segments: [
    { start: 0, end: 4.2, text: "Hello and welcome." },
    { start: 12.9, end: 18, text: "Today we talk about pricing." },
    { start: 3725.4, end: 3730, text: "That is the whole set." },
  ],
};

async function flush() {
  // A few turns of the microtask queue: api() → setData → Thumbnail effect → fetch → blob.
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<FootagePanel />); });
  await flush();
}

function sessionTitles(): string[] {
  return [...(container?.querySelectorAll(".studio-footage-session h3") || [])].map((h) => h.textContent || "");
}

function clickRefresh() {
  const button = [...(container?.querySelectorAll("button") || [])].find((b) => b.textContent === "Refresh");
  if (!button) throw new Error("no Refresh button");
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

beforeEach(() => {
  activeProject = "proj_fixture";
  footageReads = [];
  thumbnailRequests = [];
  thumbnailsWork = false;
  transcriptReads = [];
  (window as unknown as { App: unknown }).App = {
    api: async (path: string) => {
      if (path.includes("/transcript")) {
        transcriptReads.push(path);
        return { ok: true, data: TRANSCRIPT };
      }
      footageReads.push(`${activeProject} ${path}`);
      return { ok: true, data: CATALOG[activeProject] };
    },
    projectContext: { getSessionProjectId: () => activeProject },
    getSessionToken: () => "tok",
  };
  // A hand-made reply rather than `new Response(blob)`: Node's Response does not
  // read jsdom's Blob the same way on every Node version, and CI (Node 22)
  // never produced an image from it while Node 24 did.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    thumbnailRequests.push(String(url));
    const type = thumbnailsWork ? "image/jpeg" : "application/json";
    return {
      ok: thumbnailsWork,
      status: thumbnailsWork ? 200 : 404,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? type : null) },
      blob: async () => ({ size: 3, type }),
    };
  }));
  URL.createObjectURL = vi.fn(() => `blob:preview-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
  delete (window as unknown as { App?: unknown }).App;
});

describe("Footage panel — switching client", () => {
  it("replaces the list with the new client's footage when the project is switched", async () => {
    await mount();
    expect(sessionTitles()).toEqual(["Fixture shoot"]);

    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new CustomEvent(PROJECT_SWITCH_EVENT, { detail: { projectId: "proj_delray" } })); });
    await flush();

    expect(footageReads.at(-1)).toMatch(/^proj_delray /);
    expect(sessionTitles()).toEqual(["Delray match"]);
    expect(container?.textContent).not.toContain("Fixture shoot");
  });

  it("drops a reply for the old client that arrives after the switch", async () => {
    let releaseOld: (() => void) | null = null;
    const app = (window as unknown as { App: { api: (p: string) => Promise<unknown> } }).App;
    const real = app.api;
    app.api = (path: string) => {
      if (activeProject === "proj_fixture" && !releaseOld) {
        const asked = CATALOG.proj_fixture;
        return new Promise((resolve) => { releaseOld = () => resolve({ ok: true, data: asked }); });
      }
      return real(path);
    };
    await mount();
    activeProject = "proj_delray";
    await act(async () => { window.dispatchEvent(new CustomEvent(PROJECT_SWITCH_EVENT)); });
    await flush();
    expect(sessionTitles()).toEqual(["Delray match"]);

    await act(async () => { releaseOld?.(); });
    await flush();
    expect(sessionTitles()).toEqual(["Delray match"]);
  });
});

describe("Footage panel — Refresh retries previews", () => {
  it("asks again for a preview that failed, and shows it once Drive has one", async () => {
    await mount();
    const firstPaint = thumbnailRequests.length;
    expect(firstPaint).toBe(2);
    expect(container?.querySelectorAll("img").length).toBe(0);
    expect(container?.textContent).toContain("No preview yet");

    thumbnailsWork = true;
    clickRefresh();
    await flush();

    expect(thumbnailRequests.length).toBeGreaterThan(firstPaint);
    expect(container?.querySelectorAll("img").length).toBe(2);
    expect(container?.textContent).not.toContain("No preview yet");
  });

  it("does not fetch a preview again once it is on screen", async () => {
    thumbnailsWork = true;
    await mount();
    expect(container?.querySelectorAll("img").length).toBe(2);
    const before = thumbnailRequests.length;

    clickRefresh();
    await flush();

    expect(thumbnailRequests.length).toBe(before);
    expect(container?.querySelectorAll("img").length).toBe(2);
  });
});

describe("Footage panel — watching a recording (86bcdejzy)", () => {
  it("the file name and the preview both open the original in Drive, in a new tab", async () => {
    await mount();
    const links = [...(container?.querySelectorAll("a") || [])].filter((a) => a.getAttribute("href") === "https://drive.google.com/file/d/drv-fx-1/view");
    expect(links.length).toBe(2);
    expect(links.some((a) => a.textContent === "fx-1.MOV")).toBe(true);
    expect(links.some((a) => a.querySelector(".studio-footage-thumb"))).toBe(true);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener");
    }
  });

  it("a file with no Drive copy shows its name and why, never a dead link", async () => {
    const row = CATALOG.proj_fixture.sessions[0].sources[0];
    const saved = { ...row };
    Object.assign(row, { hasDriveFile: false, driveUrl: null });
    try {
      await mount();
      const firstRow = container?.querySelector("tbody tr");
      expect(firstRow?.querySelectorAll("a").length).toBe(0);
      expect(firstRow?.textContent).toContain("fx-1.MOV");
      expect(firstRow?.textContent).toContain("not from Drive");
    } finally {
      Object.assign(row, saved);
    }
  });
});

describe("Footage panel — reading what was said (86bcdek0e)", () => {
  function withStates(states: Record<string, { state: string; reason: string }>) {
    const rows = CATALOG.proj_fixture.sessions[0].sources;
    const saved = rows.map((r) => ({ ...r.transcript }));
    rows.forEach((r) => { if (states[r.id]) r.transcript = states[r.id]; });
    return () => rows.forEach((r, i) => { r.transcript = saved[i]; });
  }

  function rowText(id: string): string {
    const rows = [...(container?.querySelectorAll("tbody tr") || [])];
    return rows.find((r) => r.textContent?.includes(`${id}.MOV`))?.textContent || "";
  }

  it("each transcript state says its own sentence; only a finished one has a button", async () => {
    const restore = withStates({
      "fx-1": { state: "failed", reason: "whisper-cli exited 1" },
      "fx-2": { state: "no_audio", reason: "" },
    });
    try {
      await mount();
      expect(rowText("fx-1")).toContain("Transcription failed: whisper-cli exited 1");
      expect(rowText("fx-2")).toContain("No transcript: this file has no sound");
      expect(container?.querySelectorAll('[data-testid="studio-transcript-open"]').length).toBe(0);
    } finally {
      restore();
    }
    expect(transcriptSentence({ state: "done", reason: "" })).toBe("Transcribed");
    expect(transcriptSentence({ state: "plate", reason: "" })).toMatch(/Plates/);
    expect(transcriptSentence({ state: "not_yet", reason: "" })).toBe("Not transcribed yet");
    expect(transcriptSentence({ state: "unknown", reason: "" })).toMatch(/Could not read/);
  });

  it("a finished transcript opens as lines, each starting with its time", async () => {
    const restore = withStates({ "fx-1": { state: "done", reason: "" } });
    try {
      await mount();
      const buttons = [...(container?.querySelectorAll('[data-testid="studio-transcript-open"]') || [])];
      expect(buttons.length).toBe(1);
      act(() => { buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await flush();

      expect(transcriptReads).toEqual(["/api/studio/sources/fx-1/transcript"]);
      const lines = [...(container?.querySelectorAll('[data-testid="studio-transcript-lines"] li') || [])]
        .map((li) => li.textContent);
      expect(lines).toEqual([
        "0:00Hello and welcome.",
        "0:12Today we talk about pricing.",
        "1:02:05That is the whole set.",
      ]);
      expect(container?.textContent).toContain("Transcript of fx-1.MOV");

      const close = [...(container?.querySelectorAll("button") || [])].find((b) => b.textContent === "Close");
      act(() => { close!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(container?.querySelector('[data-testid="studio-transcript-lines"]')).toBeNull();
    } finally {
      restore();
    }
  });

  it("times are floored, never rounded up past what was said", () => {
    expect(timestamp(59.9)).toBe("0:59");
    expect(timestamp(0)).toBe("0:00");
    expect(timestamp(3600)).toBe("1:00:00");
  });
});
