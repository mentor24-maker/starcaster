import { describe, expect, it } from "vitest";
import {
  CAROUSEL_IMAGE_FRAME_DEFAULTS,
  CAROUSEL_IMAGE_FRAME_LIMITS,
  CAROUSEL_SHADOW_ANGLE_STEP,
  carouselBorderStyle,
  carouselShadowAngleFromOffsets,
  carouselShadowDistanceFromOffsets,
  carouselShadowOffsetSettings,
  carouselShadowOffsetsFromPolar,
  carouselShadowPolar,
  carouselShadowPolarIsReachable,
  getCarouselImageFrameStyle,
  getCarouselImageShadow,
  getCarouselImageShadowGutter
} from "./builder-carousel-image-frame";

/**
 * The carousel's image frame (operator, 2026-08-16: "full border control that
 * applies to all images, including dropshadows").
 *
 * This is the half of the feature a test can reach. Whether the frame LOOKS
 * right is CSS, which nothing in this repo tests (DOCTRINE §5.14) — what is
 * asserted here is that the resolver turns settings into the values the
 * renderer hands to the browser, including the ones an imported page has no
 * business carrying.
 */
describe("carousel image frame", () => {
  it("draws no border until one is asked for", () => {
    // Every carousel that exists today is in this state. Shipping a visible
    // border by default would restyle all of them.
    expect(getCarouselImageFrameStyle({}).border).toBeUndefined();
  });

  it("keeps the 8px corner both formats already had", () => {
    // The stylesheet rounded the slideshow frame and the card picture by 8px
    // long before either had a control, so this is the "changed nothing" case.
    expect(getCarouselImageFrameStyle({}).borderRadius).toBe("8px");
    expect(CAROUSEL_IMAGE_FRAME_DEFAULTS.radius).toBe(8);
  });

  it("composes width, style and colour into one border", () => {
    const style = getCarouselImageFrameStyle({
      imageBorderWidth: "6",
      imageBorderStyle: "dashed",
      imageBorderColor: "#ff0000"
    });
    expect(style.border).toBe("6px dashed #ff0000");
  });

  it("falls back to the default colour when none was chosen", () => {
    expect(getCarouselImageFrameStyle({ imageBorderWidth: "2" }).border).toBe(
      `2px solid ${CAROUSEL_IMAGE_FRAME_DEFAULTS.borderColor}`
    );
  });

  it("treats style None as no border, whatever the width says", () => {
    const style = getCarouselImageFrameStyle({ imageBorderWidth: "10", imageBorderStyle: "none" });
    expect(style.border).toBeUndefined();
  });

  it("squares the corners on 0 rather than reverting to the default", () => {
    // A stored "0" is a choice; only an absent value means "the old look".
    expect(getCarouselImageFrameStyle({ imageBorderRadius: "0" }).borderRadius).toBe("0px");
  });

  it("clamps numbers an imported document should never have carried", () => {
    const style = getCarouselImageFrameStyle({
      imageBorderWidth: "900",
      imageBorderRadius: "-40"
    });
    expect(style.border).toBe(`24px solid ${CAROUSEL_IMAGE_FRAME_DEFAULTS.borderColor}`);
    expect(style.borderRadius).toBe("0px");
  });

  it("ignores a border width that is not a number", () => {
    expect(getCarouselImageFrameStyle({ imageBorderWidth: "thick" }).border).toBeUndefined();
  });
});

