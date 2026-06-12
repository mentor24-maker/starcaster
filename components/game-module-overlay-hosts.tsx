"use client";

import { PlayerGameEventBackdrop } from "@/components/player-game-event-backdrop";
import { PlayerGameFloatingImageHost } from "@/components/player-game-floating-image-host";
import { PlayerGameSpeechBubbleHost } from "@/components/player-game-speech-bubble-host";

/** Game overlays: shared wash, then floating images, then speech (see `lib/game-overlay-layer.ts`). */
export function GameModuleOverlayHosts() {
  return (
    <>
      <PlayerGameEventBackdrop />
      <PlayerGameFloatingImageHost />
      <PlayerGameSpeechBubbleHost />
    </>
  );
}
