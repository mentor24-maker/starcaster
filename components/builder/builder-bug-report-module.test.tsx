// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BugReportModule, bugReportVisibleFor, readBugReportSettings } from "./builder-bug-report-module";

/**
 * Bug Report module (task 4/5): the floating trigger, the popup, the submit,
 * the thank-you, and the visibility gating — driven without a server.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  document.querySelector(".builder-public-site-layout")?.remove();
  vi.useRealTimers();
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * Flush repeatedly until `check` holds. A screenshot upload is a chain of a
 * FileReader macrotask, a fetch, its .json(), and a setState — more than one
 * flush's worth of ticks, and how many is timing-dependent (it passed locally
 * and flaked in CI on a single flush). Waiting on the settled DOM marker is
 * deterministic where a fixed flush count is not.
 */
async function flushUntil(check: () => boolean, tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    if (check()) return;
    await flush();
  }
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** A fetch that answers the three endpoints; records every call. */
function fakeFetch({ tier = "public", screenshotRoute = 404, submitStatus = 201, uploadStatus = 201, uploadAssetId = 7, uploadToken = "tok_7" } = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/bug-report/viewer")) return jsonResponse({ ok: true, data: { tier } });
    if (url.includes("/bug-report/screenshot")) {
      // Hit twice: a `{ probe: true }` availability check (only its status is
      // read) and the real file upload, which MUST return { assetId, token } —
      // the submit attaches each screenshot by that pair (task 2/5).
      if ((body as { probe?: boolean } | undefined)?.probe) {
        return jsonResponse({ ok: screenshotRoute < 400, error: { message: "probe" } }, screenshotRoute);
      }
      return uploadStatus >= 200 && uploadStatus < 300
        ? jsonResponse({ ok: true, data: { assetId: uploadAssetId, token: uploadToken } }, uploadStatus)
        : jsonResponse({ ok: false, error: { message: "Upload failed" } }, uploadStatus);
    }
    if (url.endsWith("/bug-report")) {
      return submitStatus === 201
        ? jsonResponse({ ok: true, data: { id: "bug_1" } }, 201)
        : jsonResponse({ ok: false, error: { message: "Could not save bug report" } }, submitStatus);
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
  return { impl, calls };
}

function markLiveSite() {
  const layout = document.createElement("div");
  layout.className = "builder-public-site-layout";
  document.body.appendChild(layout);
}

describe("readBugReportSettings / bugReportVisibleFor (pure)", () => {
  it("fills defaults and clamps the icon size", () => {
    const s = readBugReportSettings({});
    expect(s.visibility).toBe("public");
    expect(s.iconSize).toBe(40);
    expect(s.corner).toBe("bottom-right");
    expect(readBugReportSettings({ iconSize: "9999" }).iconSize).toBe(120);
  });

  it("staff sees everything, clients see public+clients, public sees public only", () => {
    expect(bugReportVisibleFor("public", "public")).toBe(true);
    expect(bugReportVisibleFor("clients", "public")).toBe(false);
    expect(bugReportVisibleFor("clients", "client")).toBe(true);
    expect(bugReportVisibleFor("staff", "client")).toBe(false);
    expect(bugReportVisibleFor("staff", "staff")).toBe(true);
  });
});

describe("BugReportModule — preview rendering", () => {
  it("renders an inline trigger sized and labelled by its settings, no viewer lookup", async () => {
    const { impl, calls } = fakeFetch();
    render(<BugReportModule settings={{ iconSize: "60", labelText: "Report a problem", blockColor: "#c0392b" }} previewMode fetchImpl={impl} />);
    await flush();
    const trigger = document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger");
    expect(trigger).toBeTruthy();
    expect(trigger!.classList.contains("is-inline")).toBe(true);
    expect(trigger!.style.getPropertyValue("--bug-report-size")).toBe("60px");
    expect(trigger!.style.getPropertyValue("--bug-report-block-color")).toBe("#c0392b");
    expect(trigger!.textContent).toContain("Report a problem");
    expect(calls.filter((c) => c.url.includes("/viewer"))).toHaveLength(0);
  });

  it("does not emit the block colour when the block is off (conditional emit is a dead-control hazard)", async () => {
    render(<BugReportModule settings={{ iconBlock: "false", blockColor: "#c0392b" }} previewMode fetchImpl={fakeFetch().impl} />);
    await flush();
    const trigger = document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!;
    expect(trigger.classList.contains("is-block")).toBe(false);
    expect(trigger.style.getPropertyValue("--bug-report-block-color")).toBe("");
  });
});

describe("BugReportModule — popup and submit", () => {
  it("click opens the popup; submit posts the description, page URL, tier and project; thank-you shows; closes after 2s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { impl, calls } = fakeFetch();
    render(<BugReportModule settings={{ popupTitle: "Tell us", thankYouMessage: "Got it!" }} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();

    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain("Tell us");
    expect(document.querySelector(".builder-bug-report-picker")).toBeNull(); // screenshot route 404 → picker hidden

    const textarea = document.querySelector<HTMLTextAreaElement>(".builder-bug-report-textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "The menu overlaps the logo");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();

    const submit = calls.find((c) => c.url.endsWith("/bug-report"));
    expect(submit).toBeTruthy();
    expect(submit!.body).toMatchObject({ projectId: "proj_1", description: "The menu overlaps the logo", viewerTier: "public", screenshots: [] });
    expect(String((submit!.body as { pageUrl: string }).pageUrl)).toContain("http");
    expect(document.body.textContent).toContain("Got it!");

    await act(async () => { vi.advanceTimersByTime(2100); });
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("a failed submit shows the server's message and keeps the popup open", async () => {
    const { impl } = fakeFetch({ submitStatus: 500 });
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();
    const textarea = document.querySelector<HTMLTextAreaElement>(".builder-bug-report-textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Broken");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();
    expect(document.body.textContent).toContain("Could not save bug report");
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("an empty description is refused before any request", async () => {
    const { impl, calls } = fakeFetch();
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();
    expect(calls.find((c) => c.url.endsWith("/bug-report"))).toBeUndefined();
    expect(document.body.textContent).toContain("describe what went wrong");
  });

  it("the screenshot picker appears when the upload route exists (anything but 404)", async () => {
    const { impl } = fakeFetch({ screenshotRoute: 400 });
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();
    expect(document.querySelector(".builder-bug-report-picker")).toBeTruthy();
  });

  it("uploads a screenshot and submits it as an { id, token } pair — the task 2/5 contract", async () => {
    // The whole reason this module was held: the submit must present the token
    // the upload handed back, or 2/5's attach step refuses every picture.
    const { impl, calls } = fakeFetch({ screenshotRoute: 201, uploadAssetId: 7, uploadToken: "tok_7" });
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();

    const input = document.querySelector<HTMLInputElement>('.builder-bug-report-picker input[type="file"]')!;
    const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    act(() => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Wait for the upload to settle (the shot leaves "uploading") before submit,
    // or the form blocks on "a screenshot is still uploading".
    await flushUntil(() => !!document.querySelector(".builder-bug-report-shot-list .is-ready"));

    const textarea = document.querySelector<HTMLTextAreaElement>(".builder-bug-report-textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Broken, and here is a picture");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();

    const submit = calls.find((c) => c.url.endsWith("/bug-report"));
    expect(submit).toBeTruthy();
    // The legacy id-only shape is gone; the paired ref is what 2/5 verifies.
    expect(submit!.body).toMatchObject({ screenshots: [{ id: 7, token: "tok_7" }] });
    expect((submit!.body as { screenshotAssetIds?: unknown }).screenshotAssetIds).toBeUndefined();
  });

  it("a failed screenshot upload never reaches the submit as a token-less ref", async () => {
    // Resilience: a broken upload shows an error on that thumbnail, and the
    // report still submits — carrying NO screenshot rather than one that 2/5
    // would reject. The report is never lost to a picture that would not attach.
    const { impl, calls } = fakeFetch({ screenshotRoute: 201, uploadStatus: 500 });
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();

    const input = document.querySelector<HTMLInputElement>('.builder-bug-report-picker input[type="file"]')!;
    const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    act(() => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Wait for the upload to settle into its error state before submit.
    await flushUntil(() => !!document.querySelector(".builder-bug-report-shot-list .is-error"));

    const textarea = document.querySelector<HTMLTextAreaElement>(".builder-bug-report-textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "The upload failed but the report should still go");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();

    const submit = calls.find((c) => c.url.endsWith("/bug-report"));
    expect(submit).toBeTruthy();
    expect(submit!.body).toMatchObject({ screenshots: [] });
  });
});

describe("BugReportModule — visibility on the live site", () => {
  it("public visibility: floats via a portal on the live site, no viewer lookup", async () => {
    markLiveSite();
    const { impl, calls } = fakeFetch();
    render(<BugReportModule settings={{ visibility: "public", corner: "bottom-left" }} projectId="proj_1" fetchImpl={impl} />);
    await flush();
    const trigger = document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!;
    expect(trigger.classList.contains("is-floating")).toBe(true);
    expect(trigger.classList.contains("builder-bug-report-trigger--bottom-left")).toBe(true);
    expect(trigger.parentElement).toBe(document.body); // portaled out of any column
    expect(calls.filter((c) => c.url.includes("/viewer"))).toHaveLength(0);
  });

  it("clients visibility hides the icon from a public viewer and shows it to a signed-in client", async () => {
    markLiveSite();
    const publicViewer = fakeFetch({ tier: "public" });
    render(<BugReportModule settings={{ visibility: "clients" }} projectId="proj_1" fetchImpl={publicViewer.impl} />);
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeNull();
    act(() => root?.unmount());

    const clientViewer = fakeFetch({ tier: "client" });
    render(<BugReportModule settings={{ visibility: "clients" }} projectId="proj_1" fetchImpl={clientViewer.impl} />);
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeTruthy();
    expect(clientViewer.calls.some((c) => c.url.includes("/viewer?projectId=proj_1"))).toBe(true);
  });

  it("staff visibility hides the icon from a client and shows it to staff; the submit carries the tier", async () => {
    markLiveSite();
    const client = fakeFetch({ tier: "client" });
    render(<BugReportModule settings={{ visibility: "staff" }} projectId="proj_1" fetchImpl={client.impl} />);
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeNull();
    act(() => root?.unmount());

    const staff = fakeFetch({ tier: "staff" });
    render(<BugReportModule settings={{ visibility: "staff" }} projectId="proj_1" fetchImpl={staff.impl} />);
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeTruthy();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();
    const textarea = document.querySelector<HTMLTextAreaElement>(".builder-bug-report-textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Staff-only issue");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();
    const submit = staff.calls.find((c) => c.url.endsWith("/bug-report"));
    expect(submit!.body).toMatchObject({ viewerTier: "staff" });
  });
});
