// @vitest-environment jsdom
import { useLayoutEffect, type ReactNode } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BugReportModule, bugReportVisibleFor, readBugReportSettings, BUG_REPORT_MAX_SCREENSHOT_MB } from "./builder-bug-report-module";

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
  // No stray-layout-div cleanup: the live-site class now exists ONLY as a React
  // ancestor (LiveSiteTree), so unmounting the tree is what removes it. A leak
  // here would mean a test built the production shape by hand again.
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
function fakeFetch({ tier = "public", screenshotRoute = 404, submitStatus = 201, uploadStatus = 201, uploadAssetId = 7, uploadToken = "tok_7", holdUpload = false } = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  // When holdUpload is set, a real screenshot upload blocks until releaseUpload()
  // is called — so a test can remove another row while THIS one is in flight.
  let releaseUpload: () => void = () => {};
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
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
      if (holdUpload) await uploadGate;
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
  return { impl, calls, releaseUpload: () => releaseUpload() };
}

/**
 * The production tree shape, and the ONLY way these tests may create it.
 *
 * WHY THIS REPLACED the old `markLiveSite` helper: that one appended the layout
 * div to <body> as a SIBLING of the container before rendering, so the class
 * really was in the DOM when the module went looking for it — a tree production
 * never has. Every gating test passed on that fiction while the real page
 * painted a staff-only button to public visitors for a frame (review rounds
 * 2-4). On a real page the layout div and the module land in the SAME React
 * commit, which is why the module is now TOLD it is live (the `liveSite` prop)
 * instead of asking the DOM. Keeping the class strictly as a React ancestor
 * here means a future attempt to go back to sniffing the DOM fails these tests
 * instead of passing them.
 */
function LiveSiteTree({ children }: { children: ReactNode }) {
  return <div className="builder-public-site-layout">{children}</div>;
}

/**
 * Snapshots the DOM from a layout effect. React runs layout effects after the
 * commit and BEFORE the browser paints, so what this captures IS the first
 * painted frame — the frame the flash used to live in. Rendered as the LAST
 * child so everything above it is already committed when it fires.
 */
