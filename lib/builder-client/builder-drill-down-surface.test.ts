import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";
import {
  resolveBuilderDrillDownSurfaceBackground,
  sanitizeCellBackgroundForDrillDown,
  usesBuilderDrillDownSurfaceDefault
} from "@/lib/builder-drill-down-surface";

describe("builder drill-down surfaces", () => {
  it("treats decorative style presets as hierarchy defaults", () => {
    expect(
      usesBuilderDrillDownSurfaceDefault({
        mode: "style",
        color: "#ffffff",
        color2: "#eaf4ff",
        imageUrl: "",
        styleKey: "blue-yellow-circles"
      })
    ).toBe(true);
  });

  it("resolves cell tier to the row-body background token", () => {
    expect(resolveBuilderDrillDownSurfaceBackground(createDefaultBackgroundSettings(), "cell")).toEqual({
      background: "var(--builder-bg-cell)"
    });
  });

  it("resolves column tier to the column background token", () => {
    expect(resolveBuilderDrillDownSurfaceBackground(createDefaultBackgroundSettings(), "column")).toEqual({
      background: "var(--builder-bg-column)"
    });
  });

  it("sanitizes decorative cell backgrounds back to none", () => {
    expect(
      sanitizeCellBackgroundForDrillDown({
        mode: "style",
        color: "#ffffff",
        color2: "#eaf4ff",
        imageUrl: "",
        styleKey: "blue-yellow-circles"
      })
    ).toEqual(createDefaultBackgroundSettings());
  });
});
