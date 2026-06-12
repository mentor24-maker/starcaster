import { describe, expect, it } from "vitest";
import { gameAudienceFiresForContext, normalizeGameAudience } from "./game-audience";

describe("gameAudienceFiresForContext", () => {
  it("matches public, portal, or both", () => {
    expect(gameAudienceFiresForContext("public", "public")).toBe(true);
    expect(gameAudienceFiresForContext("public", "portal")).toBe(false);
    expect(gameAudienceFiresForContext("portal", "portal")).toBe(true);
    expect(gameAudienceFiresForContext("portal", "public")).toBe(false);
    expect(gameAudienceFiresForContext("both", "public")).toBe(true);
    expect(gameAudienceFiresForContext("both", "portal")).toBe(true);
  });
});

describe("normalizeGameAudience", () => {
  it("defaults unknown values to both", () => {
    expect(normalizeGameAudience(undefined)).toBe("both");
    expect(normalizeGameAudience("")).toBe("both");
    expect(normalizeGameAudience("invalid")).toBe("both");
  });
});
