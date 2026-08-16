import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { carouselSeamShift, carouselShortestDelta } from "./builder-carousel-loop";

/**
 * The card slider's continuous loop, 2026-08-16.
 *
 * Both of these were wrong at least once while the loop was being built, and
 * neither failure was visible in rendered markup — they only showed up as
 * "eight quick presses moved seven cards" when driving a real browser. Pulled
 * out into pure functions for exactly that reason.
 */
describe("carouselSeamShift", () => {
  const SET = 2368; // 8 cards at 296px

  it("leaves the strip alone while it is on the middle copy", () => {
    expect(carouselSeamShift(SET, SET)).toBe(0);
    expect(carouselSeamShift(SET * 1.4, SET)).toBe(0);
    expect(carouselSeamShift(SET * 0.6, SET)).toBe(0);
  });

  it("pulls it forward a whole set once it walks off the near end", () => {
    expect(carouselSeamShift(SET * 0.4, SET)).toBe(SET);
    expect(carouselSeamShift(0, SET)).toBe(SET);
  });

  it("pushes it back a whole set once it walks off the far end", () => {
    expect(carouselSeamShift(SET * 1.6, SET)).toBe(-SET);
    expect(carouselSeamShift(SET * 3, SET)).toBe(-SET);
  });

  it("shifts by exactly one set, so the jump lands on identical content", () => {
    // Any other distance would move the strip to a DIFFERENT card and the
    // seam would be visible — the whole trick is that it is not.
    for (const at of [0, SET * 0.2, SET * 1.9, SET * 5]) {
      const shift = carouselSeamShift(at, SET);
      expect(Math.abs(shift) === SET || shift === 0).toBe(true);
    }
  });

  it("does nothing rather than dividing by zero on an empty shelf", () => {
    expect(carouselSeamShift(0, 0)).toBe(0);
    expect(carouselSeamShift(Number.NaN, 2368)).toBe(0);
  });
});

describe("carouselShortestDelta", () => {
  it("steps forward one to reach the next card", () => {
    expect(carouselShortestDelta(0, 1, 8)).toBe(1);
  });

  it("wraps forward rather than travelling the whole shelf backwards", () => {
    // The dots' scenic-route bug: from the last card, card 0 is one step on.
    expect(carouselShortestDelta(7, 0, 8)).toBe(1);
    expect(carouselShortestDelta(6, 0, 8)).toBe(2);
  });

  it("wraps backward for the same reason", () => {
    expect(carouselShortestDelta(0, 7, 8)).toBe(-1);
    expect(carouselShortestDelta(1, 7, 8)).toBe(-2);
  });

  it("takes the direct route when it is genuinely shorter", () => {
    expect(carouselShortestDelta(0, 3, 8)).toBe(3);
    expect(carouselShortestDelta(5, 2, 8)).toBe(-3);
  });

  it("reads a position from any copy of the set", () => {
    // The strip's raw card offset counts across all three copies, so position
    // 9 on an 8-card shelf is card 1 — the caller passes it unreduced.
    expect(carouselShortestDelta(9, 2, 8)).toBe(1);
    expect(carouselShortestDelta(17, 2, 8)).toBe(1);
  });

  it("stays put when asked for the card it is already on", () => {
    expect(carouselShortestDelta(3, 3, 8)).toBe(0);
    expect(carouselShortestDelta(11, 3, 8)).toBe(0);
  });

  it("does nothing rather than dividing by zero on an empty shelf", () => {
    expect(carouselShortestDelta(0, 1, 0)).toBe(0);
  });
});

/**
 * The scrollbar the operator asked to remove lives in CSS, where no markup
 * test can see it — the same blind spot that let a hard-coded 180px crop
 * reach the live site a day earlier. So this reads the stylesheet.
 */
describe("the card row hides its scrollbar", () => {
  const css = readFileSync(
    new URL("../../src/css/_builder-react-overrides.css", import.meta.url),
    "utf8"
  );

  it("hides it in every engine, not just the one the author was using", () => {
    const at = css.indexOf(".builder-react-root .builder-preview-carousel-cards {");
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toContain("scrollbar-width: none");
    expect(rule).toContain("-ms-overflow-style: none");
    expect(css).toContain(".builder-preview-carousel-cards::-webkit-scrollbar");
  });

  it("still scrolls — hiding the bar must not stop a swipe", () => {
    const at = css.indexOf(".builder-react-root .builder-preview-carousel-cards {");
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toContain("overflow-x: auto");
  });
});
