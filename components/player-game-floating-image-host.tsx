"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BuilderImagePreview } from "@/components/builder/builder-image-preview";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  PLAYER_GAME_FLOATING_IMAGE_EVENT,
  resolveGameFloatingImageDismissMs,
  type PlayerGameFloatingImageDetail
} from "@/lib/game-floating-image-trigger";

export function PlayerGameFloatingImageHost() {
  const pathname = usePathname();
  const [activeModule, setActiveModule] = useState<BuilderTemplateModule | null>(null);

  useEffect(() => {
    function handleFloatingImage(event: Event) {
      const detail = (event as CustomEvent<PlayerGameFloatingImageDetail>).detail;

      if (!detail?.module || detail.module.type !== "floating-image") {
        return;
      }

      setActiveModule(detail.module);
    }

    window.addEventListener(PLAYER_GAME_FLOATING_IMAGE_EVENT, handleFloatingImage);

    return () => {
      window.removeEventListener(PLAYER_GAME_FLOATING_IMAGE_EVENT, handleFloatingImage);
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

    const dismissMs = resolveGameFloatingImageDismissMs(activeModule.settings);

    if (dismissMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActiveModule(null);
    }, dismissMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeModule]);

  useEffect(() => {
    if (!activeModule) {
      return;
    }

    return () => {
      window.dispatchEvent(new CustomEvent("starcaster-player-game-floating-image-end"));
    };
  }, [activeModule]);

  if (!activeModule) {
    return null;
  }

  return (
    <div aria-live="polite" className="player-game-floating-image-host">
      <BuilderImagePreview gameOverlayHost module={activeModule} />
    </div>
  );
}
