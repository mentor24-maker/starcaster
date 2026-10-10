import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultBackgroundSettings,
  normalizeLayoutSections,
  normalizeModuleZIndexValue
} from "@/lib/builder-template";
import { getModuleStackStyle } from "./builder/builder-utils";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Z-Index on a flow module (task 86bcgc7xq). The operator nudged a headline
 * over an image with Vertical Offset and the image painted over it: two
 * overlapping modules stacked in page order and nothing could say otherwise.
 */

function renderRows(rows: unknown[]) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections(rows)}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

function row(modules: Array<Record<string, unknown>>) {
  return {
    id: "row-1",
    title: "Hero",
    layout: "single",
    background: { mode: "color", color: "#ffffff" },
    modules: modules.map((module, index) => ({ id: `m${index + 1}`, column: "main", ...module }))
  };
}

/** The wrapper div's opening tag, where the setting must land. */
function moduleWrapperTag(html: string) {
  return html.match(/<div[^>]*class="builder-preview-module [^"]*"[^>]*>/)?.[0] ?? "";
}

describe("module Z-Index — the setting", () => {
  it("reads 0 for blank, missing and unreadable values, never a deleted key", () => {
    expect(normalizeModuleZIndexValue(undefined)).toBe("0");
    expect(normalizeModuleZIndexValue("")).toBe("0");
    expect(normalizeModuleZIndexValue("top")).toBe("0");
  });

  it("keeps the Floating Image's range so the two fields read the same number the same way", () => {
    expect(normalizeModuleZIndexValue("2")).toBe("2");
    expect(normalizeModuleZIndexValue("-5000")).toBe("-999");
    expect(normalizeModuleZIndexValue("5000000")).toBe("999999");
  });

  it("emits nothing at all while the value is 0 or unset — page order, exactly as before", () => {
    expect(getModuleStackStyle({})).toEqual({});
    expect(getModuleStackStyle({ zIndex: "0" })).toEqual({});
    expect(getModuleStackStyle({ zIndex: "" })).toEqual({});
  });

  it("positions the wrapper and stacks it when a value is set", () => {
    expect(getModuleStackStyle({ zIndex: "2" })).toEqual({ position: "relative", zIndex: 2 });
    expect(getModuleStackStyle({ zIndex: "-1" })).toEqual({ position: "relative", zIndex: -1 });
  });
});

describe("module Z-Index — normalize", () => {
  it("survives a save on every module that offers it, including the image, which used to strip it", () => {
    const [section] = normalizeLayoutSections([
      row([
        { type: "heading", text: "Headline", settings: { zIndex: "7" } },
        { type: "image", settings: { url: "/x.png", zIndex: "3" } },
        { type: "carousel", settings: { zIndex: "4" } },
        { type: "navigation", settings: { zIndex: "5" } }
      ])
    ]);
    expect(section.modules.map((module) => module.settings.zIndex)).toEqual(["7", "3", "4", "5"]);
  });

  it("does not stamp the key onto a module that never had one", () => {
    const [section] = normalizeLayoutSections([
      row([{ type: "heading", text: "Headline", settings: {} }, { type: "image", settings: { url: "/x.png" } }])
    ]);
    expect(section.modules.every((module) => !("zIndex" in module.settings))).toBe(true);
  });

  it("clamps a value an imported page may carry", () => {
    const [section] = normalizeLayoutSections([
      row([{ type: "heading", text: "Headline", settings: { zIndex: "99999999" } }])
    ]);
    expect(section.modules[0].settings.zIndex).toBe("999999");
  });
});

describe("module Z-Index — render", () => {
  it("lands on the module WRAPPER, the box that is a sibling of the other modules", () => {
    const html = renderRows([
      row([{ type: "heading", text: "Headline", settings: { verticalOffset: "-60", zIndex: "2" } }])
    ]);
    const wrapper = moduleWrapperTag(html);
    expect(wrapper).toContain("z-index:2");
    expect(wrapper).toContain("position:relative");
  });

  it("renders a module with no Z-Index exactly as before: no z-index on its wrapper", () => {
    const html = renderRows([
      row([{ type: "heading", text: "Headline", settings: { verticalOffset: "-60" } }])
    ]);
    expect(moduleWrapperTag(html)).not.toContain("z-index");
  });

  it("stacks behind on a negative value", () => {
    const html = renderRows([row([{ type: "heading", text: "Headline", settings: { zIndex: "-1" } }])]);
    expect(moduleWrapperTag(html)).toContain("z-index:-1");
  });
});
