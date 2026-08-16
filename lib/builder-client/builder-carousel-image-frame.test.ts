import { describe, expect, it } from "vitest";
import {
  CAROUSEL_IMAGE_FRAME_DEFAULTS,
  carouselBorderStyle,
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
