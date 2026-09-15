import { describe, expect, it } from "vitest";
import { createEmptySection, normalizeBuilderSection, type BuilderTemplateSection } from "./builder-template";
import {
  isSectionHiddenOnDevice,
  resetSectionDeviceOverride,
  resolveSectionForDevice,
  setSectionHiddenOnDevice,
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
