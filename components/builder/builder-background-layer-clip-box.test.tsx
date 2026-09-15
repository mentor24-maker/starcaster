// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderBackgroundLayer } from "./builder-background-layer";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";

/**
 * WHERE THE CLIP BOX GOES, AND WHEN IT MUST NOT GO ANYWHERE (86bbwmp2y).
 *
 * The layer is contained by a box of its own rather than by the row or the
 * cell, so a navigation dropdown in a video column is not cut off. The box was
 * mounted by the SURFACES at first, from the settings — and the layer renders
 * nothing at all at phone width and under reduce motion, so a phone got an
 * empty box as the row's first child. That is an extra element in a CSS grid:
 * the mobile reverse-stack rules run `:nth-child(1..6)` and stop at six, so
 * the sixth column of a six-column row fell through to `order: 0` and was
 * shown fourth. Silently, on a live page.
 *
 * `check:render` cannot see this — it sweeps at 1440px, where the video always
 * mounts — and the phone-width contracts added beside it read the real browser.
 * These are the same questions asked where they are cheap, plus the one about
 * the PAGE layer, which must stay a direct child of the shell because
 * `.has-shell-background-video > .builder-preview-video-background-page` is the
 * rule that makes it fixed to the window.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIDEO = {
  ...createDefaultBackgroundSettings(),
  mode: "video" as const,
  videoUrl: "/images/x.mp4"
};

let container: HTMLDivElement;
/** Stands in for the surface: the layer renders as its child. */
let surface: HTMLDivElement;
let root: Root;

/** jsdom has no media queries; the component reads these exactly as it does in a browser. */
let isPhone = false;
let prefersReduce = false;

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query.includes("max-width") ? isPhone : prefersReduce;
      },
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {}
    })
  });
}

function render(node: React.ReactElement) {
  act(() => {
    root.render(node);
  });
}

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  isPhone = false;
  prefersReduce = false;
  installMatchMedia();
  container = document.createElement("div");
  document.body.appendChild(container);
  surface = document.createElement("div");
  container.appendChild(surface);
  root = createRoot(surface);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("the clip box around a background layer", () => {
  it("wraps a ROW's video, so the footage is contained and the row is not", () => {
    render(<BuilderBackgroundLayer background={VIDEO} surface="section" />);

    const box = surface.querySelector('[data-builder-background-clip="section"]');
    expect(box).not.toBeNull();
    expect(box?.querySelector("video")).not.toBeNull();
    expect((box as HTMLElement).style.overflow).toBe("hidden");
  });

  it("wraps a CELL's video the same way, from the same function", () => {
    render(<BuilderBackgroundLayer background={VIDEO} surface="cell" />);

    const box = surface.querySelector('[data-builder-background-clip="cell"]');
    expect(box).not.toBeNull();
    expect(box?.querySelector("video")).not.toBeNull();
  });

  it("leaves the PAGE layer a direct child, because a CSS rule requires it", () => {
    // `.has-shell-background-video > .builder-preview-video-background-page`
    // is what makes the page clip `position: fixed`. A wrapper is one element
    // too many and the clip would scroll away with the sections.
    render(<BuilderBackgroundLayer background={VIDEO} surface="page" />);

    expect(surface.querySelector("[data-builder-background-clip]")).toBeNull();
    expect(surface.firstElementChild?.tagName).toBe("VIDEO");
  });

  it("MOUNTS NOTHING AT ALL at phone width — not even the box", () => {
    // The regression this file is named for. An empty box is still a child,
    // and the row's children are what the reverse-stack rules count.
    isPhone = true;
    render(<BuilderBackgroundLayer background={VIDEO} surface="section" />);

    expect(surface.querySelector("video")).toBeNull();
    expect(surface.querySelector("[data-builder-background-clip]")).toBeNull();
    expect(surface.childElementCount).toBe(0);
  });

  it("mounts nothing under reduce motion either, for the same reason", () => {
    prefersReduce = true;
    render(<BuilderBackgroundLayer background={VIDEO} surface="section" />);

    expect(surface.childElementCount).toBe(0);
  });

  it("mounts nothing for an image background that is not parallaxing", () => {
    // An image is a CSS background on the surface itself; the layer exists
    // only to MOVE one. Off by default has to mean no element, box included.
    render(
      <BuilderBackgroundLayer
        background={{
          ...createDefaultBackgroundSettings(),
          mode: "image" as const,
          imageUrl: "/images/x.png"
        }}
        surface="section"
      />
    );

    expect(surface.childElementCount).toBe(0);
  });
});
