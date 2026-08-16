// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderModuleSpacingFields, spacingPairSpecs, resolveSpacingSide } from "./builder-spacing-fields";

/**
 * The matched spacing rows (doctrine E4b). These need a real DOM because the
 * whole point of the control is what CLICKING it writes — and the thing that
 * must never break is that it writes the four SIDE keys. E4 exists because a
 * single vertical/horizontal setting could not express "no padding above, keep
 * the padding on the left"; if matching ever starts persisting a pair again,
 * that failure is back.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

/** Re-renders with the settings the last write produced, like the panel does. */
function mountSpacing(initial: Record<string, string>) {
  const state = { settings: { ...initial } };
  const render = () =>
    act(() => {
      root!.render(
        <BuilderModuleSpacingFields
          box="margin"
          max={160}
          onChange={(values) => {
            state.settings = { ...state.settings, ...values };
            render();
          }}
          settings={state.settings}
        />
      );
    });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render();
  return { state, node: container };
}

function labels(node: HTMLElement) {
  return [...node.querySelectorAll(".builder-module-field-label")].map((el) => el.textContent);
}

function rowSelect(node: HTMLElement, label: string) {
  const field = [...node.querySelectorAll(".builder-module-field")].find(
    (el) => el.querySelector(".builder-module-field-label")?.textContent === label
  );
  if (!field) throw new Error(`no row labelled ${label}`);
  return field.querySelector("select") as HTMLSelectElement;
}

function rowToggle(node: HTMLElement, label: string) {
  const field = [...node.querySelectorAll(".builder-module-field")].find(
    (el) => el.querySelector(".builder-module-field-label")?.textContent === label
  );
  return field?.querySelector(".builder-spacing-link-toggle") as HTMLButtonElement | null;
}

describe("BuilderModuleSpacingFields", () => {
  it("shows one row per axis while the two sides match", () => {
    const { node } = mountSpacing({});
    expect(labels(node)).toEqual(["V Margin", "H Margin"]);
  });

  it("writes BOTH sides from a matched row — never a vertical/horizontal key (E4)", () => {
    const { state, node } = mountSpacing({});
    const select = rowSelect(node, "V Margin");
    act(() => {
      select.value = "20";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(state.settings.marginTop).toBe("20");
    expect(state.settings.marginBottom).toBe("20");
    expect(state.settings.verticalMargin).toBeUndefined();
    expect(state.settings.marginLeft).toBeUndefined();
  });

  it("splits into Top and Bottom on the row's own toggle, and writes only that side", () => {
    const { state, node } = mountSpacing({});
    act(() => rowToggle(node, "V Margin")!.click());
    expect(labels(node)).toEqual(["Top Margin", "Bottom Margin", "H Margin"]);

    act(() => {
      const select = rowSelect(node, "Top Margin");
      select.value = "35";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(state.settings.marginTop).toBe("35");
    // Splitting itself writes nothing: the other side is still unset, and
    // still showing the 0 it renders.
    expect(state.settings.marginBottom).toBeUndefined();
    expect(rowSelect(node, "Bottom Margin").value).toBe("0");
    // The horizontal axis is untouched by any of it.
    expect(labels(node)).toContain("H Margin");
  });

  it("re-matching brings the second side to the row you clicked", () => {
    const { state, node } = mountSpacing({ marginTop: "40", marginBottom: "10" });
    // Unequal sides open split, with no state to remember and none needed.
    expect(labels(node)).toEqual(["Top Margin", "Bottom Margin", "H Margin"]);
    // The toggle rides the FIRST row only, so the survivor is predictable.
    expect(rowToggle(node, "Bottom Margin")).toBeNull();

    act(() => rowToggle(node, "Top Margin")!.click());
    expect(state.settings.marginBottom).toBe("40");
    expect(labels(node)).toEqual(["V Margin", "H Margin"]);
  });

  it("reads the retired vertical/horizontal pair a stale page still renders", () => {
    const { node } = mountSpacing({ verticalMargin: "25", horizontalMargin: "15" });
    expect(rowSelect(node, "V Margin").value).toBe("25");
    expect(rowSelect(node, "H Margin").value).toBe("15");
  });

  it("keeps the sides split when a value change pulls them apart", () => {
    // Derived, not stored: an undo that makes the two sides differ shows two
    // rows again on its own, so the control can never claim they match.
    const { state, node } = mountSpacing({});
    act(() => rowToggle(node, "V Margin")!.click());
    act(() => {
      const select = rowSelect(node, "Bottom Margin");
      select.value = "15";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(state.settings.marginBottom).toBe("15");
    expect(labels(node)).toEqual(["Top Margin", "Bottom Margin", "H Margin"]);
  });
});

describe("spacingPairSpecs", () => {
  it("keeps the E4 side order — top, bottom, then left, right", () => {
    const [vertical, horizontal] = spacingPairSpecs("padding");
    expect(vertical.sides.map((side) => side.key)).toEqual(["paddingTop", "paddingBottom"]);
    expect(horizontal.sides.map((side) => side.key)).toEqual(["paddingLeft", "paddingRight"]);
  });

  it("takes per-side legacy keys and defaults (the Button pill's 12/24)", () => {
    const [vertical, horizontal] = spacingPairSpecs("padding", {
      min: 1,
      max: 50,
      step: 1,
      sides: {
        paddingTop: { legacy: "paddingY", fallback: "12" },
        paddingBottom: { legacy: "paddingY", fallback: "12" },
        paddingLeft: { legacy: "paddingX", fallback: "24" },
        paddingRight: { legacy: "paddingX", fallback: "24" }
      }
    });
    expect(resolveSpacingSide({}, vertical.sides[0])).toBe("12");
    expect(resolveSpacingSide({}, horizontal.sides[0])).toBe("24");
    expect(resolveSpacingSide({ paddingY: "8" }, vertical.sides[1])).toBe("8");
    expect(resolveSpacingSide({ paddingTop: "3", paddingY: "8" }, vertical.sides[0])).toBe("3");
    expect(vertical.step).toBe(1);
  });
});
