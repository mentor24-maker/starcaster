import { describe, expect, it } from "vitest";
import { getButtonModuleStyle } from "../../components/builder/builder-utils";
import { BUTTON_GLOW_DEFAULTS, buttonGlowIsOn, getButtonGlowShadow } from "./builder-button-glow";

describe("Button glow (task 86bctde3a)", () => {
  it("is off unless ticked, so no existing button gains a box-shadow", () => {
    expect(buttonGlowIsOn({})).toBe(false);
    expect(getButtonGlowShadow({})).toBe("");
    expect(getButtonModuleStyle({ buttonColor: "#214c71" }).boxShadow).toBeUndefined();
    expect(getButtonModuleStyle({ buttonGlow: "false", buttonGlowColor: "#00d9ff" }).boxShadow).toBeUndefined();
  });

  it("draws a zero-offset box-shadow in the chosen colour, size and strength", () => {
    const settings = { buttonGlow: "true", buttonGlowColor: "#00d9ff", buttonGlowSize: "22", buttonGlowStrength: "18" };
    expect(getButtonGlowShadow(settings)).toBe("0px 0px 22px 0px rgba(0, 217, 255, 0.18)");
    expect(getButtonModuleStyle(settings).boxShadow).toBe("0px 0px 22px 0px rgba(0, 217, 255, 0.18)");
    // Theme-following web buttons carry it too — the live site's path.
    expect(getButtonModuleStyle(settings, { followThemePalette: true }).boxShadow).toBe(
      "0px 0px 22px 0px rgba(0, 217, 255, 0.18)"
    );
  });

  it("falls back to the defaults and clamps out-of-range numbers", () => {
    expect(getButtonGlowShadow({ buttonGlow: "true" })).toBe(
      `0px 0px ${BUTTON_GLOW_DEFAULTS.size}px 0px rgba(0, 217, 255, 0.4)`
    );
    expect(getButtonGlowShadow({ buttonGlow: "true", buttonGlowSize: "500", buttonGlowStrength: "100" })).toBe(
      "0px 0px 80px 0px #00d9ff"
    );
    expect(getButtonGlowShadow({ buttonGlow: "on", buttonGlowSize: "0" })).toMatch(/^0px 0px 1px 0px /);
  });
});
