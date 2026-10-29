import { describe, expect, it } from "vitest";
import {
  builderGradientLayersCss,
  createDefaultGlowLayer,
  getBuilderBackgroundStyle,
  gradientLayerFromTwoColour,
  normalizeBackgroundSettings,
  normalizeBuilderGradientLayers,
  withGradientLayers
} from "@/lib/builder-template";

/** Alphire's hero, as the importer reads it (task 86bctde1m). */
const ALPHIRE_HERO = [
  {
    kind: "radial",
    shape: "circle",
    x: 80,
    y: 18,
    stops: [
      { color: "#00e5ff", alpha: 16, position: 0 },
      { color: "#000000", alpha: 0, position: 42 }
    ]
  },
  {
    kind: "radial",
    shape: "ellipse",
    size: "60% 50%",
    x: 50,
    y: 100,
    stops: [
      { color: "#7c4dff", alpha: 12, position: 0 },
      { color: "#000000", alpha: 0, position: 60 }
    ]
  },
  {
    kind: "linear",
    angle: 110,
    stops: [
      { color: "#020307", alpha: 100, position: 0 },
      { color: "#030a13", alpha: 100, position: 46 },
      { color: "#03111e", alpha: 100, position: 100 }
    ]
  }
];

describe("layered gradient backgrounds", () => {
  it("paints every layer, top first, radial and linear", () => {
    const style = getBuilderBackgroundStyle(
      normalizeBackgroundSettings({ mode: "gradient", color: "#020307", color2: "#03111e", gradientLayers: ALPHIRE_HERO })
    );
    expect(style?.backgroundImage).toBe(
      "radial-gradient(circle at 80% 18%, rgba(0, 229, 255, 0.16) 0%, rgba(0, 0, 0, 0) 42%), " +
        "radial-gradient(ellipse 60% 50% at 50% 100%, rgba(124, 77, 255, 0.12) 0%, rgba(0, 0, 0, 0) 60%), " +
        "linear-gradient(110deg, rgba(2, 3, 7, 1) 0%, rgba(3, 10, 19, 1) 46%, rgba(3, 17, 30, 1) 100%)"
    );
  });

  it("leaves a two-colour gradient exactly as it painted before", () => {
    const plain = normalizeBackgroundSettings({ mode: "gradient", color: "#ff0000", color2: "#0000ff", gradientAngle: 90 });
    expect("gradientLayers" in plain).toBe(false);
    expect(getBuilderBackgroundStyle(plain)).toEqual({
      backgroundImage: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)"
    });
    // An empty list is the same as none — never a blank background-image.
    expect(getBuilderBackgroundStyle({ ...plain, gradientLayers: [] })).toEqual(getBuilderBackgroundStyle(plain));
  });

  it("paints layers only in gradient mode", () => {
    const style = getBuilderBackgroundStyle(
      normalizeBackgroundSettings({ mode: "color", color: "#123456", gradientLayers: ALPHIRE_HERO })
    );
    expect(style?.backgroundImage).toBeUndefined();
  });

  it("scales every stop by the background's opacity", () => {
    const css = builderGradientLayersCss([ALPHIRE_HERO[2]], 50);
    expect(css).toContain("rgba(2, 3, 7, 0.5) 0%");
  });

  it("never lets a typed value reach CSS unchecked", () => {
    const layers = normalizeBuilderGradientLayers([
      {
        kind: "radial",
        shape: "ellipse",
        size: "1px); background: url(https://evil",
        x: "50%); color: red",
        y: 900,
        stops: [
          { color: "red; background: url(x)", alpha: 50, position: 0 },
          { color: "#ffffff", alpha: 50, position: 0 },
          { color: "#000000", alpha: -4, position: 4000 }
        ]
      }
    ]);
    expect(layers).toHaveLength(1);
    expect(layers[0].size).toBe("");
    expect(layers[0].x).toBe(50);
    expect(layers[0].y).toBe(100);
    expect(layers[0].stops).toEqual([
      { color: "#ffffff", alpha: 50, position: 0 },
      { color: "#000000", alpha: 0, position: 100 }
    ]);
    expect(builderGradientLayersCss(layers)).not.toMatch(/url|;|red/);
  });

  it("drops a layer with fewer than two stops, which CSS would reject outright", () => {
    expect(normalizeBuilderGradientLayers([{ kind: "linear", stops: [{ color: "#ffffff" }] }])).toEqual([]);
    expect(normalizeBuilderGradientLayers("nope")).toEqual([]);
  });

  it("drops a radial size that does not suit its shape, rather than voiding every layer", () => {
    const [circle, ellipse] = normalizeBuilderGradientLayers([
      { ...ALPHIRE_HERO[0], shape: "circle", size: "60% 50%" },
      { ...ALPHIRE_HERO[0], shape: "ellipse", size: "300px" }
    ]);
    expect(circle.size).toBe("");
    expect(ellipse.size).toBe("");
    expect(normalizeBuilderGradientLayers([{ ...ALPHIRE_HERO[0], size: "300px" }])[0].size).toBe("300px");
  });

  it("keeps the two-colour fields mirroring the bottom layer, and restores them when the last layer goes", () => {
    const base = normalizeBackgroundSettings({ mode: "gradient", color: "#ff0000", color2: "#0000ff", gradientAngle: 45 });
    const layered = withGradientLayers(base, normalizeBuilderGradientLayers(ALPHIRE_HERO));
    expect([layered.color, layered.color2, layered.gradientAngle]).toEqual(["#020307", "#03111e", 110]);
    const back = withGradientLayers(layered, []);
    expect("gradientLayers" in back).toBe(false);
    expect([back.color, back.color2]).toEqual(["#020307", "#03111e"]);
  });

  it("turns a two-colour gradient into a first layer that paints the same picture", () => {
    const base = normalizeBackgroundSettings({ mode: "gradient", color: "#ff0000", color2: "#0000ff", gradientAngle: 45 });
    const layer = gradientLayerFromTwoColour(base);
    expect(builderGradientLayersCss([layer])).toBe(
      "linear-gradient(45deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)"
    );
    expect(normalizeBuilderGradientLayers([createDefaultGlowLayer()])).toHaveLength(1);
  });

  it("survives normalization so a save keeps it", () => {
    const once = normalizeBackgroundSettings({ mode: "gradient", gradientLayers: ALPHIRE_HERO });
    expect(normalizeBackgroundSettings(once)).toEqual(once);
    expect(once.gradientLayers).toHaveLength(3);
  });
});
