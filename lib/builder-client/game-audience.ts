export const GAME_AUDIENCE_OPTIONS = [
  { value: "public", label: "Public Site" },
  { value: "portal", label: "Player Portal" },
  { value: "both", label: "Public and Portal" }
] as const;

export type GameAudience = (typeof GAME_AUDIENCE_OPTIONS)[number]["value"];

export type GamePlayContext = "public" | "portal";

export function normalizeGameAudience(value: unknown): GameAudience {
  const candidate = String(value ?? "").trim();

  if (GAME_AUDIENCE_OPTIONS.some((option) => option.value === candidate)) {
    return candidate as GameAudience;
  }

  return "both";
}

export function gameAudienceFiresForContext(audience: GameAudience, context: GamePlayContext): boolean {
  if (audience === "both") {
    return true;
  }

  return audience === context;
}

export function gameAudienceLabel(audience: GameAudience): string {
  return GAME_AUDIENCE_OPTIONS.find((option) => option.value === audience)?.label ?? "Public and Portal";
}
