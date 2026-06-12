import type { BuilderTemplateModule } from "@/lib/builder-template";

export const PLAYER_GAME_SPEECH_BUBBLE_EVENT = "normie-player-game-speech-bubble";

export type PlayerGameSpeechBubbleDetail = {
  module: BuilderTemplateModule;
};

export function fireGameSpeechBubbleModule(module: BuilderTemplateModule): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PlayerGameSpeechBubbleDetail>(PLAYER_GAME_SPEECH_BUBBLE_EVENT, {
      detail: { module }
    })
  );
}
