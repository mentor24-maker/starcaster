// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { normalizeBackgroundSettings } from "@/lib/builder-template";

/**
 * WHICH FILTER THE VIDEO PICKERS ASK THE GALLERY FOR.
 *
 * They asked for a media CATEGORY of "Video"/"Image" until 2026-08-31.
 * `mediaCategory` is the topical category — "Article Banner", "X Post", and a
 * "Top / Sub" pair for community assets — and nothing in the library carries
 * "Video" as one. So the modal painted the whole gallery and then emptied
 * itself the instant the filter landed: Dane saw a flash and then a blank
 * shell, which is indistinguishable from a broken picker.
 *
 * The gallery modal is stubbed on purpose. What was wrong is the PROPS the
 * panel hands it — a value that type-checks perfectly and matches nothing —
 * so those props are exactly what this asserts, without dragging in the real
 * media library, its fetches and its portal.
 */
const galleryProps: Array<Record<string, unknown>> = [];

vi.mock("./builder-gallery-modal", () => ({
  BuilderGalleryModal: (props: Record<string, unknown>) => {
    galleryProps.push(props);
    return null;
  }
}));

const { BuilderBackgroundControls } = await import("./builder-background-controls");

const VIDEO_BACKGROUND = normalizeBackgroundSettings({
  mode: "video",
  videoUrl: "/assets/clip.mp4",
  posterUrl: "/assets/still.jpg"
});

/** Mount the panel, click the named button, and hand back the modal's props. */
function clickPicker(label: string): Record<string, unknown> | undefined {
  galleryProps.length = 0;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <BuilderBackgroundControls
        allowVideo
        label="Row Background"
        background={VIDEO_BACKGROUND}
        onChange={() => {}}
      />
    );
  });

  const button = [...host.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === label
  );
  if (!button) throw new Error(`no "${label}" button in the panel`);

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const props = galleryProps.at(-1);
  act(() => root.unmount());
  host.remove();
  return props;
}

beforeEach(() => {
  galleryProps.length = 0;
});

describe("the video background pickers", () => {
  it("opens a gallery at all when Choose Video is clicked", () => {
    // If this fails, every assertion below is passing on nothing.
    expect(clickPicker("Choose Video")).toBeDefined();
  });

  it("asks for video FILES when choosing the clip", () => {
    expect(clickPicker("Choose Video")?.initialKind).toBe("video");
  });

  it("asks for image FILES when choosing the poster", () => {
    expect(clickPicker("Choose Poster")?.initialKind).toBe("image");
  });

  it("never asks for a media CATEGORY — the bug that emptied the picker", () => {
    for (const label of ["Choose Video", "Choose Poster"]) {
      const category = clickPicker(label)?.initialMediaCategory;
      // Absent, or at least never one of the two values no asset carries.
      expect(category === undefined || category === "").toBe(true);
    }
  });
});
