// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignInWindow, {
  CLOSE_WORDS,
  FIRST_PICTURE_MS,
  IDLE_CLOSE_MS,
  MAX_WINDOW_MS,
  clockFor,
  countdown,
  isPasteShortcut,
  keyMessage,
  loggedReason,
  reasonFromDoor,
  toPagePoint,
} from "./sign-in-window";
import { afterWindowSentence, type OutreachAccount } from "./outreach-wizard-panel";

/**
 * Outreach wizard 6/19 (86bcrmbfb): the sign-in window. Driven against a fake
 * /api/browser-view and a fake door keeper socket that speaks the message
 * shapes at the top of workers/browser-door/server.js.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  // door keeper side
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

let posts: Array<{ path: string; body: any }> = [];
let openFails = "";
let onClosed: ReturnType<typeof vi.fn>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  posts = [];
  openFails = "";
  FakeSocket.last = null;
  onClosed = vi.fn();
  (window as any).App = {
    api: async (path: string, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body || "{}"));
      posts.push({ path, body });
      if (path === "/api/browser-view/open") {
        if (openFails) throw new Error(openFails);
        return {
          ok: true,
          data: { session: { id: "bvs_1" }, pass: "PASS-123", viewerUrl: "wss://mini.example/live/live" },
        };
      }
      return { ok: true, data: {} };
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
    root!.render(
      <SignInWindow site="reddit" label="Reddit" onClosed={onClosed} makeSocket={(u) => new FakeSocket(u) as unknown as WebSocket} />,
    );
  });
}

function button(text: string): HTMLButtonElement {
  const b = Array.from(container!.querySelectorAll("button")).find((x) => x.textContent === text);
  if (!b) throw new Error(`no button "${text}" in: ${container!.textContent}`);
  return b;
}

/** Click Connect, let the Mini accept and send one picture. */
async function openWindow() {
  await act(async () => button("Connect Reddit").click());
  const ws = FakeSocket.last!;
  await act(async () => ws.accept());
  await act(async () => ws.push({ type: "frame", data: "AAAA", metadata: { deviceWidth: 1280, deviceHeight: 800 } }));
  return ws;
}

function closeLogs() {
  return posts.filter((p) => p.path.startsWith("/api/browser-view/bvs_1/close"));
}

describe("the Connect button", () => {
  it("asks for a pass for this site, opens the door keeper's feed with it, and shows the picture with a countdown", async () => {
    await mount();
    const ws = await openWindow();
    expect(posts[0]).toEqual({ path: "/api/browser-view/open", body: { site: "reddit" } });
    expect(ws.url).toBe("wss://mini.example/live/live");
    expect(ws.sent[0]).toEqual({ type: "hello", pass: "PASS-123" });
    const img = container!.querySelector<HTMLImageElement>(".sign-in-window-picture")!;
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
    expect(container!.querySelector('[role="timer"]')!.textContent).toMatch(/^Closes in 3:00 with no clicks or keys$/);
    expect(button("Close")).toBeTruthy();
  });

  it("says why when the window could not be opened, and does not run the sign-in check", async () => {
    openFails = "The Mini's browser door is not set up here (BROWSER_DOOR_URL is empty).";
    await mount();
    await act(async () => button("Connect Reddit").click());
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain("The window did not open: The Mini's browser door is not set up");
    expect(FakeSocket.last).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    expect(button("Connect Reddit")).toBeTruthy();
  });
});

