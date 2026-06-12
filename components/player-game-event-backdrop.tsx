"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAYER_GAME_FLOATING_IMAGE_EVENT } from "@/lib/game-floating-image-trigger";
import { PLAYER_GAME_SPEECH_BUBBLE_EVENT } from "@/lib/game-speech-bubble-trigger";

type OverlayLayerKey = "floating-image" | "speech-bubble";

export function PlayerGameEventBackdrop() {
  const pathname = usePathname();
  const [activeLayers, setActiveLayers] = useState<Set<OverlayLayerKey>>(() => new Set());

  useEffect(() => {
    setActiveLayers(new Set());
  }, [pathname]);

  useEffect(() => {
    function showLayer(layer: OverlayLayerKey) {
      setActiveLayers((current) => {
        if (current.has(layer)) {
          return current;
        }

        const next = new Set(current);
        next.add(layer);
        return next;
      });
    }

    function hideLayer(layer: OverlayLayerKey) {
      setActiveLayers((current) => {
        if (!current.has(layer)) {
          return current;
        }

        const next = new Set(current);
        next.delete(layer);
        return next;
      });
    }

    function onFloatingImage(event: Event) {
      const detail = (event as CustomEvent<{ module?: { type?: string } }>).detail;

      if (detail?.module?.type === "floating-image") {
        showLayer("floating-image");
      }
    }

    function onSpeechBubble(event: Event) {
      const detail = (event as CustomEvent<{ module?: { type?: string } }>).detail;

      if (detail?.module?.type === "speech-bubble") {
        showLayer("speech-bubble");
      }
    }

    function onFloatingImageEnd() {
      hideLayer("floating-image");
    }

    function onSpeechBubbleEnd() {
      hideLayer("speech-bubble");
    }

    window.addEventListener(PLAYER_GAME_FLOATING_IMAGE_EVENT, onFloatingImage);
    window.addEventListener(PLAYER_GAME_SPEECH_BUBBLE_EVENT, onSpeechBubble);
    window.addEventListener("normie-player-game-floating-image-end", onFloatingImageEnd);
    window.addEventListener("normie-player-game-speech-bubble-end", onSpeechBubbleEnd);

    return () => {
      window.removeEventListener(PLAYER_GAME_FLOATING_IMAGE_EVENT, onFloatingImage);
      window.removeEventListener(PLAYER_GAME_SPEECH_BUBBLE_EVENT, onSpeechBubble);
      window.removeEventListener("normie-player-game-floating-image-end", onFloatingImageEnd);
      window.removeEventListener("normie-player-game-speech-bubble-end", onSpeechBubbleEnd);
    };
  }, []);

  if (activeLayers.size === 0) {
    return null;
  }

  return <div aria-hidden="true" className="player-game-event-backdrop" />;
}
