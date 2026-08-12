import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  marginFields,
  paddingFields,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

function makeModule(settings: Record<string, string> = {}): BuilderTemplateModule {
  return { id: "m1", type: "text", column: "main", name: "", text: "", settings } as BuilderTemplateModule;
}

function render(schema: BuilderSettingsSchema, settings: Record<string, string> = {}) {
  return renderToStaticMarkup(
    <BuilderSchemaModuleSettings schema={schema} module={makeModule(settings)} onUpdateModule={() => {}} />
  );
}

describe("BuilderSchemaModuleSettings", () => {
  it("renders groups in doctrine order regardless of declaration order (E3)", () => {
    const schema: BuilderSettingsSchema = {
      style: [[{ key: "color", label: "StyleMarker", width: "color", control: "color", dialogLabel: "c" }]],
      content: [[{ key: "alt", label: "ContentMarker", width: "full", control: "text" }]],
      layout: [[{ key: "size", label: "LayoutMarker", width: "select-sm", control: "select", options: [{ value: "100", label: "100%" }] }]]
    };
    const html = render(schema);
    const order = ["ContentMarker", "LayoutMarker", "StyleMarker"].map((m) => html.indexOf(m));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("wraps every field in a strip with its declared width token (E1, E2)", () => {
    const html = render({
      content: [[
        { key: "alt", label: "Alt", width: "full", control: "text" },
        { key: "size", label: "Size", width: "select-sm", control: "select", options: [{ value: "1", label: "1" }] }
      ]]
    });
    expect(html).toContain("builder-module-field-strip");
    expect(html).toContain("builder-module-field--full");
    expect(html).toContain("builder-module-field--select-sm");
  });

  it("marginFields yields all four sides adjacent in one strip, canonical names (E4/W7)", () => {
    const html = render({ layout: [[...marginFields("getModuleOuterSpacingStyle")]] }, { horizontalMargin: "10", verticalMargin: "20" });
    const at = ["Top Margin", "Bottom Margin", "Left Margin", "Right Margin"].map((label) => html.indexOf(label));
    expect(at.every((index) => index >= 0)).toBe(true);
    // Side order is fixed: top, bottom, left, right.
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Same strip: no strip boundary anywhere between the first and last.
    expect(html.slice(at[0], at[3])).not.toContain("builder-module-field-strip");
    // W7 forbids the abbreviations and the pair that preceded the sides.
    expect(html).not.toContain(">V Margin<");
    expect(html).not.toContain(">H Margin<");
    expect(html).not.toContain(">Vertical Margin<");
    expect(html).not.toContain(">Horizontal Margin<");
  });

  it("paddingFields yields all four sides, same order and names (W7)", () => {
    const html = render({ layout: [[...paddingFields("getModuleInnerSpacingStyle")]] });
    const at = ["Top Padding", "Bottom Padding", "Left Padding", "Right Padding"].map((label) => html.indexOf(label));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Padding controls never invent margin ones.
    expect(html).not.toContain("Margin");
  });

  it("renders advanced strips inside a hanging details block", () => {
    const html = render({
      advanced: [[{ key: "x", label: "AdvMarker", width: "num", control: "number", min: 0, max: 10 }]]
    });
    expect(html).toContain("hanging-details");
    expect(html.indexOf("<details")).toBeLessThan(html.indexOf("AdvMarker"));
  });

  it("hides fields whose visibleWhen returns false, and drops empty strips", () => {
    const schema: BuilderSettingsSchema = {
      content: [[{ key: "mega", label: "MegaOnly", width: "num", control: "number", min: 0, max: 5, visibleWhen: (s) => s.mode === "mega" }]]
    };
    expect(render(schema, { mode: "list" })).not.toContain("MegaOnly");
    expect(render(schema, { mode: "list" })).not.toContain("builder-module-field-strip");
    expect(render(schema, { mode: "mega" })).toContain("MegaOnly");
  });

  it("renders bare custom fields without the label wrapper", () => {
    const html = render({
      style: [[{ key: "bg", label: "ShouldNotAppear", width: "full", control: "custom", bare: true, render: () => <div>BareMarker</div> }]]
    });
    expect(html).toContain("BareMarker");
    expect(html).not.toContain("ShouldNotAppear");
    expect(html).not.toContain("builder-module-field-strip");
  });

  it("throws when a bare custom field shares a strip (misuse is loud, not silent)", () => {
    expect(() =>
      render({
        style: [[
          { key: "bg", label: "Bg", width: "full", control: "custom", bare: true, render: () => <div /> },
          { key: "other", label: "Other", width: "full", control: "text" }
        ]]
      })
    ).toThrow(/bare custom field/);
  });

  it("renders titled groups and distributes strips across columns (D4/D5)", () => {
    const html = render({
      content: {
        title: "General",
        columns: 2,
        strips: [
          [{ key: "a", label: "FieldA", width: "text-md", control: "text" }],
          [{ key: "b", label: "FieldB", width: "text-md", control: "text" }]
        ]
      }
    });
    expect(html).toContain("builder-schema-group-title");
    expect(html).toContain("General");
    expect((html.match(/builder-schema-group-column"/g) ?? []).length).toBe(2);
    // Contiguous split: A in the first column, B in the second.
    expect(html.indexOf("FieldA")).toBeLessThan(html.indexOf("FieldB"));
  });

  it("panelColumns arranges groups side by side, doctrine order left-to-right (D2)", () => {
    const html = render({
      panelColumns: [["content"], ["layout"], ["style"]],
      style: [[{ key: "c", label: "StyleMarker", width: "color", control: "color", dialogLabel: "c" }]],
      content: [[{ key: "a", label: "ContentMarker", width: "full", control: "text" }]],
      layout: [[{ key: "b", label: "LayoutMarker", width: "select-sm", control: "select", options: [{ value: "1", label: "1" }] }]],
      advanced: [[{ key: "d", label: "AdvMarker", width: "num", control: "number", min: 0, max: 9 }]]
    });
    expect((html.match(/builder-schema-panel-column"/g) ?? []).length).toBe(3);
    const order = ["ContentMarker", "LayoutMarker", "StyleMarker"].map((m) => html.indexOf(m));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Advanced never joins the columns — it renders after them, full width.
    expect(html.indexOf("AdvMarker")).toBeGreaterThan(html.indexOf("StyleMarker"));
    expect(html.indexOf("<details")).toBeGreaterThan(html.indexOf("builder-schema-panel-columns"));
  });

  it("plain array groups render exactly as before (backwards compatible)", () => {
    const html = render({ content: [[{ key: "a", label: "Alt", width: "full", control: "text" }]] });
    expect(html).toContain("builder-module-field-strip");
    expect(html).not.toContain("builder-schema-group-title");
    expect(html).not.toContain("builder-schema-panel-columns");
  });

  it("select and checkbox honour fallback and custom true values", () => {
    const html = render({
      content: [[
        { key: "size", label: "Size", width: "select-sm", control: "select", fallback: "50", options: [{ value: "50", label: "Half" }, { value: "100", label: "Full" }] },
        { key: "on", label: "On", width: "check", control: "checkbox", trueValue: "1", falseValue: "" }
      ]]
    }, { on: "1" });
    expect(html).toMatch(/<option value="50" selected(="")?>/);
    expect(html).toMatch(/<input type="checkbox" checked/);
  });
});

describe("columns by default (D2 — the opt-in that got forgotten)", () => {
  it("derives side-by-side columns when two or more narrow groups exist", () => {
    const html = render({
      content: [[{ key: "a", label: "AMark", width: "text-md", control: "text" }]],
      layout: [[{ key: "b", label: "BMark", width: "select-sm", control: "select", options: [{ value: "1", label: "1" }] }]]
    });
    expect((html.match(/builder-schema-panel-column"/g) ?? []).length).toBe(2);
    expect(html.indexOf("AMark")).toBeLessThan(html.indexOf("BMark"));
  });

  it("leaves a lone group full width — nothing to sit beside", () => {
    const html = render({ content: [[{ key: "a", label: "AMark", width: "text-md", control: "text" }]] });
    expect(html).not.toContain("builder-schema-panel-columns");
  });

  it("keeps wide groups (full-width fields, bare blocks) out of the columns", () => {
    const html = render({
      content: [[{ key: "a", label: "Wide", width: "full", control: "textarea" }]],
      layout: [[{ key: "b", label: "Narrow", width: "select-sm", control: "select", options: [{ value: "1", label: "1" }] }]]
    });
    // Only one narrow group remains, so no columns are forced on the wide one.
    expect(html).not.toContain("builder-schema-panel-columns");
  });

  it("never reorders groups to make columns — a wide group holds its place (E3)", () => {
    const html = render({
      content: [[{ key: "a", label: "ContentMark", width: "full", control: "textarea" }]],
      layout: [[{ key: "b", label: "LayoutMark", width: "select-sm", control: "select", options: [{ value: "1", label: "1" }] }]],
      style: [[{ key: "c", label: "StyleMark", width: "color", control: "color", dialogLabel: "c" }]]
    });
    const order = ["ContentMark", "LayoutMark", "StyleMark"].map((m) => html.indexOf(m));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    // layout + style are both narrow and adjacent, so they pair up.
    expect((html.match(/builder-schema-panel-column"/g) ?? []).length).toBe(2);
  });

  it("an explicit panelColumns still wins, including an empty opt-out", () => {
    const schema: BuilderSettingsSchema = {
      content: [[{ key: "a", label: "AMark", width: "text-md", control: "text" }]],
      layout: [[{ key: "b", label: "BMark", width: "text-md", control: "text" }]]
    };
    expect(render({ ...schema, panelColumns: [] })).not.toContain("builder-schema-panel-columns");
    expect((render({ ...schema, panelColumns: [["content", "layout"]] }).match(/builder-schema-panel-column"/g) ?? []).length).toBe(1);
  });
});

describe("logical axes (D8)", () => {
  it("renders each axis as a titled column in declaration order", () => {
    const html = render({
      axes: [
        { title: "Structure", strips: [[{ key: "a", label: "StructMark", width: "select-sm", control: "select", options: [{ value: "1", label: "1" }] }]] },
        { title: "Text", strips: [[{ key: "b", label: "TextMark", width: "num", control: "number", min: 0, max: 9 }]] },
        { title: "Placement", strips: [[{ key: "c", label: "PlaceMark", width: "align", control: "align", ariaLabel: "a" }]] }
      ]
    });
    expect((html.match(/builder-schema-panel-column"/g) ?? []).length).toBe(3);
    const order = ["Structure", "Text", "Placement"].map((t) => html.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.indexOf("StructMark")).toBeLessThan(html.indexOf("TextMark"));
  });

  it("throws on a fifth axis rather than rendering a cramped column", () => {
    const axis = (title: string) => ({
      title,
      strips: [[{ key: title, label: title, width: "num" as const, control: "number" as const, min: 0, max: 9 }]]
    });
    expect(() => render({ axes: [axis("A"), axis("B"), axis("C"), axis("D"), axis("E")] })).toThrow(/ceiling is 4/);
    expect(() => render({ axes: [axis("A"), axis("B"), axis("C"), axis("D")] })).not.toThrow();
  });

  it("keeps advanced below the axes, full width", () => {
    const html = render({
      axes: [{ title: "Structure", strips: [[{ key: "a", label: "StructMark", width: "num", control: "number", min: 0, max: 9 }]] }],
      advanced: [[{ key: "z", label: "AdvMark", width: "num", control: "number", min: 0, max: 9 }]]
    });
    expect(html.indexOf("AdvMark")).toBeGreaterThan(html.indexOf("StructMark"));
    expect(html).toContain("hanging-details");
  });

  it("drops an axis whose every field is hidden by visibleWhen", () => {
    const html = render({
      axes: [
        { title: "Structure", strips: [[{ key: "a", label: "StructMark", width: "num", control: "number", min: 0, max: 9 }]] },
        { title: "Frame", strips: [[{ key: "b", label: "FrameMark", width: "num", control: "number", min: 0, max: 9, visibleWhen: () => false }]] }
      ]
    });
    expect(html).toContain("StructMark");
    expect(html).not.toContain("FrameMark");
    expect(html).not.toContain("Frame</div>");
  });
});

describe("per-axis Advanced (operator 8/10)", () => {
  const axis = (title: string, extra: Record<string, unknown> = {}) => ({
    title,
    strips: [[{ key: `${title}-basic`, label: `${title}Basic`, width: "num" as const, control: "number" as const, min: 0, max: 9 }]],
    ...extra
  });

  it("renders an axis's advanced controls under its own heading", () => {
    const html = render({
      axes: [
        axis("Structure"),
        axis("Placement", {
          advanced: [[{ key: "offset", label: "OffsetMark", width: "num", control: "number", min: 0, max: 9 }]]
        })
      ]
    });
    expect(html).toContain("OffsetMark");
    // The advanced region carries the Placement heading, not a generic one.
    const advancedStart = html.indexOf("hanging-details");
    expect(html.slice(advancedStart)).toContain("Placement");
    // Structure has no advanced controls, so it contributes no heading there.
    expect(html.slice(advancedStart)).not.toContain("StructureBasic");
  });

  it("renders no Advanced region at all when no axis declares one", () => {
    const html = render({ axes: [axis("Structure"), axis("Text")] });
    expect(html).not.toContain("hanging-details");
  });

  it("counts theme overrides across axes in the Advanced summary (A3)", () => {
    const schema: BuilderSettingsSchema = {
      axes: [
        axis("Text", {
          advanced: [[{ key: "c1", label: "C1", width: "color", control: "theme-color", themeDefault: "#000000", dialogLabel: "c" }]]
        }),
        axis("Frame", {
          advanced: [[{ key: "c2", label: "C2", width: "color", control: "theme-color", themeDefault: "#111111", dialogLabel: "c" }]]
        })
      ]
    };
    expect(render(schema)).not.toContain("overriding the theme");
    expect(render(schema, { c1: "#ff0000" })).toContain("1 overriding the theme");
    expect(render(schema, { c1: "#ff0000", c2: "#00ff00" })).toContain("2 overriding the theme");
  });
});
