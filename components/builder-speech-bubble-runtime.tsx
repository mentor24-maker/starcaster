"use client";

import { useEffect, useRef } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { fireGameSpeechBubbleModule } from "@/lib/game-speech-bubble-trigger";
import {
  moduleFiresForGameContext,
  type ModuleGamePlayContext
} from "@/lib/module-game-audience";
import { getModuleTrigger } from "@/lib/module-trigger";
import { shouldRunGameLayerOnSite } from "@/lib/public-game-layer";

type BuilderSpeechBubbleRuntimeProps = {
  module: BuilderTemplateModule;
  /** Builder /preview route — show a test control instead of auto-firing on load. */
  previewMode?: boolean;
  gamePlayContext?: ModuleGamePlayContext;
  /** When false on the public site, game/page-load overlays do not auto-fire (reminders only). */
  sitePlayerRegistered?: boolean;
};

export function shouldSpeechBubbleUseOverlayRuntime(trigger: ReturnType<typeof getModuleTrigger>): boolean {
  return trigger === "game" || trigger === "on-load" || trigger === "button";
}

export function BuilderSpeechBubbleRuntime({
  module,
  previewMode = false,
  gamePlayContext = "public",
  sitePlayerRegistered = false
}: BuilderSpeechBubbleRuntimeProps) {
  const trigger = getModuleTrigger(module.settings);
  const hasFiredOnLoadRef = useRef(false);
  const firesOnThisSite = moduleFiresForGameContext(module.settings, gamePlayContext);
  const gameLayerAllowed = shouldRunGameLayerOnSite(sitePlayerRegistered, gamePlayContext);

  function fireBubble() {
    if (!firesOnThisSite) {
      return;
    }

    if (!previewMode && !gameLayerAllowed) {
      return;
    }

    fireGameSpeechBubbleModule(module);
  }

  useEffect(() => {
    if (previewMode || !firesOnThisSite || !gameLayerAllowed) {
      return;
    }

    if (trigger !== "game" && trigger !== "on-load") {
      hasFiredOnLoadRef.current = false;
      return;
    }

    if (hasFiredOnLoadRef.current) {
      return;
    }

    hasFiredOnLoadRef.current = true;
    queueMicrotask(() => {
      fireGameSpeechBubbleModule(module);
    });
  }, [firesOnThisSite, gameLayerAllowed, module.id, module.settings, module.text, module.type, previewMode, trigger]);

  if (!shouldSpeechBubbleUseOverlayRuntime(trigger) || !firesOnThisSite) {
    return null;
  }

  if (trigger === "game" || trigger === "on-load") {
    if (!previewMode) {
      return null;
    }

    if (!gameLayerAllowed) {
      return (
        <div className="builder-confetti-module builder-confetti-module-game-stub" aria-hidden="true">
          <p className="panel-copy builder-confetti-module-copy">
            Game layer modules do not run for anonymous visitors on the live site. Log in to preview, or use
            reminders for public users.
          </p>
        </div>
      );
    }

    return (
      <div className="builder-confetti-module builder-confetti-module-game-stub" aria-hidden="true">
        <p className="panel-copy builder-confetti-module-copy">
          {trigger === "game"
            ? "Game trigger — overlay fires on the live site when this page loads and when portal game events run."
            : "Page load trigger — overlay fires when this page loads on the live site."}
        </p>
        <button className="secondary-button" onClick={fireBubble} type="button">
          Test Speech Bubble
        </button>
      </div>
    );
  }

  return (
    <div className="builder-speech-bubble-runtime">
      <button className="secondary-button builder-speech-bubble-runtime-button" onClick={fireBubble} type="button">
        {module.settings.buttonLabel?.trim() || "Show Message"}
      </button>
    </div>
  );
}
