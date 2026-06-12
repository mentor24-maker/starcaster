import { describe, expect, it } from "vitest";
import {
  confettiBurstFromModuleSettings,
  confettiOptionsFromModuleSettings,
  CONFETTI_EFFECT_DEFAULTS,
  isGameTriggeredConfetti,
  normalizeConfettiModuleSettings
} from "@/lib/confetti-effect";

describe("confetti-effect", () => {
  it("normalizes handoff defaults", () => {
    expect(normalizeConfettiModuleSettings({})).toMatchObject({
      particleCount: "100",
      spread: "70",
      originX: "0.5",
      originY: "0.6"
    });
  });

  it("maps module settings to canvas-confetti options", () => {
    const options = confettiOptionsFromModuleSettings({
      particleCount: "120",
      spread: "80",
      originX: "0.4",
      originY: "0.7",
      zIndex: CONFETTI_EFFECT_DEFAULTS.zIndex
    });

    expect(options).toEqual({
      particleCount: 120,
      spread: 80,
      origin: { x: 0.4, y: 0.7 },
      zIndex: 12000,
      disableForReducedMotion: false
    });
  });

  it("includes sound settings in burst payload", () => {
    const burst = confettiBurstFromModuleSettings({
      sound: "chime",
      popVolume: "60"
    });

    expect(burst.sound).toBe("chime");
    expect(burst.soundVolume).toBe(0.6);
  });

  it("maps legacy playPopSound=false to sound off", () => {
    const burst = confettiBurstFromModuleSettings({
      playPopSound: "false"
    });

    expect(burst.sound).toBe("off");
  });

  it("preserves game trigger", () => {
    const normalized = normalizeConfettiModuleSettings({ trigger: "game" });
    expect(normalized.trigger).toBe("game");
    expect(isGameTriggeredConfetti(normalized)).toBe(true);
  });
});
