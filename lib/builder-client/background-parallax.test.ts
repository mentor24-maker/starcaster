import { describe, expect, it } from "vitest";
import {
  BACKGROUND_PARALLAX_SPEED_INERT,
  backgroundParallaxGeometry,
  backgroundParallaxOffset,
  backgroundParallaxOverscan,
  backgroundParallaxSpeedFromInput,
  clampBackgroundParallaxSpeed,
  DEFAULT_BACKGROUND_PARALLAX_SPEED
} from "./background-parallax";
import {
  builderBackgroundParallaxActive,
  builderBackgroundParallaxSpeed,
  createDefaultBackgroundSettings,
  normalizeBackgroundSettings
} from "./builder-template";

/**
 * The arithmetic is the only part of a parallax that can be held still —
 * nothing in this repo tests CSS — so these are deliberately about NUMBERS and
 * not about elements. `check:render` proves the layer moves in a real browser;
 * this proves it moves by the right amount, and that the two ends of the
 * control mean what the panel says they mean.
 */

/** A 600px band in a 900px window, seen at three moments of its travel. */
const BAND = { sectionHeight: 600, viewportHeight: 900 };

describe("clampBackgroundParallaxSpeed", () => {
  it("keeps a value that is already in range", () => {
    expect(clampBackgroundParallaxSpeed(0.45)).toBe(0.45);
  });

  it("clamps to the two ends rather than wrapping", () => {
    expect(clampBackgroundParallaxSpeed(-3)).toBe(0);
    expect(clampBackgroundParallaxSpeed(9)).toBe(1);
  });

  it("reads a numeric string, because a form control hands back text", () => {
    expect(clampBackgroundParallaxSpeed("0.25")).toBe(0.25);
  });

  it("falls back to the DEFAULT, never to 0, when the value is unreadable", () => {
    // 0 is "pinned", the most dramatic setting on the control, and a stored
    // null must not silently select it. This is the right answer for a value
    // arriving from STORAGE and the wrong one for a keystroke — which is what
    // `backgroundParallaxSpeedFromInput` below is for.
    for (const junk of [undefined, null, "", "abc", NaN, {}]) {
      expect(clampBackgroundParallaxSpeed(junk)).toBe(DEFAULT_BACKGROUND_PARALLAX_SPEED);
    }
  });
});

/**
 * THE BUG THIS PAIR OF FUNCTIONS EXISTS TO SPLIT (review of #481, 2026-08-31).
 *
 * In the real Builder: click into Parallax Speed, backspace to clear it, type
 * 0.7 — and the box read 0.37. Backspace never emptied it. The speed box ran
 * every keystroke through the storage clamp, `<input type="number">` reports
 * an empty string for anything it cannot parse, and the storage clamp turns an
 * empty string into the DEFAULT. So clearing the box put 0.3 straight back and
 * the digits typed next landed inside that number.
 *
 * The fix is not to change what unreadable means in storage — 0.3 is right
 * there, and argued for above. It is that a keystroke is a different question,
 * and its answer needs a third state the clamp does not have: "not a number
 * YET, so change nothing".
 */
describe("backgroundParallaxSpeedFromInput", () => {
  it("commits nothing while the box is empty, so backspace can actually empty it", () => {
    expect(backgroundParallaxSpeedFromInput("")).toBeNull();
  });

  it("commits nothing for the half-typed values a number input reports as empty", () => {
    // `<input type="number">` hands back "" for "0." and "-" alike. Whatever
    // reaches here that is not yet a number must leave the stored speed alone.
    for (const partial of ["", "   ", "-", ".", "0.", "abc"]) {
      expect(backgroundParallaxSpeedFromInput(partial)).toBeNull();
    }
  });

  it("never answers with the default — that is the substitution that ate the keystroke", () => {
    // The regression in one line: the old path returned 0.3 here, so the box
    // refilled itself behind the operator's cursor.
    expect(backgroundParallaxSpeedFromInput("")).not.toBe(DEFAULT_BACKGROUND_PARALLAX_SPEED);
  });

  it("commits a readable number, so typing 0.7 gives 0.7 and not 0.37", () => {
    expect(backgroundParallaxSpeedFromInput("0.7")).toBe(0.7);
    expect(backgroundParallaxSpeedFromInput("0")).toBe(0);
    expect(backgroundParallaxSpeedFromInput("1")).toBe(1);
  });

  it("commits a typed 0 as 0 — pinned is a setting the operator is allowed to choose", () => {
    // Storage reads an unreadable value as 0.3; a DELIBERATELY typed 0 is the
    // one case where 0 must survive, and the two paths disagreeing on this is
    // the whole reason they are separate functions.
    expect(backgroundParallaxSpeedFromInput("0")).toBe(0);
    expect(clampBackgroundParallaxSpeed("")).toBe(DEFAULT_BACKGROUND_PARALLAX_SPEED);
  });

  it("still clamps what it does commit, so the ends of the range hold", () => {
    expect(backgroundParallaxSpeedFromInput("9")).toBe(1);
    expect(backgroundParallaxSpeedFromInput("-3")).toBe(0);
  });
});

