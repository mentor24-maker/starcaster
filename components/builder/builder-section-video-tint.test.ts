import { describe, expect, it } from "vitest";
import { changeSectionBackgroundMode } from "./builder-section-controls";
import {
  BUILDER_VIDEO_DEFAULT_OVERLAY_TINT,
  createDefaultBackgroundSettings,
  hasActiveRowOverlayScreen,
  type BuilderTemplateSection
} from "@/lib/builder-template";

/**
 * The WIRING, not the helper.
 *
 * `seedVideoBackgroundOverlayScreen` has its own tests, and they all passed
 * while the call to it could be deleted outright — the seed was tested, its
 * USE was not, and a break test is what surfaced that. These cover the step
 * the operator actually performs: changing the dropdown to Video.
 */
function sectionWith(overlayScreen?: unknown): BuilderTemplateSection {
  return {
    id: "s1",
    title: "Row",
    layout: "single",
    modules: [],
    background: createDefaultBackgroundSettings(),
    ...(overlayScreen ? { overlayScreen } : {})
  } as unknown as BuilderTemplateSection;
}

/** Run the handler and return the section it produced. */
function changeMode(section: BuilderTemplateSection, mode: string): BuilderTemplateSection {
  let next = section;
  changeSectionBackgroundMode((updater) => {
    next = updater(section);
  }, mode as never);
  return next;
}

describe("choosing Video on a row", () => {
  it("sets the background mode", () => {
    expect(changeMode(sectionWith(), "video").background.mode).toBe("video");
  });

  it("turns the tint on, so text over the footage is readable by default", () => {
    const next = changeMode(sectionWith(), "video");

    expect(hasActiveRowOverlayScreen(next.overlayScreen)).toBe(true);
    expect(next.overlayScreen?.background.color).toBe(BUILDER_VIDEO_DEFAULT_OVERLAY_TINT);
  });

  it("leaves a tint the operator already set exactly as it was", () => {
    const mine = { background: { mode: "color", color: "#ff0000" }, opacity: 20 };
    const next = changeMode(sectionWith(mine), "video");

    expect(next.overlayScreen?.background.color).toBe("#ff0000");
    expect(next.overlayScreen?.opacity).toBe(20);
  });
});

describe("choosing any other mode", () => {
  it("does not seed a tint", () => {
    for (const mode of ["color", "gradient", "image", "style"]) {
      const next = changeMode(sectionWith(), mode);
      expect(hasActiveRowOverlayScreen(next.overlayScreen)).toBe(false);
    }
  });

  it("does NOT tear out a tint that is already there", () => {
    const mine = { background: { mode: "color", color: "#ff0000" }, opacity: 20 };
    const next = changeMode(sectionWith(mine), "color");

    // Switching away from Video must not delete a setting the operator can
    // see and did not ask about — that is the silent edit this guards.
    expect(next.overlayScreen).toEqual(mine);
  });
});
