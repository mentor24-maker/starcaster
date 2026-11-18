import { describe, expect, it } from "vitest";
import {
  getSectionShapeLayerStyle,
  hasActiveSectionShapeLayer,
  matchSectionShape,
  normalizeSectionShapeLayer,
  sectionShapePath
} from "./section-shape-layer";
import { normalizeLayoutSections } from "./builder-template";

const svgUrl = (svg: string, base64 = true) =>
  base64
    ? `url("data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}")`
    : `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// Bayside's own mask, as the capture recorded it (task SC-859).
const BAYSIDE =
  '<svg  fill="rgba(255,255,255,0.71)" viewBox="0 0 1920 1440" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M1920,0H1175.84c-110.3,207.33-174.34,454.33-174.34,719.5,0,265.59,64.24,513,174.88,720.5H1920Z"/></svg>';

describe("normalizeSectionShapeLayer", () => {
  it("falls back on anything not on the allowlists, because every value reaches a style attribute", () => {
    expect(
      normalizeSectionShapeLayer({ shape: "star", side: "middle", color: 'red"/><script>', opacity: "abc" })
    ).toEqual({ shape: "none", side: "left", color: "#ffffff", opacity: 100 });
    expect(normalizeSectionShapeLayer({ shape: "wave", side: "top", color: "#ABC", opacity: 140 })).toEqual({
      shape: "wave",
      side: "top",
      color: "#aabbcc",
      opacity: 100
    });
    expect(normalizeSectionShapeLayer(null).shape).toBe("none");
  });

  it("paints nothing for none or zero opacity", () => {
    expect(getSectionShapeLayerStyle(undefined)).toBeUndefined();
    expect(getSectionShapeLayerStyle({ shape: "none" })).toBeUndefined();
    expect(hasActiveSectionShapeLayer({ shape: "curve", opacity: 0 })).toBe(false);
  });
});

describe("sectionShapePath", () => {
  it("draws each side from the one right-anchored definition", () => {
    expect(sectionShapePath("slant", "right")).toBe("M100,0L70,0L50,100L100,100Z");
    expect(sectionShapePath("slant", "left")).toBe("M0,0L30,0L50,100L0,100Z");
    expect(sectionShapePath("slant", "top")).toBe("M0,0L0,30L100,50L100,0Z");
    expect(sectionShapePath("slant", "bottom")).toBe("M0,100L0,70L100,50L100,100Z");
  });

  it("puts the colour, strength and shape into the SVG the layer paints", () => {
    const style = getSectionShapeLayerStyle({ shape: "curve", side: "left", color: "#ffffff", opacity: 71 });
    const svg = decodeURIComponent(String(style?.backgroundImage).replace(/^url\("data:image\/svg\+xml,|"\)$/g, ""));
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill-opacity="0.71"');
    expect(svg).toContain(`d="${sectionShapePath("curve", "left")}"`);
    expect(style?.backgroundSize).toBe("100% 100%");
  });
});

describe("matchSectionShape", () => {
  it("reads Bayside's mask as a white curve on the right, and on the left once mirrored", () => {
    expect(matchSectionShape(svgUrl(BAYSIDE))).toEqual({
      ok: true,
      layer: { shape: "curve", side: "right", color: "#ffffff", opacity: 71 },
      note: "curve on the right, #ffffff at 71%"
    });
    const flipped = matchSectionShape(svgUrl(BAYSIDE), "matrix(-1, 0, 0, 1, 0, 0)");
    expect(flipped.ok && flipped.layer.side).toBe("left");
    const flippedByScale = matchSectionShape(svgUrl(BAYSIDE, false), "scale(-1, 1)");
    expect(flippedByScale.ok && flippedByScale.layer.side).toBe("left");
  });

  it("tells a slant from a wave", () => {
    const slant = '<svg viewBox="0 0 100 50" fill="#123456"><path d="M0,50L100,20L100,50Z"/></svg>';
    expect(matchSectionShape(svgUrl(slant))).toMatchObject({ ok: true, layer: { shape: "slant", side: "bottom", color: "#123456" } });
    const wave =
      '<svg viewBox="0 0 100 100" fill="#000"><path d="M0,0L40,0C30,10 50,20 40,30C30,40 50,50 40,60C30,70 50,80 40,100L0,100Z"/></svg>';
    expect(matchSectionShape(svgUrl(wave))).toMatchObject({ ok: true, layer: { shape: "wave", side: "left" } });
  });

  it("refuses, with a reason, what it cannot match", () => {
    expect(matchSectionShape('url("photo.jpg")')).toEqual({ ok: false, reason: "the shape is not an SVG drawing" });
    const island = '<svg viewBox="0 0 100 100" fill="#fff"><path d="M40,40L60,40L60,60Z"/></svg>';
    expect(matchSectionShape(svgUrl(island))).toEqual({ ok: false, reason: "the shape does not sit along one edge" });
    const cssColour = '<svg viewBox="0 0 100 100" fill="currentColor"><path d="M100,0L50,0L50,100L100,100Z"/></svg>';
    expect(matchSectionShape(svgUrl(cssColour))).toMatchObject({ ok: false });
  });
});

describe("a section's shapeLayer through the page normalizer", () => {
  it("is kept when a shape is chosen, and adds no key to a row without one", () => {
    const [withShape, without] = normalizeLayoutSections([
      { id: "a", layout: "single", modules: [], shapeLayer: { shape: "wave", side: "bottom", color: "#ff0000", opacity: 50 } },
      { id: "b", layout: "single", modules: [] }
    ]);
    expect(withShape.shapeLayer).toEqual({ shape: "wave", side: "bottom", color: "#ff0000", opacity: 50 });
    expect("shapeLayer" in without).toBe(false);
  });
});
