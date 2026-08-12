import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import Image from "./next-image";
import { clearImageRenditions, registerImageRenditions } from "@/lib/image-renditions";

/**
 * This component is the single place every ported `<Image>` passes through —
 * the slider, card grids, the gallery picker. It used to drop `sizes` and serve
 * only the original, which is how the Delray slider kept pulling thirteen
 * full-size images after every other module had been fixed. These tests exist
 * so that cannot happen quietly again.
 */

const ORIGINAL = "https://cdn.example.com/APP/Assets/Image/1786048421592_court.png";

const LADDER = [
  { w: 300, h: 200, url: "https://cdn.example.com/r/court/w300.webp", format: "webp" },
  { w: 600, h: 400, url: "https://cdn.example.com/r/court/w600.webp", format: "webp" },
  { w: 1920, h: 1280, url: "https://cdn.example.com/r/court/w1920.webp", format: "webp", role: "full" },
  { w: 1200, h: 800, url: "https://cdn.example.com/r/court/social-w1200.jpg", format: "jpeg", role: "social" }
];

afterEach(() => clearImageRenditions());

describe("ported <Image> compat", () => {
  it("offers the scaled-down copies to the browser", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    const html = renderToStaticMarkup(<Image src={ORIGINAL} alt="Court" />);

    expect(html).toContain("w300.webp 300w");
    expect(html).toContain("w600.webp 600w");
    expect(html).toContain("w1920.webp 1920w");
  });

  it("passes the caller's own slot width through as the hint", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    // The slider states its slot is 280px wide. Dropping that is what made a
    // 280px slot fetch a 1920px file.
    const html = renderToStaticMarkup(<Image src={ORIGINAL} alt="" fill sizes="280px" />);
    expect(html).toContain('sizes="280px"');
  });

  it("keeps the social JPEG out of the choice", () => {
    registerImageRenditions(ORIGINAL, LADDER);
    const html = renderToStaticMarkup(<Image src={ORIGINAL} alt="" />);
    expect(html).not.toContain("social-w1200.jpg");
  });

  it("renders an image with no copies exactly as before", () => {
    const html = renderToStaticMarkup(<Image src="https://cdn.example.com/untouched.png" alt="" />);
    expect(html).toContain('src="https://cdn.example.com/untouched.png"');
    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("srcset");
  });

  it("still applies fill positioning and caller styles", () => {
    const html = renderToStaticMarkup(
      <Image src={ORIGINAL} alt="" fill style={{ borderRadius: 8 }} />
    );
    expect(html).toContain("position:absolute");
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("border-radius:8px");
  });

  it("does not choke on a missing src", () => {
    expect(() => renderToStaticMarkup(<Image alt="" />)).not.toThrow();
  });
});
