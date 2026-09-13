import { describe, expect, it } from "vitest";

import { applyUploadedBackgroundMedia } from "./background-uploaded-media";
import { createDefaultBackgroundSettings } from "./builder-template";

const videoMode = { ...createDefaultBackgroundSettings(), mode: "video" as const };
const imageMode = { ...createDefaultBackgroundSettings(), mode: "image" as const };

describe("applyUploadedBackgroundMedia", () => {
  it("puts an uploaded video on the video url and leaves the surface in video mode", () => {
    const next = applyUploadedBackgroundMedia(videoMode, {
      path: "/api/admin/media-file/hero.mp4",
      kind: "video",
      size: 2_400_000
    });

    expect(next.mode).toBe("video");
    expect(next.videoUrl).toBe("/api/admin/media-file/hero.mp4");
    expect(next.videoBytes).toBe(2_400_000);
  });

  it("does NOT convert a video upload into an image background — the 86bbwe98a defect", () => {
    const next = applyUploadedBackgroundMedia(videoMode, {
      path: "/api/admin/media-file/hero.mp4",
      kind: "video"
    });

    expect(next.mode).not.toBe("image");
    expect(next.imageUrl).toBe(videoMode.imageUrl);
  });

  it("still puts an uploaded image on the image url, the way every surface always has", () => {
    const next = applyUploadedBackgroundMedia(imageMode, {
      path: "/api/admin/media-file/photo.jpg",
      kind: "image"
    });

    expect(next.mode).toBe("image");
    expect(next.imageUrl).toBe("/api/admin/media-file/photo.jpg");
  });

  it("reads the extension when the server did not say what the file is", () => {
    expect(
      applyUploadedBackgroundMedia(imageMode, { path: "/api/admin/media-file/clip.mp4", extension: "mp4" }).mode
    ).toBe("video");
    expect(
      applyUploadedBackgroundMedia(videoMode, { path: "/api/admin/media-file/still.png", extension: "png" }).mode
    ).toBe("image");
  });

  it("falls back to the mode the operator is standing in when nothing identifies the file", () => {
    expect(applyUploadedBackgroundMedia(videoMode, { path: "/blob/mystery" }).mode).toBe("video");
    expect(applyUploadedBackgroundMedia(imageMode, { path: "/blob/mystery" }).mode).toBe("image");
    expect(
      applyUploadedBackgroundMedia(createDefaultBackgroundSettings(), { path: "/blob/mystery" }).mode
    ).toBe("image");
  });

  it("carries a zero size rather than a stale one when the upload reports no bytes", () => {
    const stale = { ...videoMode, videoBytes: 9_000_000 };
    expect(applyUploadedBackgroundMedia(stale, { path: "/x.mp4", kind: "video" }).videoBytes).toBe(0);
  });

  it("keeps every other setting on the background untouched", () => {
    const decorated = { ...videoMode, posterUrl: "/poster.jpg", videoSpeed: 0.5, videoLoop: false };
    const next = applyUploadedBackgroundMedia(decorated, { path: "/new.mp4", kind: "video" });

    expect(next.posterUrl).toBe("/poster.jpg");
    expect(next.videoSpeed).toBe(0.5);
    expect(next.videoLoop).toBe(false);
  });
});