describe("carousel image drop shadow", () => {
  it("is off until it is switched on", () => {
    expect(getCarouselImageShadow({})).toBe("");
    expect(getCarouselImageFrameStyle({}).boxShadow).toBeUndefined();
  });

  it("paints a soft shadow below the picture by default", () => {
    // Ticking the box has to show something, or the control reads as broken.
    expect(getCarouselImageShadow({ imageShadow: "true" })).toBe(
      "0px 6px 18px 0px rgba(0, 0, 0, 0.3)"
    );
  });

  it("accepts the legacy 'on' the shared shadow checkbox writes", () => {
    expect(getCarouselImageShadow({ imageShadow: "on" })).not.toBe("");
  });

  it("carries every part through, opacity included", () => {
    expect(
      getCarouselImageShadow({
        imageShadow: "true",
        imageShadowX: "-4",
        imageShadowY: "10",
        imageShadowBlur: "24",
        imageShadowSpread: "3",
        imageShadowColor: "#123456",
        imageShadowOpacity: "50"
      })
    ).toBe("-4px 10px 24px 3px rgba(18, 52, 86, 0.5)");
  });

  it("stays a flat hex at full opacity", () => {
    expect(
      getCarouselImageShadow({
        imageShadow: "true",
        imageShadowColor: "#123456",
        imageShadowOpacity: "100"
      })
    ).toContain("#123456");
  });

  /**
   * The gutter exists because `overflow-x: auto` on the card row clips the
   * vertical axis too — without it the shadow stops dead at the bottom edge
   * of the card, which reads as a rendering bug rather than an effect.
   */
  it("asks for no gutter while the shadow is off", () => {
    expect(getCarouselImageShadowGutter({})).toBe(0);
    expect(getCarouselImageShadowGutter({ imageShadowY: "30" })).toBe(0);
  });

  it("reserves as much room as the shadow actually reaches", () => {
    expect(getCarouselImageShadowGutter({ imageShadow: "true" })).toBe(24);
    expect(
      getCarouselImageShadowGutter({
        imageShadow: "true",
        imageShadowY: "-8",
        imageShadowBlur: "10",
        imageShadowSpread: "2"
      })
    ).toBe(20);
  });
});

describe("border style", () => {
  it("falls back to solid on anything it does not recognise", () => {
    expect(carouselBorderStyle(undefined)).toBe("solid");
    expect(carouselBorderStyle("")).toBe("solid");
    expect(carouselBorderStyle("groovy")).toBe("solid");
    // Nothing a document carries reaches CSS unchecked.
    expect(carouselBorderStyle("solid; background: url(x)")).toBe("solid");
  });

  it("keeps the styles it does", () => {
    for (const style of ["none", "solid", "dashed", "dotted", "double"]) {
      expect(carouselBorderStyle(style)).toBe(style);
    }
  });
});

/**
 * SHADOW ANGLE AND SHADOW DISTANCE (operator, 2026-08-25: "there are X/Y
 * settings AND direction").
 *
 * Two views of one pair of stored numbers. The trigonometry is the only part
 * of a drop shadow a test in this repo can hold still (DOCTRINE §5.14) —
 * whether the shadow LOOKS right is CSS, which nothing here tests — so the
 * conversion is where the proof has to live.
 */
