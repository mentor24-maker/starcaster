// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";
import type { BackgroundSettings } from "@/lib/builder-template";
import type { AdminMediaItem } from "@/lib/admin-media-shared";

/**
 * WHAT THE PANEL DOES WITH THE SIZE THE PICKER HANDS IT.
 *
 * This is the one line the whole feature hangs from: the gallery knows every
 * asset's byte size, the background setting stores only a url, and the moment
 * of the click is where the two meet. Delete `videoBytes` from that write and
 * nothing errors, nothing type-fails, and every other test in the suite still
 * passes — the warning simply never appears on any page anyone builds from
 * now on. That was verified by trying it.
 *
 * The gallery modal is stubbed, on the same reasoning as
 * `builder-background-picker-kind.test.tsx` next door: what is under test is
 * the panel's own handler, so calling it directly is more honest than dragging
 * the real media library, its fetches and its portal into a unit test.
 */
// React 18 asks to be told out loud that `act` is legitimate here rather than
// inferring it; without this every render logs a warning that reads like a
// broken test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const galleryProps: Array<Record<string, unknown>> = [];

vi.mock("./builder-gallery-modal", () => ({
  BuilderGalleryModal: (props: Record<string, unknown>) => {
    galleryProps.push(props);
    return null;
  }
}));

const { BuilderBackgroundControls } = await import("./builder-background-controls");

const MB = 1000 * 1000;

/** What the panel has actually committed, as the page model would hold it. */
let stored: BackgroundSettings;

function Host() {
  const [background, setBackground] = useState<BackgroundSettings>({
    ...createDefaultBackgroundSettings(),
    mode: "video"
  });
  stored = background;
  return (
    <BuilderBackgroundControls
      allowVideo
      label="Row Background"
      background={background}
      onChange={(updater) => setBackground((current) => updater(current))}
    />
  );
}

/** Mount, click a picker button, and choose `item` from the stubbed gallery. */
function pick(label: string, item: Partial<AdminMediaItem> & { path: string }) {
  galleryProps.length = 0;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Host />);
  });

  const button = [...host.querySelectorAll("button")].find(
    (candidate) => (candidate.textContent || "").trim() === label
  );
  if (!button) throw new Error(`no "${label}" button in the panel`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const onSelectImage = galleryProps.at(-1)?.onSelectImage as
    | ((path: string, item?: AdminMediaItem) => void)
    | undefined;
  if (!onSelectImage) throw new Error("the gallery was never opened with a select handler");

  act(() => {
    onSelectImage(item.path, item as AdminMediaItem);
  });

  const text = host.textContent || "";
  act(() => root.unmount());
  host.remove();
  return text;
}

beforeEach(() => {
  galleryProps.length = 0;
});

describe("choosing a background video from the gallery", () => {
  it("records the chosen file's size on the page, beside its url", () => {
    pick("Choose Video", { path: "/gallery/hero.mp4", size: 34 * MB });

    expect(stored.videoUrl).toBe("/gallery/hero.mp4");
    expect(stored.videoBytes).toBe(34 * MB);
  });

  it("warns about it on screen straight away", () => {
    const text = pick("Choose Video", { path: "/gallery/hero.mp4", size: 34 * MB });

    expect(text).toContain("This video is 34 MB.");
  });

  it("records a comfortable size too, and does not warn about it", () => {
    const text = pick("Choose Video", { path: "/gallery/small.mp4", size: 4 * MB });

    expect(stored.videoBytes).toBe(4 * MB);
    expect(text).toContain("4.0 MB");
    expect(text).not.toContain("Visitors on phone data");
  });

  /*
   * The community library carries no size, and an asset row written before
   * sizes were recorded carries none either. Both must land as 0 — "unknown",
   * which the panel renders as nothing — rather than as NaN or undefined,
   * either of which would survive normalization as a number the panel then
   * tries to format.
   */
  it("stores 0 when the chosen file has no size to give", () => {
    pick("Choose Video", { path: "/gallery/sizeless.mp4" });

    expect(stored.videoUrl).toBe("/gallery/sizeless.mp4");
    expect(stored.videoBytes).toBe(0);
  });

  /*
   * A poster is an image behind the video, not the video. Writing the
   * poster's size onto `videoBytes` would describe the wrong file entirely —
   * and a poster is always the smaller of the two, so it would silently
   * SUPPRESS the warning on exactly the heavy videos that need it.
   */
  it("leaves the video's size alone when a poster is chosen", () => {
    pick("Choose Poster", { path: "/gallery/still.jpg", size: 2 * MB });

    expect(stored.posterUrl).toBe("/gallery/still.jpg");
    expect(stored.videoBytes).toBe(0);
  });
});
