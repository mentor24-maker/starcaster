import { describe, expect, it } from "vitest";
import {
  GAME_FLOATING_IMAGE_DURATION_PAGE,
  getGameFloatingImageDurationSelectValue,
  normalizeGameFloatingImageDurationMs,
  resolveGameFloatingImageDismissMs
} from "@/lib/game-floating-image-trigger";

describe("game floating image duration", () => {
  it("defaults to until page change", () => {
    expect(normalizeGameFloatingImageDurationMs(undefined)).toBe(GAME_FLOATING_IMAGE_DURATION_PAGE);
    expect(resolveGameFloatingImageDismissMs({})).toBeNull();
    expect(getGameFloatingImageDurationSelectValue({})).toBe(GAME_FLOATING_IMAGE_DURATION_PAGE);
  });

  it("treats zero and page tokens as until page change", () => {
    expect(normalizeGameFloatingImageDurationMs("0")).toBe(GAME_FLOATING_IMAGE_DURATION_PAGE);
    expect(normalizeGameFloatingImageDurationMs("page")).toBe(GAME_FLOATING_IMAGE_DURATION_PAGE);
    expect(resolveGameFloatingImageDismissMs({ durationMs: "0" })).toBeNull();
  });

  it("resolves timed dismiss values with a one second minimum", () => {
    expect(normalizeGameFloatingImageDurationMs("500")).toBe("1000");
    expect(resolveGameFloatingImageDismissMs({ durationMs: "5000" })).toBe(5000);
  });
});