describe("clicks, keys and paste", () => {
  it("scales a click on the picture back to the Mini's page pixels", async () => {
    await mount();
    const ws = await openWindow();
    const img = container!.querySelector<HTMLImageElement>(".sign-in-window-picture")!;
    img.getBoundingClientRect = () => ({ left: 10, top: 20, width: 640, height: 400, right: 650, bottom: 420, x: 10, y: 20, toJSON() {} });
    const surface = container!.querySelector<HTMLDivElement>(".sign-in-window-surface")!;
    await act(async () => {
      surface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 330, clientY: 220, button: 0, detail: 1 }));
      surface.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 330, clientY: 220, button: 0, detail: 1 }));
    });
    const mice = ws.sent.filter((m) => m.type === "mouse");
    expect(mice).toEqual([
      { type: "mouse", action: "down", x: 640, y: 400, modifiers: 0, button: "left", clickCount: 1 },
      { type: "mouse", action: "up", x: 640, y: 400, modifiers: 0, button: "left", clickCount: 1 },
    ]);
  });

  it("types a key as one key press with its character, and pastes this computer's clipboard rather than sending Cmd+V", async () => {
    await mount();
    const ws = await openWindow();
    const surface = container!.querySelector<HTMLDivElement>(".sign-in-window-surface")!;
    await act(async () => {
      surface.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a", code: "KeyA", keyCode: 65 }));
      surface.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "v", code: "KeyV", metaKey: true }));
      const paste = new Event("paste", { bubbles: true }) as any;
      paste.clipboardData = { getData: () => "hunter2" };
      surface.dispatchEvent(paste);
    });
    const inputs = ws.sent.filter((m) => m.type !== "hello");
    expect(inputs[0]).toMatchObject({ type: "key", action: "down", key: "a", text: "a" });
    expect(inputs.some((m) => m.type === "key" && m.key === "v")).toBe(false);
    expect(inputs[inputs.length - 1]).toEqual({ type: "paste", text: "hunter2" });
  });
});

