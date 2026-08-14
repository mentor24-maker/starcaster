import { beforeEach, describe, expect, it } from "vitest";
import {
  clearImageRenditions,
  getImageRenditions,
  imageProps,
  imageSourceSetFor,
  registerImageRenditionMap,
  registerImageRenditions,
  sizesForWidthPercent,
  socialImageUrl
} from "./image-renditions";

const ORIGINAL = "https://cdn.example.com/APP/Assets/Image/1753248000000_hero.png";

const LADDER = [
  { w: 300, h: 200, url: "https://cdn.example.com/r/hero/w300.webp", format: "webp" },
  { w: 600, h: 400, url: "https://cdn.example.com/r/hero/w600.webp", format: "webp" },
  { w: 1200, h: 800, url: "https://cdn.example.com/r/hero/w1200.webp", format: "webp" },
  { w: 1536, h: 1024, url: "https://cdn.example.com/r/hero/w1536.webp", format: "webp", role: "full" },
  { w: 1200, h: 800, url: "https://cdn.example.com/r/hero/social-w1200.jpg", format: "jpeg", role: "social" }
];

describe("image renditions registry", () => {
  beforeEach(() => clearImageRenditions());

  it("offers every web copy to the browser, smallest first", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    const resolved = imageSourceSetFor(ORIGINAL);

    expect(resolved?.srcSet).toBe(
      [
        "https://cdn.example.com/r/hero/w300.webp 300w",
        "https://cdn.example.com/r/hero/w600.webp 600w",
        "https://cdn.example.com/r/hero/w1200.webp 1200w",
        "https://cdn.example.com/r/hero/w1536.webp 1536w"
      ].join(", ")
    );
  });

  it("keeps the social JPEG out of the srcset so the browser cannot pick the heavier twin", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    expect(imageSourceSetFor(ORIGINAL)?.srcSet).not.toContain("social");
    expect(imageSourceSetFor(ORIGINAL)?.srcSet).not.toContain(".jpg");
    // …but it is still reachable for someone about to post the picture.
    expect(socialImageUrl(ORIGINAL)).toBe("https://cdn.example.com/r/hero/social-w1200.jpg");
  });

  it("leaves the original as src, so anything ignoring srcset still shows the picture", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    expect(imageSourceSetFor(ORIGINAL)?.src).toBe(ORIGINAL);
    expect(imageProps(ORIGINAL).src).toBe(ORIGINAL);
  });

  it("renders an unregistered image exactly as before", () => {
    expect(imageSourceSetFor("https://cdn.example.com/never-processed.png")).toBeNull();
    expect(imageProps("https://cdn.example.com/never-processed.png")).toEqual({
      src: "https://cdn.example.com/never-processed.png"
    });
  });

  it("never invents a srcset from a single copy", () => {
    registerImageRenditions(ORIGINAL, [LADDER[0]]);
    expect(imageSourceSetFor(ORIGINAL)).toBeNull();
  });

  it("drops malformed entries rather than emitting a link to a missing file", () => {
    registerImageRenditions(ORIGINAL, [
      ...LADDER.slice(0, 2),
      { w: 900, url: "" },
      { url: "https://cdn.example.com/r/hero/mystery.webp" },
      { w: "wide", url: "https://cdn.example.com/r/hero/nope.webp" },
      null,
      "not an object"
    ]);

    const resolved = imageSourceSetFor(ORIGINAL);
    expect(resolved?.srcSet).toBe(
      "https://cdn.example.com/r/hero/w300.webp 300w, https://cdn.example.com/r/hero/w600.webp 600w"
    );
  });

  it("ignores junk input instead of throwing", () => {
    expect(() => registerImageRenditions(ORIGINAL, "nope" as unknown)).not.toThrow();
    expect(() => registerImageRenditions("", LADDER)).not.toThrow();
    expect(() => registerImageRenditionMap(null)).not.toThrow();
    expect(getImageRenditions(ORIGINAL)).toEqual([]);
    expect(imageSourceSetFor(null)).toBeNull();
    expect(imageProps(undefined)).toEqual({ src: "" });
  });

  it("defaults sizes to full width and takes a better answer when the caller has one", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    expect(imageSourceSetFor(ORIGINAL)?.sizes).toBe("100vw");
    expect(imageSourceSetFor(ORIGINAL, { sizes: "(max-width: 700px) 100vw, 50vw" })?.sizes).toBe(
      "(max-width: 700px) 100vw, 50vw"
    );
  });

  it("turns a module's column width into a sizes hint", () => {
    // A half-column image asks for half the viewport, then a fixed 600px once
    // the content column stops growing — which is the 600 rung exactly.
    expect(sizesForWidthPercent(50)).toBe("(max-width: 1200px) 50vw, 600px");
    expect(sizesForWidthPercent(100)).toBe("(max-width: 1200px) 100vw, 1200px");
    expect(sizesForWidthPercent(33)).toBe("(max-width: 1200px) 33vw, 396px");
    // Nonsense falls back to full width rather than shrinking an image away.
    expect(sizesForWidthPercent(0)).toBe("(max-width: 1200px) 100vw, 1200px");
    expect(sizesForWidthPercent(undefined)).toBe("(max-width: 1200px) 100vw, 1200px");
    expect(sizesForWidthPercent("oops")).toBe("(max-width: 1200px) 100vw, 1200px");
    expect(sizesForWidthPercent(400)).toBe("(max-width: 1200px) 100vw, 1200px");
  });

  it("registers a whole map at once, the shape the page API sends", () => {
    registerImageRenditionMap({
      [ORIGINAL]: LADDER,
      "https://cdn.example.com/other.png": [LADDER[0], LADDER[1]]
    });

    expect(imageSourceSetFor(ORIGINAL)).not.toBeNull();
    expect(imageSourceSetFor("https://cdn.example.com/other.png")).not.toBeNull();
  });

  it("re-registering replaces rather than accumulates, so a replaced picture cannot linger", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    registerImageRenditions(ORIGINAL, [
      { w: 300, url: "https://cdn.example.com/r/new/w300.webp" },
      { w: 600, url: "https://cdn.example.com/r/new/w600.webp" }
    ]);

    const resolved = imageSourceSetFor(ORIGINAL);
    expect(resolved?.srcSet).not.toContain("/r/hero/");
    expect(getImageRenditions(ORIGINAL)).toHaveLength(2);
  });
});
