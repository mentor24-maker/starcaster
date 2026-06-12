import { describe, expect, it } from "vitest";
import { moduleFiresForGameContext, normalizeModuleGameAudience } from "./module-game-audience";

describe("moduleFiresForGameContext", () => {
  it("respects audience settings", () => {
    expect(moduleFiresForGameContext({ gameAudience: "public" }, "public")).toBe(true);
    expect(moduleFiresForGameContext({ gameAudience: "public" }, "portal")).toBe(false);
    expect(moduleFiresForGameContext({ gameAudience: "portal" }, "portal")).toBe(true);
    expect(moduleFiresForGameContext({ gameAudience: "portal" }, "public")).toBe(false);
    expect(moduleFiresForGameContext({ gameAudience: "both" }, "public")).toBe(true);
    expect(moduleFiresForGameContext({}, "public")).toBe(true);
  });
});

describe("normalizeModuleGameAudience", () => {
  it("defaults to both", () => {
    expect(normalizeModuleGameAudience(undefined)).toBe("both");
    expect(normalizeModuleGameAudience("public")).toBe("public");
  });
});
