import { describe, expect, it } from "vitest";
import {
  getImageShapeFrameStyle,
  getImageShapeMediaStyle,
  normalizeImageShapeSettings,
  sanitizeImageShapeRadii
} from "./image-shape";
import { getImageModuleStyle } from "@/components/builder/builder-utils";

const ALPHIRE_BLOB = "50% 45% 52% 48% / 48% 52% 48% 52%";

describe("image shape (task 86bctde2b)", () => {
  it("an image saved before shapes existed renders exactly as it did", () => {
    // No imageShape key: Radius in px, no aspect ratio, picture untouched.
    const style = getImageModuleStyle({ url: "/a.png", borderRadius: "18" });
    expect(style.borderRadius).toBe("18px");
    expect(style.aspectRatio).toBeUndefined();
    expect(getImageShapeMediaStyle({})).toBeNull();
    expect(getImageModuleStyle({ url: "/a.png" }).borderRadius).toBe("18px");
  });

  it("Square ignores Radius", () => {
    expect(getImageShapeFrameStyle({ imageShape: "square" }, 18)).toEqual({ borderRadius: "0px" });
  });

  it("Circle squares the frame and the picture fills it", () => {
    const style = getImageModuleStyle({ url: "/a.png", borderRadius: "18", imageShape: "circle" });
    expect(style.borderRadius).toBe("50%");
    expect(style.aspectRatio).toBe("1 / 1");
    expect(style.overflow).toBe("hidden");
    expect(getImageShapeMediaStyle({ imageShape: "circle" })).toEqual({ height: "100%", objectFit: "cover" });
  });

  it("Custom carries elliptical radii; an unusable value falls back to Radius", () => {
    expect(getImageShapeFrameStyle({ imageShape: "custom", imageShapeRadii: ALPHIRE_BLOB }, 18)).toEqual({
      borderRadius: ALPHIRE_BLOB
    });
    expect(getImageShapeFrameStyle({ imageShape: "custom", imageShapeRadii: "" }, 7)).toEqual({ borderRadius: "7px" });
    expect(
      getImageShapeFrameStyle({ imageShape: "custom", imageShapeRadii: "10px; background:url(x)" }, 7)
    ).toEqual({ borderRadius: "7px" });
  });

  it("only px/% lengths survive sanitizing — the string goes straight into a style", () => {
    expect(sanitizeImageShapeRadii(ALPHIRE_BLOB)).toBe(ALPHIRE_BLOB);
    expect(sanitizeImageShapeRadii("  12PX   0 ")).toBe("12px 0");
    expect(sanitizeImageShapeRadii("12px / 4px")).toBe("12px / 4px");
    expect(sanitizeImageShapeRadii("1px 2px 3px 4px 5px")).toBe("");
    expect(sanitizeImageShapeRadii("1px / 2px / 3px")).toBe("");
    expect(sanitizeImageShapeRadii("2em")).toBe("");
    expect(sanitizeImageShapeRadii("calc(1px)")).toBe("");
    expect(sanitizeImageShapeRadii("120%")).toBe("");
    expect(sanitizeImageShapeRadii("-4px")).toBe("");
    expect(sanitizeImageShapeRadii(42)).toBe("");
  });

  it("normalizing drops unknown shapes and bad radii, keeps good ones", () => {
    const unknown: Record<string, string> = { imageShape: "hexagon", imageShapeRadii: "2em" };
    normalizeImageShapeSettings(unknown);
    expect(unknown).toEqual({});

    const good: Record<string, string> = { imageShape: " Custom ", imageShapeRadii: ALPHIRE_BLOB };
    normalizeImageShapeSettings(good);
    expect(good).toEqual({ imageShape: "custom", imageShapeRadii: ALPHIRE_BLOB });

    const zero: Record<string, string> = { imageShape: "custom", imageShapeRadii: "0 0px / 0%" };
    normalizeImageShapeSettings(zero);
    expect(zero).toEqual({ imageShape: "custom" });
  });
});
