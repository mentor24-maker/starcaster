// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderPublishPanel, revealAndFocus, type PublishStatus } from "./builder-publish-panel";

/**
 * After Save Page the next step is Publish, and after Publish it is Close
 * Builder — but both sit a long scroll away from where the operator just
 * clicked (task 86bcgmztg). So a successful save hands the focus to Publish
 * once the re-check answers, and only when there is something to publish:
 * a disabled button cannot take focus, and moving focus to nothing would
 * pull his eye away from the page for no reason.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let pending = 0;

beforeEach(() => {
  pending = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const data: PublishStatus = { pending, total: 5, pages: [] };
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

async function renderPanel(props: { refreshKey: number; focusRequestKey: number }) {
  await act(async () => {
    root!.render(<BuilderPublishPanel {...props} />);
  });
  // Let the status fetch resolve and the follow-up render land.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function publishButton(): HTMLButtonElement {
  // The collapse toggle also reads "Publish" when nothing is waiting, so look
  // only among the header's action buttons.
  const button = Array.from(container!.querySelectorAll(".builder-panel-heading-button")).find(
    (candidate) => candidate.textContent === "Publish"
  );
  if (!button) throw new Error("no Publish button rendered");
  return button as HTMLButtonElement;
}

describe("Save Page hands the focus to Publish", () => {
  it("focuses Publish once the re-check finds pages waiting", async () => {
    await renderPanel({ refreshKey: 0, focusRequestKey: 0 });
    expect(document.activeElement).not.toBe(publishButton());

    pending = 2;
    await renderPanel({ refreshKey: 1, focusRequestKey: 1 });
    expect(publishButton().disabled).toBe(false);
    expect(document.activeElement).toBe(publishButton());
  });

  it("leaves the focus alone when nothing is waiting", async () => {
    await renderPanel({ refreshKey: 0, focusRequestKey: 0 });
    pending = 0;
    await renderPanel({ refreshKey: 1, focusRequestKey: 1 });
    expect(publishButton().disabled).toBe(true);
    expect(document.activeElement).not.toBe(publishButton());
  });

  it("does not grab the focus on the first load, before any save", async () => {
    // The panel mounts with the editor; stealing focus then would yank the
    // page away from whatever he opened.
    pending = 3;
    await renderPanel({ refreshKey: 0, focusRequestKey: 0 });
    expect(publishButton().disabled).toBe(false);
    expect(document.activeElement).not.toBe(publishButton());
  });

  it("does not grab the focus on a re-check nobody asked to focus", async () => {
    pending = 3;
    await renderPanel({ refreshKey: 0, focusRequestKey: 0 });
    await renderPanel({ refreshKey: 1, focusRequestKey: 0 });
    expect(document.activeElement).not.toBe(publishButton());
  });
});

describe("revealAndFocus", () => {
  it("does nothing, and does not throw, for a missing button", () => {
    expect(revealAndFocus(null)).toBe(false);
  });

  it("scrolls once and focuses without a second scroll", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    const scroll = vi.fn();
    button.scrollIntoView = scroll;
    const focus = vi.spyOn(button, "focus");
    expect(revealAndFocus(button)).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("will not focus a disabled button", () => {
    const button = document.createElement("button");
    button.disabled = true;
    document.body.appendChild(button);
    expect(revealAndFocus(button)).toBe(false);
    expect(document.activeElement).not.toBe(button);
    button.remove();
  });
});
