"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SpeechBubblePreview } from "@/components/builder/speech-bubble-preview";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  PLAYER_GAME_SPEECH_BUBBLE_EVENT,
  type PlayerGameSpeechBubbleDetail
} from "@/lib/game-speech-bubble-trigger";

export function PlayerGameSpeechBubbleHost() {
  const pathname = usePathname();
  const [activeModule, setActiveModule] = useState<BuilderTemplateModule | null>(null);

  useEffect(() => {
    function handleSpeechBubble(event: Event) {
      const detail = (event as CustomEvent<PlayerGameSpeechBubbleDetail>).detail;

      if (!detail?.module || detail.module.type !== "speech-bubble") {
        return;
      }

      setActiveModule(detail.module);
    }

    window.addEventListener(PLAYER_GAME_SPEECH_BUBBLE_EVENT, handleSpeechBubble);

    return () => {
      window.removeEventListener(PLAYER_GAME_SPEECH_BUBBLE_EVENT, handleSpeechBubble);
    };
  }, []);

  useEffect(() => {
    setActiveModule(null);
  }, [pathname]);

  useEffect(() => {
    if (!activeModule) {
      return;
    }

    function dismissOnNextClick() {
      setActiveModule(null);
    }

    window.addEventListener("click", dismissOnNextClick, { once: true });

    return () => {
      window.removeEventListener("click", dismissOnNextClick);
    };
  }, [activeModule]);

  useEffect(() => {
    if (!activeModule) {
      return;
    }

    return () => {
      window.dispatchEvent(new CustomEvent("starcaster-player-game-speech-bubble-end"));
    };
  }, [activeModule]);

  if (!activeModule) {
    return null;
  }

  return (
    <div aria-live="polite" className="player-game-speech-bubble-host">
      <SpeechBubblePreview classNamePrefix="builder-preview" layoutMode="overlay" module={activeModule} />
    </div>
  );
}
