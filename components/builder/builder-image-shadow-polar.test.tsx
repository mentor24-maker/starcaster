// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BuilderImageShadowAngleControl,
  BuilderImageShadowDistanceControl,
  clearShadowPolarMemory,
  optionsIncluding,
  shadowAnglePick,
  shadowDistancePick,
  shadowPolarShown
} from "./builder-image-shadow-polar";

/**
 * The two controls that say where a drop shadow falls the other way round
 * (operator, 2026-08-25: "there are X/Y settings AND direction").
 *
 * The trigonometry itself is tested next to the engine, in
 * lib/builder-client/builder-carousel-image-frame.test.ts. What is tested
 * here is the wiring the engine cannot see: which companion value a pick
 * carries over, what the list shows for a shadow whose angle is not one of
 * the twenty-four the list offers, and — since the 2026-09-07 send-back —
 * that a value the operator PICKED is still the value the box shows.
 */

type Settings = Record<string, string | undefined>;

/** The module whose panel is on screen. Every test that drives ONE panel uses
 *  this; the cross-module test at the bottom is the one that needs two. */
const MODULE = "module-court-photo";

function optionsIn(markup: string): string[] {
  return [...markup.matchAll(/<option value="(-?\d+)"/g)].map((match) => match[1]);
}

function selectedIn(markup: string): string {
  return markup.match(/<select[^>]*\bvalue="(-?\d+)"/)?.[1] ?? markup.match(/selected=""[^>]*>(-?\d+)</)?.[1] ?? "";
}

