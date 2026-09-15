import { describe, expect, it } from "vitest";
import type { CSSProperties } from "react";
import { createEmptySection, type BuilderTemplateSection } from "@/lib/builder-template";
import { setSectionHiddenOnDevice, writeSectionDeviceEdit } from "@/lib/builder-device-overrides";
import { getSectionHorizontalMarginStyle, getSectionPaddingStyle } from "./builder-utils";
import { buildSectionDeviceCss } from "./builder-device-css";

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
