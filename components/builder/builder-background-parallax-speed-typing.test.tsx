// @vitest-environment jsdom
import { useState } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";
import type { BackgroundSettings } from "@/lib/builder-template";

/**
 * THE ONE TEST THAT FAILS IF THE SPEED BOX IS REWIRED BACK (review of #481).
 *
 * The arithmetic half of this fix — that a keystroke and a stored value are
 * different questions — is held still by the unit tests on
 * `backgroundParallaxSpeedFromInput`. Those cannot fail if somebody puts
 * `clampBackgroundParallaxSpeed(event.target.value)` back on the input,
 * because the helper would still be correct and simply not called. A helper
 * nothing reaches is exactly the shape of a check that cannot fail, and this
 * repo has been bitten by that three times in the render contracts alone.
 *
 * So this drives the real control in a real DOM and reproduces what the
 * reviewer did by hand: clear the box, and see whether it is actually empty.
 * It is the only test here that renders interactively rather than to static
 * markup, which is why it opts into jsdom on its first line — the suite runs
 * in `node` by default and every other component test only needs markup.
 */

// React 18 asks to be told, out loud, that `act` is legitimate here rather
// than inferring it — without this every render logs a warning that reads like
// a broken test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IMAGE_PARALLAX: BackgroundSettings = {
  ...createDefaultBackgroundSettings(),
  mode: "image",
  imageUrl: "/images/x.png",
  parallax: true,
  parallaxSpeed: 0.3
};

let container: HTMLDivElement;
let root: Root;
/** What the panel has actually committed, as the page model would hold it. */
let stored: BackgroundSettings;

/**
 * A CONTROLLED host, because the bug only exists in the round trip. The panel
 * hands back a new settings object, the host stores it, and the host hands it
 * straight back down as `background` — which is what re-rendered the box with
 * the default in it. Rendering against a frozen prop would hide the whole
 * thing.
 */
function Host({ speed }: { speed: number }) {
  const [background, setBackground] = useState<BackgroundSettings>({
    ...IMAGE_PARALLAX,
    parallaxSpeed: speed
  });
  stored = background;
  return (
    <BuilderBackgroundControls
      label="Row Background"
      allowParallax
      background={background}
      onChange={(updater) => setBackground((current) => updater(current))}
    />
  );
}

/**
 * Remount at a chosen stored speed. Some of these assertions are only
 * discriminating away from 0.3: the broken path answered "" with the DEFAULT,
 * so a test that starts at the default cannot tell "left alone" apart from
 * "reset", and would pass on the very bug it names.
 */
function renderAt(speed: number) {
  act(() => {
    // Keyed by the speed so a second call REMOUNTS. Re-rendering the same
    // element would only change a prop, and the stored speed lives in the
    // host's own state, which a prop change does not touch — the tests below
    // would silently all run at 0.3.
    root.render(<Host key={speed} speed={speed} />);
  });
  onScreen = speedBox().value;
}

function speedBox(): HTMLInputElement {
  // The only disabled-capable number box in this panel is Parallax Speed, and
  // it is the only number box at all when Video is not allowed here.
  const box = container.querySelector<HTMLInputElement>('input[type="number"]');
  if (!box) throw new Error("the Parallax Speed box did not render at all");
  return box;
}

/**
 * Put a value on the node the way the browser does and let React hear it.
 * React remembers the last value it wrote and ignores an event whose value
 * looks unchanged, so assigning `.value` is not enough — the native setter is
 * what keeps React's own tracker in step.
 */
function setBoxValue(value: string) {
  const box = speedBox();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  if (!setter) throw new Error("no native value setter — the environment is not a DOM");
  act(() => {
    setter.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * `<input type="number">` reports "" for anything that is not a complete
 * number — "0." on the way to "0.7" included — while still SHOWING what was
 * typed. jsdom implements that sanitization exactly as a browser does
 * (verified: "0." reads back as ""), so the one thing missing from this
 * environment is the raw text the field keeps behind the sanitized value.
 */
function isCompleteNumber(text: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(text);
}

/**
 * WHAT IS ON SCREEN, which is not `box.value` and is the whole subject here.
 * Tracked by hand for the reason above, and re-synced after every keystroke:
 * if React wrote something different into the box, that REPLACED what the
 * operator could see — which is exactly the defect, React putting 0.3 back
 * over a field somebody had just emptied.
 */
let onScreen = "";

function syncFromReact(raw: string) {
  const shown = speedBox().value;
  onScreen = shown === (isCompleteNumber(raw) ? raw : "") ? raw : shown;
}

/** Select the contents and press Backspace. */
function clearBox() {
  setBoxValue("");
  syncFromReact("");
}

/** Type these characters, one keystroke at a time, at the end of the field. */
function typeChars(text: string) {
  for (const ch of text) {
    const raw = onScreen + ch;
    setBoxValue(isCompleteNumber(raw) ? raw : "");
    syncFromReact(raw);
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renderAt(0.3);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("typing in the Parallax Speed box", () => {
  it("starts showing the stored speed", () => {
    expect(speedBox().value).toBe("0.3");
  });

  it("CAN BE EMPTIED — backspace does not put the default straight back", () => {
    // The reported bug at its root. The old path ran every keystroke through
    // the storage clamp, which reads "" as "unset" and answers 0.3, so the box
    // refilled itself behind the operator's cursor.
    clearBox();
    expect(onScreen).toBe("");
    expect(speedBox().value).toBe("");
  });

  it("leaves the stored speed alone while the box is empty", () => {
    // Started away from the default ON PURPOSE: the broken path answered ""
    // with 0.3, so a run starting at 0.3 could not tell "left alone" from
    // "reset to the default" and would pass on the bug it is named after.
    renderAt(0.55);
    clearBox();
    expect(stored.parallaxSpeed).toBe(0.55);
  });

  it("TYPES 0.7 AND GETS 0.7, not 0.37", () => {
    // The reviewer's reproduction, keystroke for keystroke: clear the field,
    // then press 0, then ., then 7. The old path answered the "." — which a
    // number input reports as "" — with the default, so the box read 0.3 and
    // the 7 landed on the end of it.
    clearBox();
    typeChars("0.7");
    expect(onScreen).toBe("0.7");
    expect(stored.parallaxSpeed).toBe(0.7);
  });

  it("does not answer the decimal point with the default", () => {
    clearBox();
    typeChars("0.");
    // Halfway through "0.7". The "0" legitimately committed 0; the "." must
    // commit nothing at all. The old path answered it with 0.3 — which is
    // both a value the operator never typed and the reason the 7 that came
    // next read as 0.37.
    expect(stored.parallaxSpeed).toBe(0);
    expect(onScreen).toBe("0.");
  });

  it("lets a deliberately typed 0 mean pinned", () => {
    renderAt(0.55);
    clearBox();
    typeChars("0");
    // The one case where 0 must survive. Storage reads an unreadable value as
    // 0.3; a keystroke of "0" is the operator choosing the most dramatic
    // setting on the control, and it has to stick.
    expect(stored.parallaxSpeed).toBe(0);
  });

  it("still clamps what it commits, so the ends of the range hold", () => {
    clearBox();
    typeChars("9");
    expect(stored.parallaxSpeed).toBe(1);
  });

  it("falls back to the stored value when the operator leaves it empty", () => {
    // Leaving the field is the moment the draft stops mattering: the box has
    // to show what is actually saved rather than sit blank and imply nothing
    // is set.
    renderAt(0.55);
    clearBox();
    act(() => {
      speedBox().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(speedBox().value).toBe("0.55");
    expect(stored.parallaxSpeed).toBe(0.55);
  });
});
