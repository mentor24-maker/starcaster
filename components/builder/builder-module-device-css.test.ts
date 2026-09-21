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

  it("keeps a legacy field out of the rules when ANOTHER key is set on a device", () => {
    /*
     * Review round 1, finding 4, and the one that would have moved a live
     * client page. The guard used to be per MODULE, so one unrelated tablet
     * margin let the phone chain — which reads the legacy fields — emit
     * `mobileFontSize` at 767px with `!important` and a three-repeat selector
     * on it. A heading rendering at `clamp(1.35rem, 9vw, 2.35rem)` today would
     * have dropped to 18px because somebody set a tablet margin.
     */
    const module = moduleOf("heading", {
      fontSize: "48",
      mobileFontSize: "18",
      mobileHidden: "true",
      mobileAlignment: "center",
      "tablet.marginTop": "12"
    });
    const css = buildModuleDeviceCss(module, "m1");
    expect(css).toContain("margin-top:12px !important");
    expect(css).not.toContain("font-size");
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("justify-items");
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

  it("writes a device alignment on the module's ROOT as well as its wrapper", () => {
    /*
     * Review round 1, finding 3. Desktop declares `center` and `right` on the
     * CHILD (`.is-align-center .builder-preview-heading { justify-self }`), and
     * a child's own `justify-self` beats the parent's `justify-items` — so a
     * wrapper-only rule could move a module OUT of left but never back INTO
     * it. Both directions, because only one of them was broken.
     */
    const toLeft = buildModuleDeviceCss(
      edit(moduleOf("heading", { alignment: "center" }), "phone", { alignment: "left" }),
      "m1"
    );
    expect(toLeft).toContain("justify-items:stretch !important");
    expect(toLeft).toContain("justify-self:auto !important");
    expect(toLeft).toContain("text-align:left !important");

    const toCenter = buildModuleDeviceCss(
      edit(moduleOf("heading", { alignment: "left" }), "phone", { alignment: "center" }),
      "m1"
    );
    expect(toCenter).toContain("justify-items:center !important");
    expect(toCenter).toContain("justify-self:center !important");
    expect(toCenter).toContain("text-align:center !important");
  });

  it("outranks the pre-device mobile stylesheet by repeating its scope", () => {
    const css = buildModuleDeviceCss(edit(moduleOf("heading"), "phone", { marginTop: "4" }), "m1");
    const repeats = css.split('[data-builder-module-device-scope="m1"]').length - 1;
    expect(repeats).toBeGreaterThanOrEqual(6); // three per selector, two selectors
  });

  it("makes the words a heading's toolbar sized follow a device font size", () => {
    /*
     * 86bc3xrhz: Delray's hero headline wraps every word in
     * `<span style="font-size: 88px">`. A size set only on the heading lost to
     * those inline styles, so its Phone Font Size did nothing at all.
     */
    const css = buildModuleDeviceCss(edit(moduleOf("heading", { fontSize: "60" }), "phone", { fontSize: "40" }), "m1");
    expect(css).toContain(' > * [style*="font-size"]{font-size:inherit !important}');
    // No device font size, no inheritance rule: desktop sizes stay as drawn.
    const margin = buildModuleDeviceCss(edit(moduleOf("heading"), "phone", { marginTop: "4" }), "m1");
    expect(margin).not.toContain("font-size");
  });

  it("writes a heading's device line height and letter spacing on the heading itself", () => {
    const css = buildModuleDeviceCss(
      edit(moduleOf("heading", { lineHeight: "1.2", letterSpacing: "2" }), "phone", { lineHeight: "1", letterSpacing: "0" }),
      "m1"
    );
    expect(css).toContain("> *{line-height:1 !important;letter-spacing:0px !important}");
  });

  it("shows a tablet setting in the preview's Tablet frame too", () => {
    const css = buildModuleDeviceCss(edit(moduleOf("heading"), "tablet", { fontSize: "40" }), "m1");
    expect(css).toContain('.builder-preview-device-tablet [data-builder-module-device-scope="m1"]');
    const hidden = buildModuleDeviceCss(moduleOf("heading", setModuleHiddenOnDevice({}, "heading", "tablet", true)), "m1");
    expect(hidden).toMatch(/\.builder-preview-device-tablet \[[^{]+\{display:none !important\}/);
  });

  it("cannot be broken out of its selector by the scope string", () => {
    const module = moduleOf("heading", setModuleHiddenOnDevice({}, "heading", "phone", true));
    expect(buildModuleDeviceCss(module, '"]</style><script>')).not.toMatch(/<|"\]"/);
  });
});