describe("the window always says why it closed", () => {
  it("Close: says 'You closed the window', records 'finished', then runs the sign-in check", async () => {
    await mount();
    const ws = await openWindow();
    await act(async () => button("Close").click());
    expect(container!.querySelector("[data-close-reason]")!.textContent).toBe("You closed the window.");
    expect(ws.readyState).toBe(3);
    expect(closeLogs()).toEqual([{ path: "/api/browser-view/bvs_1/close", body: { reason: "finished" } }]);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(button("Connect Reddit")).toBeTruthy();
  });

  it("idle: the Mini's idle close is said in plain words and recorded as 'idle'", async () => {
    await mount();
    const ws = await openWindow();
    await act(async () => {
      ws.push({ type: "closed", reason: "idle", message: "Window closed after 3 minutes with no clicks or keys." });
      ws.drop(); // the door keeper hangs up right after
    });
    expect(container!.querySelector("[data-close-reason]")!.getAttribute("data-close-reason")).toBe("idle");
    expect(container!.querySelector("[data-close-reason]")!.textContent).toBe(CLOSE_WORDS.idle);
    expect(closeLogs()).toEqual([{ path: "/api/browser-view/bvs_1/close", body: { reason: "idle" } }]);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["time-limit", "time-limit"],
    ["browser-gone", "browser-gone"],
    ["refused", "error"],
    ["already-open", "error"],
    ["error", "error"],
    ["something-new", "error"],
  ])("door reason %s is shown and recorded as %s", async (doorReason, logged) => {
    await mount();
    const ws = await openWindow();
    await act(async () => ws.push({ type: "closed", reason: doorReason }));
    const shown = container!.querySelector("[data-close-reason]")!.textContent;
    expect(shown).toBe(CLOSE_WORDS[reasonFromDoor(doorReason)]);
    expect(shown).toBeTruthy();
    expect(closeLogs()[0].body).toEqual({ reason: logged });
  });

  it("a feed that never sends a picture is closed after the wait and says why, instead of 'Opening…' forever (86bcu7d6h)", async () => {
    vi.useFakeTimers();
    try {
      await mount();
      await act(async () => button("Connect Reddit").click());
      const ws = FakeSocket.last!; // never accepts: the 2026-10-28 Tailscale drop
      expect(container!.querySelector('[role="timer"]')!.textContent).toMatch(/^Opening the Mini's browser on Reddit/);
      await act(async () => { vi.advanceTimersByTime(FIRST_PICTURE_MS - 1); });
      expect(container!.querySelector("[data-close-reason]")).toBeNull();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(container!.querySelector("[data-close-reason]")!.textContent).toBe(CLOSE_WORDS["no-answer"]);
      expect(CLOSE_WORDS["no-answer"]).toMatch(/Tailscale/);
      expect(ws.readyState).toBe(3);
      expect(closeLogs()).toEqual([{ path: "/api/browser-view/bvs_1/close", body: { reason: "error" } }]);
      expect(onClosed).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("once the first picture arrives, the wait is called off", async () => {
    vi.useFakeTimers();
    try {
      await mount();
      await openWindow();
      await act(async () => { vi.advanceTimersByTime(FIRST_PICTURE_MS * 2); });
      expect(container!.querySelector("[data-close-reason]")).toBeNull();
      expect(container!.querySelector(".sign-in-window-picture")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a socket that closes before it ever opened never reached the Mini, and says that", async () => {
    await mount();
    await act(async () => button("Connect Reddit").click());
    await act(async () => FakeSocket.last!.drop());
    expect(container!.querySelector("[data-close-reason]")!.getAttribute("data-close-reason")).toBe("no-answer");
  });

  it("a dropped connection with no word from the Mini says so, rather than nothing", async () => {
    await mount();
    const ws = await openWindow();
    await act(async () => ws.drop());
    expect(container!.querySelector("[data-close-reason]")!.textContent).toBe(CLOSE_WORDS.dropped);
    expect(closeLogs()[0].body).toEqual({ reason: "error" });
  });
});

describe("pure helpers", () => {
  it("toPagePoint refuses without a picture description", () => {
    expect(toPagePoint(5, 5, { left: 0, top: 0, width: 100, height: 100 }, null)).toBeNull();
    expect(toPagePoint(50, 25, { left: 0, top: 0, width: 100, height: 50 }, { deviceWidth: 1000, deviceHeight: 500 })).toEqual({ x: 500, y: 250 });
  });

  it("countdown is the sooner of the idle close and the 15-minute limit", () => {
    expect(countdown(0, 0, 0)).toEqual({ ms: IDLE_CLOSE_MS, idle: true });
    const late = MAX_WINDOW_MS - 60_000;
    expect(countdown(late, 0, late)).toEqual({ ms: 60_000, idle: false });
    expect(clockFor(61_000)).toBe("1:01");
    expect(clockFor(-5)).toBe("0:00");
  });

  it("keys: Enter types a return, a shortcut types nothing, Cmd/Ctrl+V is the paste shortcut", () => {
    const base = { code: "", keyCode: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(keyMessage("down", { ...base, key: "Enter" }).text).toBe("\r");
    expect(keyMessage("down", { ...base, key: "a", metaKey: true }).text).toBeUndefined();
    expect(keyMessage("up", { ...base, key: "a" }).text).toBeUndefined();
    expect(isPasteShortcut({ key: "V", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isPasteShortcut({ key: "v", ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("every ending maps to a reason the log accepts", () => {
    const accepted = ["finished", "idle", "time-limit", "browser-gone", "error"];
    for (const r of Object.keys(CLOSE_WORDS)) expect(accepted).toContain(loggedReason(r as any));
  });
});

describe("after the window closes: who is signed in", () => {
  const account: OutreachAccount = {
    expectedAccount: "DaneOfEarth",
    observedAccount: "Exotic-Break-7850",
    confirmedAt: null,
    checkRequestedAt: null,
    browserCheckedAt: "2026-10-27T19:00:00Z",
  };
  const closedAt = Date.parse("2026-10-27T18:59:00Z");

  it("waits for a reading taken AFTER the window closed", () => {
    expect(afterWindowSentence({ ...account, browserCheckedAt: "2026-10-27T18:00:00Z" }, "Reddit", closedAt)).toEqual({
      text: "Checking which account the Mini is signed in to Reddit as…",
      offer: false,
    });
  });

  it("offers 'Post as this account?' when the Mini sees someone else", () => {
    expect(afterWindowSentence(account, "Reddit", closedAt)).toEqual({ text: "Signed in as Exotic-Break-7850. Post as this account?", offer: true });
  });

  it("says plainly when it is already the posting account, or nobody is signed in", () => {
    expect(afterWindowSentence({ ...account, observedAccount: "DaneOfEarth" }, "Reddit", closedAt).text).toBe("Signed in as DaneOfEarth, the account Reddit posts as.");
    expect(afterWindowSentence({ ...account, observedAccount: "" }, "Reddit", closedAt).offer).toBe(false);
  });
});