function FirstPaintProbe({ onFrame }: { onFrame: (frame: { trigger: boolean; className: string }) => void }) {
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger");
    onFrame({ trigger: Boolean(el), className: el?.className || "" });
  });
  return null;
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

  it("the picker promises the SAME cap the server enforces (3 MB, not 8)", async () => {
    // The desync half of the original hold: the module advertised 8 MB while
    // 2/5's server cap is 3 MB, so a 4 MB phone screenshot was accepted by the
    // picker and refused by the submit. The promise must match the enforcement.
    expect(BUG_REPORT_MAX_SCREENSHOT_MB).toBe(3);
    const { impl } = fakeFetch({ screenshotRoute: 400 });
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();
    expect(document.querySelector(".builder-bug-report-picker")!.textContent).toContain("3 MB");
  });

  it("hides the picker when blob storage is not configured (probe 503), not only on 404", async () => {
    const { impl } = fakeFetch({ screenshotRoute: 503 });
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();
    expect(document.querySelector(".builder-bug-report-picker")).toBeNull();
  });

  it("a screenshot can be removed, freeing its slot and dropping it from the submit", async () => {
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
    await flushUntil(() => !!document.querySelector(".builder-bug-report-shot-list .is-ready"));
    expect(document.querySelectorAll(".builder-bug-report-shot-list li")).toHaveLength(1);

    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-shot-remove")!.click());
    await flush();
    expect(document.querySelectorAll(".builder-bug-report-shot-list li")).toHaveLength(0);

    const textarea = document.querySelector<HTMLTextAreaElement>(".builder-bug-report-textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Removed the picture, sending text only");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();
    const submit = calls.find((c) => c.url.endsWith("/bug-report"));
    expect(submit!.body).toMatchObject({ screenshots: [] });
  });

  it("removing a failed row while another upload is in flight does not orphan the good one (round-3)", async () => {
    // The round-2 bug: remove-by-index shifted an in-flight upload's position, so
    // its result landed on the wrong row (or nowhere) — the good upload stuck at
    // "uploading" forever, the form refused to submit, and closing to escape
    // threw away the description. Stable ids fix it. This is the reviewer's
    // required break-test; revert to index-keying and it fails.
    const { impl, calls, releaseUpload } = fakeFetch({ screenshotRoute: 201, holdUpload: true, uploadAssetId: 7, uploadToken: "tok_7" });
    render(<BugReportModule settings={{}} previewMode projectId="proj_1" fetchImpl={impl} />);
    await flush();
    act(() => document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!.click());
    await flush();

    const input = document.querySelector<HTMLInputElement>('.builder-bug-report-picker input[type="file"]')!;
    const tooBig = new File([new Uint8Array(4 * 1024 * 1024)], "big.png", { type: "image/png" }); // > 3 MB → errors, no upload
    const good = new File([new Uint8Array([137, 80, 78, 71])], "good.png", { type: "image/png" }); // uploads (held open)
    act(() => {
      Object.defineProperty(input, "files", { value: [tooBig, good], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The oversize row errors; the good one is uploading with its fetch held.
    await flushUntil(() => !!document.querySelector(".builder-bug-report-shot-list .is-error"));
    const errorRow = [...document.querySelectorAll(".builder-bug-report-shot-list li")].find((li) => li.classList.contains("is-error")) as HTMLElement;
    expect(errorRow).toBeTruthy();
    expect(document.querySelector(".builder-bug-report-shot-list .is-uploading")).toBeTruthy();

    // Remove the FAILED row while the good upload is still in flight.
    act(() => errorRow.querySelector<HTMLButtonElement>(".builder-bug-report-shot-remove")!.click());
    await flush();

    // Release the good upload — it must find its row by id and land READY.
    act(() => releaseUpload());
    await flushUntil(() => !!document.querySelector(".builder-bug-report-shot-list .is-ready"));
    expect(document.querySelectorAll(".builder-bug-report-shot-list li")).toHaveLength(1);
    expect(document.querySelector(".builder-bug-report-shot-list .is-uploading")).toBeNull();

    // And the form submits, carrying the good screenshot as an { id, token } pair.
    const textarea = document.querySelector<HTMLTextAreaElement>(".builder-bug-report-textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "One good picture after removing a failed one");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { document.querySelector<HTMLFormElement>(".builder-bug-report-form")!.requestSubmit(); });
    await flush();
    const submit = calls.find((c) => c.url.endsWith("/bug-report"));
    expect(submit!.body).toMatchObject({ screenshots: [{ id: 7, token: "tok_7" }] });
  });
});

describe("BugReportModule — visibility on the live site", () => {
  it("public visibility: floats via a portal on the live site, no viewer lookup", async () => {
    const { impl, calls } = fakeFetch();
    render(<LiveSiteTree><BugReportModule settings={{ visibility: "public", corner: "bottom-left" }} liveSite projectId="proj_1" fetchImpl={impl} /></LiveSiteTree>);
    await flush();
    const trigger = document.querySelector<HTMLButtonElement>(".builder-bug-report-trigger")!;
    expect(trigger.classList.contains("is-floating")).toBe(true);
    expect(trigger.classList.contains("builder-bug-report-trigger--bottom-left")).toBe(true);
    expect(trigger.parentElement).toBe(document.body); // portaled out of any column
    expect(calls.filter((c) => c.url.includes("/viewer"))).toHaveLength(0);
  });

  // THE FIRST-PAINT FLASH (review findings, rounds 2-4). The two tests below
  // are the guard. Both read the FIRST PAINTED FRAME via FirstPaintProbe, in
  // the production tree shape, so they fail against any version that goes back
  // to asking the DOM whether it is on a live site.

  it("a staff-only trigger is absent from the FIRST PAINTED FRAME, not just after it settles", async () => {
    const frames: Array<{ trigger: boolean; className: string }> = [];
    const staff = fakeFetch({ tier: "staff" });
    render(
      <LiveSiteTree>
        <BugReportModule settings={{ visibility: "staff" }} liveSite projectId="proj_1" fetchImpl={staff.impl} />
        <FirstPaintProbe onFrame={(f) => frames.push(f)} />
      </LiveSiteTree>,
    );
    // The frame the browser would paint first: the tier is still unresolved, so
    // a gated control must not be on screen at all. Under the old DOM-sniffing
    // code `live` was false here, which rendered the trigger INLINE to whoever
    // was looking — public visitor included — and then removed it.
    expect(frames[0]).toEqual({ trigger: false, className: "" });

    // ...and it does appear once the server confirms this browser is staff.
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeTruthy();
  });

  it("a public trigger is already floating in the FIRST PAINTED FRAME — no inline-to-fixed shift", async () => {
    const frames: Array<{ trigger: boolean; className: string }> = [];
    const { impl } = fakeFetch();
    render(
      <LiveSiteTree>
        <BugReportModule settings={{ visibility: "public" }} liveSite projectId="proj_1" fetchImpl={impl} />
        <FirstPaintProbe onFrame={(f) => frames.push(f)} />
      </LiveSiteTree>,
    );
    expect(frames[0].trigger).toBe(true);
    expect(frames[0].className).toContain("is-floating");
    expect(frames[0].className).not.toContain("is-inline");
    await flush();
  });

  it("clients visibility hides the icon from a public viewer and shows it to a signed-in client", async () => {
    const publicViewer = fakeFetch({ tier: "public" });
    render(<LiveSiteTree><BugReportModule settings={{ visibility: "clients" }} liveSite projectId="proj_1" fetchImpl={publicViewer.impl} /></LiveSiteTree>);
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeNull();
    act(() => root?.unmount());

    const clientViewer = fakeFetch({ tier: "client" });
    render(<LiveSiteTree><BugReportModule settings={{ visibility: "clients" }} liveSite projectId="proj_1" fetchImpl={clientViewer.impl} /></LiveSiteTree>);
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeTruthy();
    expect(clientViewer.calls.some((c) => c.url.includes("/viewer?projectId=proj_1"))).toBe(true);
  });

  it("staff visibility hides the icon from a client and shows it to staff; the submit carries the tier", async () => {
    const client = fakeFetch({ tier: "client" });
    render(<LiveSiteTree><BugReportModule settings={{ visibility: "staff" }} liveSite projectId="proj_1" fetchImpl={client.impl} /></LiveSiteTree>);
    await flush();
    expect(document.querySelector(".builder-bug-report-trigger")).toBeNull();
    act(() => root?.unmount());

    const staff = fakeFetch({ tier: "staff" });
    render(<LiveSiteTree><BugReportModule settings={{ visibility: "staff" }} liveSite projectId="proj_1" fetchImpl={staff.impl} /></LiveSiteTree>);
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