describe("backgroundParallaxOverscan", () => {
  it("is zero at the inert speed, so 'off' costs exactly nothing", () => {
    expect(backgroundParallaxOverscan(600, 900, BACKGROUND_PARALLAX_SPEED_INERT)).toBe(0);
  });

  it("is the whole travel distance when the background is pinned", () => {
    // speed 0 → the layer must cover the full sweep, viewport + section.
    expect(backgroundParallaxOverscan(600, 900, 0)).toBe(1500);
  });

  it("scales with the lag, not with the speed", () => {
    // lag = 1 - 0.3 = 0.7 → 0.7 * 1500
    expect(backgroundParallaxOverscan(600, 900, 0.3)).toBeCloseTo(1050, 6);
  });

  it("never goes negative on a zero-sized or unmeasured box", () => {
    expect(backgroundParallaxOverscan(0, 0, 0)).toBe(0);
    expect(backgroundParallaxOverscan(NaN, NaN, 0.3)).toBe(0);
  });
});

describe("backgroundParallaxOffset", () => {
  it("is exactly zero at every scroll position when speed is inert", () => {
    // This is what makes "parallax off" and "reduce motion" one code path.
    for (const sectionTop of [-2000, -300, 0, 450, 900, 5000]) {
      expect(
        backgroundParallaxOffset({ ...BAND, sectionTop, speed: BACKGROUND_PARALLAX_SPEED_INERT })
      ).toBe(0);
    }
  });

  it("is zero as the section passes the middle of the screen, whatever the speed", () => {
    // centre == 0 there, so there is nothing to give back.
    const sectionTop = BAND.viewportHeight / 2 - BAND.sectionHeight / 2; // 150
    expect(backgroundParallaxOffset({ ...BAND, sectionTop, speed: 0.3 })).toBe(0);
    expect(backgroundParallaxOffset({ ...BAND, sectionTop, speed: 0 })).toBe(0);
  });

  it("cancels the page's own movement exactly when the background is pinned", () => {
    // At speed 0 the offset must equal minus the distance the section has
    // travelled from centre — that is what "the picture does not move" IS.
    const centred = BAND.viewportHeight / 2 - BAND.sectionHeight / 2;
    const scrolledBy = 200;
    expect(
      backgroundParallaxOffset({ ...BAND, sectionTop: centred - scrolledBy, speed: 0 })
    ).toBeCloseTo(scrolledBy, 6);
  });

  it("moves the background LESS than the page moves — the whole effect, stated once", () => {
    const centred = BAND.viewportHeight / 2 - BAND.sectionHeight / 2;
    const speed = 0.3;
    const scrolledBy = 200;

    const before = backgroundParallaxOffset({ ...BAND, sectionTop: centred, speed });
    const after = backgroundParallaxOffset({ ...BAND, sectionTop: centred - scrolledBy, speed });

    // The layer travels with the section (scrolledBy) MINUS its translate, so
    // its net movement on screen is scrolledBy * speed.
    const netMovement = scrolledBy - (after - before);
    expect(netMovement).toBeCloseTo(scrolledBy * speed, 6);
    expect(Math.abs(netMovement)).toBeLessThan(scrolledBy);
  });

  it("changes sign as the section crosses the middle", () => {
    const centred = BAND.viewportHeight / 2 - BAND.sectionHeight / 2;
    const below = backgroundParallaxOffset({ ...BAND, sectionTop: centred + 300, speed: 0.3 });
    const above = backgroundParallaxOffset({ ...BAND, sectionTop: centred - 300, speed: 0.3 });
    expect(below).toBeLessThan(0);
    expect(above).toBeGreaterThan(0);
  });

  it("NEVER exceeds half the overscan — acceptance criterion 7, by construction", () => {
    // The gap at the top or bottom edge of the band is the classic parallax
    // bug. It cannot happen if the offset is bounded by the extra height, so
    // this sweeps the section well past both ends of the screen.
    for (const speed of [0, 0.15, 0.3, 0.5, 0.85, 1]) {
      const limit = backgroundParallaxOverscan(BAND.sectionHeight, BAND.viewportHeight, speed) / 2;
      for (let sectionTop = -4000; sectionTop <= 4000; sectionTop += 37) {
        const offset = backgroundParallaxOffset({ ...BAND, sectionTop, speed });
        expect(Math.abs(offset)).toBeLessThanOrEqual(limit + 1e-9);
      }
    }
  });
});

