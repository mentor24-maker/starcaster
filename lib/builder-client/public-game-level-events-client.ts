import { firePlayerLevelUpGameEvents } from "@/lib/player-portal-confetti";
import type { PlayerPortalLevelEvent } from "@/lib/player-portal";

let cachedLevelEvents: PlayerPortalLevelEvent[] | null = null;
let loadPromise: Promise<PlayerPortalLevelEvent[]> | null = null;

export function resetPublicGameLevelEventsCache(): void {
  cachedLevelEvents = null;
  loadPromise = null;
}

export async function loadPublicGameLevelEvents(): Promise<PlayerPortalLevelEvent[]> {
  if (cachedLevelEvents) {
    return cachedLevelEvents;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      const response = await fetch("/api/public/game-level-events", { cache: "no-store" });
      const payload = (await response.json()) as { data?: PlayerPortalLevelEvent[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load game level events.");
      }

      cachedLevelEvents = payload.data ?? [];
      return cachedLevelEvents;
    })().finally(() => {
      loadPromise = null;
    });
  }

  return loadPromise;
}

export async function firePublicProgressGameEvents(
  progressPollsTaken: number,
  options?: { duplicate?: boolean }
): Promise<void> {
  if (options?.duplicate) {
    return;
  }

  if (!Number.isFinite(progressPollsTaken) || progressPollsTaken <= 0) {
    return;
  }

  resetPublicGameLevelEventsCache();
  const levelEvents = await loadPublicGameLevelEvents();
  await firePlayerLevelUpGameEvents(levelEvents, progressPollsTaken, "public");
}
