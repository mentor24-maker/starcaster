"use client";

import { useEffect, useRef } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { fireGameFloatingImageModule } from "@/lib/game-floating-image-trigger";
import {
  moduleFiresForGameContext,
  type ModuleGamePlayContext
} from "@/lib/module-game-audience";
import { getModuleTrigger } from "@/lib/module-trigger";
import { shouldRunGameLayerOnSite } from "@/lib/public-game-layer";

type BuilderFloatingImageRuntimeProps = {
  module: BuilderTemplateModule;
  /** Builder /preview route — show a test control instead of auto-firing on load. */
  previewMode?: boolean;
  gamePlayContext?: ModuleGamePlayContext;
  /**
   * Overlay-flow row mascot (e.g. a bouncing character anchored to a row): stay inline on the page;
   * do not auto-fire the full-screen host on load (game events still can).
   */
  overlayFlowDecor?: boolean;
  sitePlayerRegistered?: boolean;
};

export function shouldFloatingImageUseOverlayHost(trigger: ReturnType<typeof getModuleTrigger>): boolean {
  return trigger === "game" || trigger === "on-load";
}

export function BuilderFloatingImageRuntime({
  module,
  previewMode = false,
  gamePlayContext = "public",
  overlayFlowDecor = false,
  sitePlayerRegistered = false
}: BuilderFloatingImageRuntimeProps) {
  const trigger = getModuleTrigger(module.settings);
  const hasFiredOnLoadRef = useRef(false);
  const firesOnThisSite = moduleFiresForGameContext(module.settings, gamePlayContext);
  const gameLayerAllowed = shouldRunGameLayerOnSite(sitePlayerRegistered, gamePlayContext);

  function fireFloatingImage() {
    if (!firesOnThisSite) {
      return;
    }

    if (!previewMode && !gameLayerAllowed) {
      return;
    }

    fireGameFloatingImageModule(module);
  }

  useEffect(() => {
    if (previewMode || !firesOnThisSite || !gameLayerAllowed || overlayFlowDecor) {
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
      fireGameFloatingImageModule(module);
    });
  }, [firesOnThisSite, gameLayerAllowed, module, overlayFlowDecor, previewMode, trigger]);

  if (!shouldFloatingImageUseOverlayHost(trigger) || !firesOnThisSite || !gameLayerAllowed || overlayFlowDecor) {
    return null;
  }

  if (!previewMode) {
    return null;
  }

  return (
    <div className="builder-confetti-module builder-confetti-module-game-stub" aria-hidden="true">
      <p className="panel-copy builder-confetti-module-copy">
        {trigger === "game"
          ? "Game trigger — floating image and backdrop fire in the full-screen overlay layer on the live site."
          : "Page load trigger — floating image fires in the overlay layer when this page loads."}
      </p>
      <button className="secondary-button" onClick={fireFloatingImage} type="button">
        Test Floating Image
      </button>
    </div>
  );
}
