import { describe, expect, it } from "vitest";
import { createEmptySection, normalizeBuilderSection, type BuilderTemplateSection } from "./builder-template";
import {
  isCellHiddenOnDevice,
  isSectionHiddenOnDevice,
  resetCellDeviceOverride,
  resetSectionDeviceOverride,
  resolveCellDeviceValues,
  resolveSectionForCellDevice,
  resolveSectionForDevice,
  setCellHiddenOnDevice,
  setSectionHiddenOnDevice,
  writeCellDeviceEdit,
  writeSectionDeviceEdit
} from "./builder-device-overrides";

/**
 * Tablet and phone FOLLOW desktop until a setting is changed on them
 * (Dane, 2026-09-15). These hold the two halves of that promise: only what
 * differs is stored, and a later desktop change still reaches every screen
 * that never asked to be different.
 */
function row(): BuilderTemplateSection {
  return createEmptySection("single");
}

describe("per-device row styles", () => {
  it("stores only the setting that was changed, as the device's own value", () => {
    const next = writeSectionDeviceEdit(row(), "phone", (current) => ({ ...current, paddingTop: "60" }));
    expect(next.deviceOverrides).toEqual({ phone: { paddingTop: "60" } });
    expect(next.paddingTop).toBe("18");
    expect(resolveSectionForDevice(next, "phone").paddingTop).toBe("60");
  });

  it("removes the value, rather than pinning it, when it is set back to what the device inherits", () => {
    const changed = writeSectionDeviceEdit(row(), "phone", (current) => ({ ...current, paddingTop: "60" }));
    const back = writeSectionDeviceEdit(changed, "phone", (current) => ({ ...current, paddingTop: "18" }));
    expect(back.deviceOverrides).toBeUndefined();
    expect("deviceOverrides" in back).toBe(false);
  });

  it("lets a later desktop change reach a device that never changed that setting", () => {
    const phoneGap = writeSectionDeviceEdit(row(), "phone", (current) => ({ ...current, columnGap: "4" }));
    const desktopEdit = { ...phoneGap, paddingTop: "40" };
    expect(resolveSectionForDevice(desktopEdit, "phone").paddingTop).toBe("40");
    expect(resolveSectionForDevice(desktopEdit, "phone").columnGap).toBe("4");
  });

  it("passes a tablet change down to phone unless phone has its own value", () => {
    let section = writeSectionDeviceEdit(row(), "tablet", (current) => ({ ...current, paddingTop: "30", marginTop: "10" }));
    section = writeSectionDeviceEdit(section, "phone", (current) => ({ ...current, marginTop: "0" }));
    const phone = resolveSectionForDevice(section, "phone");
    expect(phone.paddingTop).toBe("30");
    expect(phone.marginTop).toBe("0");
    // Phone matching DESKTOP but not tablet is a real difference and is kept.
    expect(section.deviceOverrides?.phone).toEqual({ marginTop: "0" });
  });

  it("ignores edits to settings a device cannot hold", () => {
    const next = writeSectionDeviceEdit(row(), "tablet", (current) => ({ ...current, layout: "two-column" }));
    expect(next.layout).toBe("single");
    expect(next.deviceOverrides).toBeUndefined();
  });

  it("hides on tablet and phone, and lets phone show the row again", () => {
    const hiddenOnTablet = setSectionHiddenOnDevice(row(), "tablet", true);
    expect(isSectionHiddenOnDevice(hiddenOnTablet, "desktop")).toBe(false);
    expect(isSectionHiddenOnDevice(hiddenOnTablet, "phone")).toBe(true);
    const shownOnPhone = setSectionHiddenOnDevice(hiddenOnTablet, "phone", false);
    expect(isSectionHiddenOnDevice(shownOnPhone, "phone")).toBe(false);
    expect(isSectionHiddenOnDevice(shownOnPhone, "tablet")).toBe(true);
  });

  it("resets one setting, or all of them", () => {
    let section = writeSectionDeviceEdit(row(), "phone", (current) => ({ ...current, paddingTop: "60", columnGap: "4" }));
    section = resetSectionDeviceOverride(section, "phone", "paddingTop");
    expect(section.deviceOverrides).toEqual({ phone: { columnGap: "4" } });
    expect(resetSectionDeviceOverride(section, "phone").deviceOverrides).toBeUndefined();
  });

  it("survives normalization, cleaning each value the way its desktop field is cleaned", () => {
    const saved = normalizeBuilderSection({
      ...row(),
      deviceOverrides: {
        phone: { paddingTop: "999", bogus: "x", rowBorderStyle: "wavy", hidden: "TRUE" },
        tablet: {},
        watch: { paddingTop: "4" }
      }
    });
    expect(saved?.deviceOverrides).toEqual({ phone: { paddingTop: "160", rowBorderStyle: "solid", hidden: "true" } });
  });

  it("adds no key at all to a row nobody changed on a device", () => {
    const saved = normalizeBuilderSection(row());
    expect(saved && "deviceOverrides" in saved).toBe(false);
  });
});

