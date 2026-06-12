import type { GamePlayContext } from "@/lib/game-audience";

/** Game events and builder game-layer modules only run for logged-in players on the public site. */
export function shouldRunGameLayerOnSite(isRegistered: boolean, playContext: GamePlayContext): boolean {
  if (playContext === "portal") {
    return true;
  }

  return isRegistered;
}
