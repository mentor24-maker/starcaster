import { describe, expect, it } from "vitest";
import {
  MODULE_TRIGGER_SETTING_KEY,
  getModuleTrigger,
  isGameModuleTrigger,
  normalizeModuleTrigger,
} from "./module-trigger";

describe("normalizeModuleTrigger", () => {
  it("returns each allowed value unchanged", () => {
    expect(normalizeModuleTrigger("button")).toBe("button");
    expect(normalizeModuleTrigger("on-load")).toBe("on-load");
    expect(normalizeModuleTrigger("game")).toBe("game");
  });

  it("falls back to button for undefined, empty, and unknown input", () => {
    expect(normalizeModuleTrigger(undefined)).toBe("button");
    expect(normalizeModuleTrigger("")).toBe("button");
    expect(normalizeModuleTrigger("   ")).toBe("button");
    expect(normalizeModuleTrigger("not-a-real-trigger")).toBe("button");
  });
});

describe("getModuleTrigger", () => {
  it("reads the trigger settings key and normalizes it", () => {
    expect(getModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "game" })).toBe("game");
    expect(getModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "on-load" })).toBe("on-load");
  });

  it("falls back to button when the settings key is missing or invalid", () => {
    expect(getModuleTrigger({})).toBe("button");
    expect(getModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "bogus" })).toBe("button");
  });
});

describe("isGameModuleTrigger", () => {
  it("is true only when the trigger resolves to game", () => {
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "game" })).toBe(true);
  });

  it("is false for every other resolved trigger, including the fallback", () => {
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "button" })).toBe(false);
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "on-load" })).toBe(false);
    expect(isGameModuleTrigger({})).toBe(false);
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "bogus" })).toBe(false);
  });
});
