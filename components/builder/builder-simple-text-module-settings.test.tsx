import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSimpleTextModuleSettings } from "./builder-simple-text-module-settings";

function makeModule(settings: Record<string, string> = {}): BuilderTemplateModule {
  return {
    id: "m1",
    type: "text",
    column: "main",
    name: "",
    text: "",
    settings: { variant: "plain", ...settings }
  } as BuilderTemplateModule;
}

function render(settings: Record<string, string> = {}, compact = false) {
  return renderToStaticMarkup(
    <BuilderSimpleTextModuleSettings module={makeModule(settings)} onUpdateModule={() => {}} compact={compact} />
  );
}

describe("BuilderSimpleTextModuleSettings", () => {
  it("offers the type controls the module has no scale of its own for", () => {
    const html = render();
    for (const label of ["Size", "Weight", "Line Height", "Letter Spacing", "Color"]) {
      expect(html).toContain(label);
    }
  });

  it("is built from field strips with declared widths (doctrine E1, E2)", () => {
    const html = render();
    expect(html).toContain("builder-module-field-strip");
    expect(html).toContain("builder-module-field--select-md");
  });

  it("shows every control empty until the operator sets one", () => {
    // Empty is what keeps an untouched module inheriting from its section.
    const html = render();
    expect(html).toContain('placeholder="Inherit"');
    expect(html).not.toContain('value="16"');
  });

  it("reflects the values that are set", () => {
    const html = render({ fontSize: "28", fontWeight: "800", letterSpacing: "3" });
    expect(html).toContain('value="28"');
    expect(html).toContain('value="3"');
    expect(html).toContain('<option value="800" selected="">');
  });

  it("drops the secondary controls in a table cell, keeping size and weight", () => {
    const html = render({}, true);
    expect(html).toContain("Size");
    expect(html).toContain("Weight");
    expect(html).not.toContain("Letter Spacing");
  });

  it("does not repeat the module card's universal chrome (doctrine E6)", () => {
    const html = render();
    for (const absent of ["Alignment", "Width", "Margin"]) {
      expect(html).not.toContain(absent);
    }
  });
});
