import {
  gameAudienceFiresForContext,
  normalizeGameAudience,
  type GameAudience,
  type GamePlayContext
} from "@/lib/game-audience";

/** @deprecated Use `gameAudience` on game events / reminders. Kept for on-page module overlays. */
export const MODULE_GAME_AUDIENCE_SETTING_KEY = "gameAudience";

export const MODULE_GAME_AUDIENCE_OPTIONS = [
  { value: "public", label: "Public Site" },
  { value: "portal", label: "Player Portal" },
  { value: "both", label: "Public and Portal" }
] as const;

export type ModuleGameAudience = GameAudience;
export type ModuleGamePlayContext = GamePlayContext;

export function normalizeModuleGameAudience(value: string | undefined): ModuleGameAudience {
  return normalizeGameAudience(value);
}

export function getModuleGameAudience(settings: Record<string, string>): ModuleGameAudience {
  return normalizeModuleGameAudience(settings[MODULE_GAME_AUDIENCE_SETTING_KEY]);
}

export function moduleFiresForGameContext(
  settings: Record<string, string>,
  context: ModuleGamePlayContext
): boolean {
  return gameAudienceFiresForContext(getModuleGameAudience(settings), context);
}
