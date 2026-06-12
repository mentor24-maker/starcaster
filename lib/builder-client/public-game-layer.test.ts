import { describe, expect, it } from "vitest";
import { shouldRunGameLayerOnSite } from "@/lib/public-game-layer";

describe("shouldRunGameLayerOnSite", () => {
  it("allows the game layer on the portal for any visitor", () => {
    expect(shouldRunGameLayerOnSite(false, "portal")).toBe(true);
    expect(shouldRunGameLayerOnSite(true, "portal")).toBe(true);
  });

  it("allows the game layer on the public site only for registered players", () => {
    expect(shouldRunGameLayerOnSite(false, "public")).toBe(false);
    expect(shouldRunGameLayerOnSite(true, "public")).toBe(true);
  });
});
