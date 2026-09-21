// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FootagePanel, { PROJECT_SWITCH_EVENT } from "./footage-panel";

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
  (window as unknown as { App: unknown }).App = {
    api: async (path: string) => {
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
