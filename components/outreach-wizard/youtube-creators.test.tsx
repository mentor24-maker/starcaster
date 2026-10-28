// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YoutubeCreators, { CREATORS_PATH, findSummaryText, subscriberText, type YoutubeCreator } from "./youtube-creators";

/**
 * Outreach wizard 15/19 (86bcrmbrf). Driven against a fake App.api that keeps
 * the channel list, so a decision is checked by what the server was sent AND
 * what the card shows afterwards.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function creator(id: string, extra: Partial<YoutubeCreator> = {}): YoutubeCreator {
  return {
    id,
    channelId: `UC${id.padStart(22, "x")}`,
    channelUrl: `https://www.youtube.com/channel/UC${id}`,
    name: `Channel ${id}`,
    avatarUrl: "https://yt3.example.com/a.jpg",
    subscriberCount: 12400,
    latestVideos: [{ videoId: "abcdefghijk", title: "On awareness" }],
    keywordsHit: ["consciousness"],
    status: "candidate",
    decisionReasons: [],
    note: "",
    suggestion: { action: "approved", reasons: ["consciousness"], confidence: "low", why: "Talks about minds." },
    ...extra,
  };
}

let host: HTMLDivElement;
let root: Root;
let calls: Array<{ path: string; method: string; body: any }>;
let list: YoutubeCreator[];
let findAnswer: Record<string, any>;

async function flush() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  calls = [];
  list = [creator("1"), creator("2", { suggestion: null }), creator("3", { status: "rejected", decisionReasons: ["off topic"] })];
  findAnswer = { keywordsSearched: ["consciousness"], added: 2, merged: 0, cannotTell: "" };
  (window as any).App = {
    api: async (path: string, options: RequestInit = {}) => {
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(String(options.body)) : null;
      calls.push({ path, method, body });
      if (path === CREATORS_PATH) return { data: { creators: list, keywords: { keywords: ["consciousness"], source: "substack_miner" } } };
      if (path.endsWith("/find")) return { data: findAnswer };
      if (path.endsWith("/suggest")) return { data: { suggested: [{}], undecided: 2, fromCanonOnly: true } };
      const m = path.match(/creators\/([^/]+)\/decide$/);
      if (m) {
        list = list.map((c) => (c.id === m[1] ? { ...c, status: body.status, decisionReasons: body.decisionReasons, note: body.note } : c));
        return { data: list.find((c) => c.id === m[1]) };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as any).App;
});

function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

describe("YouTube creators", () => {
  it("shows each undecided channel with picture, subscribers, videos and suggestion; decided ones are tucked away", async () => {
    act(() => root.render(<YoutubeCreators />));
    await flush();
    const cards = host.querySelectorAll('.yt-creator-list [data-status="candidate"]');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector("img")?.getAttribute("src")).toBe("https://yt3.example.com/a.jpg");
    expect(cards[0].textContent).toContain("12,400 subscribers");
    expect(cards[0].textContent).toContain("On awareness");
    expect(cards[0].textContent).toContain("Suggested: Approve (low confidence) — consciousness. Talks about minds.");
    expect(cards[1].textContent).toContain("No suggestion yet.");
    expect(host.textContent).toContain("Substack Miner's");
    expect(host.querySelector('[data-status="rejected"]')).toBeNull();
    act(() => button("Show decided (1)").click());
    expect(host.querySelector('[data-status="rejected"]')?.textContent).toContain("Rejected — off topic");
  });

  it("Agree saves the suggestion as his decision, reasons included", async () => {
    act(() => root.render(<YoutubeCreators />));
    await flush();
    const card = host.querySelector('[data-status="candidate"]') as HTMLElement;
    await act(async () => { button("Agree", card).click(); });
    await flush();
    const sent = calls.find((c) => c.path.endsWith("/1/decide"));
    expect(sent?.body).toEqual({ status: "approved", decisionReasons: ["consciousness"], note: "" });
    expect(host.textContent).toContain("Channel 1 approved, because: consciousness.");
  });

  it("Reject asks why and saves the ticked reason and his sentence", async () => {
    act(() => root.render(<YoutubeCreators />));
    await flush();
    const card = host.querySelectorAll('[data-status="candidate"]')[1] as HTMLElement;
    act(() => button("Reject", card).click());
    const dialog = document.querySelector('[data-decision="rejected"]') as HTMLFormElement;
    expect(dialog).not.toBeNull();
    const note = dialog.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "sells courses");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const tick = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement; // "off topic", used before
    act(() => tick.click());
    await act(async () => { dialog.requestSubmit(); });
    await flush();
    const sent = calls.find((c) => c.path.endsWith("/2/decide"));
    expect(sent?.body).toEqual({ status: "rejected", decisionReasons: ["off topic"], note: "sells courses" });
  });

  it("a quota-stopped search says Cannot tell with the time, never 'no channels'", async () => {
    findAnswer = { keywordsSearched: [], added: 0, merged: 0, cannotTell: "Cannot tell — YouTube quota used up until Oct 29, 3:00 AM Eastern (midnight Pacific)." };
    act(() => root.render(<YoutubeCreators />));
    await flush();
    await act(async () => { button("Find channels").click(); });
    await flush();
    expect(host.querySelector("[data-cannot-tell]")?.textContent).toBe("Cannot tell — YouTube quota used up until Oct 29, 3:00 AM Eastern (midnight Pacific).");
    expect(calls.map((c) => c.path)).toContain(`${CREATORS_PATH}/suggest`);
  });

  it("words: a hidden subscriber count is not 0; a canon-only run says so", () => {
    expect(subscriberText(null)).toBe("subscribers hidden");
    expect(subscriberText(1)).toBe("1 subscriber");
    expect(findSummaryText({ keywordsSearched: ["a", "b"], added: 21, merged: 3 }, { suggested: new Array(21), undecided: 21, fromCanonOnly: true }))
      .toMatch(/^Searched 2 keywords: 21 new channels, 3 already on the list\. Suggested 21 of 21 undecided\. With fewer than 5/);
  });
});

describe("YouTube creators — errors stay visible", () => {
  it("a suggestion refusal is still on screen after the list re-reads", async () => {
    const api = (window as any).App.api;
    (window as any).App.api = async (path: string, options?: RequestInit) => {
      if (path.endsWith("/suggest")) throw new Error("There is nothing to judge from yet");
      return api(path, options);
    };
    act(() => root.render(<YoutubeCreators />));
    await flush();
    await act(async () => { button("Find channels").click(); });
    await flush();
    expect(host.textContent).toContain("Channels were found, but not suggested: There is nothing to judge from yet");
  });
});
