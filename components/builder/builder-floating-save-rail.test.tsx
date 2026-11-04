// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderFloatingSaveRail } from "./builder-floating-save-rail";

/**
 * The rail is portaled to <body>, outside the screen that owns it, and the
 * admin app leaves a screen by adding `hidden` to it without unmounting the
 * editor. The rail then lost its anchor, fell back to floating mid-right, and
 * Save Page stayed on screen over CRM and every other page (task 86bcxtw7m).
 *
 * jsdom does no layout, so these tests stand in for it: an element inside a
 * `.hidden` screen has no layout box, anything else has a 40px one.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let screen: HTMLDivElement | null = null;
let root: Root | null = null;

function isLaidOut(el: Element) {
  return el.isConnected && !el.closest(".hidden");
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (isLaidOut(this) ? [new DOMRect(0, 0, 40, 40)] : []) as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return isLaidOut(this) ? new DOMRect(0, -500, 40, 40) : new DOMRect(0, 0, 0, 0);
  });

  screen = document.createElement("div");
  screen.className = "app-page";
  document.body.appendChild(screen);
  root = createRoot(screen);
});

afterEach(() => {
  act(() => root?.unmount());
  screen?.remove();
  screen = null;
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function railVisibility() {
  const rail = document.querySelector<HTMLElement>(".builder-floating-save-rail");
  if (!rail) throw new Error("rail did not render");
  return rail.style.visibility;
}

function renderRail(anchorSelector?: string | null) {
  act(() => {
    root?.render(
      <BuilderFloatingSaveRail
        actions={[{ label: "Save Page", savingLabel: "Saving...", onSave: () => {} }]}
        anchorSelector={anchorSelector}
        isSaving={false}
      />
    );
  });
}

describe("the floating Save rail leaves with its screen", () => {
  it("floats while its screen is showing and the anchor is scrolled away", () => {
    const anchor = document.createElement("button");
    anchor.setAttribute("data-builder-save-anchor", "page");
    screen?.appendChild(anchor);

    renderRail();

    expect(railVisibility()).toBe("visible");
  });

  it("hides the moment its screen is hidden, with no scroll or resize", async () => {
    renderRail(null);
    expect(railVisibility()).toBe("visible");

    await act(async () => {
      screen?.classList.add("hidden");
      // MutationObserver callbacks run as a microtask.
      await Promise.resolve();
    });

    expect(railVisibility()).toBe("hidden");
  });

  it("comes back when the screen is shown again", async () => {
    renderRail(null);

    await act(async () => {
      screen?.classList.add("hidden");
      await Promise.resolve();
    });
    await act(async () => {
      screen?.classList.remove("hidden");
      await Promise.resolve();
    });

    expect(railVisibility()).toBe("visible");
  });
});
