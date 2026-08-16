/**
 * The arithmetic behind the card slider's continuous loop.
 *
 * The loop is built by rendering the card set three times over and keeping
 * the strip parked on the middle copy: it can then be walked past either end
 * without running out, and once scrolling settles the strip is put back by
 * exactly one set-width. The three copies are identical, so that jump lands
 * on the same picture in the same place and is invisible — which is what
 * makes the first card come round again instead of the shelf dead-ending
 * (operator, 2026-08-16).
 *
 * These two functions are the whole of the reasoning, pulled out of the
 * component because they are the part that is easy to get wrong and
 * impossible to test in place: everything around them is scroll positions and
 * refs, which exist only in a real browser. Both bugs found while building
 * this — a press thrown away at the seam, and the dots taking the long way
 * round — were in exactly this arithmetic.
 */

/**
 * How far to shove the strip to put it back on the middle copy, or 0 if it is
 * already there.
 *
 * The bounds are half a set either side of the middle copy rather than its
 * exact edges, so an ordinary step near a boundary does not ping-pong.
 */
export function carouselSeamShift(scrollLeft: number, setWidth: number): number {
  if (!Number.isFinite(scrollLeft) || !Number.isFinite(setWidth) || setWidth <= 0) return 0;
  if (scrollLeft < setWidth * 0.5) return setWidth;
  if (scrollLeft > setWidth * 1.5) return -setWidth;
  return 0;
}

/**
 * How many cards to move to get from `current` to `next`, taking the shorter
 * way round.
 *
 * Positions repeat while looping, so "go to card 0" from card 7 of 8 means
 * one step forward, not seven back — without this a dot press near the end of
 * a long shelf takes the scenic route past everything else.
 */
export function carouselShortestDelta(current: number, next: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const from = ((Math.trunc(current) % count) + count) % count;
  const to = ((Math.trunc(next) % count) + count) % count;
  let delta = to - from;
  if (delta > count / 2) delta -= count;
  if (delta < -count / 2) delta += count;
  return delta;
}
