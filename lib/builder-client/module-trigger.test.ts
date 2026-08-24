import { describe, expect, it } from "vitest";
import {
  MODULE_TRIGGER_OPTIONS,
  MODULE_TRIGGER_SETTING_KEY,
  getModuleTrigger,
  isGameModuleTrigger,
  normalizeModuleTrigger,
} from "./module-trigger";

/**
 * What makes a module fire: a button, the page loading, or a game finishing.
 *
 * This is an ALLOW-LIST with a fallback, and both halves are worth pinning.
 * The allow-list decides what a stored page may ask for; the fallback decides
 * what happens to everything else. A widened list would let an unrecognised
 * value through to whatever reads it downstream, and a changed fallback would
 * silently move every module carrying a typo — or an option that was later
 * removed — onto a different behaviour, on pages nobody is looking at.
 *
 * Read-only on the subject, per the ticket. These describe what it does today.
 */

describe("normalizeModuleTrigger", () => {
  it("returns each allowed value unchanged", () => {
    expect(normalizeModuleTrigger("button")).toBe("button");
    expect(normalizeModuleTrigger("on-load")).toBe("on-load");
    expect(normalizeModuleTrigger("game")).toBe("game");
  });

  it("accepts every option the panel actually offers", () => {
    // Driven from the list itself rather than a copy of it: a new option added
    // to MODULE_TRIGGER_OPTIONS is covered here the moment it appears, instead
    // of being covered by a hand-written list somebody forgot to extend.
    for (const option of MODULE_TRIGGER_OPTIONS) {
      expect(normalizeModuleTrigger(option.value)).toBe(option.value);
    }
  });

  it("falls back to button for anything unrecognised", () => {
    expect(normalizeModuleTrigger("hover")).toBe("button");
    expect(normalizeModuleTrigger("Button")).toBe("button");
    expect(normalizeModuleTrigger("on_load")).toBe("button");
    expect(normalizeModuleTrigger("GAME")).toBe("button");
  });

  it("falls back to button for nothing at all", () => {
    expect(normalizeModuleTrigger(undefined)).toBe("button");
    expect(normalizeModuleTrigger("")).toBe("button");
    expect(normalizeModuleTrigger("   ")).toBe("button");
  });

  it("is case-SENSITIVE, and that is the behaviour being pinned", () => {
    // Worth stating outright rather than leaving to inference: "Game" does not
    // become "game", it becomes "button". A stored page written by hand with a
    // capital would quietly get the default. If that is ever judged wrong, it
    // is a deliberate change with this test in front of it.
    expect(normalizeModuleTrigger("Game")).toBe("button");
    expect(normalizeModuleTrigger("On-Load")).toBe("button");
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(normalizeModuleTrigger("  game  ")).toBe("game");
    expect(normalizeModuleTrigger("\ton-load\n")).toBe("on-load");
  });

  it("never returns anything outside the allow-list", () => {
    const allowed = MODULE_TRIGGER_OPTIONS.map((option) => option.value) as string[];
    const junk = ["hover", "", "   ", "game ", "GAME", "on load", "1", "null", "undefined"];
    for (const value of junk) {
      expect(allowed).toContain(normalizeModuleTrigger(value));
    }
  });
});

describe("getModuleTrigger", () => {
  it("reads the trigger key and normalizes it", () => {
    expect(getModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "game" })).toBe("game");
    expect(getModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "on-load" })).toBe("on-load");
  });

  it("reads the key named 'trigger'", () => {
    // The constant and the literal must agree — a module's stored settings are
    // written by one and read by the other, and a rename on one side only
    // would leave every saved page falling back to the default.
    expect(MODULE_TRIGGER_SETTING_KEY).toBe("trigger");
    expect(getModuleTrigger({ trigger: "game" })).toBe("game");
  });

  it("falls back to button when the key is missing", () => {
    expect(getModuleTrigger({})).toBe("button");
    expect(getModuleTrigger({ somethingElse: "game" })).toBe("button");
  });

  it("falls back to button when the key holds something unrecognised", () => {
    expect(getModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "hover" })).toBe("button");
    expect(getModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "" })).toBe("button");
  });

  it("ignores every other setting on the module", () => {
    const settings = { trigger: "game", delay: "500", label: "Play", game: "on-load" };
    expect(getModuleTrigger(settings)).toBe("game");
  });
});

describe("isGameModuleTrigger", () => {
  it("is true only for game", () => {
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "game" })).toBe(true);
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "button" })).toBe(false);
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "on-load" })).toBe(false);
  });

  it("is false for anything unrecognised, because that resolves to button", () => {
    // The important direction. A typo must not accidentally switch a module
    // into game behaviour — it lands on the default, and the default is not
    // game.
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "Game" })).toBe(false);
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "gam" })).toBe(false);
    expect(isGameModuleTrigger({ [MODULE_TRIGGER_SETTING_KEY]: "games" })).toBe(false);
    expect(isGameModuleTrigger({})).toBe(false);
  });

  it("returns a boolean, not a truthy string", () => {
    // It is read straight into JSX conditionals; a string would render.
    expect(typeof isGameModuleTrigger({ trigger: "game" })).toBe("boolean");
    expect(typeof isGameModuleTrigger({})).toBe("boolean");
  });

  it("agrees with getModuleTrigger for every option", () => {
    // The two must never drift: one is defined in terms of the other today,
    // and if that ever stops being true this is what notices.
    for (const option of MODULE_TRIGGER_OPTIONS) {
      const settings = { [MODULE_TRIGGER_SETTING_KEY]: option.value };
      expect(isGameModuleTrigger(settings)).toBe(getModuleTrigger(settings) === "game");
    }
  });
});

describe("the options list itself", () => {
  it("offers a label for every value, so no option renders blank", () => {
    for (const option of MODULE_TRIGGER_OPTIONS) {
      expect(option.value.trim()).not.toBe("");
      expect(option.label.trim()).not.toBe("");
    }
  });

  it("has no duplicate values", () => {
    const values = MODULE_TRIGGER_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("includes the fallback among the options it offers", () => {
    // If "button" were ever removed from the list, normalizeModuleTrigger
    // would still return it — handing downstream code a value the panel can no
    // longer display, which is the quiet kind of broken.
    expect(MODULE_TRIGGER_OPTIONS.map((option) => option.value)).toContain("button");
  });
});
