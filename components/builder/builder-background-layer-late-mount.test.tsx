// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderBackgroundLayer } from "./builder-background-layer";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";

/**
 * THE PARALLAX LOOP HAS TO START WHEN THE VIDEO ARRIVES (review of #481).
 *
 * The loop reads its anchor out of a ref and gives up when the ref is empty.
 * A ref OBJECT is stable, though, so an element that mounts later changes none
 * of the effect's dependencies and the effect never re-runs. That is a real
 * window rather than a theoretical one: a <video> is not rendered below phone
 * width unless Play On Phones is on, so loading a parallaxing video row in a
 * narrow window and then widening it inserted a <video> carrying every
 * parallax inline style with nothing writing the custom properties behind
 * them. Every var() fell back to its default and it sat perfectly still.
 *
 * What is asserted here is only that THE LOOP RAN — jsdom gives every element
 * a zero-sized box, so the offsets it computes are all zero and mean nothing.
 * That is enough, and it is the whole distinction: with the bug the three
 * custom properties are never written at all.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIDEO_PARALLAX = {
  ...createDefaultBackgroundSettings(),
  mode: "video" as const,
  videoUrl: "/images/x.mp4",
  parallax: true,
  parallaxSpeed: 0.3
};

/** The properties the loop writes on the section, once per frame. */
const WRITTEN_BY_THE_LOOP = "--builder-parallax-y";

let container: HTMLDivElement;
/** Stands in for the section: the layer mounts as a direct child of it. */
let section: HTMLDivElement;
let root: Root;

/**
 * A media query the test can move. jsdom has no layout and no `matchMedia`, so
 * "this window is 390px wide" has to be something the component can be told —
 * which is exactly what it reads in a browser too.
 */
let isPhone = true;
const listeners = new Set<() => void>();

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      // Reduce Motion is off; the width query is the one that moves.
      get matches() {
        return query.includes("max-width") ? isPhone : false;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: (fn: () => void) => listeners.add(fn),
      removeListener: (fn: () => void) => listeners.delete(fn)
    })
  });
}

/** Drag the window out past the phone breakpoint. */
function widenPastPhoneWidth() {
  act(() => {
    isPhone = false;
    for (const fn of [...listeners]) fn();
  });
}

function render() {
  act(() => {
    root.render(<BuilderBackgroundLayer background={VIDEO_PARALLAX} surface="section" />);
  });
}

/** Let at least one animation frame run. */
async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
  });
}

beforeEach(() => {
  // jsdom implements no media playback at all, so `play()` returns undefined
  // and the component's `.catch()` on it throws. A resolved promise is the
  // shape a browser returns.
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};

  isPhone = true;
  listeners.clear();
  installMatchMedia();
  container = document.createElement("div");
  document.body.appendChild(container);
  section = document.createElement("div");
  container.appendChild(section);
  root = createRoot(section);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("a video background that mounts after the layer does", () => {
  it("renders no video at phone width, which is the setup for the bug", () => {
    render();
    // Play On Phones is off by default, so there is nothing to translate yet.
    expect(section.querySelector("video")).toBeNull();
  });

  it("STARTS THE PARALLAX LOOP once the window widens and the video appears", async () => {
    render();
    widenPastPhoneWidth();
    await nextFrame();

    expect(section.querySelector("video")).not.toBeNull();
    // The assertion that fails on the bug: the video is on the page carrying
    // its parallax styles, and nothing has written the values they read.
    expect(section.style.getPropertyValue(WRITTEN_BY_THE_LOOP)).not.toBe("");
  });

  it("runs the loop straight away when the video is there from the start", async () => {
    // The control for the test above. If this one ever fails the fixture is
    // broken, not the feature — and a green result on the widening test would
    // then be measuring nothing.
    isPhone = false;
    render();
    await nextFrame();

    expect(section.querySelector("video")).not.toBeNull();
    expect(section.style.getPropertyValue(WRITTEN_BY_THE_LOOP)).not.toBe("");
  });
});
