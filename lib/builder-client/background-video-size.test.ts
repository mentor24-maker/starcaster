import { describe, expect, it } from "vitest";

import {
  BACKGROUND_VIDEO_WARN_BYTES,
  backgroundVideoSizeNotice,
  formatFileSize,
  recallAssetByteSize,
  rememberAssetByteSize
} from "./background-video-size";

const MB = 1000 * 1000;

describe("formatFileSize", () => {
  it("names megabytes the way the operator's Finder does", () => {
    expect(formatFileSize(34 * MB)).toBe("34 MB");
    expect(formatFileSize(1.4 * MB)).toBe("1.4 MB");
    expect(formatFileSize(820 * 1000)).toBe("820 KB");
    expect(formatFileSize(512)).toBe("512 bytes");
  });

  it("says nothing rather than '0' when there is no size to report", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(-1)).toBe("");
  });
});

describe("backgroundVideoSizeNotice", () => {
  it("warns, in plain words naming the real size, above the threshold", () => {
    const notice = backgroundVideoSizeNotice(34 * MB);
    expect(notice?.isOversized).toBe(true);
    expect(notice?.sizeText).toBe("34 MB");
    expect(notice?.warning).toContain("This video is 34 MB.");
    expect(notice?.warning).toContain("phone data");
  });

  it("reports the size but does not warn below the threshold", () => {
    const notice = backgroundVideoSizeNotice(4 * MB);
    expect(notice?.isOversized).toBe(false);
    expect(notice?.sizeText).toBe("4.0 MB");
    expect(notice?.warning).toBe("");
  });

  /*
   * The boundary in both directions. A `>=` here would warn about a video that
   * is exactly the size the message calls comfortable, which is the one case a
   * reader would notice and stop trusting the number.
   */
  it("treats exactly the threshold as comfortable and one byte more as not", () => {
    expect(backgroundVideoSizeNotice(BACKGROUND_VIDEO_WARN_BYTES)?.isOversized).toBe(false);
    expect(backgroundVideoSizeNotice(BACKGROUND_VIDEO_WARN_BYTES + 1)?.isOversized).toBe(true);
  });

  it("returns null when the size is unknown, so the panel says nothing at all", () => {
    expect(backgroundVideoSizeNotice(null)).toBeNull();
    expect(backgroundVideoSizeNotice(undefined)).toBeNull();
    expect(backgroundVideoSizeNotice(0)).toBeNull();
  });
});

describe("the asset size registry", () => {
  /*
   * The failure this guards is silent: an asset registers under its raw
   * `location` and the panel looks it up under the normalized `videoUrl`, so
   * every lookup misses, nothing errors, and the size simply never appears.
   */
  it("finds a size registered under one spelling of the path from the other", () => {
    rememberAssetByteSize("gallery/hero-clip.mp4", 34 * MB);
    expect(recallAssetByteSize("/gallery/hero-clip.mp4")).toBe(34 * MB);
    expect(recallAssetByteSize("/api/admin/media-file/gallery/hero-clip.mp4")).toBe(34 * MB);
  });

  it("returns null for a path it has never seen", () => {
    expect(recallAssetByteSize("/gallery/never-loaded.mp4")).toBeNull();
    expect(recallAssetByteSize("")).toBeNull();
  });

  it("ignores a registration with no usable size", () => {
    rememberAssetByteSize("/gallery/sizeless.mp4", 0);
    expect(recallAssetByteSize("/gallery/sizeless.mp4")).toBeNull();
  });
});