describe("per-device cell styles", () => {
  // A single-column row's one column is keyed "main"; two columns are
  // "left" and "right" (`getLayoutColumns`), and the device map is keyed by
  // exactly those, so a test using the wrong key would be normalized away.
  const CELL = "main";
  const setPadding = (section: BuilderTemplateSection, value: string) => (current: BuilderTemplateSection) => ({
    ...current,
    cellPaddingTop: { ...current.cellPaddingTop, [CELL]: value }
  });

  it("stores only the setting that was changed, as that cell's own value", () => {
    const next = writeCellDeviceEdit(row(), CELL, "phone", setPadding(row(), "40"));
    expect(next.cellDeviceOverrides).toEqual({ phone: { [CELL]: { cellPaddingTop: "40" } } });
    expect(next.cellPaddingTop[CELL]).toBe("0");
    expect(resolveCellDeviceValues(next, CELL, "phone").cellPaddingTop).toBe("40");
  });

  it("leaves the OTHER columns alone", () => {
    const next = writeCellDeviceEdit(createEmptySection("two-column"), "left", "phone", (current) => ({
      ...current,
      cellPaddingTop: { ...current.cellPaddingTop, left: "40" }
    }));
    expect(Object.keys(next.cellDeviceOverrides?.phone ?? {})).toEqual(["left"]);
    expect(resolveCellDeviceValues(next, "right", "phone").cellPaddingTop).toBe("0");
  });

  it("removes the value, rather than pinning it, when it is set back to what the cell inherits", () => {
    const changed = writeCellDeviceEdit(row(), CELL, "phone", setPadding(row(), "40"));
    const back = writeCellDeviceEdit(changed, CELL, "phone", setPadding(changed, "0"));
    expect(back.cellDeviceOverrides).toBeUndefined();
    expect("cellDeviceOverrides" in back).toBe(false);
  });

  it("lets a later desktop change reach a cell that never changed that setting", () => {
    const phonePadding = writeCellDeviceEdit(row(), CELL, "phone", setPadding(row(), "40"));
    const desktopEdit = {
      ...phonePadding,
      cellMarginTop: { ...phonePadding.cellMarginTop, [CELL]: "24" }
    };
    expect(resolveCellDeviceValues(desktopEdit, CELL, "phone").cellMarginTop).toBe("24");
    expect(resolveCellDeviceValues(desktopEdit, CELL, "phone").cellPaddingTop).toBe("40");
  });

  it("passes a tablet change down to phone unless phone has its own value", () => {
    let section = writeCellDeviceEdit(row(), CELL, "tablet", (current) => ({
      ...current,
      cellPaddingTop: { ...current.cellPaddingTop, [CELL]: "20" },
      cellHAlign: { ...current.cellHAlign, [CELL]: "center" }
    }));
    section = writeCellDeviceEdit(section, CELL, "phone", (current) => ({
      ...current,
      cellHAlign: { ...current.cellHAlign, [CELL]: "left" }
    }));
    const phone = resolveCellDeviceValues(section, CELL, "phone");
    expect(phone.cellPaddingTop).toBe("20");
    expect(phone.cellHAlign).toBe("left");
    // Phone matching DESKTOP but not tablet is a real difference and is kept.
    expect(section.cellDeviceOverrides?.phone?.[CELL]).toEqual({ cellHAlign: "left" });
  });

  it("inherits from the padding pair a cell was saved with, so an edit back to it stores nothing", () => {
    /*
     * A row from before the four-sides split (2026-08-11): no `cellPaddingTop`
     * entry at all for this column, the number living in the vertical/
     * horizontal PAIR underneath. The renderer reads that chain, so the
     * device inheritance has to read the same one — otherwise the cell would
     * inherit 0 while painting 30, and every phone edit would be stored as a
     * difference from a number nobody can see.
     */
    const legacy = {
      ...row(),
      cellPaddingTop: {},
      cellVerticalPadding: { [CELL]: "30" }
    } as unknown as BuilderTemplateSection;
    expect(resolveCellDeviceValues(legacy, CELL, "phone").cellPaddingTop).toBe("30");
    const next = writeCellDeviceEdit(legacy, CELL, "phone", setPadding(legacy, "30"));
    expect(next.cellDeviceOverrides).toBeUndefined();
  });

  it("ignores edits to cell settings a device cannot hold", () => {
    const next = writeCellDeviceEdit(row(), CELL, "tablet", (current) => ({
      ...current,
      cellShadow: { ...current.cellShadow, [CELL]: "heavy" }
    }));
    expect(next.cellDeviceOverrides).toBeUndefined();
  });

  it("hides on tablet and phone, and lets phone show the cell again", () => {
    const hiddenOnTablet = setCellHiddenOnDevice(row(), CELL, "tablet", true);
    expect(isCellHiddenOnDevice(hiddenOnTablet, CELL, "desktop")).toBe(false);
    expect(isCellHiddenOnDevice(hiddenOnTablet, CELL, "phone")).toBe(true);
    const shownOnPhone = setCellHiddenOnDevice(hiddenOnTablet, CELL, "phone", false);
    expect(isCellHiddenOnDevice(shownOnPhone, CELL, "phone")).toBe(false);
    expect(isCellHiddenOnDevice(shownOnPhone, CELL, "tablet")).toBe(true);
  });

  it("reads the old Hide on Mobile as a phone value, and retires it once this control is used", () => {
    const legacy = { ...row(), cellMobileHidden: { ...row().cellMobileHidden, [CELL]: "true" } };
    expect(isCellHiddenOnDevice(legacy, CELL, "phone")).toBe(true);
    expect(isCellHiddenOnDevice(legacy, CELL, "tablet")).toBe(false);
    // Unticking has to actually show the column: leaving the old field set
    // would have the device map say "follows desktop" while it went on hiding.
    const shown = setCellHiddenOnDevice(legacy, CELL, "phone", false);
    expect(shown.cellMobileHidden[CELL]).toBe("false");
    expect(isCellHiddenOnDevice(shown, CELL, "phone")).toBe(false);
    expect(shown.cellDeviceOverrides).toBeUndefined();
  });

  it("resets one setting, or all of them, for one cell", () => {
    let section = writeCellDeviceEdit(row(), CELL, "phone", (current) => ({
      ...current,
      cellPaddingTop: { ...current.cellPaddingTop, [CELL]: "40" },
      cellBorderRadius: { ...current.cellBorderRadius, [CELL]: "10" }
    }));
    section = resetCellDeviceOverride(section, CELL, "phone", "cellPaddingTop");
    expect(section.cellDeviceOverrides).toEqual({ phone: { [CELL]: { cellBorderRadius: "10" } } });
    expect(resetCellDeviceOverride(section, CELL, "phone").cellDeviceOverrides).toBeUndefined();
  });

  it("resolves the whole row for a device, writing each cell's values into the maps the renderer reads", () => {
    const section = writeCellDeviceEdit(createEmptySection("two-column"), "right", "phone", (current) => ({
      ...current,
      cellPaddingTop: { ...current.cellPaddingTop, right: "40" }
    }));
    const phone = resolveSectionForCellDevice(section, "phone");
    expect(phone.cellPaddingTop.right).toBe("40");
    expect(phone.cellPaddingTop.left).toBe("0");
    expect(resolveSectionForCellDevice(section, "desktop").cellPaddingTop.right).toBe("0");
  });

  it("survives normalization, cleaning each value the way its desktop field is cleaned", () => {
    const saved = normalizeBuilderSection({
      ...row(),
      cellDeviceOverrides: {
        // 999 caps at the CELL padding maximum of 50, not the row's 160.
        phone: { [CELL]: { cellPaddingTop: "999", bogus: "x", hidden: "TRUE" }, nosuchcolumn: { cellPaddingTop: "4" } },
        tablet: { [CELL]: {} },
        watch: { [CELL]: { cellPaddingTop: "4" } }
      }
    });
    expect(saved?.cellDeviceOverrides).toEqual({ phone: { [CELL]: { cellPaddingTop: "50", hidden: "true" } } });
  });

  it("adds no key at all to a row nobody changed on a device", () => {
    const saved = normalizeBuilderSection(row());
    expect(saved && "cellDeviceOverrides" in saved).toBe(false);
  });
});
