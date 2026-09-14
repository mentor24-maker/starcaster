// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyUploadedBackgroundMedia } from "@/lib/background-uploaded-media";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";
import { BuilderBackgroundControls } from "./builder-background-controls";

/**
 * Row Background's Upload Video switched the row to IMAGE and put the clip in
 * the image url (task 86bbwe98a): the row's upload handler hard-coded
 * `mode: "image"` from before video backgrounds existed, and the Video panel
 * reused it. And the Poster File row had no upload at all, so a library with
 * no stills let the operator add the clip but not the poster the panel's own
 * warning says he needs.
 *
 * These drive the real buttons and the real row handler's source, so each
 * half fails if it comes back.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

const VIDEO_ROW = {
  ...createDefaultBackgroundSettings(),
  mode: "video" as const,
  videoUrl: "/api/admin/media-file/old.mp4",
  posterUrl: "",
  imageUrl: "/api/admin/media-file/kept-image.jpg"
};

function mountVideoPanel(onUploadImage: (file: File | null, target?: "poster") => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <BuilderBackgroundControls
        allowVideo
        label="Row Background"
        background={VIDEO_ROW}
        onChange={() => {}}
        onUploadImage={onUploadImage}
      />
    );
  });
}

function fileInputUnder(labelText: string): HTMLInputElement {
  const label = [...container!.querySelectorAll("label")].find((l) => l.textContent?.trim() === labelText);
  if (!label) throw new Error(`no "${labelText}" upload button rendered`);
  return label.querySelector("input[type=file]") as HTMLInputElement;
}

function chooseFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the Video panel's upload buttons", () => {
  it("Upload Video hands over the clip with no target — it is the background itself", () => {
    const calls: Array<[string | undefined, string | undefined]> = [];
    mountVideoPanel((file, target) => calls.push([file?.name, target]));
    const input = fileInputUnder("Upload Video");
    expect(input.accept).toBe("video/*");
    chooseFile(input, new File(["x"], "hero.mp4", { type: "video/mp4" }));
    expect(calls).toEqual([["hero.mp4", undefined]]);
  });

  it("Upload Poster exists and hands over the still marked as the poster", () => {
    const calls: Array<[string | undefined, string | undefined]> = [];
    mountVideoPanel((file, target) => calls.push([file?.name, target]));
    const input = fileInputUnder("Upload Poster");
    expect(input.accept).toBe("image/*");
    chooseFile(input, new File(["x"], "still.jpg", { type: "image/jpeg" }));
    expect(calls).toEqual([["still.jpg", "poster"]]);
  });
});

describe("what an upload does to the background", () => {
  it("an uploaded clip keeps the row on Video, sets videoUrl and its size, and leaves the image url alone", () => {
    const next = applyUploadedBackgroundMedia(
      VIDEO_ROW,
      { path: "/api/admin/media-file/hero.mp4", kind: "video", size: 3_100_000 }
    );
    expect(next.mode).toBe("video");
    expect(next.videoUrl).toBe("/api/admin/media-file/hero.mp4");
    expect(next.videoBytes).toBe(3_100_000);
    expect(next.imageUrl).toBe(VIDEO_ROW.imageUrl);
  });

  it("an uploaded poster fills ONLY the poster — an image must not flip a video row to Image", () => {
    const decorated = { ...VIDEO_ROW, videoSpeed: 0.5, videoLoop: false, videoBytes: 2_000_000 };
    const next = applyUploadedBackgroundMedia(
      decorated,
      { path: "/api/admin/media-file/still.jpg", kind: "image" },
      "poster"
    );
    expect(next).toEqual({ ...decorated, posterUrl: "/api/admin/media-file/still.jpg" });
  });

  it("the Image panel's upload still sets Image mode and imageUrl, exactly as before", () => {
    const imageRow = { ...createDefaultBackgroundSettings(), mode: "image" as const };
    const next = applyUploadedBackgroundMedia(imageRow, { path: "/api/admin/media-file/photo.jpg", kind: "image" });
    expect(next.mode).toBe("image");
    expect(next.imageUrl).toBe("/api/admin/media-file/photo.jpg");
  });
});

describe("the ROW upload handler in the editor", () => {
  // The handler lives inside a 3,000-line component with no seam, so read its
  // source — comments stripped, anchored on the call rather than on phrases.
  const src = readFileSync(path.join(__dirname, "..", "admin-builder-editor.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const start = src.indexOf("function uploadMediaForSectionBackground(");
  const body = src.slice(start, src.indexOf("\n  }\n", start));

  it("goes through applyUploadedBackgroundMedia with the upload's target", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/background: applyUploadedBackgroundMedia\(c\.background, m, target\)/);
  });

  it("never hard-codes Image mode again — the 86bbwe98a defect", () => {
    expect(body).not.toMatch(/mode:\s*"image"/);
  });

  it("the row and cell wiring both pass the target through from the button", () => {
    expect(src).toMatch(/onUploadSectionBackgroundMedia=\{\(file, target\) => uploadMediaForSectionBackground\(section\.id, file, target\)\}/);
    expect(src).toMatch(/onUploadCellBackgroundMedia=\{\(col, file, target\) => uploadMediaForCellBackground\(section\.id, col, file, target\)\}/);
    expect(src).not.toMatch(/onUploadSectionBackgroundMedia=\{\(file\) =>/);
  });

  it("the column panel forwards the target too — dropping it would flip a video CELL to Image on Upload Poster", () => {
    const cell = readFileSync(path.join(__dirname, "builder-cell-style-settings.tsx"), "utf8");
    expect(cell).toMatch(/\(file, target\) => onUploadCellBackgroundMedia\(column, file, target\)/);
  });
});
