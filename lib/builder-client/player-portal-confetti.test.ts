import { describe, expect, it } from "vitest";
import { PLAYER_PORTAL_CONFETTI_Z_INDEX } from "@/lib/confetti-effect";

describe("player-portal-confetti", () => {
  it("uses a z-index above portal and admin overlays", () => {
    expect(PLAYER_PORTAL_CONFETTI_Z_INDEX).toBeGreaterThan(1100);
  });
});
