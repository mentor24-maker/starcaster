"use client";

import { confettiBurstFromModuleSettings, isGameTriggeredConfetti } from "@/lib/confetti-effect";

/**
 * Fire a confetti module using saved module settings.
 * Intended for the game layer when Trigger is set to Game.
 */
export async function fireConfettiFromModuleSettings(settings: Record<string, string>): Promise<void> {
  const { fireConfettiBurst } = await import("@/lib/confetti-burst");
  await fireConfettiBurst(confettiBurstFromModuleSettings(settings));
}

export { isGameTriggeredConfetti };
