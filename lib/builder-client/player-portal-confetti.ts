import { fireGameEventModule } from "@/lib/game-event-module-runtime";
import { gameAudienceFiresForContext, type GamePlayContext } from "@/lib/game-audience";
import {
  eventTargetProgressPolls,
  readEventProgressionFromMetadata
} from "@/lib/player-progression-tiers";
import { isGameModuleTrigger } from "@/lib/module-trigger";
import { CONFETTI_EFFECT_DEFAULTS, confettiBurstFromModuleSettings } from "@/lib/confetti-effect";
import type { PlayerPortalLevelEvent } from "@/lib/player-portal";

export { PLAYER_PORTAL_CONFETTI_Z_INDEX } from "@/lib/confetti-effect";

/** Level-up burst using handoff defaults (see docs/Handoffs/confetti.js). */
export async function firePlayerLevelUpConfetti(): Promise<void> {
  const { fireConfettiBurst } = await import("@/lib/confetti-burst");
  await fireConfettiBurst(confettiBurstFromModuleSettings(CONFETTI_EFFECT_DEFAULTS));
}

function eventMatchesProgressPolls(event: PlayerPortalLevelEvent, progressPollsTaken?: number | null) {
  if (!progressPollsTaken) {
    return true;
  }

  return eventTargetProgressPolls(event.metadata, event.sublevelName) === progressPollsTaken;
}

export async function firePlayerLevelUpGameEvents(
  levelEvents: PlayerPortalLevelEvent[],
  progressPollsTaken?: number | null,
  playContext: GamePlayContext = "portal"
): Promise<void> {
  const gameTriggeredEvents = levelEvents.filter(
    (event) =>
      event.trigger === "game" &&
      isGameModuleTrigger(event.moduleSettings) &&
      gameAudienceFiresForContext(event.audience, playContext) &&
      eventMatchesProgressPolls(event, progressPollsTaken)
  );

  if (!gameTriggeredEvents.length) {
    if (levelEvents.length === 0) {
      await firePlayerLevelUpConfetti();
    }
    return;
  }

  for (const event of gameTriggeredEvents) {
    await fireGameEventModule(event.moduleType, event.moduleSettings, event.gameModule);
  }
}
