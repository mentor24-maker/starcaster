import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_EFFECT_ROTATION_RATE,
  IMAGE_EFFECT_OPTIONS,
  IMAGE_EFFECT_TRAVEL_SECONDS,
  getImageEffectClassName,
  getImageEffectStyle,
  imageEffectRotates,
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

  it("turns a rate into turns-per-crossing for tumbleweed, so both effects mean the same speed", () => {
    // 60 turns/min across an 8s crossing is 8 turns.
    expect(getImageEffectStyle({ effect: "tumbleweed", effectRotationRate: "60" })).toEqual({
      "--sc-effect-spins": String(60 * (IMAGE_EFFECT_TRAVEL_SECONDS / 60))
    });
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
