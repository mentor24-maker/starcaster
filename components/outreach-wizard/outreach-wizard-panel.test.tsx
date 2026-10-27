// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OutreachWizardPanel, {
  CHANNEL_STORAGE_KEY,
  PROJECT_SWITCH_EVENT,
  openStageIndex,
  type OutreachChannel,
  type OutreachOverview,
  type OutreachStage,
} from "./outreach-wizard-panel";

/**
 * Outreach wizard 1/19 (86bcrmb8x). The screen is driven against a fake
 * /api/outreach/overview that answers PER PROJECT, so "still showing the old
 * project" after a switch is distinguishable from a fresh read.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function st(key: string, state: OutreachStage["state"], sentence: string, page = "engageSubstackNotesPage"): OutreachStage {
  return { key, label: key[0].toUpperCase() + key.slice(1), state, sentence, next: { label: `Go to ${key}`, page } };
}

function channel(key: string, label: string, stages: OutreachStage[]): OutreachChannel {
  return { key, label, stages };
}

function overviewFor(project: string): OutreachOverview {
  return {
    generatedAt: "2026-10-26T20:00:00Z",
    channels: [
      channel("youtube", "YouTube", [
        st("connect", "needs_you", `${project}: The browser is SIGNED OUT of YouTube.`, "engageYoutubeOutreachPage"),
        st("creators", "not_started", "No list yet."),
        st("conversations", "not_started", "0 videos."),
        st("replies", "not_started", "0 comments."),
        st("learn", "not_started", "Nothing learnt."),
      ]),
      channel("substack", "Substack", [
        st("connect", "done", "Signed in as Dane of Earth, checked 4 minutes ago."),
        st("creators", "done", "17 writers approved.", "acquireSubstackPage"),
        st("conversations", "cannot_tell", "Cannot tell. The Substack Notes list could not be read: boom."),
        st("replies", "not_started", "0 Notes."),
        st("learn", "not_started", "Nothing learnt."),
      ]),
      channel("reddit", "Reddit", [
        st("connect", "needs_you", "No Reddit account chosen."),
        st("creators", "not_started", "No subreddits."),
        st("conversations", "needs_you", "0 links pasted."),
        st("replies", "not_started", "0 comments."),
        st("learn", "not_started", "Nothing learnt."),
      ]),
    ],
  };
}

let activeProject = "proj_doe";
let failNext = "";
let calls = 0;
let setActivePage: ReturnType<typeof vi.fn>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  activeProject = "proj_doe";
  failNext = "";
  calls = 0;
  window.localStorage.clear();
  setActivePage = vi.fn();
  (window as any).App = {
    setActivePage,
    api: async (path: string) => {
      calls += 1;
      if (path !== "/api/outreach/overview") throw new Error(`unexpected ${path}`);
      if (failNext) {
        const why = failNext;
        failNext = "";
        throw new Error(why);
      }
      return { ok: true, data: overviewFor(activeProject) };
    },
  };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  delete (window as any).App;
});

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<OutreachWizardPanel />);
  });
  await act(async () => {});
}

function stages() {
  return Array.from(container!.querySelectorAll<HTMLLIElement>(".outreach-wizard-stage"));
}

function tab(label: string) {
  const b = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((x) => x.textContent === label);
  if (!b) throw new Error(`no tab ${label}`);
  return b;
}

describe("openStageIndex", () => {
  it("is the first stage that is not done, and -1 when every stage is", () => {
    expect(openStageIndex([st("a", "done", ""), st("b", "cannot_tell", ""), st("c", "needs_you", "")])).toBe(1);
    expect(openStageIndex([st("a", "done", "")])).toBe(-1);
  });
});

describe("OutreachWizardPanel", () => {
  it("shows the five stages with their sentences, and exactly one primary button on the open stage", async () => {
    await mount();
    const rows = stages();
    expect(rows.map((r) => r.dataset.stage)).toEqual(["connect", "creators", "conversations", "replies", "learn"]);
    expect(rows[0].textContent).toContain("proj_doe: The browser is SIGNED OUT of YouTube.");
    expect(rows[0].getAttribute("aria-current")).toBe("step");
    expect(rows[0].textContent).toContain("Needs you");
    const primaries = container!.querySelectorAll(".btn-primary");
    expect(primaries).toHaveLength(1);
    expect(rows[0].contains(primaries[0])).toBe(true);
    expect(primaries[0].getAttribute("href")).toBe("#page=engageYoutubeOutreachPage");
    // Collapsed stages still say where they stand.
    expect(rows[3].textContent).toContain("0 comments.");
  });

  it("opens the first stage not done — a 'cannot tell' stage is never drawn as done", async () => {
    await mount();
    await act(async () => tab("Substack").click());
    const rows = stages();
    expect(rows[2].getAttribute("aria-current")).toBe("step");
    expect(rows[2].textContent).toContain("Cannot tell");
    expect(rows[2].textContent).toContain("could not be read: boom");
    expect(rows[1].textContent).toContain("✓");
    expect(rows[2].textContent).not.toContain("✓");
    expect(container!.querySelectorAll(".btn-primary")).toHaveLength(1);
  });

  it("the button opens the screen for that step", async () => {
    await mount();
    const button = container!.querySelector<HTMLAnchorElement>(".btn-primary")!;
    await act(async () => button.click());
    expect(setActivePage).toHaveBeenCalledWith("engageYoutubeOutreachPage");
  });

  it("remembers the last channel per viewer, and survives storage that throws", async () => {
    await mount();
    await act(async () => tab("Reddit").click());
    expect(window.localStorage.getItem(CHANNEL_STORAGE_KEY)).toBe("reddit");
    act(() => root!.unmount());
    container!.remove();
    await mount();
    expect(container!.querySelector(".outreach-wizard-channel")!.getAttribute("data-channel")).toBe("reddit");

    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    act(() => root!.unmount());
    container!.remove();
    await mount();
    expect(container!.querySelector(".outreach-wizard-channel")!.getAttribute("data-channel")).toBe("youtube");
    spy.mockRestore();
  });

  it("says why when the whole read fails", async () => {
    failNext = "Server said 500";
    await mount();
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain("could not be read: Server said 500");
    expect(stages()).toHaveLength(0);
  });

  it("reads again on a project switch", async () => {
    await mount();
    activeProject = "proj_other";
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await act(async () => {});
    expect(calls).toBe(2);
    expect(stages()[0].textContent).toContain("proj_other:");
  });
});
