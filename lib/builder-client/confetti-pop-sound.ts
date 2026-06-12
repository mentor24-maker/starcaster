"use client";

import type { ConfettiSoundType } from "@/lib/confetti-effect";

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    return null;
  }

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContextCtor();
  }

  return sharedAudioContext;
}

function shouldSkipSound(disableForReducedMotion: boolean) {
  if (disableForReducedMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return true;
  }

  return false;
}

type ToneSpec = {
  type: OscillatorType;
  startFrequency: number;
  endFrequency: number;
  duration: number;
  peakGain: number;
  delay?: number;
};

function playToneSequence(
  context: AudioContext,
  master: GainNode,
  startTime: number,
  tones: ToneSpec[]
) {
  for (const toneSpec of tones) {
    const toneStart = startTime + (toneSpec.delay ?? 0);
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = toneSpec.type;
    oscillator.frequency.setValueAtTime(toneSpec.startFrequency, toneStart);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(toneSpec.endFrequency, 1),
      toneStart + toneSpec.duration
    );
    oscillator.connect(gain);
    gain.connect(master);
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(toneSpec.peakGain, toneStart + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + toneSpec.duration);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + toneSpec.duration + 0.01);
  }
}

function playPopSound(context: AudioContext, master: GainNode, startTime: number) {
  playToneSequence(context, master, startTime, [
    {
      type: "triangle",
      startFrequency: 988,
      endFrequency: 196,
      duration: 0.07,
      peakGain: 0.55
    },
    {
      type: "square",
      startFrequency: 1800,
      endFrequency: 400,
      duration: 0.03,
      peakGain: 0.18
    }
  ]);
}

function playChimeSound(context: AudioContext, master: GainNode, startTime: number) {
  playToneSequence(context, master, startTime, [
    { type: "sine", startFrequency: 880, endFrequency: 880, duration: 0.12, peakGain: 0.35 },
    { type: "sine", startFrequency: 1175, endFrequency: 1175, duration: 0.14, peakGain: 0.3, delay: 0.05 },
    { type: "sine", startFrequency: 1568, endFrequency: 1568, duration: 0.16, peakGain: 0.25, delay: 0.1 }
  ]);
}

function playSparkleSound(context: AudioContext, master: GainNode, startTime: number) {
  playToneSequence(context, master, startTime, [
    { type: "triangle", startFrequency: 2400, endFrequency: 1200, duration: 0.04, peakGain: 0.12, delay: 0 },
    { type: "triangle", startFrequency: 2800, endFrequency: 1400, duration: 0.04, peakGain: 0.1, delay: 0.03 },
    { type: "triangle", startFrequency: 3200, endFrequency: 1600, duration: 0.04, peakGain: 0.08, delay: 0.06 },
    { type: "triangle", startFrequency: 3600, endFrequency: 1800, duration: 0.05, peakGain: 0.06, delay: 0.09 }
  ]);
}

function playFanfareSound(context: AudioContext, master: GainNode, startTime: number) {
  playToneSequence(context, master, startTime, [
    { type: "triangle", startFrequency: 523, endFrequency: 523, duration: 0.1, peakGain: 0.28 },
    { type: "triangle", startFrequency: 659, endFrequency: 659, duration: 0.1, peakGain: 0.28, delay: 0.08 },
    { type: "triangle", startFrequency: 784, endFrequency: 988, duration: 0.16, peakGain: 0.32, delay: 0.16 }
  ]);
}

function playCoinSound(context: AudioContext, master: GainNode, startTime: number) {
  playToneSequence(context, master, startTime, [
    { type: "square", startFrequency: 1318, endFrequency: 1760, duration: 0.05, peakGain: 0.22 },
    { type: "sine", startFrequency: 1760, endFrequency: 1318, duration: 0.08, peakGain: 0.18, delay: 0.04 }
  ]);
}

/**
 * Celebratory UI sounds via Web Audio (no asset files).
 */
export async function playConfettiSound(
  sound: ConfettiSoundType,
  volume = 0.35,
  disableForReducedMotion = false
): Promise<void> {
  if (sound === "off" || typeof window === "undefined" || shouldSkipSound(disableForReducedMotion)) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    if (context.state === "suspended") {
      await context.resume();
    }

    const now = context.currentTime;
    const clampedVolume = Math.min(1, Math.max(0, volume));
    const master = context.createGain();
    master.gain.setValueAtTime(clampedVolume, now);
    master.connect(context.destination);

    switch (sound) {
      case "chime":
        playChimeSound(context, master, now);
        break;
      case "sparkle":
        playSparkleSound(context, master, now);
        break;
      case "fanfare":
        playFanfareSound(context, master, now);
        break;
      case "coin":
        playCoinSound(context, master, now);
        break;
      case "pop":
      default:
        playPopSound(context, master, now);
        break;
    }
  } catch (error) {
    console.warn("[confetti-pop-sound] Unable to play celebration sound.", error);
  }
}

/** @deprecated Use playConfettiSound */
export async function playConfettiPopSound(volume = 0.35, disableForReducedMotion = false): Promise<void> {
  await playConfettiSound("pop", volume, disableForReducedMotion);
}
