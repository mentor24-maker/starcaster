export const DEFAULT_BUILDER_HEX_COLOR = "#ffffff";

const LEGACY_WHITE_RGBA = new Set([
  "rgba(255, 255, 255, 0.94)",
  "rgba(255,255,255,0.94)",
  "rgba(255, 255, 255, 0.92)",
  "rgba(255,255,255,0.92)"
]);

function expandShortHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  return hex;
}

function rgbComponentsToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function parseRgbOrRgba(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );

  if (!match) {
    return null;
  }

  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] !== undefined ? Number(match[4]) : 1;

  if (![r, g, b, a].every(Number.isFinite)) {
    return null;
  }

  return { r, g, b, a };
}

export function isTransparentBuilderColor(value: unknown): boolean {
  const trimmed = String(value ?? "").trim().toLowerCase();

  if (!trimmed || trimmed === "transparent") {
    return true;
  }

  if (/^#[0-9a-f]{8}$/i.test(trimmed) && trimmed.slice(-2) === "00") {
    return true;
  }

  const rgba = parseRgbOrRgba(trimmed);

  return rgba !== null && rgba.a <= 0;
}

/** Builder color settings are stored and edited as hex (e.g. #ffffff). */
export function normalizeBuilderHexColor(value: unknown, fallback = DEFAULT_BUILDER_HEX_COLOR): string {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return fallback;
  }

  if (trimmed.toLowerCase() === "transparent") {
    return "transparent";
  }

  const compact = trimmed.replace(/\s+/g, "");

  if (LEGACY_WHITE_RGBA.has(trimmed) || LEGACY_WHITE_RGBA.has(compact)) {
    return fallback;
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed) || /^#[0-9a-f]{6}$/i.test(trimmed)) {
    return expandShortHex(trimmed.toLowerCase());
  }

  const rgb = parseRgbOrRgba(trimmed);

  if (rgb) {
    if (rgb.a <= 0) {
      return "transparent";
    }

    return rgbComponentsToHex(rgb.r, rgb.g, rgb.b);
  }

  return fallback;
}

/** Background opacity is stored as 0–100 (percent). */
export function clampBuilderOpacity(value: unknown, fallback = 100): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/** Convert a builder hex color to rgba when opacity is below 100%. */
export function applyBuilderColorOpacity(color: string, opacityPercent: number): string {
  const opacity = clampBuilderOpacity(opacityPercent);
  if (opacity >= 100) {
    return normalizeBuilderHexColor(color);
  }

  if (isTransparentBuilderColor(color)) {
    return "transparent";
  }

  const hex = normalizeBuilderHexColor(color).replace("#", "");
  const expanded = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
  const value = Number.parseInt(expanded, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}
