import { applyBuilderColorOpacity } from "./builder-hex-color";

/**
 * A Button's GLOW — a coloured haze that spreads evenly round the pill.
 *
 * Asked for by the Alphire import (task 86bctde3a, 2026-10-27): its buttons
 * wear `0 0 22px rgba(0, 217, 255, .18)`, and the Button had nothing that
 * could carry it. Its only shadow, `dropShadow*`, is a `text-shadow` on the
 * letters (A7 files it on the Text axis), so a glow round the BOX was
 * unreachable.
 *
 * Three numbers on purpose — colour, size, strength — rather than a second
 * copy of the drop-shadow block: a glow has no offset by definition, and an
 * X/Y pair the operator must leave at zero is two controls that can only
 * break it. Rendered as a zero-offset `box-shadow`, so it paints OUTSIDE the
 * button's box and takes the button's corners.
 *
 * Pure and shared: the live renderer and the editor canvas both read
 * `getButtonModuleStyle`, which reads this, and the importer writes the
 * same keys (lib/site-import/surfaces.ts, `readGlow`).
 */

export const BUTTON_GLOW_DEFAULTS = {
  on: false,
  color: "#00d9ff",
  size: 22,
  strength: 40
};

export const BUTTON_GLOW_LIMITS = {
  size: { min: 1, max: 80 },
  strength: { min: 1, max: 100 }
};

type Settings = Record<string, string | undefined>;

function num(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function buttonGlowIsOn(settings: Settings): boolean {
  const v = String(settings.buttonGlow ?? "").trim();
  if (v === "true" || v === "on") return true;
  return BUTTON_GLOW_DEFAULTS.on && v !== "false";
}

/** The glow as a `box-shadow` value, or "" when it is off. */
export function getButtonGlowShadow(settings: Settings): string {
  if (!buttonGlowIsOn(settings)) return "";
  const d = BUTTON_GLOW_DEFAULTS;
  const l = BUTTON_GLOW_LIMITS;
  const size = num(settings.buttonGlowSize, d.size, l.size.min, l.size.max);
  const strength = num(settings.buttonGlowStrength, d.strength, l.strength.min, l.strength.max);
  const tint = applyBuilderColorOpacity(settings.buttonGlowColor?.trim() || d.color, strength);
  return `0px 0px ${size}px 0px ${tint}`;
}