describe("shadow angle and distance", () => {
  it("puts 0 degrees to the RIGHT of the picture", () => {
    expect(carouselShadowOffsetsFromPolar(0, 20)).toEqual({ x: 20, y: 0 });
  });

  it("puts 90 degrees ABOVE it — a CSS shadow moves up on a negative y", () => {
    // The one bug here nobody would mistake for a preference: flip this sign
    // and every shadow lands on the wrong side of every picture.
    expect(carouselShadowOffsetsFromPolar(90, 20)).toEqual({ x: 0, y: -20 });
  });

  it("puts 180 degrees to the LEFT and 270 BELOW", () => {
    expect(carouselShadowOffsetsFromPolar(180, 20)).toEqual({ x: -20, y: 0 });
    expect(carouselShadowOffsetsFromPolar(270, 20)).toEqual({ x: 0, y: 20 });
  });

  it("reads those same four back as 0, 90, 180 and 270", () => {
    expect(carouselShadowAngleFromOffsets(20, 0)).toBe(0);
    expect(carouselShadowAngleFromOffsets(0, -20)).toBe(90);
    expect(carouselShadowAngleFromOffsets(-20, 0)).toBe(180);
    expect(carouselShadowAngleFromOffsets(0, 20)).toBe(270);
  });

  it("never reports an angle outside 0-359", () => {
    // atan2 answers in -180..180, and a value that rounds to 360 has to come
    // back as 0 or the control has an option its own reader cannot produce.
    for (const [x, y] of [[1, 1], [-1, 1], [-1, -1], [1, -1], [40, 1], [40, -1]]) {
      const angle = carouselShadowAngleFromOffsets(x, y);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThanOrEqual(359);
    }
  });

  it("shows 0 degrees for a shadow sitting exactly under its picture", () => {
    // x: 0, y: 0 has no direction. 0 is what the control rounds to anyway,
    // and picking an angle at distance 0 correctly does nothing until there
    // is a distance to swing.
    expect(carouselShadowAngleFromOffsets(0, 0)).toBe(0);
    expect(carouselShadowDistanceFromOffsets(0, 0)).toBe(0);
    expect(carouselShadowOffsetsFromPolar(135, 0)).toEqual({ x: 0, y: 0 });
  });

  it("measures a corner shadow at 57, not at the 40 the offsets cap to", () => {
    // THE FAILURE THIS FEATURE MOST HAD TO AVOID. X and Y reach a square,
    // angle and distance describe a circle. If Distance capped at 40, opening
    // a panel on a shadow already saved at the corner would show a clamped
    // value, re-derive smaller offsets from it, and move a shadow on a live
    // page without anybody touching a control.
    expect(carouselShadowDistanceFromOffsets(40, 40)).toBe(57);
    expect(CAROUSEL_IMAGE_FRAME_LIMITS.shadowDistance.max).toBe(57);
  });

  it("round-trips the corner shadow back to exactly 40, 40", () => {
    const { angle, distance } = carouselShadowPolar({ imageShadowX: "40", imageShadowY: "40" });
    expect(angle).toBe(315);
    expect(distance).toBe(57);
    expect(carouselShadowOffsetsFromPolar(angle, distance)).toEqual({ x: 40, y: 40 });
  });

  it("re-derives the same angle and distance for every quarter of the dial", () => {
    // Reading the panel and then writing what it shows must be a no-op, or a
    // stored shadow drifts a pixel at a time each time somebody looks at it.
    for (const angle of [0, 15, 30, 45, 90, 135, 180, 225, 270, 315, 345]) {
      const offsets = carouselShadowOffsetsFromPolar(angle, 24);
      const polar = carouselShadowPolar({
        imageShadowX: String(offsets.x),
        imageShadowY: String(offsets.y)
      });
      expect(carouselShadowOffsetsFromPolar(polar.angle, polar.distance)).toEqual(offsets);
    }
  });

  it("clamps a distance the square cannot reach, and says so honestly", () => {
    // 57 at 0 degrees wants x: 57, which is off the square. The component is
    // clamped and the shown distance then recomputes to 40 — reachable only
    // at the extreme, and widening the X/Y caps would just move the mismatch.
    expect(carouselShadowOffsetsFromPolar(0, 57)).toEqual({ x: 40, y: 0 });
    expect(carouselShadowPolar({ imageShadowX: "40", imageShadowY: "0" }).distance).toBe(40);
  });

  /**
   * The question the PANEL asks before it may keep showing a picked pair.
   *
   * A pair the square can express is one the panel may go on displaying even
   * though whole pixels read it back a degree out (2026-09-07 send-back:
   * picking 15 left the box reading 16 on 16 of the 24 positions). A pair the
   * square CANNOT express is the opposite case: the page draws something
   * else, so the boxes must re-derive or they describe a shadow nobody sees.
   */
  it("says a short-distance direction IS reachable, off by a rounded pixel or not", () => {
    expect(carouselShadowPolarIsReachable(15, 15)).toBe(true);
    expect(carouselShadowPolarIsReachable(60, 3)).toBe(true);
    // The corner: 40, 40 sits exactly on the cap, which is inside it.
    expect(carouselShadowPolarIsReachable(315, 57)).toBe(true);
    expect(carouselShadowOffsetsFromPolar(315, 57)).toEqual({ x: 40, y: 40 });
  });

  /**
   * THE CAP MUST NOT TURN THE SHADOW. (Send-back, 2026-09-07 round 2.)
   *
   * X and Y used to be capped at 40 INDEPENDENTLY, so the moment one of them
   * hit the cap the point left the ray the angle describes and slid along the
   * edge of the square towards its corner. Measured in the real panel: pick
   * Angle 15, then drag Distance up — 42 still read 15, 45 read 17, 50 read
   * 21, 57 read 27. The operator picked a direction, touched only Distance,
   * and watched the shadow swing twelve degrees.
   *
   * Both components are scaled by ONE factor now — the largest that brings
   * both inside the square — so the point stays on the ray and only the
   * distance shortens. That is the requirement in the send-back's own words:
   * moving Distance must never change the Angle the box is showing, at any
   * distance, not only at 0.
   */
  it("keeps the picked DIRECTION when the cap bites, instead of sliding to the corner", () => {
    // The exact walk from the send-back. Every one of these used to turn.
    expect(carouselShadowOffsetsFromPolar(15, 42)).toEqual({ x: 40, y: -11 });
    expect(carouselShadowOffsetsFromPolar(15, 45)).toEqual({ x: 40, y: -11 });
    expect(carouselShadowOffsetsFromPolar(15, 50)).toEqual({ x: 40, y: -11 });
    expect(carouselShadowOffsetsFromPolar(15, 57)).toEqual({ x: 40, y: -11 });
    // And what the box then SHOWS is still the fifteen that was picked.
    for (const distance of [42, 45, 50, 57]) {
      const { x, y } = carouselShadowOffsetsFromPolar(15, distance);
      expect(carouselShadowAngleFromOffsets(x, y)).toBe(15);
    }
  });

  it("holds every direction on the dial, all the way out to 57", () => {
    // The sweep, because 15 degrees is one of twenty-four and the old bug hit
    // 189 angle/distance pairs. A clamped pick must re-derive to the angle it
    // was given, whichever way round the picture it points.
    const drifted: string[] = [];
    for (let angle = 0; angle < 360; angle += CAROUSEL_SHADOW_ANGLE_STEP) {
      for (let distance = 1; distance <= CAROUSEL_IMAGE_FRAME_LIMITS.shadowDistance.max; distance += 1) {
        if (carouselShadowPolarIsReachable(angle, distance)) continue;
        const { x, y } = carouselShadowOffsetsFromPolar(angle, distance);
        const shown = carouselShadowAngleFromOffsets(x, y);
        if (shown !== angle) drifted.push(`${angle} degrees at ${distance} reads ${shown}`);
      }
    }
    expect(drifted).toEqual([]);
  });

  it("shortens the distance honestly rather than reporting the one asked for", () => {
    // The other half: the shadow really is nearer than 57, and the box says so
    // — 41 for a fifteen-degree shadow pinned against the right-hand cap.
    const { x, y } = carouselShadowOffsetsFromPolar(15, 57);
    expect(carouselShadowDistanceFromOffsets(x, y)).toBe(41);
  });

  it("still lands the two pairs the ticket named, to the pixel", () => {
    // Scaling both components must not disturb what was already agreed:
    // straight out to the right, and the exact corner.
    expect(carouselShadowOffsetsFromPolar(0, 57)).toEqual({ x: 40, y: 0 });
    expect(carouselShadowOffsetsFromPolar(315, 57)).toEqual({ x: 40, y: 40 });
    expect(carouselShadowPolar({ imageShadowX: "40", imageShadowY: "40" })).toEqual({
      angle: 315,
      distance: 57
    });
  });

  it("says a pair the cap had to bite is NOT reachable", () => {
    expect(carouselShadowPolarIsReachable(0, 57)).toBe(false);
    expect(carouselShadowPolarIsReachable(270, 57)).toBe(false);
    expect(carouselShadowPolarIsReachable(90, 41)).toBe(false);
  });

  it("describes the shadow the RENDERER is drawing, defaults included", () => {
    // An untouched module stores nothing, and the panel must still describe
    // the default shadow the page paints: 6px below.
    expect(carouselShadowPolar({})).toEqual({ angle: 270, distance: 6 });
    expect(getCarouselImageShadow({ imageShadow: "true" })).toContain("0px 6px");
  });

  it("clamps a stored offset an imported document should never have carried", () => {
    // The same clamp the renderer applies, so the panel cannot describe a
    // shadow further out than the one being drawn.
    expect(carouselShadowPolar({ imageShadowX: "900", imageShadowY: "0" })).toEqual({
      angle: 0,
      distance: 40
    });
  });

  it("writes BOTH offsets as strings, under the keys the renderer reads", () => {
    expect(carouselShadowOffsetSettings(90, 12)).toEqual({
      imageShadowX: "0",
      imageShadowY: "-12"
    });
    // And what it writes is what the shadow engine then draws.
    expect(
      getCarouselImageShadow({ imageShadow: "true", ...carouselShadowOffsetSettings(180, 30) })
    ).toContain("-30px 0px");
  });
});
