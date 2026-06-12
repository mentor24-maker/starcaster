import { describe, expect, it } from "vitest";
import {
  inferModuleClassFromBuilderModule,
  isGameEventPickableModule,
  isGameLayerTriggeredModule,
  isSupportedGameEventModuleType
} from "./module-class-triggers";

describe("isGameEventPickableModule", () => {
  it("allows supported module types regardless of trigger", () => {
    expect(
      isGameEventPickableModule({
        moduleClass: "Special Effects",
        settings: { trigger: "on-load" },
        moduleType: "confetti"
      })
    ).toBe(true);
    expect(
      isGameEventPickableModule({
        moduleClass: "Speech Bubble",
        settings: {},
        moduleType: "speech-bubble"
      })
    ).toBe(true);
    expect(
      isGameEventPickableModule({
        moduleClass: "Layout",
        settings: { trigger: "game" },
        moduleType: "heading"
      })
    ).toBe(false);
  });
});

describe("isGameLayerTriggeredModule", () => {
  it("still requires a game trigger for layer execution eligibility", () => {
    expect(
      isGameLayerTriggeredModule("Special Effects", { trigger: "game" }, "confetti")
    ).toBe(true);
    expect(
      isGameLayerTriggeredModule("Special Effects", { trigger: "on-load" }, "confetti")
    ).toBe(false);
  });
});

describe("inferModuleClassFromBuilderModule", () => {
  it("infers special effects class for confetti modules", () => {
    expect(
      inferModuleClassFromBuilderModule({
        id: "1",
        type: "confetti",
        column: "main",
        name: "Burst",
        text: "",
        settings: {}
      })
    ).toBe("Special Effects");
  });
});

describe("isSupportedGameEventModuleType", () => {
  it("lists executable game module types", () => {
    expect(isSupportedGameEventModuleType("confetti")).toBe(true);
    expect(isSupportedGameEventModuleType("floating-image")).toBe(true);
    expect(isSupportedGameEventModuleType("speech-bubble")).toBe(true);
    expect(isSupportedGameEventModuleType("heading")).toBe(false);
  });
});
