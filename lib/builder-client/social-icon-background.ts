import { DEFAULT_BUILDER_HEX_COLOR, normalizeBuilderHexColor } from "./builder-hex-color";

export const DEFAULT_SOCIAL_ICON_BACKGROUND = DEFAULT_BUILDER_HEX_COLOR;

/** Social icon backgrounds are stored and edited as hex (e.g. #ffffff). */
export function normalizeSocialIconBackgroundColor(value: unknown): string {
  return normalizeBuilderHexColor(value, DEFAULT_SOCIAL_ICON_BACKGROUND);
}
