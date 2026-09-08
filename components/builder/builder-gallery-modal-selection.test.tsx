// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { AdminMediaItem } from "@/lib/admin-media-shared";
import { DEFAULT_GALLERY_MEDIA_FILTERS } from "@/lib/gallery-media-filters";

/**
 * WHAT THE PICKER HANDS BACK WHEN A FILE IS CHOSEN.
 *
 * The path alone cannot answer "how big is it?", so the picker passes the
 * gallery row too. That second argument is the last link in the chain that
 * carries an asset's byte size from `/api/assets` to the background video
 * warning, and it is invisible to everything else: drop it and the argument is
 * simply `undefined`, which is a legal value of an optional parameter. No type
 * error, no crash, and the warning quietly stops appearing for good.
 *
 * The library hook is mocked rather than the modal, because the modal itself
 * is what is under test here — mocking it, as the panel's own tests do, would
 * leave exactly this line uncovered.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERO: AdminMediaItem = {
  name: "Hero clip",
  path: "gallery/hero.mp4",
  directory: "gallery",
  kind: "video",
  extension: ".mp4",
  size: 34_000_000
};

vi.mock("@/lib/use-gallery-media-library", () => ({
  useGalleryMediaLibrary: () => ({
    media: [HERO],
    allMedia: [HERO],
    total: 1,
    isLoading: false,
    filters: DEFAULT_GALLERY_MEDIA_FILTERS,
    setFilters: () => {},
    loadMedia: () => {},
    clearFilters: () => {},
    rangeEnd: 1,
    canLoadMore: false
  })
}));

const { BuilderGalleryModal } = await import("./builder-gallery-modal");

/** Render the picker and click the first thing that selects the one asset. */
function chooseTheOnlyAsset(): { path?: string; item?: AdminMediaItem } {
  const seen: { path?: string; item?: AdminMediaItem } = {};

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <BuilderGalleryModal
        isUploading={false}
        onSelectImage={(path, item) => {
          seen.path = path;
          seen.item = item;
        }}
        onClose={() => {}}
      />
    );
  });

  /*
   * Queried off the DOCUMENT, not off `host`: this modal renders through a
   * body portal, so nothing it draws is inside the container it was mounted
   * into. The grid view renders one card per asset and the card itself IS the
   * select button.
   */
  const card = document.querySelector<HTMLButtonElement>("button.builder-gallery-card");
  if (!card) throw new Error("the picker rendered no asset card to choose");
  act(() => {
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  act(() => root.unmount());
  host.remove();
  return seen;
}

describe("the gallery picker's selection", () => {
  it("hands back the chosen path", () => {
    expect(chooseTheOnlyAsset().path).toBe("gallery/hero.mp4");
  });

  it("hands back the gallery row too, carrying the file's size", () => {
    const { item } = chooseTheOnlyAsset();

    expect(item).toBeDefined();
    expect(item?.size).toBe(34_000_000);
  });
});
