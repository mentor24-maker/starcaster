import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_EFFECT_ROTATION_RATE,
  IMAGE_EFFECT_OPTIONS,
  IMAGE_EFFECT_TRAVEL_SECONDS,
  getImageEffectClassName,
  DEFAULT_IMAGE_EFFECT_BOUNCE_HEIGHT,
  DEFAULT_IMAGE_EFFECT_SPEED,
  getImageEffectStageStyle,
  getImageEffectStyle,
  imageEffectBounces,
  imageEffectRotates,
  imageEffectRunsOnce,
  imageEffectTravels,
  normalizeImageEffectBounceHeight,
  normalizeImageEffectDelay,
  normalizeImageEffectFrequency,
  normalizeImageEffectSpeed,
  normalizeImageEffectRotationRate
} from "./builder-image-effects";

const cssRoot = path.resolve(__dirname, "../../src/css");
const builderCss = [
  readFileSync(path.join(cssRoot, "_builder-react.css"), "utf8"),
  readFileSync(path.join(cssRoot, "_builder-react-overrides.css"), "utf8")
].join("\n");

describe("image effects", () => {
  it("the fallback crossing time is the Speed the panel defaults to", () => {
    // Two names for one number; a test rather than a comment, because the
    // stylesheet ALSO carries it as a fallback.
    expect(String(IMAGE_EFFECT_TRAVEL_SECONDS)).toBe(DEFAULT_IMAGE_EFFECT_SPEED);
    expect(builderCss).toContain(`var(--sc-effect-travel-duration, ${IMAGE_EFFECT_TRAVEL_SECONDS}s)`);
  });

  it("Speed drives the crossing, and everything per-crossing follows it", () => {
    const fast = getImageEffectStyle({ effect: "tumbleweed", effectSpeed: "2" });
    expect(fast?.["--sc-effect-travel-duration" as keyof typeof fast]).toBe("2s");

    // 4 hops per crossing across a 2s crossing is a 0.5s hop — the count is
    // what the operator set, the rate falls out of Speed.
    expect(
      getImageEffectStageStyle({ effect: "tumbleweed", effectSpeed: "2", effectFrequency: "4" })?.[
        "--sc-effect-bounce-duration" as never
      ]
    ).toBe("0.5s");
  });

  it("Once counts each animation separately, so the spin does not stop early", () => {
    const style = getImageEffectStyle({
      effect: "tumbleweed",
      effectRepeat: "once",
      effectSpeed: "8",
      effectRotationRate: "30"
    }) as Record<string, string>;

    expect(style["--sc-effect-travel-iterations"]).toBe("1");
    // 30 turns/min is a 2s turn; eight seconds of crossing is four of them.
    expect(style["--sc-effect-turn-iterations"]).toBe("4");
    expect(style["--sc-effect-fill"]).toBe("forwards");

    // The hop count for one crossing IS the Frequency.
    expect(
      (getImageEffectStageStyle({ effect: "tumbleweed", effectRepeat: "once", effectFrequency: "6" }) as Record<string, string>)[
        "--sc-effect-hop-iterations"
      ]
    ).toBe("6");
  });

  it("Forever writes no iteration keys at all, and Once needs a travelling effect", () => {
    const looping = getImageEffectStyle({ effect: "tumbleweed", effectRepeat: "loop" }) as Record<string, string>;
    expect(looping["--sc-effect-travel-iterations"]).toBeUndefined();
    expect(looping["--sc-effect-fill"]).toBeUndefined();

    expect(imageEffectRunsOnce({ effect: "tumbleweed", effectRepeat: "once" })).toBe(true);
    // Spin turns in place; "once" would be a control that means nothing there.
    expect(imageEffectRunsOnce({ effect: "spin", effectRepeat: "once" })).toBe(false);
  });

  it("Start Delay is written only when it is not zero", () => {
    expect((getImageEffectStyle({ effect: "cruise", effectDelay: "3" }) as Record<string, string>)["--sc-effect-delay"]).toBe("3s");
    expect((getImageEffectStyle({ effect: "cruise", effectDelay: "0" }) as Record<string, string>)["--sc-effect-delay"]).toBeUndefined();
    // The hop has to wait with it, or the ball bounces before it sets off.
    expect(
      (getImageEffectStageStyle({ effect: "tumbleweed", effectDelay: "3" }) as Record<string, string>)["--sc-effect-delay"]
    ).toBe("3s");
  });

  it("keeps Speed and Delay in range", () => {
    expect(normalizeImageEffectSpeed("")).toBe(8);
    expect(normalizeImageEffectSpeed("junk")).toBe(8);
    expect(normalizeImageEffectSpeed("0")).toBe(1);
    expect(normalizeImageEffectSpeed("9999")).toBe(600);
    expect(normalizeImageEffectDelay("")).toBe(0);
    expect(normalizeImageEffectDelay("-5")).toBe(0);
    expect(normalizeImageEffectDelay("9999")).toBe(120);
  });

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
      "--sc-effect-rotation-duration": "1s",
      // Travelling effects always carry their crossing time (Speed, 8/17).
      "--sc-effect-travel-duration": "8s"
    });
  });

  it("turns Frequency into the duration of ONE hop, and Height into the arc", () => {
    // 4 hops across an 8s crossing is a 2s hop.
    expect(getImageEffectStageStyle({ effect: "tumbleweed", effectFrequency: "4", effectBounceHeight: "200" })).toEqual({
      "--sc-effect-bounce-duration": `${IMAGE_EFFECT_TRAVEL_SECONDS / 4}s`,
      "--sc-effect-bounce": "200%"
    });
    expect(getImageEffectStageStyle({ effect: "tumbleweed" })).toEqual({
      "--sc-effect-bounce-duration": "2s",
      "--sc-effect-bounce": `${DEFAULT_IMAGE_EFFECT_BOUNCE_HEIGHT}%`
    });
  });

  /**
   * The stylesheet carries the same number as a fallback for pages written
   * before the control existed. Two copies of one default is exactly how a
   * panel comes to disagree with the page, so the test holds them together.
   */
  it("the stylesheet fallback matches the default the panel offers", () => {
    expect(builderCss).toContain(`var(--sc-effect-bounce, ${DEFAULT_IMAGE_EFFECT_BOUNCE_HEIGHT}%)`);
  });

  it("only tumbleweed leaves the midline", () => {
    expect(imageEffectBounces("tumbleweed")).toBe(true);
    expect(imageEffectBounces("spin")).toBe(false);
    expect(imageEffectBounces("cruise")).toBe(false);
    expect(getImageEffectStageStyle({ effect: "cruise", effectFrequency: "4" })).toBeUndefined();
    expect(getImageEffectStageStyle({ effect: "spin", effectFrequency: "4" })).toBeUndefined();
  });

  it("keeps the arc in range, and lets it be flat", () => {
    expect(normalizeImageEffectBounceHeight("")).toBe(50);
    expect(normalizeImageEffectBounceHeight("junk")).toBe(50);
    // 0 is a real answer here — travel and spin with no hop.
    expect(normalizeImageEffectBounceHeight("0")).toBe(0);
    expect(normalizeImageEffectBounceHeight("-40")).toBe(0);
    expect(normalizeImageEffectBounceHeight("99999")).toBe(1000);
  });

  it("falls back rather than emitting a hop of zero seconds", () => {
    expect(normalizeImageEffectFrequency("")).toBe(4);
    expect(normalizeImageEffectFrequency("junk")).toBe(4);
    expect(normalizeImageEffectFrequency("0")).toBe(1);
    expect(normalizeImageEffectFrequency("9999")).toBe(60);
  });

  it("has nothing to say about an effect that neither turns nor travels", () => {
    expect(getImageEffectStyle({})).toBeUndefined();
    expect(getImageEffectStyle({ effect: "bounce" })).toBeUndefined();
    // Cruise does not rotate, so it gets no turn duration — but it travels,
    // so it carries a crossing time and is entitled to a direction.
    expect(getImageEffectStyle({ effect: "cruise", effectRotationRate: "60" })).toEqual({
      "--sc-effect-travel-duration": "8s"
    });
  });

  it("reverses travel and spin together, and only when asked", () => {
    expect(imageEffectTravels("cruise")).toBe(true);
    expect(imageEffectTravels("tumbleweed")).toBe(true);
    expect(imageEffectTravels("spin")).toBe(false);

    expect(getImageEffectStyle({ effect: "cruise", effectDirection: "rtl" })).toEqual({
      "--sc-effect-travel-duration": "8s",
      "--sc-effect-direction": "reverse"
    });
    expect(getImageEffectStyle({ effect: "tumbleweed", effectRotationRate: "60", effectDirection: "rtl" })).toEqual({
      "--sc-effect-rotation-duration": "1s",
      "--sc-effect-travel-duration": "8s",
      "--sc-effect-direction": "reverse"
    });
    // Left to right is the absence of the variable, not a second keyword.
    expect(getImageEffectStyle({ effect: "cruise", effectDirection: "ltr" })).toEqual({
      "--sc-effect-travel-duration": "8s"
    });
    // Spin turns in place; a direction on it would be a control that does
    // nothing, which is the whole species of bug this file exists for.
    expect(getImageEffectStyle({ effect: "spin", effectDirection: "rtl" })).toEqual({
      "--sc-effect-rotation-duration": "2.4s"
    });
  });

  it("both travelling effects declare a direction in the stylesheet", () => {
    const rules = builderCss.split("}");
    for (const cls of ["starcaster-effect-cruise", "starcaster-effect-tumbleweed"]) {
      const rule = rules.find((r) => r.includes(`.${cls} {`));
      expect(rule, cls).toBeDefined();
      expect(rule, cls).toContain("animation-direction: var(--sc-effect-direction");
    }
  });

  it("falls back rather than emitting a broken duration", () => {
    expect(normalizeImageEffectRotationRate("")).toBe(25);
    expect(normalizeImageEffectRotationRate("nonsense")).toBe(25);
    expect(normalizeImageEffectRotationRate("0")).toBe(1);
    expect(normalizeImageEffectRotationRate("99999")).toBe(600);
  });
});
