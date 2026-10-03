/**
 * Effect placement — WHERE a page-wide effect sits.
 *
 * Lifted out of `proximity-effects.ts` on 2026-09-25 (Galaxy module 1/6,
 * task 86bc7f5hf) so a second effect module can share it without importing
 * the cursor-proximity driver it has no use for. The names are unchanged and
 * `proximity-effects.ts` re-exports every one of them, so TractorNav and its
 * tests never noticed the move.
 *
 * "window" is the original behaviour and stays the default: pinned to the
 * middle of the browser window, ignoring the layout entirely, not scrolling
 * with the page. That is right for a page-wide backdrop and wrong for
 * everything else, and it is the only mode TractorNav had — which is why
 * Position X/Y read as nonsense to anyone who had placed the module in a
 * cell and expected the numbers to mean something local.
 *
 * "inline" puts it where the module actually is: centred across its cell,
 * at the module's own place in the flow, scrolling with the page.
 */
export const PROXIMITY_PLACEMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "window", label: "Window Center" },
  { value: "inline", label: "In Place" }
];

export const DEFAULT_PROXIMITY_PLACEMENT = "window";

export function normalizeProximityPlacement(value: string | undefined): string {
  return PROXIMITY_PLACEMENT_OPTIONS.some((option) => option.value === value)
    ? (value as string)
    : DEFAULT_PROXIMITY_PLACEMENT;
}

export function proximityIsInline(value: string | undefined): boolean {
  return normalizeProximityPlacement(value) === "inline";
}

/**
 * The z-index the effect should actually paint at.
 *
 * -9999 is the module's default and is correct for a window backdrop: it puts
 * the light behind the whole page. In place it is a trap — the effect lands
 * behind its own cell's background and disappears completely, which reads as
 * "switching to In Place broke it". A negative index is therefore lifted to 0
 * for inline, so the effect is behind the cell's CONTENT but in front of its
 * backdrop. Any non-negative value the operator set is theirs and is kept.
 */
export function proximityZIndex(zIndex: number, placement: string | undefined): number {
  if (!Number.isFinite(zIndex)) return proximityIsInline(placement) ? 0 : -9999;
  if (proximityIsInline(placement) && zIndex < 0) return 0;
  return zIndex;
}
