import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeBuilderModuleSettingsForType } from "@/lib/builder-template";
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
  imageEffectBouncesInPlace,
  imageEffectRotates,
  imageEffectRunsOnce,
  imageEffectTravels,
  normalizeImageEffect,
  normalizeImageEffectBounceHeight,
  normalizeImageEffectDelay,
  normalizeImageEffectFrequency,
  normalizeImageEffectSpeed,
  normalizeImageEffectRotationRate,
  usesHorizontalMotionClip
} from "./builder-image-effects";

const cssRoot = path.resolve(__dirname, "../../src/css");
const builderCss = [
  readFileSync(path.join(cssRoot, "_builder-react.css"), "utf8"),
  readFileSync(path.join(cssRoot, "_builder-react-overrides.css"), "utf8")
].join("\n");

/**
 * The rule that actually WINS for an effect class.
 *
 * `_builder-react.css` still carries the old ported rules for the effects
 * surfaced in 2026-08-22 (flips, slide, axis-rotate), and it is concatenated
 * FIRST here just as it is imported first in `main.css`. So the naive "find
 * the rule mentioning this class" picks the dead one and asserts against
 * markup no browser ever applies. Last match, not first — same order the
 * cascade resolves in.
 */
function winningRule(cls: string): string | undefined {
  const rules = builderCss
    .split("}")
    .filter((rule) => rule.includes(`.${cls} {`))
    // The reduced-motion block matches every effect class too, and it is the
    // last thing in the file. It is a silencer, not a description of the
    // motion, so it is never the rule these assertions mean.
    .filter((rule) => !/animation:\s*none/.test(rule));
  return rules[rules.length - 1];
}

/**
 * The selector list of the reduced-motion block that silences the image
 * effects — and ONLY that block, bounded by its own opening brace and its own
 * `animation: none`, so the assertion cannot quietly widen to the whole file.
 * Identified by the silencer that has been there longest rather than by
 * position, because position is what made the first version of this vacuous.
 */
