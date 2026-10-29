// @vitest-environment jsdom
import { useState } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { getBuilderBackgroundStyle, normalizeBackgroundSettings } from "@/lib/builder-template";
import type { BackgroundSettings } from "@/lib/builder-template";

/**
 * The layer editor driven the way the operator drives it: clicks on a real
 * DOM, with the panel reading back its own writes. The static-markup tests
 * prove what it shows; these prove the buttons are wired to the model.
 */
let host: HTMLDivElement;
let root: Root;
let latest: BackgroundSettings;

function Harness() {
  const [background, setBackground] = useState<BackgroundSettings>(
    normalizeBackgroundSettings({ mode: "gradient", color: "#ff0000", color2: "#0000ff", gradientAngle: 45 })
  );
  latest = background;
  return (
    <BuilderBackgroundControls
      allowGradientLayers
      horizontal
      label="Row Background"
      background={background}
      onChange={(updater) => setBackground((current) => updater(current))}
    />
  );
}

function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`no "${label}" button`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("editing gradient layers", () => {
  it("Use Layers keeps the picture, Add Layer puts a glow on top, Remove Layer takes it back", () => {
    const before = getBuilderBackgroundStyle(latest)?.backgroundImage;
    click("Use Layers");
    expect(latest.gradientLayers).toHaveLength(1);
    expect(getBuilderBackgroundStyle(latest)?.backgroundImage).toBe(
      "linear-gradient(45deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)"
    );
    expect(before).toBe("linear-gradient(45deg, #ff0000 0%, #0000ff 100%)");

    click("Add Layer");
    expect(latest.gradientLayers?.map((layer) => layer.kind)).toEqual(["radial", "linear"]);
    expect(getBuilderBackgroundStyle(latest)?.backgroundImage).toMatch(/^radial-gradient\(circle at 50% 50%/);

    click("Add Stop");
    expect(latest.gradientLayers?.[0].stops).toHaveLength(3);

    const [removeTop] = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Remove Layer");
    act(() => {
      removeTop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(latest.gradientLayers?.map((layer) => layer.kind)).toEqual(["linear"]);

    click("Remove Layer");
    expect(latest.gradientLayers).toBeUndefined();
    expect([latest.color, latest.color2, latest.gradientAngle]).toEqual(["#ff0000", "#0000ff", 45]);
    expect(host.textContent).toContain("Use Layers");
  });

  it("switching a layer to radial paints it as one", () => {
    click("Use Layers");
    const select = [...host.querySelectorAll("select")].find((s) => s.querySelector('option[value="radial"]'));
    if (!select) throw new Error("no layer type select");
    act(() => {
      select.value = "radial";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(getBuilderBackgroundStyle(latest)?.backgroundImage).toMatch(/^radial-gradient\(ellipse at 50% 50%/);
  });
});
