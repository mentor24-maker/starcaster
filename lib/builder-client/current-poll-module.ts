import type { CSSProperties } from "react";
import {
  getModuleBackgroundSettings,
  getModuleWidthShellStyle,
  getVerticalMarginStyle
} from "@/components/builder/builder-utils";
import { getBuilderBackgroundStyle } from "@/lib/builder-template";
import {
  getPollPodAppearanceStyle,
  normalizePollContentWidth,
  POLL_CONTENT_WIDTH_OPTIONS,
  type PollSettingsSnapshot
} from "@/lib/poll-pod-config";

type PollPanelStyle = CSSProperties & Record<`--${string}`, string | number>;

export function normalizeCurrentPollModuleWidth(value: unknown) {
  return normalizePollContentWidth(value, "100");
}

export function getCurrentPollModuleShellStyle(settings: Record<string, string>): CSSProperties {
  const width = normalizeCurrentPollModuleWidth(settings.size);
  const moduleBackground = getBuilderBackgroundStyle(getModuleBackgroundSettings(settings));

  return {
    ...getModuleWidthShellStyle({ ...settings, size: width }),
    ...getVerticalMarginStyle(settings.verticalMargin),
    ...(moduleBackground ?? {})
  };
}

export function getCurrentPollPanelStyle(
  moduleSettings: Record<string, string>,
  pollSettings?: PollSettingsSnapshot | null
): PollPanelStyle {
  const podStyle = getPollPodAppearanceStyle(pollSettings, "polls");

  return {
    ...podStyle,
    "--poll-question-width": "100%",
    "--poll-content-width": "100%",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box"
  };
}

export { POLL_CONTENT_WIDTH_OPTIONS };
