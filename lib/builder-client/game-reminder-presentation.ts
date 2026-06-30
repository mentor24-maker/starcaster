import type { CSSProperties } from "react";
import type { GameReminderAppearance, GameReminderStripPlacement } from "@/lib/game-reminder";
import {
  getSpeechBubbleBodyStyle,
  getSpeechBubbleModuleStyle
} from "@/components/builder/builder-utils";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import { normalizeSignedOffsetValue, normalizeSpacingValue } from "@/lib/builder-template";
import { resolveGameOverlayContentZIndex } from "@/lib/game-overlay-layer";

/** Default speech-bubble chrome for reminder copy (no builder module required). */
export const REMINDER_SPEECH_BUBBLE_SETTINGS: Record<string, string> = {
  backgroundColor: "#ffffff",
  borderColor: "#4cbb17",
  borderThickness: "2",
  textColor: "#18324a",
  borderRadius: "40",
  containerWidth: "520",
  containerHeight: "0",
  offsetX: "0",
  offsetY: "0",
  zIndex: "10"
};

export function resolveReminderLayoutSettings(metadata: Record<string, unknown>): Record<string, string> {
  return {
    ...REMINDER_SPEECH_BUBBLE_SETTINGS,
    backgroundColor: normalizeBuilderHexColor(
      String(metadata.backgroundColor ?? REMINDER_SPEECH_BUBBLE_SETTINGS.backgroundColor)
    ),
    borderColor: normalizeBuilderHexColor(
      String(metadata.borderColor ?? REMINDER_SPEECH_BUBBLE_SETTINGS.borderColor)
    ),
    borderThickness: normalizeSpacingValue(
      String(metadata.borderThickness ?? REMINDER_SPEECH_BUBBLE_SETTINGS.borderThickness),
      REMINDER_SPEECH_BUBBLE_SETTINGS.borderThickness,
      0,
      24
    ),
    containerWidth: normalizeSpacingValue(
      String(metadata.containerWidth ?? REMINDER_SPEECH_BUBBLE_SETTINGS.containerWidth),
      REMINDER_SPEECH_BUBBLE_SETTINGS.containerWidth,
      200,
      900
    ),
    offsetX: normalizeSignedOffsetValue(String(metadata.offsetX ?? "0"), "0"),
    offsetY: normalizeSignedOffsetValue(String(metadata.offsetY ?? "0"), "0"),
    zIndex: normalizeSpacingValue(String(metadata.zIndex ?? "46"), "46", -999, 999999)
  };
}

export function resolveReminderHostZIndex(metadata: Record<string, unknown>): number {
  return resolveGameOverlayContentZIndex(resolveReminderLayoutSettings(metadata), 46);
}

export function getReminderSpeechBubbleShellStyle(metadata: Record<string, unknown> = {}): CSSProperties {
  return getSpeechBubbleModuleStyle(resolveReminderLayoutSettings(metadata), "overlay");
}

export function getReminderSpeechBubbleBodyStyle(metadata: Record<string, unknown> = {}): CSSProperties {
  return getSpeechBubbleBodyStyle(resolveReminderLayoutSettings(metadata));
}

export function getReminderStripOffsetStyle(metadata: Record<string, unknown>): CSSProperties {
  const settings = resolveReminderLayoutSettings(metadata);
  const offsetX = Number.parseInt(settings.offsetX ?? "0", 10);
  const offsetY = Number.parseInt(settings.offsetY ?? "0", 10);
  const x = Number.isFinite(offsetX) ? offsetX : 0;
  const y = Number.isFinite(offsetY) ? offsetY : 0;

  if (x === 0 && y === 0) {
    return {};
  }

  return { transform: `translate(${x}px, ${-y}px)` };
}

export function resolveReminderStripPlacement(metadata: Record<string, unknown>): GameReminderStripPlacement {
  const candidate = String(metadata.stripPlacement ?? metadata.strip_position ?? "top").trim().toLowerCase();

  return candidate === "bottom" ? "bottom" : "top";
}

export function reminderAppearanceUsesSpeechBubble(appearance: GameReminderAppearance): boolean {
  return appearance === "speech_bubble";
}

export function reminderAppearanceUsesStrip(appearance: GameReminderAppearance): boolean {
  return appearance === "strip";
}
