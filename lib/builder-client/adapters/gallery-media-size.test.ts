import { describe, expect, it } from "vitest";

import { assetToAdminMediaItem } from "./use-gallery-media-library";
import { recallAssetByteSize } from "../background-video-size";

/**
 * THE JOIN NOBODY ELSE TESTS.
 *
 * A background setting stores a bare URL, so `/api/assets` is the only place
 * the file's weight is known. This mapping is the single point where that
 * number crosses from the API into anything the builder can ask — delete the
 * two lines that do it and the size warning silently renders nothing on every
 * panel, on every site, for ever.
 *
 * That is not hypothetical: it was tried. Removing that line left the
 * warning's own tests, the panel's tests and the whole 17-test adapter suite
 * passing, because every one of them seeds the registry directly. A feature
 * whose load-bearing line can be deleted with no test failing is a feature
 * with no test, which is why this file exists.
 */
describe("the gallery mapping carries an asset's byte size", () => {
  const asset = (over: Record<string, unknown> = {}) => ({
    assetName: "hero.mp4",
    assetType: "video",
    location: "gallery/hero.mp4",
    ...over
  });

  it("registers it so a panel holding only the URL can find it later", () => {
    assetToAdminMediaItem(asset({ location: "gallery/hero.mp4", size: 34_000_000 }));
    expect(recallAssetByteSize("/gallery/hero.mp4")).toBe(34_000_000);
  });

  it("registers under the raw location, findable by the normalized URL", () => {
    assetToAdminMediaItem(asset({ location: "gallery/registered.mp4", size: 12_345_678 }));
    // The stored setting is the NORMALIZED url, not the raw location.
    expect(recallAssetByteSize("/gallery/registered.mp4")).toBe(12_345_678);
  });

  /*
   * A row written before sizes were recorded carries 0, and the community
   * library carries none at all. Neither is an error: `undefined` makes the
   * panel say nothing, where a 0 would render as "0 bytes".
   */
  it("registers nothing when the row has no size", () => {
    assetToAdminMediaItem(asset({ location: "gallery/sizeless.mp4" }));
    assetToAdminMediaItem(asset({ location: "gallery/zero.mp4", size: 0 }));
    expect(recallAssetByteSize("/gallery/sizeless.mp4")).toBeNull();
    expect(recallAssetByteSize("/gallery/zero.mp4")).toBeNull();
  });
});