const reducedMotionEffectSelectors = (() => {
  for (const match of builderCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{/g)) {
    const rest = builderCss.slice((match.index ?? 0) + match[0].length);
    const end = rest.indexOf("animation: none");
    if (end === -1) continue;
    const selectors = rest.slice(0, end);
    // Crossing either of these means the two landmarks were not in one block.
    if (selectors.includes("@media") || selectors.includes("}")) continue;
    if (selectors.includes("starcaster-effect-spin")) return selectors;
  }
  return undefined;
})();

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
    expect((getImageEffectStyle({ effect: "slide", effectDelay: "3" }) as Record<string, string>)["--sc-effect-delay"]).toBe("3s");
    expect((getImageEffectStyle({ effect: "slide", effectDelay: "0" }) as Record<string, string>)["--sc-effect-delay"]).toBeUndefined();
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
    expect(imageEffectRotates("slide")).toBe(false);
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
    expect(imageEffectBounces("slide")).toBe(false);
    expect(getImageEffectStageStyle({ effect: "slide", effectFrequency: "4" })).toBeUndefined();
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
    expect(getImageEffectStyle({ effect: "slide", effectRotationRate: "60" })).toEqual({
      "--sc-effect-travel-duration": "8s"
    });
  });

  it("reverses travel and spin together, and only when asked", () => {
    expect(imageEffectTravels("slide")).toBe(true);
    expect(imageEffectTravels("tumbleweed")).toBe(true);
    expect(imageEffectTravels("spin")).toBe(false);

    expect(getImageEffectStyle({ effect: "slide", effectDirection: "rtl" })).toEqual({
      "--sc-effect-travel-duration": "8s",
      "--sc-effect-direction": "reverse"
    });
    expect(getImageEffectStyle({ effect: "tumbleweed", effectRotationRate: "60", effectDirection: "rtl" })).toEqual({
      "--sc-effect-rotation-duration": "1s",
      "--sc-effect-travel-duration": "8s",
      "--sc-effect-direction": "reverse"
    });
    // Left to right is the absence of the variable, not a second keyword.
    expect(getImageEffectStyle({ effect: "slide", effectDirection: "ltr" })).toEqual({
      "--sc-effect-travel-duration": "8s"
    });
    // Spin turns in place; a direction on it would be a control that does
    // nothing, which is the whole species of bug this file exists for.
    expect(getImageEffectStyle({ effect: "spin", effectDirection: "rtl" })).toEqual({
      "--sc-effect-rotation-duration": "2.4s"
    });
  });

  /* ── Cruise retired into Slide (2026-08-22) ──────────────────────────────
   *
   * The operator collapsed the two after Slide was surfaced: "wherever you see
   * Cruise, consolidate it into Slide". They were one effect under two names —
   * identical CSS, identical controls. Cruise had SHIPPED, though, so saved
   * pages carry `effect: "cruise"` and must keep animating. These tests are the
   * guard on that: an alias that quietly stopped resolving would leave those
   * pictures still and raise no error, which is precisely the failure that put
   * this module in the repair queue in the first place.
   */
  it("Cruise is no longer offered in the picker", () => {
    expect(IMAGE_EFFECT_OPTIONS.map((o) => o.value)).not.toContain("cruise");
    expect(IMAGE_EFFECT_OPTIONS.map((o) => o.value)).toContain("slide");
  });

  it("a page saved with Cruise renders as Slide", () => {
    expect(normalizeImageEffect("cruise")).toBe("slide");
    expect(getImageEffectClassName("cruise")).toBe(getImageEffectClassName("slide"));
    expect(getImageEffectClassName("cruise").trim()).toBeTruthy();
  });

  it("Cruise keeps every behaviour Slide has", () => {
    expect(imageEffectTravels("cruise")).toBe(true);
    expect(imageEffectRotates("cruise")).toBe(false);
    expect(imageEffectBounces("cruise")).toBe(false);
    expect(getImageEffectStyle({ effect: "cruise", effectDirection: "rtl" }))
      .toEqual(getImageEffectStyle({ effect: "slide", effectDirection: "rtl" }));
  });

  it("leaves an effect it does not know alone", () => {
    // The alias map must not become a silent catch-all: an unknown name has to
    // pass through untouched so a genuinely dead effect still shows up as one.
    expect(normalizeImageEffect("tumbleweed")).toBe("tumbleweed");
    expect(normalizeImageEffect("nonsense")).toBe("nonsense");
    expect(normalizeImageEffect(undefined)).toBeUndefined();
  });

  it("both travelling effects declare a direction in the stylesheet", () => {
    // Slide's class is not `starcaster-effect-slide` — it dodges the buried
    // effect's dead legacy selectors — so derive it rather than hardcode it.
    const travellers = ["tumbleweed", "slide"].map((e) => getImageEffectClassName(e).trim());
    for (const cls of travellers) {
      const rule = winningRule(cls);
      expect(rule, cls).toBeDefined();
      expect(rule, cls).toContain("animation-direction: var(--sc-effect-direction");
    }
  });


  /* ── Slide, Axis Rotate and Flips (2026-08-22) ────────────────────────────
   *
   * Three of the five buried effects, surfaced on the operator's decision
   * (ClickUp 86bbfrpbb). The tests below are the doctrine checklist's item 7:
   * each new effect is pinned to the controls it claims and the stylesheet
   * rule that moves it, because "offered but nothing renders" is the exact
   * bug this file was opened for.
   */

  it("offers the four surfaced effects and still hides the one that was refused", () => {
    const offered = IMAGE_EFFECT_OPTIONS.map((option) => option.value);
    expect(offered).toContain("slide");
    expect(offered).toContain("axis-rotate");
    expect(offered).toContain("flips");
    // Parkour joined them on 2026-08-23. It was always part of the operator's
    // decision — it was held back only because two-axis rotation is a harder
    // piece of work, not because he refused it.
    expect(offered).toContain("parkour");
    // CARTWHEELS IS THE ONE HE REFUSED: Tumbleweed under another name, and he
    // said so in as many words. It is not a picker entry, and this assertion
    // is what keeps a future sweep from "helpfully" completing the set.
    expect(offered).not.toContain("cartwheels");
  });

  it("names a class for each of the surfaced effects", () => {
    // Slide emits `-slide-motion`, not `-slide`: the generated stylesheet's
    // dead `:has(.starcaster-effect-slide)` layout rules collapse a floating
    // image to 0px, so the live class must not match them (loop-review round 4).
    expect(getImageEffectClassName("slide")).toBe(" starcaster-effect-slide-motion");
    expect(getImageEffectClassName("axis-rotate")).toBe(" starcaster-effect-axis-rotate");
    expect(getImageEffectClassName("flips")).toBe(" starcaster-effect-flips");
  });

  it("gives slide the travelling effects' controls and no others", () => {
    expect(imageEffectTravels("slide")).toBe(true);
    expect(imageEffectRotates("slide")).toBe(false);
    expect(imageEffectBounces("slide")).toBe(false);
    // It crosses the whole viewport, so it needs the corridor for the same
    // reason Cruise does — without it the page scrolls sideways.
    expect(usesHorizontalMotionClip("slide")).toBe(true);
    expect(getImageEffectStyle({ effect: "slide", effectSpeed: "4" })).toEqual({
      "--sc-effect-travel-duration": "4s"
    });
  });

  it("turns axis-rotate in place, on the one control it offers", () => {
    expect(imageEffectRotates("axis-rotate")).toBe(true);
    expect(imageEffectTravels("axis-rotate")).toBe(false);
    expect(imageEffectBounces("axis-rotate")).toBe(false);
    expect(usesHorizontalMotionClip("axis-rotate")).toBe(false);
    expect(getImageEffectStyle({ effect: "axis-rotate", effectRotationRate: "60" })).toEqual({
      "--sc-effect-rotation-duration": "1s"
    });
  });

  it("rotates axis-rotate about Y, with the depth on the parent box", () => {
    // The only non-Z rotation in the codebase, so it cannot reuse
    // `sc-effect-turn` — that keyframe's bare `rotate: 1turn` is a Z turn.
    expect(builderCss).toContain("@keyframes sc-effect-turn-y");
    const rule = winningRule("starcaster-effect-axis-rotate");
    expect(rule).toBeDefined();
    expect(rule).toContain("sc-effect-turn-y var(--sc-effect-rotation-duration");
    // `perspective` on the spinning element itself does nothing — it only
    // bends that element's CHILDREN. Without it on an ancestor the turn reads
    // as a flat horizontal squash, which is a rendering bug no assertion
    // about class names would catch.
    expect(builderCss).toContain(
      ".builder-preview-image-shell:has(.starcaster-effect-axis-rotate)"
    );
    expect(rule).toContain("transform-style: preserve-3d");
  });

  it("flips turns AND hops without travelling, and carries both on the figure", () => {
    expect(imageEffectRotates("flips")).toBe(true);
    expect(imageEffectBounces("flips")).toBe(true);
    expect(imageEffectTravels("flips")).toBe(false);
    expect(imageEffectBouncesInPlace("flips")).toBe(true);
    // Tumbleweed hops too, but it travels — its hop needs the stage element.
    expect(imageEffectBouncesInPlace("tumbleweed")).toBe(false);
  });

  it("hangs the hop variables on the figure when there is no stage to hang them on", () => {
    // The renderer mounts the hop stage ONLY inside the travel corridor, so a
    // stationary hopper never sees one. If these variables came back from
    // getImageEffectStageStyle instead, they would land on an element that
    // does not exist for this effect and Flips would turn without hopping —
    // silently, because a missing CSS variable falls back rather than errors.
    expect(getImageEffectStageStyle({ effect: "flips", effectFrequency: "4" })).toBeUndefined();

    // 25 turns/min is a 2.4s turn; two hops per turn is a 1.2s hop.
    expect(getImageEffectStyle({ effect: "flips", effectFrequency: "2", effectBounceHeight: "150" })).toEqual({
      "--sc-effect-rotation-duration": "2.4s",
      "--sc-effect-bounce-duration": "1.2s",
      "--sc-effect-bounce": "150%"
    });
  });

  it("drives flips from both keyframes at once", () => {
    const rule = winningRule("starcaster-effect-flips");
    expect(rule).toBeDefined();
    // Two animations on two INDEPENDENT properties. One `transform` could not
    // carry both — the later animation would simply win and the other motion
    // would vanish, which is the trap the whole three-property design avoids.
    expect(rule).toContain("sc-effect-turn var(--sc-effect-rotation-duration");
    expect(rule).toContain("sc-effect-hop var(--sc-effect-bounce-duration");
  });

  it("parkour travels, turns and hops all at once — so it offers every control", () => {
    // The one effect that answers yes to all three predicates, which is what
    // puts all seven controls on its panel. Anything less and the operator
    // gets a control the page ignores, or a motion with no control behind it.
    expect(imageEffectTravels("parkour")).toBe(true);
    expect(imageEffectRotates("parkour")).toBe(true);
    expect(imageEffectBounces("parkour")).toBe(true);
    // It travels, so the hop rides the stage wrapper rather than the figure —
    // the figure has already spent `translate` on the crossing.
    expect(imageEffectBouncesInPlace("parkour")).toBe(false);
    // And travelling means it needs the corridor, or it scrolls the page.
    expect(usesHorizontalMotionClip("parkour")).toBe(true);
  });

  it("dodges the buried effect's selector instead of fighting it", () => {
    // NOT `starcaster-effect-parkour`: the regenerated `_builder-react.css`
    // still binds that exact class to `min-height: 240px` + `inset: 0
    // !important` on a floating image, and to the settings-ignoring
    // `normie-parkour` animation. Slide proved over three review rounds that
    // the override cannot win those; a class token they do not match can.
    expect(getImageEffectClassName("parkour")).toBe(" starcaster-effect-parkour-motion");
    // Guard the dodge itself: if this ever regresses to the bare name, the
    // dead `:has()` rules start matching again and a floating parkour
    // collapses to nothing with no error anywhere.
    expect(builderCss).toContain(":has(.starcaster-effect-parkour)");
    expect(getImageEffectClassName("parkour")).not.toBe(" starcaster-effect-parkour");
  });

  it("turns parkour about two axes at once, which needs `transform` and its own keyframe", () => {
    // The individual `rotate` property takes ONE axis, so the two-axis motion
    // cannot be expressed by reusing sc-effect-turn or sc-effect-turn-y.
    expect(builderCss).toContain("@keyframes sc-effect-tumble");
    const rule = winningRule("starcaster-effect-parkour-motion");
    expect(rule).toBeDefined();
    // Travel on `translate`, rotation on `transform` — two animations, two
    // properties, and the hop on a third element. None of them collide.
    expect(rule).toContain("sc-effect-travel var(--sc-effect-travel-duration");
    expect(rule).toContain("sc-effect-tumble var(--sc-effect-rotation-duration");
    // Rotation Rate has to mean the same thing here as on every other
    // rotating effect, which is what the shared variable buys. Matched on the
    // DECLARATION rather than the bare name — the comment above the rule
    // names `normie-parkour` too, and a substring check caught its own prose.
    expect(rule).not.toMatch(/animation:\s*normie-/);
    // Y rotation with no depth on an ancestor reads as a flat squash, not a
    // turn — the same trap axis-rotate documents.
    expect(rule).toContain("transform-style: preserve-3d");
    expect(builderCss).toContain(
      ".starcaster-effect-motion-clip:has(.starcaster-effect-parkour-motion)"
    );
  });

  it("drives parkour's three motions from the settings, not from fixed durations", () => {
    // 90 turns/min is a 0.667s turn; the crossing is Speed; the hop is the
    // crossing divided by Frequency, and rides the stage because it travels.
    expect(getImageEffectStyle({ effect: "parkour", effectRotationRate: "60", effectSpeed: "4" })).toEqual({
      "--sc-effect-rotation-duration": "1s",
      "--sc-effect-travel-duration": "4s"
    });
    expect(
      getImageEffectStageStyle({ effect: "parkour", effectSpeed: "4", effectFrequency: "4", effectBounceHeight: "150" })
    ).toEqual({
      "--sc-effect-bounce-duration": "1s",
      "--sc-effect-bounce": "150%"
    });
    // Right-to-left reverses the travel AND the tumble together, the same
    // single keyword tumbleweed uses.
    expect(
      (getImageEffectStyle({ effect: "parkour", effectDirection: "rtl" }) as Record<string, string>)[
        "--sc-effect-direction"
      ]
    ).toBe("reverse");
  });

  it("keeps parkour turning for the whole crossing when Repeat is Once", () => {
    // The trap tumbleweed's rule documents: one flat iteration count would
    // stop the tumble after a single turn and the figure would slide the rest
    // of the way flat. 8s crossing at 2.4s a turn is 3 turns.
    expect(imageEffectRunsOnce({ effect: "parkour", effectRepeat: "once" })).toBe(true);
    const style = getImageEffectStyle({ effect: "parkour", effectRepeat: "once" }) as Record<string, string>;
    expect(style["--sc-effect-travel-iterations"]).toBe("1");
    expect(style["--sc-effect-turn-iterations"]).toBe("3");
  });

  it("stops every surfaced effect for a visitor who asked for less motion", () => {
    // R6. The reduced-motion block is one selector list, and an effect added
    // without a line in it keeps moving for exactly the people who asked it
    // not to — a silent accessibility regression with no other symptom.
    //
    // The FIRST cut of this test could not fail. It sliced from the first
    // `prefers-reduced-motion` in the file to the first `animation: none`
    // after it, and those two landmarks sit in different blocks — so the
    // "selector list" it searched was several thousand lines of unrelated
    // CSS that happened to mention every effect class anyway. Deleting a
    // silencer line still passed. Caught by breaking it on purpose, which is
    // the only reason anyone would ever have noticed.
    expect(reducedMotionEffectSelectors, "the reduced-motion silencer block").toBeDefined();
    for (const effect of ["slide", "axis-rotate", "flips", "parkour"]) {
      // Derive the class (slide's is `-slide-motion`) rather than assume it
      // equals the option value — a substring check on `-slide` would pass
      // against `-slide-motion` by accident and hide a missing silencer line.
      const cls = getImageEffectClassName(effect).trim();
      expect(reducedMotionEffectSelectors, effect).toContain(`.${cls}`);
    }
  });

  it("falls back rather than emitting a broken duration", () => {
    expect(normalizeImageEffectRotationRate("")).toBe(25);
    expect(normalizeImageEffectRotationRate("nonsense")).toBe(25);
    expect(normalizeImageEffectRotationRate("0")).toBe(1);
    expect(normalizeImageEffectRotationRate("99999")).toBe(600);
  });

  /*
   * THE CONTROL THE PANEL SHOWS IS THE CONTROL THE PAGE GETS.
   *
   * Two halves decide the same thing. The panel decides which of the seven
   * effect controls to SHOW, from the three predicates above.
   * `normalizeImageEffectSettings` decides which to KEEP on the way to the
   * renderer — and it used to decide that by listing effect NAMES by hand.
   *
   * So Slide, Axis Rotate and Flips shipped a full review round offering
   * seven controls between them that were all deleted before they reached
   * the page: the operator moved a slider, the value saved, and the picture
   * carried on at the built-in default. Nothing errored, and the picture was
   * animating the whole time, so every other check stayed green.
   *
   * This asserts the two halves agree for EVERY offered effect, so the next
   * one added to the list cannot arrive half-wired.
   */
  const CONTROL_GATES: { key: string; visible: (effect: string) => boolean }[] = [
    { key: "effectDirection", visible: imageEffectTravels },
    { key: "effectSpeed", visible: imageEffectTravels },
    { key: "effectRepeat", visible: imageEffectTravels },
    { key: "effectDelay", visible: imageEffectTravels },
    { key: "effectRotationRate", visible: imageEffectRotates },
    { key: "effectFrequency", visible: imageEffectBounces },
    { key: "effectBounceHeight", visible: imageEffectBounces }
  ];

  // Every value non-default, so a key that survives proves the VALUE survived
  // and not merely that a default was re-stamped in its place.
  const ALL_CONTROLS = {
    effectDirection: "rtl",
    effectSpeed: "2",
    effectRepeat: "once",
    effectDelay: "3",
    effectRotationRate: "90",
    effectFrequency: "6",
    effectBounceHeight: "150"
  };

  it.each(IMAGE_EFFECT_OPTIONS.map((option) => option.value))(
    "keeps exactly the controls its panel offers: %s",
    (effect) => {
      const kept = normalizeBuilderModuleSettingsForType("image", { effect, ...ALL_CONTROLS });

      for (const { key, visible } of CONTROL_GATES) {
        if (visible(effect)) {
          expect(kept[key], `${effect} shows ${key}, so the page must receive it`).toBe(
            ALL_CONTROLS[key as keyof typeof ALL_CONTROLS]
          );
        } else {
          expect(kept[key], `${effect} hides ${key}, so it must not be carried`).toBeUndefined();
        }
      }
    }
  );

  it("carries the same controls on a floating image", () => {
    // The floating-image panel is a second copy of the same fields, and it
    // normalizes down a separate branch — a fix applied to one and not the
    // other is invisible until someone overlays a picture.
    const kept = normalizeBuilderModuleSettingsForType("floating-image", {
      effect: "flips",
      ...ALL_CONTROLS
    });
    expect(kept.effectRotationRate).toBe("90");
    expect(kept.effectFrequency).toBe("6");
    expect(kept.effectBounceHeight).toBe("150");
    expect(kept.effectDirection).toBeUndefined();
  });
});
