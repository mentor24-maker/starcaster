import { describe, expect, it } from "vitest";
import type { CSSProperties } from "react";
import { createEmptySection, type BuilderTemplateSection } from "@/lib/builder-template";
import {
  setCellHiddenOnDevice,
  setSectionHiddenOnDevice,
  writeCellDeviceEdit,
  writeSectionDeviceEdit
} from "@/lib/builder-device-overrides";
import {
  getCellContentAlignmentStyle,
  getSectionHorizontalMarginStyle,
  getSectionPaddingStyle
} from "./builder-utils";
import { buildCellDeviceCss, buildSectionDeviceCss } from "./builder-device-css";

// A cut-down version of the renderer's style builder: the function under test
// must only ever emit what this produces differently per device.
const styleOf = (section: BuilderTemplateSection): CSSProperties => ({
  display: "grid",
  ...getSectionPaddingStyle(section),
  ...getSectionHorizontalMarginStyle(section)
});

describe("buildSectionDeviceCss", () => {
  it("emits nothing for a row with no device settings", () => {
    expect(buildSectionDeviceCss(createEmptySection("single"), "r1", styleOf)).toBe("");
  });

  it("emits only the differing declaration, important, under the phone query and the phone preview frame", () => {
    const section = writeSectionDeviceEdit(createEmptySection("single"), "phone", (current) => ({
      ...current,
      paddingTop: "60"
    }));
    const css = buildSectionDeviceCss(section, "r1", styleOf);
    expect(css).toBe(
      '@media (max-width:767px){[data-builder-device-scope="r1"]{--builder-section-padding-top:60px !important}}\n' +
        '.builder-preview-device-mobile [data-builder-device-scope="r1"]{--builder-section-padding-top:60px !important}'
    );
    expect(css).not.toContain("1024px");
  });

  it("writes an explicit neutral value when a device removes a style desktop sets", () => {
    const desktop = { ...createEmptySection("single"), marginLeft: "40" };
    const section = writeSectionDeviceEdit(desktop, "tablet", (current) => ({ ...current, marginLeft: "0" }));
    const css = buildSectionDeviceCss(section, "r1", styleOf);
    expect(css).toContain("@media (max-width:1024px)");
    expect(css).toContain("margin-left:0px !important");
  });

  it("hides with display none, and a phone showing a tablet-hidden row restores the display", () => {
    const hidden = setSectionHiddenOnDevice(createEmptySection("single"), "tablet", true);
    expect(buildSectionDeviceCss(hidden, "r1", styleOf)).toContain("display:none !important");
    const shown = setSectionHiddenOnDevice(hidden, "phone", false);
    const phoneRule = buildSectionDeviceCss(shown, "r1", styleOf).split("\n")[1];
    expect(phoneRule).toContain("display:grid !important");
  });

  it("cannot be broken out of its selector by the scope string", () => {
    const section = setSectionHiddenOnDevice(createEmptySection("single"), "phone", true);
    expect(buildSectionDeviceCss(section, '"]</style><script>', styleOf)).not.toMatch(/<|"\]"/);
  });
});

// A cut-down version of the renderer's COLUMN style builder, bound to one
// column — the same shape `buildBuilderColumnStyle` takes.
const cellStyleOf = (column: string) => (section: BuilderTemplateSection): CSSProperties => ({
  padding: `${section.cellPaddingTop?.[column] ?? "0"}px 0px 0px 0px`,
  ...(Number(section.cellBorderWidth?.[column] ?? "0") > 0
    ? { border: `${section.cellBorderWidth?.[column]}px solid #000000` }
    : {}),
  ...getCellContentAlignmentStyle(section.cellHAlign?.[column] ?? "left", section.cellVAlign?.[column] ?? "top")
});

const CELL = "main";
const setCellPadding = (value: string) => (current: BuilderTemplateSection) => ({
  ...current,
  cellPaddingTop: { ...current.cellPaddingTop, [CELL]: value }
});

describe("buildCellDeviceCss", () => {
  it("emits nothing for a cell with no device settings", () => {
    expect(buildCellDeviceCss(createEmptySection("single"), CELL, "c1", cellStyleOf(CELL))).toBe("");
  });

  it("emits only the differing declaration, important, under the phone query and the phone preview frame", () => {
    const section = writeCellDeviceEdit(createEmptySection("single"), CELL, "phone", setCellPadding("40"));
    const css = buildCellDeviceCss(section, CELL, "c1", cellStyleOf(CELL));
    expect(css).toBe(
      '@media (max-width:767px){[data-builder-device-scope="c1"]{padding:40px 0px 0px 0px !important}}\n' +
        '.builder-preview-device-mobile [data-builder-device-scope="c1"]{padding:40px 0px 0px 0px !important}'
    );
    expect(css).not.toContain("1024px");
  });

  it("emits nothing for a column its neighbour changed", () => {
    const section = writeCellDeviceEdit(createEmptySection("two-column"), "left", "phone", (current) => ({
      ...current,
      cellPaddingTop: { ...current.cellPaddingTop, left: "40" }
    }));
    expect(buildCellDeviceCss(section, "left", "c1", cellStyleOf("left"))).not.toBe("");
    expect(buildCellDeviceCss(section, "right", "c2", cellStyleOf("right"))).toBe("");
  });

  it("writes an explicit neutral value when a device removes a style desktop sets", () => {
    const desktop = {
      ...createEmptySection("single"),
      cellBorderWidth: { [CELL]: "4" }
    } as BuilderTemplateSection;
    const section = writeCellDeviceEdit(desktop, CELL, "tablet", (current) => ({
      ...current,
      cellBorderWidth: { ...current.cellBorderWidth, [CELL]: "0" }
    }));
    const css = buildCellDeviceCss(section, CELL, "c1", cellStyleOf(CELL));
    expect(css).toContain("@media (max-width:1024px)");
    expect(css).toContain("border:none !important");
  });

  it("puts a column's display back to grid, never initial, when it stops being aligned", () => {
    // `display: initial` is `inline`, which collapses the whole column — the
    // one property a shared neutral would have got wrong for a cell.
    const desktop = {
      ...createEmptySection("single"),
      cellHAlign: { [CELL]: "center" }
    } as BuilderTemplateSection;
    const section = writeCellDeviceEdit(desktop, CELL, "phone", (current) => ({
      ...current,
      cellHAlign: { ...current.cellHAlign, [CELL]: "left" }
    }));
    const css = buildCellDeviceCss(section, CELL, "c1", cellStyleOf(CELL));
    expect(css).toContain("display:grid !important");
    expect(css).not.toContain("display:initial");
  });

  it("hides with display none, and a phone showing a tablet-hidden cell restores the display", () => {
    const hidden = setCellHiddenOnDevice(createEmptySection("single"), CELL, "tablet", true);
    expect(buildCellDeviceCss(hidden, CELL, "c1", cellStyleOf(CELL))).toContain("display:none !important");
    const shown = setCellHiddenOnDevice(hidden, CELL, "phone", false);
    const phoneRule = buildCellDeviceCss(shown, CELL, "c1", cellStyleOf(CELL)).split("\n")[1];
    expect(phoneRule).toContain("display:grid !important");
  });

  it("cannot be broken out of its selector by the scope string", () => {
    const section = setCellHiddenOnDevice(createEmptySection("single"), CELL, "phone", true);
    expect(buildCellDeviceCss(section, CELL, '"]</style><script>', cellStyleOf(CELL))).not.toMatch(/<|"\]"/);
  });
});
