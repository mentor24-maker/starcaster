// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  BUILDER_BACKGROUND_CLIP_ATTR,
  builderBackgroundClipAttrs,
  builderBackgroundClipStyle,
  builderBackgroundLayerSurface
} from "./background-clip";

/**
 * The clip box exists so a background layer can be contained WITHOUT its
 * surface being contained — the fix for 86bbwmp2y, where `overflow: hidden` on
 * a video-backed column cut off a navigation module's dropdown along with the
 * footage. What a browser does with the box is held by the render contracts;
 * what is checkable here is the shape of the box and, more importantly, the
 * rule the box broke: the parallax driver used to reach its surface with
 * `parentElement`, and there is now an element in the way.
 */
describe("builderBackgroundClipStyle", () => {
  it("contains the layer and keeps it out of the flow and out of hit-testing", () => {
    const style = builderBackgroundClipStyle();
    expect(style.overflow).toBe("hidden");
    expect(style.position).toBe("absolute");
    expect(style.inset).toBe(0);
    // A full-size element over the cell that ate clicks would replace one
    // invisible defect with another.
    expect(style.pointerEvents).toBe("none");
    // The rung the layer itself sat on, restated on the box because the box is
    // what the stylesheet's rungs now see.
    expect(style.zIndex).toBe(0);
    // The chain the layer relied on: surface -> box -> layer.
    expect(style.borderRadius).toBe("inherit");
  });
});

describe("builderBackgroundClipAttrs", () => {
  it("names the surface that mounted the box", () => {
    expect(builderBackgroundClipAttrs("cell")).toEqual({
      [BUILDER_BACKGROUND_CLIP_ATTR]: "cell"
    });
    expect(builderBackgroundClipAttrs("section")).toEqual({
      [BUILDER_BACKGROUND_CLIP_ATTR]: "section"
    });
  });
});

describe("builderBackgroundLayerSurface", () => {
  function scene(wrapInClipBox: boolean) {
    const surface = document.createElement("section");
    const layer = document.createElement("video");
    if (wrapInClipBox) {
      const box = document.createElement("div");
      box.setAttribute(BUILDER_BACKGROUND_CLIP_ATTR, "section");
      box.appendChild(layer);
      surface.appendChild(box);
    } else {
      surface.appendChild(layer);
    }
    return { surface, layer };
  }

  it("steps over the clip box to reach the surface", () => {
    const { surface, layer } = scene(true);
    // Not the box. The box is `inset: 0` against the PADDING box, so measuring
    // it would shift the parallax geometry by the border width on every
    // bordered row — silently, and only there.
    expect(builderBackgroundLayerSurface(layer)).toBe(surface);
  });

  it("returns the parent unchanged when there is no clip box", () => {
    const { surface, layer } = scene(false);
    expect(builderBackgroundLayerSurface(layer)).toBe(surface);
  });

  it("answers null for a layer that is not on the page", () => {
    expect(builderBackgroundLayerSurface(null)).toBeNull();
    expect(builderBackgroundLayerSurface(document.createElement("video"))).toBeNull();
  });

  it("answers null for a clip box that has no surface above it", () => {
    const box = document.createElement("div");
    box.setAttribute(BUILDER_BACKGROUND_CLIP_ATTR, "cell");
    const layer = document.createElement("video");
    box.appendChild(layer);
    expect(builderBackgroundLayerSurface(layer)).toBeNull();
  });
});
