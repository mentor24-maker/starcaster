import type { CSSProperties } from "react";

export type BuilderModalAnchor = {
  x: number;
  y: number;
};

const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_PADDING_PX = 16;

export function getAnchoredModalStyle(
  anchor: BuilderModalAnchor,
  options: { width: number; height: number }
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const modalWidth = Math.min(options.width, viewportWidth - VIEWPORT_EDGE_PADDING_PX * 2);
  const halfWidth = modalWidth / 2;
  const left = Math.min(
    Math.max(anchor.x, VIEWPORT_EDGE_PADDING_PX + halfWidth),
    viewportWidth - VIEWPORT_EDGE_PADDING_PX - halfWidth
  );
  const spaceAboveAnchor = Math.max(anchor.y - ANCHOR_GAP_PX - 24, 180);
  const modalHeight = Math.min(options.height, spaceAboveAnchor, viewportHeight - 32);

  return {
    position: "fixed",
    left,
    bottom: viewportHeight - anchor.y + ANCHOR_GAP_PX,
    transform: "translateX(-50%)",
    width: modalWidth,
    height: modalHeight,
    maxHeight: modalHeight
  };
}

const RICH_TEXT_GALLERY_EDGE_PX = 100;

/** Rich-text gallery: near-fullscreen, centered; may cover the editor beneath. */
export function getRichTextGalleryModalStyle(): CSSProperties {
  const edge = RICH_TEXT_GALLERY_EDGE_PX;
  const width = window.innerWidth - edge * 2;
  const height = window.innerHeight - edge * 2;

  return {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width,
    height,
    maxWidth: width,
    maxHeight: height
  };
}
