import { describe, expect, it } from "vitest";
import { normalizeBuilderModuleSettingsForType } from "./builder-template";
import {
  hasModuleDeviceOverrides,
  isModuleHiddenOnDevice,
  listModuleDeviceKeys,
  listModuleDeviceOverrideKeys,
  resetModuleDeviceOverride,
  resolveModuleDeviceValues,
  resolveModuleSettingsForDevice,
  setModuleHiddenOnDevice,
  writeModuleDeviceEdit
} from "./builder-module-device-overrides";

const heading = (extra: Record<string, string> = {}) => ({ marginTop: "10", fontSize: "48", ...extra });

describe("module device overrides", () => {
  it("stores only what differs, as a flat tablet./phone. key", () => {
    const next = writeModuleDeviceEdit(heading(), "heading", "phone", (current) => ({
      ...current,
      marginTop: "4"
    }));
    expect(next["phone.marginTop"]).toBe("4");
    expect(next.marginTop).toBe("10");
    expect(Object.keys(next).filter((key) => key.startsWith("phone."))).toEqual(["phone.marginTop"]);
  });

  it("removes an override put back to the value it would inherit", () => {
    const set = writeModuleDeviceEdit(heading(), "heading", "phone", (c) => ({ ...c, marginTop: "4" }));
    const back = writeModuleDeviceEdit(set, "heading", "phone", (c) => ({ ...c, marginTop: "10" }));
    expect(back["phone.marginTop"]).toBeUndefined();
    expect(hasModuleDeviceOverrides(back)).toBe(false);
  });

  it("follows desktop, then tablet, then phone", () => {
    const tablet = writeModuleDeviceEdit(heading(), "heading", "tablet", (c) => ({ ...c, fontSize: "36" }));
    expect(resolveModuleDeviceValues(tablet, "heading", "tablet").fontSize).toBe("36");
    expect(resolveModuleDeviceValues(tablet, "heading", "phone").fontSize).toBe("36");
    const phone = writeModuleDeviceEdit(tablet, "heading", "phone", (c) => ({ ...c, fontSize: "20" }));
    expect(resolveModuleDeviceValues(phone, "heading", "tablet").fontSize).toBe("36");
    expect(resolveModuleDeviceValues(phone, "heading", "phone").fontSize).toBe("20");
    expect(resolveModuleDeviceValues(phone, "heading", "desktop").fontSize).toBe("48");
  });

  it("reads the pre-device mobile fields as phone fallbacks", () => {
    const legacy = heading({ mobileFontSize: "18", mobileAlignment: "center", mobileHidden: "true" });
    const phone = resolveModuleDeviceValues(legacy, "heading", "phone");
    expect(phone.fontSize).toBe("18");
    expect(phone.alignment).toBe("center");
    expect(isModuleHiddenOnDevice(legacy, "heading", "phone")).toBe(true);
    // ...and only on the phone. A tablet still follows desktop.
    const tablet = resolveModuleDeviceValues(legacy, "heading", "tablet");
    expect(tablet.fontSize).toBe("48");
    expect(tablet.alignment).toBe("left");
    expect(isModuleHiddenOnDevice(legacy, "heading", "tablet")).toBe(false);
    // A legacy field alone is NOT an override — nothing new is stored.
    expect(hasModuleDeviceOverrides(legacy)).toBe(false);
  });

  it("lets a new phone value win over the legacy field it replaces, and retires that field", () => {
    const legacy = heading({ mobileFontSize: "18" });
    const next = writeModuleDeviceEdit(legacy, "heading", "phone", (c) => ({ ...c, fontSize: "14" }));
    expect(resolveModuleDeviceValues(next, "heading", "phone").fontSize).toBe("14");
    // The old field is GONE. Leaving it is what made the control dead below.
    expect(next.mobileFontSize).toBeUndefined();
  });

  /*
   * REVIEW ROUND 1, 2026-09-15. Every one of these is a control that accepted
   * an edit, reported success, and left the page rendering the legacy value —
   * because the writer's "what would I inherit?" baseline was tablet alone
   * while the reader's phone chain went through the legacy fields. Each is
   * written from the shipped functions' own measured output.
   */
  it("lets Hide on Phone be UNTICKED on a page carrying the old mobileHidden", () => {
    const legacy = heading({ mobileHidden: "true" });
    expect(isModuleHiddenOnDevice(legacy, "heading", "phone")).toBe(true);
    const shown = setModuleHiddenOnDevice(legacy, "heading", "phone", false);
    expect(isModuleHiddenOnDevice(shown, "heading", "phone")).toBe(false);
    expect(shown.mobileHidden).toBeUndefined();
  });

  it("lets a phone value be put BACK to desktop's on a page carrying a legacy field", () => {
    // The quiet half of the same fault: the panel accepted 48 and the phone
    // went on rendering 18, with nothing stored to show for the edit.
    const legacy = heading({ mobileFontSize: "18" });
    expect(resolveModuleDeviceValues(legacy, "heading", "phone").fontSize).toBe("18");
    const next = writeModuleDeviceEdit(legacy, "heading", "phone", (c) => ({ ...c, fontSize: "48" }));
    expect(resolveModuleDeviceValues(next, "heading", "phone").fontSize).toBe("48");
    // Following desktop again, so nothing is PINNED — a later desktop change
    // still reaches the phone.
    expect(next["phone.fontSize"]).toBeUndefined();
    expect(next.mobileFontSize).toBeUndefined();
  });

  it("retires only the legacy field for the key that was edited", () => {
    const legacy = heading({ mobileFontSize: "18", mobileAlignment: "center", mobileHidden: "true" });
    const next = writeModuleDeviceEdit(legacy, "heading", "phone", (c) => ({ ...c, fontSize: "14" }));
    expect(next.mobileFontSize).toBeUndefined();
    expect(next.mobileAlignment).toBe("center");
    expect(next.mobileHidden).toBe("true");
  });

  it("does not retire a legacy field when the edit was made on TABLET", () => {
    const legacy = heading({ mobileFontSize: "18" });
    const next = writeModuleDeviceEdit(legacy, "heading", "tablet", (c) => ({ ...c, fontSize: "30" }));
    expect(next.mobileFontSize).toBe("18");
    expect(resolveModuleDeviceValues(next, "heading", "tablet").fontSize).toBe("30");
    // The legacy field still sits below `phone.*` and above tablet.
    expect(resolveModuleDeviceValues(next, "heading", "phone").fontSize).toBe("18");
  });

  it("does not invent a legacy field on a module that never had one", () => {
    const next = writeModuleDeviceEdit(heading(), "heading", "phone", (c) => ({ ...c, fontSize: "14" }));
    expect("mobileFontSize" in next).toBe(false);
    expect("mobileHidden" in setModuleHiddenOnDevice(heading(), "heading", "phone", true)).toBe(false);
  });

  it("hides on tablet and lets the phone show it again", () => {
    const hidden = setModuleHiddenOnDevice(heading(), "heading", "tablet", true);
    expect(isModuleHiddenOnDevice(hidden, "heading", "tablet")).toBe(true);
    expect(isModuleHiddenOnDevice(hidden, "heading", "phone")).toBe(true);
    const shown = setModuleHiddenOnDevice(hidden, "heading", "phone", false);
    expect(isModuleHiddenOnDevice(shown, "heading", "tablet")).toBe(true);
    expect(isModuleHiddenOnDevice(shown, "heading", "phone")).toBe(false);
  });

  it("ignores an edit to a setting the device cannot hold", () => {
    const next = writeModuleDeviceEdit(heading(), "heading", "phone", (c) => ({ ...c, color: "#ff0000" }));
    expect(next["phone.color"]).toBeUndefined();
    expect(next.color).toBeUndefined();
  });

  it("offers font size only to the three types that have one, and Width only to text", () => {
    expect(listModuleDeviceKeys("heading")).toContain("fontSize");
    expect(listModuleDeviceKeys("headline-rotator")).toContain("fontSize");
    expect(listModuleDeviceKeys("poll-category-list")).toContain("fontSize");
    expect(listModuleDeviceKeys("image")).not.toContain("fontSize");
    expect(listModuleDeviceKeys("text")).toContain("size");
    expect(listModuleDeviceKeys("heading")).not.toContain("size");
  });

  it("offers line height and letter spacing to the Heading only, as on desktop", () => {
    expect(listModuleDeviceKeys("heading")).toEqual(expect.arrayContaining(["lineHeight", "letterSpacing"]));
    expect(listModuleDeviceKeys("text")).not.toContain("lineHeight");
    expect(listModuleDeviceKeys("headline-rotator")).not.toContain("letterSpacing");
  });

  it("stores a phone line height and letter spacing, clamped to the desktop ranges", () => {
    const next = writeModuleDeviceEdit(heading({ lineHeight: "1.2" }), "heading", "phone", (c) => ({
      ...c,
      lineHeight: "0.95",
      letterSpacing: "99"
    }));
    expect(next["phone.lineHeight"]).toBe("0.95");
    expect(next["phone.letterSpacing"]).toBe("20");
    // Put back to desktop's value, the override goes away rather than pinning.
    const back = writeModuleDeviceEdit(next, "heading", "phone", (c) => ({ ...c, lineHeight: "1.2" }));
    expect(back["phone.lineHeight"]).toBeUndefined();
  });

  it("takes each type's own font-size default as desktop's value", () => {
    expect(resolveModuleDeviceValues({}, "heading", "desktop").fontSize).toBe("32");
    expect(resolveModuleDeviceValues({}, "headline-rotator", "desktop").fontSize).toBe("32");
    expect(resolveModuleDeviceValues({}, "poll-category-list", "desktop").fontSize).toBe("18");
  });

  it("reads the pre-2026-08-11 margin pair when a side has no key of its own", () => {
    expect(resolveModuleDeviceValues({ verticalMargin: "24" }, "text", "desktop").marginTop).toBe("24");
    expect(resolveModuleDeviceValues({ horizontalMargin: "12" }, "text", "desktop").marginRight).toBe("12");
  });

  it("resets one override, or all of them", () => {
    let settings = writeModuleDeviceEdit(heading(), "heading", "phone", (c) => ({ ...c, marginTop: "4" }));
    settings = writeModuleDeviceEdit(settings, "heading", "phone", (c) => ({ ...c, fontSize: "16" }));
    expect(listModuleDeviceOverrideKeys(settings, "phone").sort()).toEqual(["fontSize", "marginTop"]);
    const one = resetModuleDeviceOverride(settings, "phone", "fontSize");
    expect(listModuleDeviceOverrideKeys(one, "phone")).toEqual(["marginTop"]);
    expect(listModuleDeviceOverrideKeys(resetModuleDeviceOverride(settings, "phone"), "phone")).toEqual([]);
  });

  it("hands the panel a flat settings object with no hidden key in it", () => {
    const settings = setModuleHiddenOnDevice(heading(), "heading", "phone", true);
    const resolved = resolveModuleSettingsForDevice(settings, "heading", "phone");
    expect(resolved.hidden).toBeUndefined();
    expect(resolved.fontSize).toBe("48");
  });

  /*
   * The storage decision this whole slice rests on: a device value is a flat
   * settings key, and the two functions every save runs it through must leave
   * it alone. `migrateSpacingPairToSides` is the one to watch — it rewrites
   * `marginTop` on every save, and `tablet.marginTop` is one character away.
   */
  it("survives the save normalizer untouched, margins included", () => {
    const saved = normalizeBuilderModuleSettingsForType("heading", {
      marginTop: "10",
      verticalMargin: "24",
      "tablet.marginTop": "6",
      "phone.marginTop": "4",
      "phone.fontSize": "16",
      "phone.hidden": "true"
    });
    expect(saved["tablet.marginTop"]).toBe("6");
    expect(saved["phone.marginTop"]).toBe("4");
    expect(saved["phone.fontSize"]).toBe("16");
    expect(saved["phone.hidden"]).toBe("true");
    // ...and the desktop migration still did its own job.
    expect(saved.marginTop).toBe("10");
    expect(saved.verticalMargin).toBeUndefined();
    // Read back through the resolver, a saved page still says what it meant.
    expect(resolveModuleDeviceValues(saved, "heading", "phone").marginTop).toBe("4");
    expect(isModuleHiddenOnDevice(saved, "heading", "phone")).toBe(true);
  });
});
