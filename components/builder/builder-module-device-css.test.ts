import { describe, expect, it } from "vitest";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  setModuleHiddenOnDevice,
  writeModuleDeviceEdit
} from "@/lib/builder-module-device-overrides";
import { buildModuleDeviceCss } from "./builder-module-device-css";

const moduleOf = (
  type: string,
  settings: Record<string, string> = {}
): BuilderTemplateModule =>
  ({ id: "m1", type, column: "left", name: "", text: "", settings } as unknown as BuilderTemplateModule);

const edit = (module: BuilderTemplateModule, device: "tablet" | "phone", patch: Record<string, string>) =>
  moduleOf(String(module.type), writeModuleDeviceEdit(module.settings, module.type, device, (current) => ({
    ...current,
    ...patch
  })));

describe("buildModuleDeviceCss", () => {
  it("emits nothing for a module with no device settings", () => {
    expect(buildModuleDeviceCss(moduleOf("heading", { marginTop: "10" }), "m1")).toBe("");
  });

  it("emits nothing for a module carrying only the pre-device mobile fields", () => {
    // Those still render through the stylesheet classes, at the width they
    // always did. Emitting here would move a page nobody has touched.
    const legacy = moduleOf("heading", { mobileFontSize: "18", mobileHidden: "true", mobileAlignment: "center" });
    expect(buildModuleDeviceCss(legacy, "m1")).toBe("");
  });

  it("puts a phone margin under the phone query and the phone preview frame, and nowhere else", () => {
    const css = buildModuleDeviceCss(edit(moduleOf("heading"), "phone", { marginTop: "4" }), "m1");
    expect(css).toContain("@media (max-width:767px)");
    expect(css).toContain("margin-top:4px !important");
    expect(css).toContain(".builder-preview-device-mobile ");
    expect(css).not.toContain("1024px");
  });

  it("puts a tablet setting under the tablet query, where a phone inherits it", () => {
    const css = buildModuleDeviceCss(edit(moduleOf("heading"), "tablet", { marginTop: "4" }), "m1");
    expect(css).toContain("@media (max-width:1024px)");
    // The phone follows the tablet, so the phone frame carries it too.
    expect(css).toContain(".builder-preview-device-mobile ");
  });

  it("sends a font size to the element the type actually sizes", () => {
    const heading = buildModuleDeviceCss(edit(moduleOf("heading"), "phone", { fontSize: "20" }), "m1");
    expect(heading).toContain("font-size:20px !important");
    expect(heading).toContain("> *{font-size:20px !important}");

    const rotator = buildModuleDeviceCss(edit(moduleOf("headline-rotator"), "phone", { fontSize: "20" }), "m1");
    expect(rotator).toContain("> * *");

    const poll = buildModuleDeviceCss(edit(moduleOf("poll-category-list"), "phone", { fontSize: "20" }), "m1");
    expect(poll).toContain(".builder-preview-poll-category-list-items{font-size:20px !important}");
  });

  it("hides on tablet, and confines the hide to the tablet band when the phone shows it again", () => {
    const hidden = moduleOf("heading", setModuleHiddenOnDevice({}, "heading", "tablet", true));
    const css = buildModuleDeviceCss(hidden, "m1");
    expect(css).toContain("@media (max-width:1024px){");
    expect(css).toContain("display:none !important");
    expect(css).not.toContain("min-width:768px");

    const shown = moduleOf("heading", setModuleHiddenOnDevice(hidden.settings, "heading", "phone", false));
    const shownCss = buildModuleDeviceCss(shown, "m1");
    expect(shownCss).toContain("@media (min-width:768px) and (max-width:1024px){");
    // Nothing un-hides it at phone width, because nothing hid it there.
    expect(shownCss).not.toContain("@media (max-width:767px)");
  });

  it("writes a text module's device Width the way getTextModuleWidthStyle does", () => {
    const module = edit(moduleOf("text", { size: "100", alignment: "center" }), "phone", { size: "50" });
    const css = buildModuleDeviceCss(module, "m1");
    expect(css).toContain("width:50% !important");
    expect(css).toContain("margin-left:auto !important");
  });

  it("puts a device nudge back to nothing rather than leaving desktop's transform", () => {
    const module = edit(moduleOf("heading", { verticalOffset: "20" }), "phone", { verticalOffset: "0" });
    const css = buildModuleDeviceCss(module, "m1");
    expect(css).toContain("transform:none !important");
    // ...and clears the margin the heading used to compensate with.
    expect(css).toContain("margin-bottom:0px !important");
  });

  it("outranks the pre-device mobile stylesheet by repeating its scope", () => {
    const css = buildModuleDeviceCss(edit(moduleOf("heading"), "phone", { marginTop: "4" }), "m1");
    const repeats = css.split('[data-builder-module-device-scope="m1"]').length - 1;
    expect(repeats).toBeGreaterThanOrEqual(6); // three per selector, two selectors
  });

  it("cannot be broken out of its selector by the scope string", () => {
    const module = moduleOf("heading", setModuleHiddenOnDevice({}, "heading", "phone", true));
    expect(buildModuleDeviceCss(module, '"]</style><script>')).not.toMatch(/<|"\]"/);
  });
});
