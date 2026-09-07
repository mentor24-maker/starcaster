// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BuilderImageShadowAngleControl,
  BuilderImageShadowDistanceControl,
  optionsIncluding,
  shadowAnglePick,
  shadowDistancePick
} from "./builder-image-shadow-polar";

/**
 * The two controls that say where a drop shadow falls the other way round
 * (operator, 2026-08-25: "there are X/Y settings AND direction").
 *
 * The trigonometry itself is tested next to the engine, in
 * lib/builder-client/builder-carousel-image-frame.test.ts. What is tested
 * here is the wiring the engine cannot see: which companion value a pick
 * carries over, and what the list shows for a shadow whose angle is not one
 * of the twenty-four the list offers.
 */

function optionsIn(markup: string): string[] {
  return [...markup.matchAll(/<option value="(-?\d+)"/g)].map((match) => match[1]);
}

function selectedIn(markup: string): string {
  return markup.match(/<select[^>]*\bvalue="(-?\d+)"/)?.[1] ?? markup.match(/selected=""[^>]*>(-?\d+)</)?.[1] ?? "";
}

describe("shadow angle and distance controls", () => {
  it("swings the shadow round WITHOUT changing how far out it sits", () => {
    // x: 12, y: -9 is 15 away at 37 degrees. Picking 90 must keep the 15.
    const settings = { imageShadowX: "12", imageShadowY: "-9" };
    expect(shadowAnglePick(settings, 90)).toEqual({ imageShadowX: "0", imageShadowY: "-15" });
  });

  it("moves the shadow out and in WITHOUT changing its direction", () => {
    // The mirror of the above, and the same mistake in the other control:
    // taking the angle from anywhere but the shadow's own would swing it.
    const settings = { imageShadowX: "0", imageShadowY: "20" };
    expect(shadowDistancePick(settings, 8)).toEqual({ imageShadowX: "0", imageShadowY: "8" });
  });

  it("carries the DEFAULT shadow's other half when nothing is stored yet", () => {
    // An untouched module stores no offsets and the page still paints 0/6.
    // Picking an angle on it must swing THAT shadow, not one at distance 0.
    expect(shadowAnglePick({}, 0)).toEqual({ imageShadowX: "6", imageShadowY: "0" });
  });

  it("offers the whole dial in fifteens, and stops short of 360", () => {
    const options = optionsIn(renderToStaticMarkup(
      <BuilderImageShadowAngleControl settings={{}} onChange={() => {}} />
    ));
    expect(options[0]).toBe("0");
    expect(options).toContain("270");
    expect(options.at(-1)).toBe("345");
    // 360 and 0 are the same direction; offering both is two names for one
    // choice, and 360 is one its own reader can never produce.
    expect(options).not.toContain("360");
  });

  it("reaches 57 on the distance list, not the 40 the offsets cap to", () => {
    const options = optionsIn(renderToStaticMarkup(
      <BuilderImageShadowDistanceControl settings={{}} onChange={() => {}} />
    ));
    expect(options.at(-1)).toBe("57");
  });

  it("shows a corner shadow at 315 and 57 rather than the nearest tidy pair", () => {
    const settings = { imageShadowX: "40", imageShadowY: "40" };
    expect(selectedIn(renderToStaticMarkup(
      <BuilderImageShadowAngleControl settings={settings} onChange={() => {}} />
    ))).toBe("315");
    expect(selectedIn(renderToStaticMarkup(
      <BuilderImageShadowDistanceControl settings={settings} onChange={() => {}} />
    ))).toBe("57");
  });

  it("adds an OFF-GRID angle to the list rather than snapping the page to fit", () => {
    // THE FAILURE THIS CONTROL EXISTS AROUND. The shared number control snaps
    // an off-grid value to the next one down and WRITES it back as it mounts.
    // That is right for a setting it owns and wrong here: these two own no
    // key, so snapping 37 to 30 would rewrite X and Y — a shadow moving on a
    // live page because somebody opened a panel and touched nothing.
    const markup = renderToStaticMarkup(
      <BuilderImageShadowAngleControl
        settings={{ imageShadowX: "12", imageShadowY: "-9" }}
        onChange={() => {}}
      />
    );
    expect(optionsIn(markup)).toContain("37");
    expect(selectedIn(markup)).toBe("37");
  });

  it("keeps the off-grid value in numeric order, not tacked on the end", () => {
    expect(optionsIncluding(37, 0, 359, 15).slice(1, 5)).toEqual(["15", "30", "37", "45"]);
    // A value already on the grid is not duplicated.
    expect(optionsIncluding(30, 0, 359, 15).filter((option) => option === "30")).toHaveLength(1);
  });
});
