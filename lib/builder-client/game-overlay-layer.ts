/**
 * Page overlay stacking (bottom → top) inside `.builder-preview-shell`:
 * 1. Main layout sections (`z-index: 1`)
 * 2. Translucent game wash (`.player-game-event-backdrop`, fixed)
 * 3. Floating images — section-scoped decor rows, full-page overlay, game-fired host (`PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX`, min 40)
 * 4. Speech bubbles (`PLAYER_GAME_SPEECH_BUBBLE_LAYER_Z_INDEX`)
 *
 * Reminder modals and dev diagnostics sit above this ladder (see globals.css).
 */

/** Main page sections (polls, nav, hero, etc.). */
export const PLAYER_GAME_PAGE_MAIN_Z_INDEX = 1;

/** Translucent white wash between main content and floating modules. */
export const PLAYER_GAME_EVENT_BACKDROP_Z_INDEX = 5;

/** Overlay-flow row + full-screen floating-image host (decorative Normie, game-fired images). */
export const PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX = 40;

/** Game / page-load speech bubbles above floating images. */
export const PLAYER_GAME_SPEECH_BUBBLE_LAYER_Z_INDEX = 45;

/** @deprecated Use layer constants above; kept so tests can assert we no longer use viewport-max stacking. */
export const PLAYER_GAME_OVERLAY_HOST_Z_INDEX = PLAYER_GAME_SPEECH_BUBBLE_LAYER_Z_INDEX;

/** Relative order inside a floating-image host (above sibling backdrop when legacy markup remains). */
export const PLAYER_GAME_OVERLAY_CONTENT_Z_INDEX_MIN = 10;

export function resolveGameOverlayContentZIndex(settings: Record<string, string>, fallback = 20): number {
  const parsed = Number.parseInt(settings.zIndex ?? String(fallback), 10);

  if (!Number.isFinite(parsed)) {
    return Math.max(fallback, PLAYER_GAME_OVERLAY_CONTENT_Z_INDEX_MIN);
  }

  return Math.max(parsed, PLAYER_GAME_OVERLAY_CONTENT_Z_INDEX_MIN);
}
