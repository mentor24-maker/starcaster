import type { Options } from "canvas-confetti";
import { MODULE_GAME_AUDIENCE_SETTING_KEY, normalizeModuleGameAudience } from "@/lib/module-game-audience";
import {
  getModuleTrigger,
  isGameModuleTrigger,
  MODULE_TRIGGER_OPTIONS,
  normalizeModuleTrigger,
  type ModuleTrigger
} from "@/lib/module-trigger";

/** Above portal chrome, modals, and builder overlays (site uses up to ~1100). */
export const PLAYER_PORTAL_CONFETTI_Z_INDEX = 12000;

/** Defaults from docs/Handoffs/confetti.js plus site z-index. */
export const CONFETTI_EFFECT_DEFAULTS: Record<string, string> = {
  particleCount: "100",
  spread: "70",
  originX: "0.5",
  originY: "0.6",
  zIndex: String(PLAYER_PORTAL_CONFETTI_Z_INDEX),
  trigger: "button",
  buttonLabel: "Confetti",
  disableForReducedMotion: "false",
  sound: "pop",
  popVolume: "35"
};

export const CONFETTI_SOUND_OPTIONS = [
  { value: "pop", label: "Pop" },
  { value: "chime", label: "Chime" },
  { value: "sparkle", label: "Sparkle" },
  { value: "fanfare", label: "Fanfare" },
  { value: "coin", label: "Coin" },
  { value: "off", label: "Off" }
] as const;

export type ConfettiSoundType = (typeof CONFETTI_SOUND_OPTIONS)[number]["value"];

export type ConfettiBurstPayload = {
  options: Options;
  sound: ConfettiSoundType;
  soundVolume: number;
};

function normalizeSoundType(value: string | undefined, playPopSoundLegacy?: string): ConfettiSoundType {
  const allowed = new Set(CONFETTI_SOUND_OPTIONS.map((option) => option.value));
  const candidate = String(value ?? "").trim();

  if (allowed.has(candidate as ConfettiSoundType)) {
    return candidate as ConfettiSoundType;
  }

  if (playPopSoundLegacy === "false") {
    return "off";
  }

  return "pop";
}

export const CONFETTI_TRIGGER_OPTIONS = MODULE_TRIGGER_OPTIONS;
export type ConfettiTrigger = ModuleTrigger;

function clampNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(String(value ?? fallback));

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function parseOrigin(value: string | undefined, fallback: number) {
  return clampNumber(value, fallback, 0, 1);
}

export function normalizeConfettiModuleSettings(settings: Record<string, string>): Record<string, string> {
  return {
    ...CONFETTI_EFFECT_DEFAULTS,
    ...settings,
    particleCount: String(
      Math.round(clampNumber(settings.particleCount, 100, 1, 500))
    ),
    spread: String(Math.round(clampNumber(settings.spread, 70, 0, 180))),
    originX: String(parseOrigin(settings.originX, 0.5)),
    originY: String(parseOrigin(settings.originY, 0.6)),
    zIndex: String(Math.round(clampNumber(settings.zIndex, 12000, 1, 999999))),
    trigger: normalizeModuleTrigger(settings.trigger),
    [MODULE_GAME_AUDIENCE_SETTING_KEY]: normalizeModuleGameAudience(settings[MODULE_GAME_AUDIENCE_SETTING_KEY]),
    buttonLabel: String(settings.buttonLabel ?? CONFETTI_EFFECT_DEFAULTS.buttonLabel).trim() || "Confetti",
    disableForReducedMotion: settings.disableForReducedMotion === "true" ? "true" : "false",
    sound: normalizeSoundType(settings.sound, settings.playPopSound),
    popVolume: String(Math.round(clampNumber(settings.popVolume, 35, 0, 100)))
  };
}

export function confettiOptionsFromModuleSettings(settings: Record<string, string>): Options {
  return confettiBurstFromModuleSettings(settings).options;
}

export function confettiBurstFromModuleSettings(settings: Record<string, string>): ConfettiBurstPayload {
  const normalized = normalizeConfettiModuleSettings(settings);

  return {
    options: {
      particleCount: Number.parseInt(normalized.particleCount, 10),
      spread: Number.parseFloat(normalized.spread),
      origin: {
        x: Number.parseFloat(normalized.originX),
        y: Number.parseFloat(normalized.originY)
      },
      zIndex: Number.parseInt(normalized.zIndex, 10),
      disableForReducedMotion: normalized.disableForReducedMotion === "true"
    },
    sound: normalizeSoundType(normalized.sound),
    soundVolume: Number.parseInt(normalized.popVolume, 10) / 100
  };
}

export function getConfettiTrigger(settings: Record<string, string>): ConfettiTrigger {
  return getModuleTrigger(normalizeConfettiModuleSettings(settings));
}

export function isGameTriggeredConfetti(settings: Record<string, string>): boolean {
  return isGameModuleTrigger(normalizeConfettiModuleSettings(settings));
}

export function getConfettiButtonLabel(settings: Record<string, string>) {
  return normalizeConfettiModuleSettings(settings).buttonLabel;
}

export function buildConfettiOriginSelectOptions() {
  const options: string[] = [];

  for (let value = 0; value <= 10; value += 1) {
    options.push((value / 10).toFixed(1));
  }

  return options;
}
