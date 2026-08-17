import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_EFFECT_ROTATION_RATE,
  IMAGE_EFFECT_OPTIONS,
  IMAGE_EFFECT_TRAVEL_SECONDS,
  getImageEffectClassName,
  getImageEffectStageStyle,
  getImageEffectStyle,
  imageEffectBounces,
  imageEffectRotates,
  normalizeImageEffectFrequency,
  normalizeImageEffectRotationRate
} from "./builder-image-effects";

const cssRoot = path.resolve(__dirname, "../../src/css");
const builderCss = [
  readFileSync(path.join(cssRoot, "_builder-react.css"), "utf8"),
  readFileSync(path.join(cssRoot, "_builder-react-overrides.css"), "utf8")
].join("\n");

describe("image effects", () => {
  /**
   * The bug this whole file exists for: Cruise and Tumbleweed were offered in
   * two panels for months and NO stylesheet defined them, so choosing one set
   * a class nobody styled and the operator saw a still picture. Nothing tests
   * CSS in this repo, which is exactly why a missing rule stayed missing —
   * so the option list is checked against the stylesheet directly.
   */
  it("every effect the panels offer has a rule in the builder CSS", () => {
    const missing = IMAGE_EFFECT_OPTIONS.filter((option) => option.value !== "none")
      .map((option) => getImageEffectClassName(option.value).trim())
      .filter((className) => !builderCss.includes(`.${className} {`));

    expect(missing).toEqual([]);
  });

  /**
   * The hop rides a wrapper element, so its class is not in the option list
   * and the sweep above cannot see it — exactly the kind of gap that let
   * Cruise and Tumbleweed ship unstyled in the first place.
   */
  it("the hop stage has a rule too", () => {
    expect(builderCss).toContain(".starcaster-effect-hop-stage {");
    expect(builderCss).toContain("@keyframes sc-effect-hop");
  });

  it("names a class for every option, and nothing for None", () => {
    expect(getImageEffectClassName("none")).toBe("");
    expect(getImageEffectClassName(undefined)).toBe("");
    expect(getImageEffectClassName("tumbleweed")).toBe(" starcaster-effect-tumbleweed");
  });

  it("offers Rotation Rate only to the effects that rotate", () => {
    expect(imageEffectRotates("spin")).toBe(true);
    expect(imageEffectRotates("tumbleweed")).toBe(true);
    expect(imageEffectRotates("cruise")).toBe(false);
    expect(imageEffectRotates("bounce")).toBe(false);
    expect(imageEffectRotates(undefined)).toBe(false);
  });

  it("turns a rate into a spin duration, and the default matches the old fixed speed", () => {
    expect(getImageEffectStyle({ effect: "spin", effectRotationRate: "60" })).toEqual({
      "--sc-effect-rotation-duration": "1s"
    });
    // 25 turns/min is 2.4s a turn — what `.starcaster-effect-spin` always ran at.
    expect(getImageEffectStyle({ effect: "spin" })).toEqual({
      "--sc-effect-rotation-duration": "2.4s"
    });
    expect(DEFAULT_IMAGE_EFFECT_ROTATION_RATE).toBe("25");
  });

  it("gives tumbleweed the same turn duration as spin, so one rate means one speed", () => {
    expect(getImageEffectStyle({ effect: "tumbleweed", effectRotationRate: "60" })).toEqual({
      "--sc-effect-rotation-duration": "1s"
    });
  });

  it("turns Frequency into the duration of ONE hop", () => {
    // 4 hops across an 8s crossing is a 2s hop.
    expect(getImageEffectStageStyle({ effect: "tumbleweed", effectFrequency: "4" })).toEqual({
      "--sc-effect-bounce-duration": `${IMAGE_EFFECT_TRAVEL_SECONDS / 4}s`
    });
    expect(getImageEffectStageStyle({ effect: "tumbleweed" })).toEqual({
      "--sc-effect-bounce-duration": "2s"
    });
  });

  it("only tumbleweed leaves the midline", () => {
    expect(imageEffectBounces("tumbleweed")).toBe(true);
    expect(imageEffectBounces("spin")).toBe(false);
    expect(imageEffectBounces("cruise")).toBe(false);
    expect(getImageEffectStageStyle({ effect: "cruise", effectFrequency: "4" })).toBeUndefined();
    expect(getImageEffectStageStyle({ effect: "spin", effectFrequency: "4" })).toBeUndefined();
  });

  it("falls back rather than emitting a hop of zero seconds", () => {
    expect(normalizeImageEffectFrequency("")).toBe(4);
    expect(normalizeImageEffectFrequency("junk")).toBe(4);
    expect(normalizeImageEffectFrequency("0")).toBe(1);
    expect(normalizeImageEffectFrequency("9999")).toBe(60);
  });

  it("has nothing to say about an effect that does not rotate", () => {
    expect(getImageEffectStyle({ effect: "cruise", effectRotationRate: "60" })).toBeUndefined();
    expect(getImageEffectStyle({})).toBeUndefined();
  });

  it("falls back rather than emitting a broken duration", () => {
    expect(normalizeImageEffectRotationRate("")).toBe(25);
    expect(normalizeImageEffectRotationRate("nonsense")).toBe(25);
    expect(normalizeImageEffectRotationRate("0")).toBe(1);
    expect(normalizeImageEffectRotationRate("99999")).toBe(600);
  });
});
