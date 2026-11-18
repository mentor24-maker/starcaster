// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PairLines, { pairSentence, type PairView } from "./pair-lines";

/**
 * Reel Spinner 3b (SC-832): a recording made together with another says so
 * and whose sound the edit uses; a refused pair says why; the switch sends
 * the OTHER recording's id and only reloads the list when the save answered ok.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pair(extra: Partial<PairView> = {}): PairView {
  return {
    pairId: "pair-1",
    partnerId: "src-zoom",
    partnerName: "zoom_call.mp4",
    status: "done",
    reason: "",
    offsetS: -20,
    soundFromId: "src-zoom",
    soundFromName: "zoom_call.mp4",
    soundIsThisFile: false,
    chosenBy: "measured",
    ...extra,
  };
}

describe("pairSentence", () => {
  it("names the partner and the cleaner sound", () => {
    expect(pairSentence(pair(), "IMG_2001.MOV")).toBe("Recorded together with zoom_call.mp4, sound from zoom_call.mp4 (cleaner).");
  });
  it("says when the sound is Dane's choice, and when it is this file's", () => {
    expect(pairSentence(pair({ soundFromId: "src-phone", soundIsThisFile: true, chosenBy: "dane" }), "IMG_2001.MOV"))
      .toBe("Recorded together with zoom_call.mp4, sound from IMG_2001.MOV (your choice).");
  });
  it("says neither was cleaner rather than pretending one was", () => {
    expect(pairSentence(pair({ soundFromId: null, soundFromName: "" }), "IMG_2001.MOV")).toMatch(/Neither sound was clearly cleaner/);
  });
  it("a refused pair says why", () => {
    expect(pairSentence(pair({ status: "failed", reason: "the two clocks drift apart (0.25 s by the end)" }), "x"))
      .toBe("Recorded at the same time as zoom_call.mp4, but the two could not be lined up: the two clocks drift apart (0.25 s by the end).");
  });
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let calls: { path: string; method: string; body: string }[] = [];
let answer: Record<string, unknown> = { ok: true, data: {} };
let reloads = 0;

beforeEach(() => {
  calls = [];
  reloads = 0;
  answer = { ok: true, data: { chosenBy: "dane" } };
  (window as unknown as { App: unknown }).App = {
    api: async (path: string, options: RequestInit = {}) => {
      calls.push({ path, method: String(options.method || "GET"), body: String(options.body || "") });
      return answer;
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
});

async function show(pairs: PairView[]) {
  await act(async () => {
    root!.render(<PairLines pairs={pairs} sourceId="src-phone" thisName="IMG_2001.MOV" onChanged={() => { reloads += 1; }} />);
  });
}

describe("PairLines", () => {
  it("renders nothing for a recording with no pair", async () => {
    await show([]);
    expect(container!.innerHTML).toBe("");
  });

  it("the switch asks for the OTHER sound and reloads once saved", async () => {
    await show([pair()]);
    const buttons = container!.querySelectorAll<HTMLButtonElement>('[data-testid="studio-pair-switch"]');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe("Use this file's sound");
    await act(async () => { buttons[0].click(); });
    expect(calls).toEqual([{ path: "/api/studio/pairs/pair-1/sound", method: "POST", body: JSON.stringify({ audioSourceId: "src-phone" }) }]);
    expect(reloads).toBe(1);
  });

  it("a refused save says so and does not reload", async () => {
    answer = { ok: false, error: { message: "That pair does not exist in this project" } };
    await show([pair()]);
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-testid="studio-pair-switch"]')!.click(); });
    expect(container!.textContent).toMatch(/Not saved: That pair does not exist in this project/);
    expect(reloads).toBe(0);
  });

  it("with no sound chosen, both are offered; a refused pair offers none", async () => {
    await show([pair({ soundFromId: null, soundFromName: "" }), pair({ pairId: "pair-2", status: "failed", reason: "their sound did not match anywhere" })]);
    const items = container!.querySelectorAll('[data-testid="studio-pair"]');
    expect(items[0].querySelectorAll("button").length).toBe(2);
    expect(items[1].querySelectorAll("button").length).toBe(0);
    expect(items[1].textContent).toMatch(/did not match anywhere/);
  });
});
