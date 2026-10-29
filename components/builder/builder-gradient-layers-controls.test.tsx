import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { normalizeBackgroundSettings } from "@/lib/builder-template";

const twoColour = normalizeBackgroundSettings({ mode: "gradient", color: "#ff0000", color2: "#0000ff" });
const layered = normalizeBackgroundSettings({
  mode: "gradient",
  gradientLayers: [
    { kind: "radial", shape: "circle", x: 80, y: 20, stops: [{ color: "#00e5ff", alpha: 20, position: 0 }, { color: "#000000", alpha: 0, position: 40 }] },
    { kind: "linear", angle: 110, stops: [{ color: "#020307", position: 0 }, { color: "#03111e", position: 100 }] }
  ]
});

function html(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    <BuilderBackgroundControls label="Row Background" background={twoColour} onChange={() => {}} {...props} />
  );
}

describe("where gradient layers can be edited", () => {
  it("is nowhere by default — a button or poll background keeps its two colours", () => {
    expect(html({ background: layered })).not.toContain("Gradient Layers");
    expect(html({ background: layered, horizontal: true })).not.toContain("Gradient Layers");
  });

  it("offers Use Layers on a two-colour gradient where the surface opts in", () => {
    const markup = html({ allowGradientLayers: true, horizontal: true });
    expect(markup).toContain("Use Layers");
    expect(markup).toContain("Color 2");
  });

  it("shows every layer and hides the two-colour fields once layered, in both layouts", () => {
    for (const horizontal of [true, false]) {
      const markup = html({ allowGradientLayers: true, horizontal, background: layered });
      expect(markup).toContain('data-gradient-layer-count="2"');
      expect(markup).toContain("Layer 1 (top)");
      expect(markup).toContain("Centre X %");
      expect(markup).not.toContain("Color 2");
      expect(markup).not.toContain("Secondary color");
    }
  });

  it("is not shown for a mode that is not gradient", () => {
    const markup = html({ allowGradientLayers: true, background: { ...layered, mode: "color" } });
    expect(markup).not.toContain("Gradient Layers");
  });
});
