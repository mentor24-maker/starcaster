"use client";

import type { Options } from "canvas-confetti";
import type { ConfettiBurstPayload } from "@/lib/confetti-effect";
import { PLAYER_PORTAL_CONFETTI_Z_INDEX } from "@/lib/confetti-effect";
import { playConfettiSound } from "@/lib/confetti-pop-sound";

type ConfettiBurst = (options?: Options) => Promise<undefined> | null;

type ConfettiFactory = ConfettiBurst & {
  create: (
    canvas: HTMLCanvasElement,
    options?: { resize?: boolean; useWorker?: boolean }
  ) => ConfettiBurst;
};

let confettiPromise: Promise<ConfettiFactory> | null = null;

function loadConfetti(): Promise<ConfettiFactory> {
  if (!confettiPromise) {
    confettiPromise = import("canvas-confetti").then((module) => {
      const confettiFactory = (module.default ?? module) as ConfettiFactory;

      if (typeof confettiFactory !== "function") {
        throw new TypeError("canvas-confetti did not provide a callable export.");
      }

      return confettiFactory;
    });
  }

  return confettiPromise;
}

function resolveZIndex(options: Options) {
  return options.zIndex ?? PLAYER_PORTAL_CONFETTI_Z_INDEX;
}

function createConfettiCanvas(zIndex: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = String(zIndex);
  document.body.appendChild(canvas);

  return canvas;
}

function removeCanvasAfterBurst(canvas: HTMLCanvasElement) {
  window.setTimeout(() => {
    canvas.remove();
  }, 2200);
}

export async function fireConfettiBurst(payload: ConfettiBurstPayload | Options): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const burstPayload: ConfettiBurstPayload =
    "options" in payload
      ? payload
      : {
          options: payload,
          sound: "pop",
          soundVolume: 0.35
        };

  const { options, sound, soundVolume } = burstPayload;

  try {
    void playConfettiSound(sound, soundVolume, options.disableForReducedMotion ?? false);

    const confettiFactory = await loadConfetti();
    const zIndex = resolveZIndex(options);
    const canvas = createConfettiCanvas(zIndex);
    const burst = confettiFactory.create(canvas, {
      resize: true,
      useWorker: false
    }) as ConfettiBurst;
    const result = burst({ ...options, zIndex });

    if (result && typeof result.then === "function") {
      await result;
    }

    removeCanvasAfterBurst(canvas);
  } catch (error) {
    console.error("[confetti-burst] Failed to fire confetti.", error);
  }
}
