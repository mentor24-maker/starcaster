import type { CSSProperties } from "react";
import { normalizeBuilderAssetUrl, resolvePublicBuilderAssetUrl, safeText } from "@/lib/builder-template";
import { sanitizeRichTextHtml } from "@/lib/sanitize-html";

export const POLL_POD_BACKGROUND_MODES = ["none", "color", "gradient", "image"] as const;
export type PollPodBackgroundMode = (typeof POLL_POD_BACKGROUND_MODES)[number];

export const POLL_BACKGROUND_IMAGE_FOCUS_OPTIONS = [
  { value: "right", label: "Right (content on left)" },
  { value: "center", label: "Center" },
  { value: "left", label: "Left" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" }
] as const;

export const POLL_POD_TYPES = ["polls", "previous_results", "initial_page", "interstitial"] as const;
export type PollPodType = (typeof POLL_POD_TYPES)[number];

export const POLL_CONTENT_WIDTH_OPTIONS = ["100", "75", "67", "50"] as const;
export type PollContentWidth = (typeof POLL_CONTENT_WIDTH_OPTIONS)[number];

export const POLL_POD_LABELS: Record<PollPodType, string> = {
  polls: "Polls",
  previous_results: "Previous Results",
  initial_page: "Initial Page",
  interstitial: "Interstitial Pages"
};

export const DEFAULT_INITIAL_PAGE_CONTENT = {
  headerLabel: "",
  contentHtml:
    "<h2>Vote left, watch the story unfold on the right.</h2><p>Each screen invites you into the next question while showing the community response to the previous prompt.</p>"
} as const;

export const DEFAULT_POLL_ANSWER_BUTTONS = {
  answerButtonABackground: "#ffffff",
  answerButtonBBackground: "#ffffff",
  answerButtonABorderSize: "1",
  answerButtonBBorderSize: "1",
  answerButtonABorderColor: "#091018",
  answerButtonBBorderColor: "#091018",
  answerButtonAFontColor: "#091018",
  answerButtonBFontColor: "#091018",
  answerButtonAFontSize: "1",
  answerButtonBFontSize: "1"
} as const;

export const DEFAULT_POLL_POD_LAYOUT = {
  podBackgroundMode: "none" as PollPodBackgroundMode,
  podBackgroundColor: "transparent",
  podGradientColor1: "#ffffff",
  podGradientColor2: "#eaf4ff",
  contentWidth: "100" as PollContentWidth,
  gutterPx: "100",
  headerBackgroundColor: "#5acff9",
  headerFontColor: "#0c5f72",
  headerFontSize: "1.08",
  podBorderRadius: "34",
  headerBorderRadius: "999",
  headerBorderSize: "0",
  headerBorderColor: "transparent",
  headerDropShadowEnabled: "false",
  headerDropShadowX: "0",
  headerDropShadowY: "12",
  headerDropShadowBlur: "30",
  headerDropShadowColor: "#322217",
  headerDropShadowOpacity: "8",
  backgroundImageUrl: "",
  backgroundImageFocus: "right"
} as const;

export type PollPodLayout = {
  podBackgroundMode: PollPodBackgroundMode;
  podBackgroundColor: string;
  podGradientColor1: string;
  podGradientColor2: string;
  contentWidth: PollContentWidth;
  gutterPx: string;
  headerBackgroundColor: string;
  headerFontColor: string;
  headerFontSize: string;
  podBorderRadius: string;
  headerBorderRadius: string;
  headerBorderSize: string;
  headerBorderColor: string;
  headerDropShadowEnabled: string;
  headerDropShadowX: string;
  headerDropShadowY: string;
  headerDropShadowBlur: string;
  headerDropShadowColor: string;
  headerDropShadowOpacity: string;
  backgroundImageUrl: string;
  backgroundImageFocus: string;
};

export type PollAnswerButtons = {
  answerButtonABackground: string;
  answerButtonBBackground: string;
  answerButtonABorderSize: string;
  answerButtonBBorderSize: string;
  answerButtonABorderColor: string;
  answerButtonBBorderColor: string;
  answerButtonAFontColor: string;
  answerButtonBFontColor: string;
  answerButtonAFontSize: string;
  answerButtonBFontSize: string;
};

export type PollPodContent = {
  headerLabel: string;
  contentHtml: string;
};

export const DEFAULT_DEEP_DIVE_TRIGGER = {
  backgroundColor: "#0245A1",
  fontColor: "#ffffff",
  marginTopPx: "17",
  hoverBackgroundColor: "#0358C4",
  hoverFontColor: "#ffffff",
  fontSizeRem: "0.99"
} as const;

export type PollDeepDiveTriggerSettings = {
  backgroundColor: string;
  fontColor: string;
  marginTopPx: string;
  hoverBackgroundColor: string;
  hoverFontColor: string;
  fontSizeRem: string;
};

export type PollPodConfig = {
  layout: PollPodLayout;
  answerButtons?: PollAnswerButtons;
  content?: PollPodContent;
  deepDiveTrigger?: PollDeepDiveTriggerSettings;
};

export type PollPodsSnapshot = Record<PollPodType, PollPodConfig>;

export function createDefaultPodLayout(overrides?: Partial<PollPodLayout>): PollPodLayout {
  return { ...DEFAULT_POLL_POD_LAYOUT, ...overrides };
}

export function createDefaultPollPodConfig(type: PollPodType): PollPodConfig {
  const layout = createDefaultPodLayout(
    type === "polls" ? { contentWidth: "100", backgroundImageFocus: "right" } : undefined
  );

  if (type === "polls") {
    return {
      layout,
      answerButtons: { ...DEFAULT_POLL_ANSWER_BUTTONS }
    };
  }

  if (type === "initial_page") {
    return {
      layout,
      content: { ...DEFAULT_INITIAL_PAGE_CONTENT }
    };
  }

  if (type === "interstitial") {
    return {
      layout,
      content: {
        headerLabel: "Announcement",
        contentHtml: "<p>Interstitial message copy goes here.</p>"
      }
    };
  }

  if (type === "previous_results") {
    return {
      layout,
      deepDiveTrigger: { ...DEFAULT_DEEP_DIVE_TRIGGER }
    };
  }

  return { layout };
}

export function createDefaultPollPods(): PollPodsSnapshot {
  return {
    polls: createDefaultPollPodConfig("polls"),
    previous_results: createDefaultPollPodConfig("previous_results"),
    initial_page: createDefaultPollPodConfig("initial_page"),
    interstitial: createDefaultPollPodConfig("interstitial")
  };
}

export function normalizePollColor(value: unknown, fallback: string) {
  const trimmed = safeText(value, 32).trim().toLowerCase();

  if (!trimmed) {
    return fallback;
  }

  if (trimmed === "transparent") {
    return "transparent";
  }

  if (/^#[0-9a-f]{3}$/.test(trimmed) || /^#[0-9a-f]{6}$/.test(trimmed)) {
    return trimmed;
  }

  return fallback;
}

export function normalizePollHeaderFontSize(value: unknown, fallback: string) {
  const parsed = Number.parseFloat(safeText(value, 16));

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const clamped = Math.min(2.5, Math.max(0.75, parsed));
  return clamped.toFixed(2).replace(/\.?0+$/, "") || fallback;
}

export function normalizePollPx(value: unknown, fallback: string, max = 24) {
  const parsed = Number.parseInt(safeText(value, 8), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return String(Math.min(max, Math.max(0, parsed)));
}

export function normalizePollShadowOffset(value: unknown, fallback: string) {
  const parsed = Number.parseInt(safeText(value, 8), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return String(Math.min(40, Math.max(-40, parsed)));
}

export function normalizePollShadowBlur(value: unknown, fallback: string) {
  return normalizePollPx(value, fallback, 60);
}

export function normalizePollShadowOpacity(value: unknown, fallback: string) {
  return normalizePollPx(value, fallback, 100);
}

export function normalizePollToggle(value: unknown, fallback: string) {
  const trimmed = safeText(value, 8).trim().toLowerCase();
  return trimmed === "true" || trimmed === "on" || trimmed === "1" ? "true" : "false";
}

export function normalizePollContentWidth(value: unknown, fallback: PollContentWidth): PollContentWidth {
  const trimmed = safeText(value, 8).trim();

  if (POLL_CONTENT_WIDTH_OPTIONS.includes(trimmed as PollContentWidth)) {
    return trimmed as PollContentWidth;
  }

  return fallback;
}

export function normalizePollGutterPx(value: unknown, fallback: string) {
  return normalizePollPx(value, fallback, 240);
}

function hexToRgba(hex: string, opacityPercent: string) {
  const normalized = normalizePollColor(hex, "#000000");

  if (normalized === "transparent") {
    return "transparent";
  }

  let digits = normalized.slice(1);

  if (digits.length === 3) {
    digits = digits
      .split("")
      .map((char) => char + char)
      .join("");
  }

  const red = Number.parseInt(digits.slice(0, 2), 16);
  const green = Number.parseInt(digits.slice(2, 4), 16);
  const blue = Number.parseInt(digits.slice(4, 6), 16);
  const alpha = Math.min(100, Math.max(0, Number.parseInt(opacityPercent, 10) || 0)) / 100;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function buildPollHeaderBoxShadow(layout: PollPodLayout) {
  if (layout.headerDropShadowEnabled !== "true") {
    return "none";
  }

  const color = hexToRgba(layout.headerDropShadowColor, layout.headerDropShadowOpacity);
  return `${layout.headerDropShadowX}px ${layout.headerDropShadowY}px ${layout.headerDropShadowBlur}px ${color}`;
}

function normalizePollBackgroundMode(
  value: unknown,
  fallback: PollPodBackgroundMode,
  podBackgroundColor: string
): PollPodBackgroundMode {
  const trimmed = safeText(value, 16).trim().toLowerCase();

  if (POLL_POD_BACKGROUND_MODES.includes(trimmed as PollPodBackgroundMode)) {
    return trimmed as PollPodBackgroundMode;
  }

  if (podBackgroundColor && podBackgroundColor !== "transparent") {
    return "color";
  }

  return fallback;
}

export function getPollBackgroundImagePosition(focus: string) {
  const map: Record<string, string> = {
    right: "right center",
    left: "left center",
    center: "center center",
    top: "center top",
    bottom: "center bottom"
  };

  return map[focus] ?? "right center";
}

export function buildPollPodBackgroundStyle(layout: PollPodLayout): CSSProperties {
  if (layout.podBackgroundMode === "color") {
    return {
      background: layout.podBackgroundColor
    };
  }

  if (layout.podBackgroundMode === "gradient") {
    return {
      backgroundImage: `linear-gradient(135deg, ${layout.podGradientColor1} 0%, ${layout.podGradientColor2} 100%)`
    };
  }

  if (layout.podBackgroundMode === "image" && layout.backgroundImageUrl) {
    const imageUrl = resolvePublicBuilderAssetUrl(layout.backgroundImageUrl);

    return {
      backgroundColor: layout.podBackgroundColor === "transparent" ? "transparent" : layout.podBackgroundColor,
      backgroundImage: `url("${imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: getPollBackgroundImagePosition(layout.backgroundImageFocus),
      backgroundRepeat: "no-repeat"
    };
  }

  return {
    background: "transparent"
  };
}

function normalizePollPodLayout(input: Record<string, unknown>, fallback: PollPodLayout): PollPodLayout {
  const podBackgroundColor = normalizePollColor(
    input.podBackgroundColor ?? input.pod_background_color,
    fallback.podBackgroundColor
  );

  return {
    podBackgroundMode: normalizePollBackgroundMode(
      input.podBackgroundMode ?? input.pod_background_mode,
      fallback.podBackgroundMode,
      podBackgroundColor
    ),
    podBackgroundColor,
    podGradientColor1: normalizePollColor(
      input.podGradientColor1 ?? input.pod_gradient_color_1,
      fallback.podGradientColor1
    ),
    podGradientColor2: normalizePollColor(
      input.podGradientColor2 ?? input.pod_gradient_color_2,
      fallback.podGradientColor2
    ),
    contentWidth: normalizePollContentWidth(
      input.contentWidth ?? input.questionAreaWidth ?? input.question_area_width ?? input.content_width,
      fallback.contentWidth
    ),
    gutterPx: normalizePollGutterPx(
      input.gutterPx ?? input.gutter_px ?? input.poll_gutter_px,
      fallback.gutterPx
    ),
    headerBackgroundColor: normalizePollColor(
      input.headerBackgroundColor ?? input.header_background_color,
      fallback.headerBackgroundColor
    ),
    headerFontColor: normalizePollColor(
      input.headerFontColor ?? input.header_font_color,
      fallback.headerFontColor
    ),
    headerFontSize: normalizePollHeaderFontSize(
      input.headerFontSize ?? input.header_font_size,
      fallback.headerFontSize
    ),
    podBorderRadius: normalizePollPx(
      input.podBorderRadius ?? input.pod_border_radius,
      fallback.podBorderRadius,
      120
    ),
    headerBorderRadius: normalizePollPx(
      input.headerBorderRadius ?? input.header_border_radius,
      fallback.headerBorderRadius,
      999
    ),
    headerBorderSize: normalizePollPx(
      input.headerBorderSize ?? input.header_border_size,
      fallback.headerBorderSize
    ),
    headerBorderColor: normalizePollColor(
      input.headerBorderColor ?? input.header_border_color,
      fallback.headerBorderColor
    ),
    headerDropShadowEnabled: normalizePollToggle(
      input.headerDropShadowEnabled ?? input.header_drop_shadow_enabled,
      fallback.headerDropShadowEnabled
    ),
    headerDropShadowX: normalizePollShadowOffset(
      input.headerDropShadowX ?? input.header_drop_shadow_x,
      fallback.headerDropShadowX
    ),
    headerDropShadowY: normalizePollShadowOffset(
      input.headerDropShadowY ?? input.header_drop_shadow_y,
      fallback.headerDropShadowY
    ),
    headerDropShadowBlur: normalizePollShadowBlur(
      input.headerDropShadowBlur ?? input.header_drop_shadow_blur,
      fallback.headerDropShadowBlur
    ),
    headerDropShadowColor: normalizePollColor(
      input.headerDropShadowColor ?? input.header_drop_shadow_color,
      fallback.headerDropShadowColor
    ),
    headerDropShadowOpacity: normalizePollShadowOpacity(
      input.headerDropShadowOpacity ?? input.header_drop_shadow_opacity,
      fallback.headerDropShadowOpacity
    ),
    backgroundImageUrl: normalizeBuilderAssetUrl(input.backgroundImageUrl ?? input.background_image_url),
    backgroundImageFocus:
      POLL_BACKGROUND_IMAGE_FOCUS_OPTIONS.find(
        (option) => option.value === safeText(input.backgroundImageFocus ?? input.background_image_focus, 16)
      )?.value ?? fallback.backgroundImageFocus
  };
}

function normalizePollAnswerButtons(
  input: Record<string, unknown> | undefined,
  fallback: PollAnswerButtons
): PollAnswerButtons {
  const source = input ?? {};

  return {
    answerButtonABackground: normalizePollColor(
      source.answerButtonABackground ?? source.answer_button_a_background,
      fallback.answerButtonABackground
    ),
    answerButtonBBackground: normalizePollColor(
      source.answerButtonBBackground ?? source.answer_button_b_background,
      fallback.answerButtonBBackground
    ),
    answerButtonABorderSize: normalizePollPx(
      source.answerButtonABorderSize ?? source.answer_button_a_border_size,
      fallback.answerButtonABorderSize,
      12
    ),
    answerButtonBBorderSize: normalizePollPx(
      source.answerButtonBBorderSize ?? source.answer_button_b_border_size,
      fallback.answerButtonBBorderSize,
      12
    ),
    answerButtonABorderColor: normalizePollColor(
      source.answerButtonABorderColor ?? source.answer_button_a_border_color,
      fallback.answerButtonABorderColor
    ),
    answerButtonBBorderColor: normalizePollColor(
      source.answerButtonBBorderColor ?? source.answer_button_b_border_color,
      fallback.answerButtonBBorderColor
    ),
    answerButtonAFontColor: normalizePollColor(
      source.answerButtonAFontColor ?? source.answer_button_a_font_color,
      fallback.answerButtonAFontColor
    ),
    answerButtonBFontColor: normalizePollColor(
      source.answerButtonBFontColor ?? source.answer_button_b_font_color,
      fallback.answerButtonBFontColor
    ),
    answerButtonAFontSize: normalizePollHeaderFontSize(
      source.answerButtonAFontSize ?? source.answer_button_a_font_size,
      fallback.answerButtonAFontSize
    ),
    answerButtonBFontSize: normalizePollHeaderFontSize(
      source.answerButtonBFontSize ?? source.answer_button_b_font_size,
      fallback.answerButtonBFontSize
    )
  };
}

function normalizePollDeepDiveTrigger(
  source: Record<string, unknown>,
  fallback: PollDeepDiveTriggerSettings
): PollDeepDiveTriggerSettings {
  const nested =
    source.deepDiveTrigger && typeof source.deepDiveTrigger === "object"
      ? (source.deepDiveTrigger as Record<string, unknown>)
      : source;

  const rawMargin = Number.parseInt(
    safeText(nested.marginTopPx ?? nested.margin_top_px ?? nested.deep_dive_trigger_margin_top_px, 6),
    10
  );
  const fallbackMargin = Number.parseInt(fallback.marginTopPx, 10);
  const margin = Number.isFinite(rawMargin)
    ? Math.min(120, Math.max(0, rawMargin))
    : Number.isFinite(fallbackMargin)
      ? Math.min(120, Math.max(0, fallbackMargin))
      : 20;

  return {
    backgroundColor: normalizePollColor(
      nested.backgroundColor ?? nested.background_color ?? nested.deep_dive_trigger_background,
      fallback.backgroundColor
    ),
    fontColor: normalizePollColor(
      nested.fontColor ?? nested.font_color ?? nested.deep_dive_trigger_font_color,
      fallback.fontColor
    ),
    marginTopPx: String(margin),
    hoverBackgroundColor: normalizePollColor(
      nested.hoverBackgroundColor ??
        nested.hover_background_color ??
        nested.deep_dive_trigger_hover_background,
      fallback.hoverBackgroundColor
    ),
    hoverFontColor: normalizePollColor(
      nested.hoverFontColor ?? nested.hover_font_color ?? nested.deep_dive_trigger_hover_font_color,
      fallback.hoverFontColor
    ),
    fontSizeRem: normalizePollHeaderFontSize(
      nested.fontSizeRem ?? nested.font_size_rem ?? nested.deep_dive_trigger_font_size_rem,
      fallback.fontSizeRem
    )
  };
}

function normalizePollPodContent(
  input: Record<string, unknown> | undefined,
  fallback: PollPodContent
): PollPodContent {
  const source = input ?? {};
  const rawHtml = safeText(
    source.contentHtml ?? source.content_html ?? source.previousResultsEmptyContentHtml,
    50000
  );

  return {
    headerLabel: safeText(
      source.headerLabel ?? source.header_label ?? source.eyebrow ?? source.previousResultsEmptyEyebrow,
      120
    ) || fallback.headerLabel,
    contentHtml: sanitizeRichTextHtml(rawHtml || fallback.contentHtml)
  };
}

export function normalizePollPodConfig(
  type: PollPodType,
  input: unknown,
  fallback?: PollPodConfig
): PollPodConfig {
  const base = fallback ?? createDefaultPollPodConfig(type);
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const layoutSource =
    source.layout && typeof source.layout === "object"
      ? (source.layout as Record<string, unknown>)
      : source;

  const config: PollPodConfig = {
    layout: normalizePollPodLayout(layoutSource, base.layout)
  };

  if (type === "polls") {
    const answerSource =
      source.answerButtons && typeof source.answerButtons === "object"
        ? (source.answerButtons as Record<string, unknown>)
        : source;

    config.answerButtons = normalizePollAnswerButtons(
      answerSource,
      base.answerButtons ?? { ...DEFAULT_POLL_ANSWER_BUTTONS }
    );
  }

  if (type === "initial_page" || type === "interstitial") {
    const contentSource =
      source.content && typeof source.content === "object"
        ? (source.content as Record<string, unknown>)
        : source;

    config.content = normalizePollPodContent(contentSource, base.content ?? DEFAULT_INITIAL_PAGE_CONTENT);

    if (type === "initial_page" && config.content.headerLabel.trim() === "How It Works") {
      config.content = { ...config.content, headerLabel: "" };
    }
  }

  if (type === "previous_results") {
    config.deepDiveTrigger = normalizePollDeepDiveTrigger(source, {
      ...DEFAULT_DEEP_DIVE_TRIGGER,
      ...(base.deepDiveTrigger ?? {})
    });
  }

  return config;
}

export function normalizePollPodsInput(input: unknown): PollPodsSnapshot {
  const defaults = createDefaultPollPods();

  if (!input || typeof input !== "object") {
    return defaults;
  }

  const source = input as Record<string, unknown>;
  const podsSource =
    source.pods && typeof source.pods === "object" ? (source.pods as Record<string, unknown>) : source;

  return {
    polls: normalizePollPodConfig("polls", podsSource.polls, defaults.polls),
    previous_results: normalizePollPodConfig(
      "previous_results",
      podsSource.previous_results ?? podsSource.previousResults,
      defaults.previous_results
    ),
    initial_page: normalizePollPodConfig(
      "initial_page",
      podsSource.initial_page ?? podsSource.initialPage ?? source.previousResultsEmpty,
      defaults.initial_page
    ),
    interstitial: normalizePollPodConfig("interstitial", podsSource.interstitial, defaults.interstitial)
  };
}

export function podsFromLegacyRow(row: Record<string, unknown>): PollPodsSnapshot {
  const sharedLayout = normalizePollPodLayout(row, createDefaultPodLayout());
  const answerButtons = normalizePollAnswerButtons(row, { ...DEFAULT_POLL_ANSWER_BUTTONS });
  const initialContent = normalizePollPodContent(
    {
      eyebrow: row.previous_results_empty_eyebrow,
      contentHtml: row.previous_results_empty_content_html
    },
    DEFAULT_INITIAL_PAGE_CONTENT
  );

  return {
    polls: {
      layout: { ...sharedLayout },
      answerButtons: { ...answerButtons }
    },
    previous_results: {
      layout: { ...sharedLayout },
      deepDiveTrigger: { ...DEFAULT_DEEP_DIVE_TRIGGER }
    },
    initial_page: {
      layout: { ...sharedLayout },
      content: initialContent
    },
    interstitial: createDefaultPollPodConfig("interstitial")
  };
}

export function parsePollPodsFromRow(row: Record<string, unknown> | null): PollPodsSnapshot {
  if (!row) {
    return createDefaultPollPods();
  }

  const rawPods = row.pod_configs ?? row.podConfigs;

  if (rawPods && typeof rawPods === "object") {
    return normalizePollPodsInput(rawPods);
  }

  return podsFromLegacyRow(row);
}

export function resolvePollPod(pods: PollPodsSnapshot | null | undefined, type: PollPodType): PollPodConfig {
  return pods?.[type] ?? createDefaultPollPodConfig(type);
}

export function clonePollPodConfig(
  pods: PollPodsSnapshot,
  from: PollPodType,
  to: PollPodType,
  mode: "layout" | "all"
): PollPodsSnapshot {
  const source = pods[from];
  const target = pods[to];
  const nextConfig: PollPodConfig = {
    layout: { ...source.layout }
  };

  if (to === "polls") {
    nextConfig.answerButtons =
      mode === "all" && source.answerButtons
        ? { ...source.answerButtons }
        : target.answerButtons
          ? { ...target.answerButtons }
          : { ...DEFAULT_POLL_ANSWER_BUTTONS };
  }

  if ((to === "initial_page" || to === "interstitial") && mode === "all" && source.content) {
    nextConfig.content = { ...source.content };
  } else if ((to === "initial_page" || to === "interstitial") && target.content) {
    nextConfig.content = { ...target.content };
  }

  if (to === "previous_results") {
    nextConfig.deepDiveTrigger =
      mode === "all" && source.deepDiveTrigger
        ? { ...source.deepDiveTrigger }
        : target.deepDiveTrigger
          ? { ...target.deepDiveTrigger }
          : { ...DEFAULT_DEEP_DIVE_TRIGGER };
  }

  return {
    ...pods,
    [to]: nextConfig
  };
}

export type PollSettingsSnapshot = {
  pods: PollPodsSnapshot;
};

export function getPollGridStyle(settings: PollSettingsSnapshot | null | undefined): CSSProperties {
  const gutterPx = resolvePollPod(settings?.pods, "polls").layout.gutterPx;

  return {
    "--poll-grid-gutter": `${gutterPx}px`
  } as CSSProperties;
}

export function getPollPodAppearanceStyle(
  settings: PollSettingsSnapshot | null | undefined,
  podType: PollPodType
) {
  return getPollPodStyle(resolvePollPod(settings?.pods, podType));
}

/** @deprecated Use getPollPodAppearanceStyle(settings, podType) */
export function getPollModuleAppearanceStyle(
  settings: PollSettingsSnapshot | null | undefined,
  podType: PollPodType = "polls"
) {
  return getPollPodAppearanceStyle(settings, podType);
}

export function getPollPodStyle(pod: PollPodConfig): CSSProperties {
  const layout = pod.layout;
  const headerShadow = buildPollHeaderBoxShadow(layout);
  const buttons = pod.answerButtons ?? DEFAULT_POLL_ANSWER_BUTTONS;
  const podBackground = buildPollPodBackgroundStyle(layout);

  return {
    ...podBackground,
    "--poll-pod-bg":
      layout.podBackgroundMode === "color" ? layout.podBackgroundColor : "transparent",
    "--poll-label-bg": layout.headerBackgroundColor,
    "--poll-label-ink": layout.headerFontColor,
    "--poll-label-size": `${layout.headerFontSize}rem`,
    "--poll-pod-radius": `${layout.podBorderRadius}px`,
    "--poll-header-radius": `${layout.headerBorderRadius}px`,
    "--poll-header-border-width": `${layout.headerBorderSize}px`,
    "--poll-header-border-color": layout.headerBorderColor,
    "--poll-header-shadow": headerShadow,
    "--poll-question-width": `${layout.contentWidth}%`,
    "--poll-content-width": `${layout.contentWidth}%`,
    "--poll-answer-a-bg": buttons.answerButtonABackground,
    "--poll-answer-b-bg": buttons.answerButtonBBackground,
    "--poll-answer-a-border-width": `${buttons.answerButtonABorderSize}px`,
    "--poll-answer-b-border-width": `${buttons.answerButtonBBorderSize}px`,
    "--poll-answer-a-border-color": buttons.answerButtonABorderColor,
    "--poll-answer-b-border-color": buttons.answerButtonBBorderColor,
    "--poll-answer-a-color": buttons.answerButtonAFontColor,
    "--poll-answer-b-color": buttons.answerButtonBFontColor,
    "--poll-answer-a-font-size": `${buttons.answerButtonAFontSize}rem`,
    "--poll-answer-b-font-size": `${buttons.answerButtonBFontSize}rem`
  } as CSSProperties;
}

export function validatePollPodsInput(pods: PollPodsSnapshot) {
  if (!pods.initial_page.content?.contentHtml.trim()) {
    return "Initial Page message is required.";
  }

  return null;
}
