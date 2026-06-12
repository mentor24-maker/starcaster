import type { BuilderTemplateModule } from "@/lib/builder-template";

export const PLAYER_GAME_FLOATING_IMAGE_EVENT = "normie-player-game-floating-image";

/** Stored on floating-image modules; empty / `page` keeps the overlay until navigation. */
export const GAME_FLOATING_IMAGE_DURATION_PAGE = "page";

export const GAME_FLOATING_IMAGE_DURATION_OPTIONS = [
  { value: GAME_FLOATING_IMAGE_DURATION_PAGE, label: "Until Page Change" },
  { value: "3000", label: "3 Seconds" },
  { value: "5000", label: "5 Seconds" },
  { value: "10000", label: "10 Seconds" },
  { value: "30000", label: "30 Seconds" }
] as const;

export function normalizeGameFloatingImageDurationMs(value: string | undefined): string {
  const trimmed = String(value ?? "").trim();

  if (!trimmed || trimmed === "0" || trimmed.toLowerCase() === GAME_FLOATING_IMAGE_DURATION_PAGE) {
    return GAME_FLOATING_IMAGE_DURATION_PAGE;
  }

  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return GAME_FLOATING_IMAGE_DURATION_PAGE;
  }

  return String(Math.max(1000, parsed));
}

/** Milliseconds until auto-dismiss, or `null` to keep visible until the route changes. */
export function resolveGameFloatingImageDismissMs(settings: Record<string, string>): number | null {
  const normalized = normalizeGameFloatingImageDurationMs(settings.durationMs);

  if (normalized === GAME_FLOATING_IMAGE_DURATION_PAGE) {
    return null;
  }

  return Number.parseInt(normalized, 10);
}

export function getGameFloatingImageDurationSelectValue(settings: Record<string, string>): string {
  const normalized = normalizeGameFloatingImageDurationMs(settings.durationMs);
  const preset = GAME_FLOATING_IMAGE_DURATION_OPTIONS.find((option) => option.value === normalized);

  return preset?.value ?? normalized;
}

export type PlayerGameFloatingImageDetail = {
  module: BuilderTemplateModule;
};

export function fireGameFloatingImageModule(module: BuilderTemplateModule): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PlayerGameFloatingImageDetail>(PLAYER_GAME_FLOATING_IMAGE_EVENT, {
      detail: { module }
    })
  );
}
