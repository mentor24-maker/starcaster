import type { CSSProperties } from "react";

/**
 * THE CLIP BOX AROUND A BACKGROUND LAYER.
 *
 * A video background layer is scaled to cover — and a blurred one is scaled
 * further still, so its soft rim falls outside the surface on purpose
 * (`blurCompensationScale`). A parallaxing image layer is taller than its row
 * by the whole travel distance. Both have to be contained, or a cell's footage
 * paints over the column beside it and a row's spills onto the rows above and
 * below.
 *
 * Until 2026-09-14 the containment was `overflow: hidden` on the SURFACE — the
 * row, and then the cell when per-cell video shipped. That contains the layer,
 * and it also clips every other thing inside the surface, which is a defect
 * the moment one of those things is supposed to escape: a navigation module's
 * dropdown in a column with a video background was cut off at the column's
 * edge and read, to a visitor, as a menu that would not open (86bbwmp2y).
 * `overflow: hidden` cannot tell "footage escaping" from "a menu that is meant
 * to escape", so the answer is to stop asking it to — clip the LAYER, in a box
 * of its own at the surface's bounds, and leave the surface `overflow:
 * visible` exactly as it is without a background.
 *
 * One function, used by the row and by the cell, because two copies of this
 * box are two things to keep in step and only one of them would ever get
 * fixed — which is the same argument that put both surfaces on one
 * `BuilderBackgroundLayer`.
 */

/**
 * Marks the clip box in the DOM.
 *
 * Load-bearing rather than decorative: the parallax driver walks up from the
 * layer to find the surface it is measuring against, and this attribute is how
 * it knows the element directly above the layer is the box rather than the
 * row. Render contracts select on it too.
 */
export const BUILDER_BACKGROUND_CLIP_ATTR = "data-builder-background-clip";

/**
 * The box itself.
 *
 * - `inset: 0` against a surface that is already `position: relative` — the
 *   same geometry the layer had when it was the surface's direct child, so
 *   nothing about where the footage lands changes.
 * - `border-radius: inherit` keeps the chain the layer already relied on: the
 *   surface's radius reaches the box, and the box's reaches the layer.
 * - `pointer-events: none` because this is a full-size element sitting over
 *   the cell's own fill. Without it the box would swallow every click on the
 *   column — which is the same failure the layer's own rule guards against,
 *   arriving one element higher up.
 * - `z-index: 0` is the rung the layer already sat on, restated on the box
 *   because the box is what the stylesheet's rungs now see: a cell's tint
 *   screen is 0 and its modules are 1, a row's screen is 1 and its columns
 *   are 2. Keeping the box at 0 leaves both of those stacks exactly as they
 *   were measured.
 */
export function builderBackgroundClipStyle(): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    borderRadius: "inherit",
    pointerEvents: "none",
    zIndex: 0
  };
}

/**
 * The attribute, ready to spread onto the box, saying which surface put it
 * there — `section` or `cell`. A render contract can then tell the row's box
 * and the cell's box apart, which is the difference between "the footage is
 * contained somewhere" and "it is contained by the surface that mounted it".
 */
export function builderBackgroundClipAttrs(
  surface: "section" | "cell"
): Record<string, string> {
  return { [BUILDER_BACKGROUND_CLIP_ATTR]: surface };
}

/**
 * The surface a background layer is measuring itself against, from the layer.
 *
 * The layer used to be a direct child of the row or the cell, so the parallax
 * driver asked for `parentElement` and got the surface. With the clip box in
 * between, `parentElement` is the box — and the box is `inset: 0` against the
 * surface's PADDING box, which is a different rectangle from the surface's own
 * `getBoundingClientRect()` the moment the row carries a border. Measuring the
 * wrong one would shift the parallax geometry by the border width on every
 * bordered row, silently and only there.
 *
 * So the step over the box is explicit: one element up when the parent is the
 * box, and unchanged otherwise. Written as a rule rather than assumed, because
 * the assumption is exactly what the box just broke.
 */
export function builderBackgroundLayerSurface(node: Element | null): HTMLElement | null {
  const parent = node?.parentElement ?? null;
  if (!parent) return null;
  if (parent.hasAttribute(BUILDER_BACKGROUND_CLIP_ATTR)) {
    return parent.parentElement;
  }
  return parent;
}