describe("shadow angle and distance controls", () => {
  beforeEach(() => {
    // The picked pair is remembered outside React (see the control), so one
    // test's pick would otherwise be the next one's starting state.
    clearShadowPolarMemory();
  });

  it("swings the shadow round WITHOUT changing how far out it sits", () => {
    // x: 12, y: -9 is 15 away at 37 degrees. Picking 90 must keep the 15.
    const settings = { imageShadowX: "12", imageShadowY: "-9" };
    expect(shadowAnglePick(settings, null, MODULE, 90).values).toEqual({ imageShadowX: "0", imageShadowY: "-15" });
  });

  it("keeps the distance at a SHORT one too, where the pixels cannot", () => {
    // The send-back's note on this test: at distance 24 every grid angle
    // round-trips exactly, so passing there proved less than the name
    // claimed. At distance 3 the offsets can only manage 2, -3 — which reads
    // back as 56 degrees and a distance of 4. The operator asked for 60 at 3,
    // so 60 at 3 is what both boxes must go on saying.
    const settings = { imageShadowX: "3", imageShadowY: "0" };
    const pick = shadowAnglePick(settings, null, MODULE, 60);
    expect(pick.values).toEqual({ imageShadowX: "2", imageShadowY: "-3" });
    expect(shadowPolarShown(pick.values, pick.memory, MODULE)).toEqual({ angle: 60, distance: 3 });
    // Without the memory the same offsets read back as something else, which
    // is exactly what the operator saw.
    expect(shadowPolarShown(pick.values, null, MODULE)).toEqual({ angle: 56, distance: 4 });
  });

  it("moves the shadow out and in WITHOUT changing its direction", () => {
    // The mirror of the above, and the same mistake in the other control:
    // taking the angle from anywhere but the shadow's own would swing it.
    const settings = { imageShadowX: "0", imageShadowY: "20" };
    expect(shadowDistancePick(settings, null, MODULE, 8).values).toEqual({ imageShadowX: "0", imageShadowY: "8" });
  });

  it("carries the DEFAULT shadow's other half when nothing is stored yet", () => {
    // An untouched module stores no offsets and the page still paints 0/6.
    // Picking an angle on it must swing THAT shadow, not one at distance 0.
    expect(shadowAnglePick({}, null, MODULE, 0).values).toEqual({ imageShadowX: "6", imageShadowY: "0" });
  });

  it("remembers NOTHING when the square could not reach the pair asked for", () => {
    // Distance 57 at 270 degrees wants y: 57 and the page draws 40. A box
    // still reading 57 would describe a shadow that is not there — the one
    // case where re-deriving is the honest answer.
    const pick = shadowDistancePick({ imageShadowX: "0", imageShadowY: "6" }, null, MODULE, 57);
    expect(pick.values).toEqual({ imageShadowX: "0", imageShadowY: "40" });
    expect(pick.memory).toBeNull();
    expect(shadowPolarShown(pick.values, pick.memory, MODULE).distance).toBe(40);
  });

  it("stops honouring a picked pair once the offsets are somebody else's", () => {
    // THE GUARD. A remembered angle that outlived the offsets it produced
    // would have the panel describing a shadow the page is not drawing.
    const pick = shadowAnglePick({ imageShadowX: "12", imageShadowY: "-9" }, null, MODULE, 15);
    expect(shadowPolarShown(pick.values, pick.memory, MODULE).angle).toBe(15);
    const editedByHand = { imageShadowX: "30", imageShadowY: "-4" };
    expect(shadowPolarShown(editedByHand, pick.memory, MODULE)).toEqual({ angle: 8, distance: 30 });
  });

  it("offers the whole dial in fifteens, and stops short of 360", () => {
    const options = optionsIn(renderToStaticMarkup(
      <BuilderImageShadowAngleControl moduleId={MODULE} settings={{}} onChange={() => {}} />
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
      <BuilderImageShadowDistanceControl moduleId={MODULE} settings={{}} onChange={() => {}} />
    ));
    expect(options.at(-1)).toBe("57");
  });

  it("shows a corner shadow at 315 and 57 rather than the nearest tidy pair", () => {
    const settings = { imageShadowX: "40", imageShadowY: "40" };
    expect(selectedIn(renderToStaticMarkup(
      <BuilderImageShadowAngleControl moduleId={MODULE} settings={settings} onChange={() => {}} />
    ))).toBe("315");
    expect(selectedIn(renderToStaticMarkup(
      <BuilderImageShadowDistanceControl moduleId={MODULE} settings={settings} onChange={() => {}} />
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
        moduleId={MODULE}
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

/**
 * THE THREE THINGS THE SEND-BACK FOUND, driven the way they were found: both
 * rows on screen at once, picked with a pointer, read straight off the boxes.
 *
 * None of them is reachable from the pure functions alone, because all three
 * are about what the OTHER row does after this one is picked — which is the
 * one thing a panel of two independent controls gets wrong.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** The two rows as the panel mounts them: one settings object, two controls,
 *  and a plain Shadow X box standing in for the panel's own.
 *
 *  `prefix` exists so TWO of these can be on screen at once, which is the
 *  Builder's normal state and the condition the cross-module test needs. */
function ShadowRows({
  initial,
  moduleId = MODULE,
  prefix = ""
}: {
  initial: Settings;
  moduleId?: string;
  prefix?: string;
}) {
  const [settings, setSettings] = useState<Settings>(initial);
  const merge = (values: Settings) => setSettings((current) => ({ ...current, ...values }));
  return (
    <div>
      <BuilderImageShadowAngleControl moduleId={moduleId} settings={settings} onChange={merge} />
      <BuilderImageShadowDistanceControl moduleId={moduleId} settings={settings} onChange={merge} />
      <input
        aria-label={`${prefix}Shadow X`}
        value={settings.imageShadowX ?? ""}
        onChange={(event) => merge({ imageShadowX: event.target.value })}
      />
      <output aria-label={`${prefix}offsets`}>
        {`${settings.imageShadowX ?? ""},${settings.imageShadowY ?? ""}`}
      </output>
    </div>
  );
}

function mount(initial: Settings) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<ShadowRows initial={initial} />));
}

/** Two module cards expanded at once — what the Builder actually looks like. */
function mountTwo(first: Settings, second: Settings) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <>
        <div data-panel="a">
          <ShadowRows initial={first} moduleId="module-slideshow" prefix="A " />
        </div>
        <div data-panel="b">
          <ShadowRows initial={second} moduleId="module-card-slider" prefix="B " />
        </div>
      </>
    )
  );
}

/** The same three readers, scoped to one of the two panels above. */
function inPanel(panel: "a" | "b") {
  const scope = container?.querySelector(`[data-panel="${panel}"]`);
  if (!scope) throw new Error(`no panel ${panel}`);
  return {
    reads(label: string): string {
      const found = scope.querySelector(`[aria-label="${label}"]`);
      if (!found) throw new Error(`no control labelled ${label}`);
      return (found as HTMLSelectElement | HTMLInputElement).value;
    },
    pick(label: string, value: string) {
      act(() => {
        const control = scope.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  };
}

function box(label: string): HTMLSelectElement | HTMLInputElement {
  const found = container?.querySelector(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no control labelled ${label}`);
  return found as HTMLSelectElement | HTMLInputElement;
}

function reads(label: string): string {
  return box(label).value;
}

function offsets(): string {
  return container?.querySelector('[aria-label="offsets"]')?.textContent ?? "";
}

function pick(label: string, value: string) {
  act(() => {
    const control = box(label);
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the two rows together, driven like the panel", () => {
  beforeEach(() => {
    clearShadowPolarMemory();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("shows the fifteen that was picked, not the sixteen the pixels landed on", () => {
    // Send-back defect 1: on 16 of the dial's 24 positions the box overruled
    // the choice the operator had just made from a list of fifteens.
    mount({ imageShadowX: "12", imageShadowY: "-9" });
    expect(reads("Shadow angle in degrees")).toBe("37");
    pick("Shadow angle in degrees", "15");
    expect(offsets()).toBe("14,-4");
    expect(reads("Shadow angle in degrees")).toBe("15");
    expect(reads("Shadow distance in pixels")).toBe("15");
  });

  it("does not turn the shadow when Distance goes to 0 and back", () => {
    // Send-back defect 2, the one that would have been reported as a bug: a
    // shadow set above the picture came back to its right-hand side, from a
    // control the operator only moved out and in.
    mount({ imageShadowX: "0", imageShadowY: "-20" });
    expect(reads("Shadow angle in degrees")).toBe("90");
    pick("Shadow distance in pixels", "0");
    expect(offsets()).toBe("0,0");
    expect(reads("Shadow angle in degrees")).toBe("90");
    pick("Shadow distance in pixels", "20");
    expect(offsets()).toBe("0,-20");
    expect(reads("Shadow angle in degrees")).toBe("90");
  });

  it("takes an Angle pick at Distance 0 instead of swallowing it", () => {
    // Send-back defect 3 — landmine 17's shape: the pick wrote 0/0, snapped
    // back to 0, and said nothing. It is a real choice now: the box keeps it,
    // and the distance the operator gives it next goes THAT way.
    mount({ imageShadowX: "0", imageShadowY: "0" });
    pick("Shadow angle in degrees", "90");
    expect(reads("Shadow angle in degrees")).toBe("90");
    pick("Shadow distance in pixels", "20");
    expect(offsets()).toBe("0,-20");
  });

  it("goes back to describing the page the moment Shadow X is edited", () => {
    // The guard, in the panel: a remembered angle must never outlive the
    // offsets it produced, or the boxes describe a shadow nobody can see.
    mount({ imageShadowX: "12", imageShadowY: "-9" });
    pick("Shadow angle in degrees", "15");
    expect(reads("Shadow angle in degrees")).toBe("15");
    act(() => {
      const control = box("Shadow X") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(control, "30");
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(offsets()).toBe("30,-4");
    expect(reads("Shadow angle in degrees")).toBe("8");
    expect(reads("Shadow distance in pixels")).toBe("30");
  });

  it("does not turn the shadow when Distance is DRAGGED past the cap", () => {
    // SEND-BACK ROUND 2. The operator picks a direction and then walks
    // Distance up one step at a time, which is how a drag arrives. X and Y
    // used to be capped separately, so past about 41 the point left the ray
    // and slid towards the corner of the square: 45 read 17, 50 read 21,
    // 57 read 27. He touched nothing but Distance and the shadow swung 12
    // degrees.
    mount({ imageShadowX: "12", imageShadowY: "-9" });
    pick("Shadow angle in degrees", "15");
    expect(reads("Shadow angle in degrees")).toBe("15");
    for (const step of ["20", "30", "38", "42", "45", "50", "57"]) {
      pick("Shadow distance in pixels", step);
      expect(reads("Shadow angle in degrees")).toBe("15");
    }
    // Pinned against the cap: as far out as the square goes in that
    // direction, and the box says the 41 it can actually reach.
    expect(offsets()).toBe("40,-11");
    expect(reads("Shadow distance in pixels")).toBe("41");
    // And back in again, still 15 the whole way.
    for (const step of ["40", "30", "20"]) {
      pick("Shadow distance in pixels", step);
      expect(reads("Shadow angle in degrees")).toBe("15");
    }
  });

  it("keeps one module's pick out of another module's boxes", () => {
    // SEND-BACK ROUND 2, item 2. The remembered pick is ONE variable for the
    // whole app, and several module cards are expanded at once — so a memory
    // fingerprinted on the offsets alone was honoured by any module whose
    // offsets happened to match. Measured: picking 15 on the Slideshow left a
    // Card Slider hand-set to the same 6,-2 reading 15, when its own offsets
    // derive to 18.
    mountTwo({ imageShadowX: "0", imageShadowY: "6" }, { imageShadowX: "0", imageShadowY: "-2" });
    const a = inPanel("a");
    const b = inPanel("b");
    expect(a.reads("Shadow angle in degrees")).toBe("270");
    expect(b.reads("Shadow angle in degrees")).toBe("90");

    // A's pick lands on 6,-2 — 15 degrees at the distance 6 it already had.
    a.pick("Shadow angle in degrees", "15");
    expect(a.reads("Shadow angle in degrees")).toBe("15");
    // B still describes its OWN page, untouched.
    expect(b.reads("Shadow angle in degrees")).toBe("90");

    // Now hand-set B's Shadow X to 6, so B's offsets become the very pair A's
    // pick produced. B never picked anything, so B must re-derive: 6,-2 is 18.
    act(() => {
      const control = container?.querySelector('[aria-label="B Shadow X"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(control, "6");
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(b.reads("Shadow angle in degrees")).toBe("18");
    // A still shows the fifteen it picked — scoping the memory took nothing
    // away from the module that owns it.
    expect(a.reads("Shadow angle in degrees")).toBe("15");
  });

  it("shows the 40 the square can draw when 57 was asked for at a quarter turn", () => {
    // The other half of the guard: a CLAMPED pick is not remembered, so the
    // honest re-derived value is what the operator sees.
    mount({ imageShadowX: "0", imageShadowY: "6" });
    pick("Shadow distance in pixels", "57");
    expect(offsets()).toBe("0,40");
    expect(reads("Shadow distance in pixels")).toBe("40");
  });
});
