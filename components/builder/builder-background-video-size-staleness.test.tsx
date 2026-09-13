// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";
import type { BackgroundSettings } from "@/lib/builder-template";

/**
 * THE STALE NUMBER.
 *
 * The background video size warning is the only thing in this panel that
 * states a specific fact about a specific file. That makes its failure mode
 * different from every other control here: a wrong SPEED is visible the moment
 * the video plays, but a wrong SIZE looks exactly like a right one. "This
 * video is 34 MB" under a 2MB clip is a confident, specific, false sentence,
 * and the operator has no way to catch it.
 *
 * `videoBytes` is stored beside `videoUrl`, so the two can come apart: change
 * the url without changing the size and the panel describes the previous clip.
 * The guard is that any route which sets a url without supplying a size must
 * clear the size — and nothing about that guard is visible to the compiler or
 * to a static-markup test, because both halves are perfectly well-typed
 * strings and numbers either way.
 *
 * So this drives the real Video URL box in a real DOM and reads back what the
 * panel committed. jsdom on the first line for that reason; the rest of the
 * suite only needs markup.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1000 * 1000;

const HEAVY_VIDEO: BackgroundSettings = {
  ...createDefaultBackgroundSettings(),
  mode: "video",
  videoUrl: "/gallery/heavy-hero.mp4",
  posterUrl: "/gallery/still.jpg",
  videoBytes: 34 * MB
};

let container: HTMLDivElement;
let root: Root;
/** What the panel has actually committed, as the page model would hold it. */
let stored: BackgroundSettings;

/**
 * A CONTROLLED host — the panel hands back a new settings object, the host
 * stores it and hands it straight back down. Rendering against a frozen prop
 * would hide the round trip, which is where the whole bug would live.
 */
function Host() {
  const [background, setBackground] = useState<BackgroundSettings>(HEAVY_VIDEO);
  stored = background;
  return (
    <BuilderBackgroundControls
      label="Row Background"
      allowVideo
      background={background}
      onChange={(updater) => setBackground((current) => updater(current))}
    />
  );
}

/** The Video URL box — the first text input in the Video group. */
function urlBox(): HTMLInputElement {
  const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="text"]')];
  const box = boxes.find((candidate) => candidate.value.endsWith(".mp4"));
  if (!box) throw new Error("the Video URL box did not render at all");
  return box;
}

/**
 * Put a value on the node the way a browser does and let React hear it. React
 * remembers the last value it wrote and ignores an event whose value looks
 * unchanged, so assigning `.value` alone is not enough.
 */
function typeUrl(value: string) {
  const box = urlBox();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no native value setter — the environment is not a DOM");
  act(() => {
    setter.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Host />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("a background video's stored size cannot outlive its video", () => {
  it("starts out warning about the video it was given", () => {
    expect(stored.videoBytes).toBe(34 * MB);
    expect(container.textContent).toContain("This video is 34 MB.");
  });

  it("clears the stored size when a different url is typed in", () => {
    typeUrl("/gallery/some-other-clip.mp4");

    expect(stored.videoUrl).toBe("/gallery/some-other-clip.mp4");
    expect(stored.videoBytes).toBe(0);
  });

  it("stops naming the old size on screen once the url changes", () => {
    typeUrl("/gallery/some-other-clip.mp4");

    expect(container.textContent).not.toContain("34 MB");
    expect(container.textContent).not.toContain("Visitors on phone data");
  });

  it("clears it when the url is emptied altogether", () => {
    typeUrl("");

    expect(stored.videoBytes).toBe(0);
    expect(container.textContent).not.toContain("34 MB");
  });

  /*
   * Everything else on the row has to survive the edit. `videoBytes` is
   * cleared by spreading the current settings, and a fix written as a fresh
   * object rather than a spread would silently reset speed, loop and poster
   * as well — landmine 13's shape, in miniature.
   */
  it("changes nothing else about the background", () => {
    typeUrl("/gallery/some-other-clip.mp4");

    expect(stored.mode).toBe("video");
    expect(stored.posterUrl).toBe("/gallery/still.jpg");
    expect(stored.videoSpeed).toBe(HEAVY_VIDEO.videoSpeed);
    expect(stored.videoLoop).toBe(HEAVY_VIDEO.videoLoop);
  });
});
