"use client";

import { useEffect, useRef } from "react";
import {
  confettiBurstFromModuleSettings,
  getConfettiButtonLabel,
  getConfettiTrigger
} from "@/lib/confetti-effect";
import { fireConfettiBurst } from "@/lib/confetti-burst";

type BuilderConfettiRuntimeProps = {
  preview?: boolean;
  settings: Record<string, string>;
};

export function BuilderConfettiRuntime({ preview = false, settings }: BuilderConfettiRuntimeProps) {
  const trigger = getConfettiTrigger(settings);
  const buttonLabel = getConfettiButtonLabel(settings);
  const hasFiredOnLoadRef = useRef(false);

  useEffect(() => {
    if (trigger !== "on-load") {
      hasFiredOnLoadRef.current = false;
      return;
    }

    if (preview && hasFiredOnLoadRef.current) {
      return;
    }

    hasFiredOnLoadRef.current = true;
    void fireConfettiBurst(confettiBurstFromModuleSettings(settings));
  }, [preview, settings, trigger]);

  function fireBurst() {
    void fireConfettiBurst(confettiBurstFromModuleSettings(settings));
  }

  if (trigger === "game") {
    if (!preview) {
      return null;
    }

    return (
      <div className="builder-confetti-module builder-confetti-module-game-stub" aria-hidden="true">
        <p className="panel-copy builder-confetti-module-copy">
          Game trigger — no button on the live page. The game layer fires this effect (e.g. on level up).
        </p>
        <button className="secondary-button" onClick={fireBurst} type="button">
          Test Burst
        </button>
      </div>
    );
  }

  if (trigger === "on-load") {
    return (
      <div className="builder-confetti-module">
        <p className="panel-copy builder-confetti-module-copy">
          Confetti runs when this page loads.
        </p>
        {preview ? (
          <button className="secondary-button" onClick={fireBurst} type="button">
            Test Burst
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="builder-confetti-module">
      <button className="secondary-button builder-confetti-module-button" onClick={fireBurst} type="button">
        {buttonLabel}
      </button>
    </div>
  );
}
