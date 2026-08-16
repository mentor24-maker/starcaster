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

  it("marginFields matches the two sides of each axis into one row (E4b)", () => {
    // Sides equal (here through the legacy pair the renderer resolves) is the
    // matched case: two rows, vertical then horizontal, in one strip.
    const html = render({ layout: [[...marginFields("getModuleOuterSpacingStyle")]] }, { horizontalMargin: "10", verticalMargin: "20" });
    const at = ["V Margin", "H Margin"].map((label) => html.indexOf(label));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Same strip: no strip boundary anywhere between the first and last.
    expect(html.slice(at[0], at[1])).not.toContain("builder-module-field-strip");
    // Matched means matched — the four side rows are not also on screen.
    expect(html).not.toContain(">Top Margin<");
    expect(html).not.toContain(">Left Margin<");
    // The legacy values are what each side reads through (20 vertical, 10
    // horizontal), so the rows show the numbers the page is rendering.
    expect(html).toContain('<option value="20" selected="">20</option>');
    expect(html).toContain('<option value="10" selected="">10</option>');
    // W7's retired spellings stay retired — V/H is a display mode over the
    // four side keys, not the old vertical/horizontal setting coming back.
    expect(html).not.toContain(">Vertical Margin<");
    expect(html).not.toContain(">Horizontal Margin<");
  });

  it("splits an axis into its two sides when their values differ (E4b)", () => {
    const html = render(
      { layout: [[...marginFields("getModuleOuterSpacingStyle")]] },
      { marginTop: "20", marginBottom: "5", marginLeft: "0", marginRight: "0" }
    );
    // Vertical differs, so it shows both sides, in Top/Bottom order (E4).
    const at = ["Top Margin", "Bottom Margin"].map((label) => html.indexOf(label));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).not.toContain(">V Margin<");
    // Horizontal still matches, so it stays on one row. The two axes are
    // independent — splitting one does not split the other.
    expect(html).toContain(">H Margin<");
  });

  it("declares two axes over the four SIDE keys, not a vertical/horizontal setting (E4)", () => {
    // Matching is a display mode: the data model is unchanged, which is what
    // keeps E4's "no padding above, keep the padding on the left" reachable.
    // What the rows actually write is covered in builder-spacing-fields.test.
    const fields = marginFields("getModuleOuterSpacingStyle");
    expect(fields).toHaveLength(2);
    const keys = fields.flatMap((field) =>
      field.control === "spacing-pair" ? field.spec.sides.map((side) => side.key) : ["not-a-pair"]
    );
    expect(keys).toEqual(["marginTop", "marginBottom", "marginLeft", "marginRight"]);
  });

  it("paddingFields matches its axes the same way, with padding names (E4b)", () => {
    const html = render({ layout: [[...paddingFields("getModuleInnerSpacingStyle")]] });
    const at = ["V Padding", "H Padding"].map((label) => html.indexOf(label));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Padding controls never invent margin ones.
    expect(html).not.toContain("Margin");
  });

  it("every spacing row can reach its two sides — the toggle is never absent", () => {
    // A0's guard, in the E4b shape: the sides are one click away IN PLACE,
    // never behind a collapse and never gone. A matched row with no toggle
    // would be the old vertical/horizontal pair E4 exists to forbid.
    const matched = render({ layout: [[...marginFields("getModuleOuterSpacingStyle")]] });
    expect(matched.match(/builder-spacing-link-toggle/g) ?? []).toHaveLength(2);
    const split = render(
      { layout: [[...marginFields("getModuleOuterSpacingStyle")]] },
      { marginTop: "20", marginBottom: "5" }
    );
    // Split: one toggle on the axis that is open (on its first row only, so
    // relinking has one predictable winner) plus one on the matched axis.
    expect(split.match(/builder-spacing-link-toggle/g) ?? []).toHaveLength(2);
    expect(split).toContain('aria-label="Match Top Margin and Bottom Margin"');
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