describe("backgroundParallaxGeometry", () => {
  it("hangs the extra height half above the section and half below", () => {
    const geometry = backgroundParallaxGeometry({ ...BAND, sectionTop: 0, speed: 0.3 });
    expect(geometry.inset).toBeCloseTo(-geometry.overscan / 2, 6);
    expect(geometry.height).toBeCloseTo(BAND.sectionHeight + geometry.overscan, 6);
  });

  it("is the section's own box exactly, at the inert speed", () => {
    const geometry = backgroundParallaxGeometry({
      ...BAND,
      sectionTop: 120,
      speed: BACKGROUND_PARALLAX_SPEED_INERT
    });
    expect(geometry).toEqual({ overscan: 0, inset: 0, height: 600, offset: 0 });
  });

  it("covers the whole band at every scroll position it can be seen at", () => {
    // The layer's top must stay at or above the section's top, and its bottom
    // at or below the section's bottom, or a strip of the band is bare.
    const speed = 0.3;
    for (let sectionTop = -1500; sectionTop <= 1500; sectionTop += 13) {
      const geometry = backgroundParallaxGeometry({ ...BAND, sectionTop, speed });
      const layerTop = geometry.inset + geometry.offset;
      const layerBottom = layerTop + geometry.height;
      expect(layerTop).toBeLessThanOrEqual(1e-9);
      expect(layerBottom).toBeGreaterThanOrEqual(BAND.sectionHeight - 1e-9);
    }
  });
});

describe("the settings that reach the driver", () => {
  it("is off by default, so an existing page renders exactly as it did", () => {
    const defaults = createDefaultBackgroundSettings();
    expect(defaults.parallax).toBe(false);
    expect(builderBackgroundParallaxActive(defaults)).toBe(false);
  });

  it("reads only an explicit true as on", () => {
    for (const value of [undefined, null, 0, "", "false", "true", 1]) {
      const background = normalizeBackgroundSettings({
        mode: "image",
        imageUrl: "/images/x.png",
        parallax: value
      });
      expect(background.parallax).toBe(false);
    }
    expect(
      normalizeBackgroundSettings({ mode: "image", imageUrl: "/images/x.png", parallax: true }).parallax
    ).toBe(true);
  });

  it("needs something to parallax WITH, not just the flag", () => {
    expect(builderBackgroundParallaxActive({ ...createDefaultBackgroundSettings(), mode: "image", parallax: true })).toBe(false);
    expect(builderBackgroundParallaxActive({ ...createDefaultBackgroundSettings(), mode: "video", parallax: true })).toBe(false);
    expect(
      builderBackgroundParallaxActive({
        ...createDefaultBackgroundSettings(),
        mode: "image",
        imageUrl: "/images/x.png",
        parallax: true
      })
    ).toBe(true);
    expect(
      builderBackgroundParallaxActive({
        ...createDefaultBackgroundSettings(),
        mode: "video",
        videoUrl: "/images/x.mp4",
        parallax: true
      })
    ).toBe(true);
  });

  it("ignores the flag on every mode that is not a picture", () => {
    for (const mode of ["none", "color", "gradient", "style"] as const) {
      expect(
        builderBackgroundParallaxActive({
          ...createDefaultBackgroundSettings(),
          mode,
          parallax: true
        })
      ).toBe(false);
    }
  });

  it("returns the inert speed for reduce motion AND for off — one path, not two", () => {
    const on = {
      ...createDefaultBackgroundSettings(),
      mode: "image" as const,
      imageUrl: "/images/x.png",
      parallax: true,
      parallaxSpeed: 0.2
    };
    expect(builderBackgroundParallaxSpeed(on, false)).toBe(0.2);
    expect(builderBackgroundParallaxSpeed(on, true)).toBe(BACKGROUND_PARALLAX_SPEED_INERT);
    expect(builderBackgroundParallaxSpeed({ ...on, parallax: false }, false)).toBe(
      BACKGROUND_PARALLAX_SPEED_INERT
    );
    expect(builderBackgroundParallaxSpeed(undefined, false)).toBe(BACKGROUND_PARALLAX_SPEED_INERT);
  });

  it("clamps a stored speed that is out of range on the way in", () => {
    expect(normalizeBackgroundSettings({ parallaxSpeed: 4 }).parallaxSpeed).toBe(1);
    expect(normalizeBackgroundSettings({ parallaxSpeed: -1 }).parallaxSpeed).toBe(0);
  });
});
