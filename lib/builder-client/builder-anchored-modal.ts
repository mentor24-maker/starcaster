import type { CSSProperties } from "react";

export type BuilderModalAnchor = {
  x: number;
  y: number;
};

const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_PADDING_PX = 16;

export type AnchoredModalOptions = {
  width: number;
  height: number;
  /**
   * Horizontal placement relative to the anchor: "center" puts the anchor at
   * the modal's horizontal center (good for buttons whose center you tracked),
   * "start" puts the anchor at the modal's left edge (good for dropdowns).
   */
  align?: "center" | "start";
  /** Smallest height to reserve before clamping (avoids a sliver-height modal). */
  minHeight?: number;
  /** Distance between the anchor and the modal edge. */
  gap?: number;
};

/**
 * Collision-aware fixed positioning for a popup anchored to a viewport point.
 *
 * Keeps the popup fully on-screen regardless of where the trigger sits:
 *  - flips vertically to whichever side of the anchor has more room and sizes
 *    `maxHeight` to fit (so a trigger near the bottom opens upward, etc.);
 *  - shifts horizontally toward the viewport center and clamps so neither edge
 *    is clipped (this is what keeps a far-right trigger's popup reachable).
 *
 * Returns `maxHeight` rather than a fixed height so shorter content doesn't get
 * padded out; pair with `overflow-y: auto` for tall content.
 */
export function getAnchoredModalStyle(
  anchor: BuilderModalAnchor,
  options: AnchoredModalOptions
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const edge = VIEWPORT_EDGE_PADDING_PX;
  const gap = options.gap ?? ANCHOR_GAP_PX;
  const align = options.align ?? "center";

  const width = Math.min(options.width, viewportWidth - edge * 2);

  // Vertical: open toward whichever side of the anchor has more room, then cap
  // the height to what actually fits there.
  const spaceAbove = anchor.y - gap - edge;
  const spaceBelow = viewportHeight - anchor.y - gap - edge;
  const openAbove = spaceAbove > spaceBelow;
  const room = Math.max(openAbove ? spaceAbove : spaceBelow, options.minHeight ?? 0);
  const maxHeight = Math.min(options.height, room, viewportHeight - edge * 2);

  // Horizontal: position per alignment, then clamp both edges into the viewport
  // (effectively nudging the popup back toward center when near an edge).
  const rawLeft = align === "center" ? anchor.x - width / 2 : anchor.x;
  const left = Math.min(Math.max(rawLeft, edge), Math.max(edge, viewportWidth - edge - width));

  return {
    position: "fixed",
    left,
    width,
    maxHeight,
    ...(openAbove ? { bottom: viewportHeight - anchor.y + gap } : { top: anchor.y + gap })
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
