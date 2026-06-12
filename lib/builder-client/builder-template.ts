import type { CSSProperties } from "react";
import { normalizeEmailFunction, type BuilderEmailFunction } from "@/lib/builder-email-template";
import { CONFETTI_EFFECT_DEFAULTS, normalizeConfettiModuleSettings } from "@/lib/confetti-effect";
import { normalizeCurrentPollModuleWidth } from "@/lib/current-poll-module";
import {
  defaultReminderModuleSettings,
  normalizeReminderModuleSettings
} from "@/lib/builder-reminder-module";
import { MODULE_GAME_AUDIENCE_SETTING_KEY, normalizeModuleGameAudience } from "@/lib/module-game-audience";
import { normalizeModuleTrigger, MODULE_TRIGGER_SETTING_KEY } from "@/lib/module-trigger";
import { isTransparentBuilderColor, normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import {
  HEADLINE_ROTATOR_DEFAULT_FONT_SIZE,
  HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT,
  normalizeHeadlineRotatorHeadlinesJson
} from "@/lib/headline-rotator";
import { normalizeBuilderAssetUrl, safeText } from "@/lib/builder-asset-url";
import { escapeHtmlText, sanitizeRichTextHtml } from "@/lib/sanitize-html";
import { rewriteRichTextImageSrcInHtml } from "@/lib/rich-text-image";

export { normalizeBuilderAssetUrl, resolvePublicBuilderAssetUrl, safeText } from "@/lib/builder-asset-url";

export type BuilderTemplateLayout =
  | "single"
  | "two-column"
  | "three-column"
  | "two-four"
  | "four-two"
  | "one-five"
  | "five-one"
  | "one-four-one";

export type BackgroundStylePreset = "blue-yellow-circles";

export type BuilderTemplateModuleType =
  | "navigation"
  | "heading"
  | "headline-rotator"
  | "text"
  | "code"
  | "merch"
  | "image"
  | "floating-image"
  | "video"
  | "quote"
  | "speech-bubble"
  | "reminder"
  | "button"
  | "contact-form"
  | "player-portal"
  | "table"
  | "slider"
  | "social"
  | "social-share"
  | "previous-results"
  | "current-poll"
  | "poll-category-list"
  | "confetti";

export type BuilderTemplateModule = {
  id: string;
  type: BuilderTemplateModuleType;
  column: string;
  name: string;
  text: string;
  settings: Record<string, string>;
};

export type BackgroundSettings = {
  mode: "none" | "color" | "gradient" | "image" | "style";
  color: string;
  color2: string;
  imageUrl: string;
  /** StarCaster: asset id behind imageUrl so the asset picker can round-trip. */
  imageAssetId?: string;
  styleKey: "" | BackgroundStylePreset;
};

/** StarCaster: dimmer/tint screen layered over a section's background. */
export type RowOverlayScreenSettings = {
  background: BackgroundSettings;
  opacity: number;
};

export type BuilderTemplateSection = {
  id: string;
  title: string;
  layout: BuilderTemplateLayout;
  alignment: "left" | "center" | "right";
  marginTop: string;
  marginBottom: string;
  mobileHidden: string;
  desktopHidden: string;
  mobileLayout: "stack" | "keep" | "reverse-stack";
  background: BackgroundSettings;
  overlayScreen?: RowOverlayScreenSettings;
  cellBackgrounds: Record<string, BackgroundSettings>;
  cellPadding: Record<string, string>;
  cellVerticalMargin: Record<string, string>;
  cellMobileHidden: Record<string, string>;
  cellDesktopHidden: Record<string, string>;
  cellBorderWidth: Record<string, string>;
  cellBorderColor: Record<string, string>;
  cellBorderRadius: Record<string, string>;
  cellBorderStyle: Record<string, string>;
  cellShadow: Record<string, string>;
  cellOpacity: Record<string, string>;
  cellHAlign: Record<string, string>;
  cellVAlign: Record<string, string>;
  modules: BuilderTemplateModule[];
};

export type BuilderTemplateKind = "modular" | "email";

export type BuilderTemplateRecord = {
  id: string;
  name: string;
  templateKind: BuilderTemplateKind;
  emailFunction: BuilderEmailFunction | "";
  pageBackground: BackgroundSettings;
  layoutSections: BuilderTemplateSection[];
  createdAt: string;
  updatedAt: string;
};

export type BuilderPageRecord = {
  id: string;
  name: string;
  slug: string;
  templateId: string;
  pageBackground: BackgroundSettings;
  layoutSections: BuilderTemplateSection[];
  createdAt: string;
  updatedAt: string;
  isPublished: boolean;
};

export type BuilderCellModuleRecord = {
  id: string;
  name: string;
  moduleClass: string;
  modules: BuilderTemplateModule[];
  createdAt: string;
  updatedAt: string;
};

export type BuilderSavedSectionRecord = {
  id: string;
  name: string;
  section: BuilderTemplateSection;
  createdAt: string;
  updatedAt: string;
};

export type BuilderProductType = "merch" | "personality_profile";

export type BuilderProductRecord = {
  id: string;
  name: string;
  productType: BuilderProductType;
  productUrl: string;
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
};

export const BUILDER_PREVIEW_STORAGE_KEY = "normie_builder_preview_draft";
export const BUILDER_PREVIEW_DEVICE_STORAGE_KEY = "normie_builder_preview_device";
export const BACKGROUND_STYLE_PRESETS: Array<{ value: BackgroundStylePreset; label: string }> = [
  { value: "blue-yellow-circles", label: "blue-yellow-circles" }
];

export function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function buildRichTextHtmlFromValue(value: unknown) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  return looksLikeHtml(text)
    ? text
    : text
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtmlText(paragraph).replace(/\n/g, "<br />")}</p>`)
        .join("");
}

export function formatRichTextContent(value: unknown) {
  const html = buildRichTextHtmlFromValue(value);

  if (!html) {
    return "";
  }

  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(html), "display");
}

export function prepareRichTextHtmlForEditor(value: unknown) {
  const html = buildRichTextHtmlFromValue(value);

  if (!html) {
    return "";
  }

  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(html), "editor");
}

export function prepareRichTextHtmlForStorage(html: string) {
  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(html), "storage");
}

export function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getLayoutColumns(layout: BuilderTemplateLayout) {
  if (
    layout === "two-column" ||
    layout === "two-four" ||
    layout === "four-two" ||
    layout === "one-five" ||
    layout === "five-one"
  ) {
    return ["left", "right"];
  }

  if (layout === "three-column" || layout === "one-four-one") {
    return ["left", "center", "right"];
  }

  return ["main"];
}

/**
 * StarCaster: map legacy module columns (col1/col2/col3) onto the columns
 * allowed by the section layout, falling back to the first allowed column.
 */
export function resolveModuleColumnForLayout(column: unknown, layout: unknown): string {
  const normalizedLayout = normalizeLayout(layout);
  const allowedColumns = getLayoutColumns(normalizedLayout);
  const raw = safeText(column, 40).toLowerCase();

  if (allowedColumns.includes(raw)) {
    return raw;
  }

  const legacyMapThree: Record<string, string> = {
    col1: "left",
    col2: "center",
    col3: "right",
    main: "main",
    left: "left",
    center: "center",
    right: "right"
  };
  const legacyMapTwo: Record<string, string> = {
    col1: "left",
    col2: "right",
    main: "main",
    left: "left",
    right: "right"
  };
  const legacyMapSingle: Record<string, string> = {
    col1: "main",
    main: "main"
  };
  const map =
    normalizedLayout === "single"
      ? legacyMapSingle
      : normalizedLayout === "three-column" || normalizedLayout === "one-four-one"
        ? legacyMapThree
        : legacyMapTwo;
  const mapped = map[raw];

  if (mapped && allowedColumns.includes(mapped)) {
    return mapped;
  }

  return allowedColumns[0] || "main";
}

export function getLayoutGridTemplate(layout: BuilderTemplateLayout) {
  if (layout === "four-two") {
    return "4fr 2fr";
  }

  if (layout === "two-four") {
    return "2fr 4fr";
  }

  if (layout === "one-five") {
    return "1fr 5fr";
  }

  if (layout === "five-one") {
    return "5fr 1fr";
  }

  if (layout === "two-column") {
    return "1fr 1fr";
  }

  if (layout === "three-column") {
    return "1fr 1fr 1fr";
  }

  if (layout === "one-four-one") {
    return "1fr 4fr 1fr";
  }

  return "1fr";
}

export function normalizeLayout(value: unknown): BuilderTemplateLayout {
  const layout = safeText(value, 40).toLowerCase();

  if (layout === "hero-split") {
    return "four-two";
  }

  // StarCaster legacy grid codes.
  const legacyLayoutMap: Record<string, BuilderTemplateLayout> = {
    "6": "single",
    "1-5": "one-five",
    "5-1": "five-one",
    "2-4": "two-four",
    "4-2": "four-two",
    "3-3": "two-column",
    "2-2-2": "three-column",
    "1-4-1": "one-four-one"
  };

  if (legacyLayoutMap[layout]) {
    return legacyLayoutMap[layout];
  }

  if (
    layout === "two-column" ||
    layout === "three-column" ||
    layout === "two-four" ||
    layout === "four-two" ||
    layout === "one-five" ||
    layout === "five-one" ||
    layout === "one-four-one"
  ) {
    return layout;
  }

  return "single";
}

export function normalizeAlignment(value: unknown): BuilderTemplateSection["alignment"] {
  const alignment = safeText(value, 20).toLowerCase();

  if (alignment === "center" || alignment === "right") {
    return alignment;
  }

  return "left";
}

export function normalizeMobileLayout(value: unknown): BuilderTemplateSection["mobileLayout"] {
  const mobileLayout = safeText(value, 40).toLowerCase();

  if (mobileLayout === "keep" || mobileLayout === "reverse-stack") {
    return mobileLayout;
  }

  return "stack";
}

export function normalizeBooleanText(value: unknown) {
  return safeText(value, 10).toLowerCase() === "true" ? "true" : "false";
}

export function normalizeSpacingValue(value: unknown, fallback = "0", min = 0, max = 160) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  const fallbackValue = Number.parseInt(fallback, 10);
  const normalized = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : Math.min(Math.max(Number.isFinite(fallbackValue) ? fallbackValue : min, min), max);

  return String(normalized);
}

export function normalizeSignedOffsetValue(value: unknown, fallback = "0", min = -500, max = 500) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  const fallbackValue = Number.parseInt(fallback, 10);
  const normalized = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : Math.min(Math.max(Number.isFinite(fallbackValue) ? fallbackValue : min, min), max);

  return String(normalized);
}

export function normalizeBackgroundMode(
  value: unknown
): BackgroundSettings["mode"] {
  const mode = safeText(value, 20).toLowerCase();

  if (mode === "color" || mode === "gradient" || mode === "image" || mode === "style") {
    return mode;
  }

  return "none";
}

export function normalizeBackgroundStyleKey(value: unknown): BackgroundSettings["styleKey"] {
  const styleKey = safeText(value, 80).toLowerCase();

  if (styleKey === "blue-yellow-circles") {
    return "blue-yellow-circles";
  }

  return "";
}

export function createDefaultBackgroundSettings(): BackgroundSettings {
  return {
    mode: "none",
    color: "#ffffff",
    color2: "#eaf4ff",
    imageUrl: "",
    imageAssetId: "",
    styleKey: ""
  };
}

export function normalizeBackgroundSettings(value: unknown): BackgroundSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultBackgroundSettings();
  }

  const background = value as Record<string, unknown>;

  return {
    mode: normalizeBackgroundMode(background.mode),
    color: normalizeBuilderHexColor(safeText(background.color, 40), "#ffffff"),
    color2: normalizeBuilderHexColor(safeText(background.color2, 40), "#eaf4ff"),
    imageUrl: normalizeBuilderAssetUrl(background.imageUrl),
    imageAssetId: safeText(background.imageAssetId, 120),
    styleKey: normalizeBackgroundStyleKey(background.styleKey)
  };
}

export function normalizeRowOverlayScreenSettings(value: unknown): RowOverlayScreenSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      background: createDefaultBackgroundSettings(),
      opacity: 100
    };
  }

  const overlay = value as Record<string, unknown>;
  const opacityRaw = Number(overlay.opacity);
  const opacity = Number.isFinite(opacityRaw) ? Math.min(100, Math.max(0, Math.round(opacityRaw))) : 100;

  return {
    background: normalizeBackgroundSettings(overlay.background),
    opacity
  };
}

export function getBuilderBackgroundStyle(background: BackgroundSettings | undefined): CSSProperties | undefined {
  if (!background || background.mode === "none") {
    return undefined;
  }

  if (background.mode === "color") {
    if (isTransparentBuilderColor(background.color)) {
      return {
        background: "transparent",
        backgroundColor: "transparent"
      };
    }

    return {
      background: background.color
    };
  }

  if (background.mode === "gradient") {
    return {
      backgroundImage: `linear-gradient(135deg, ${background.color} 0%, ${background.color2} 100%)`
    };
  }

  if (background.mode === "image" && background.imageUrl) {
    return {
      backgroundImage: `url("${background.imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center"
    };
  }

  if (background.mode === "style" && background.styleKey === "blue-yellow-circles") {
    return {
      background:
        "radial-gradient(circle at 15% 15%, rgba(255, 214, 10, 0.35), transparent 18%), radial-gradient(circle at 82% 14%, rgba(23, 183, 238, 0.28), transparent 18%), radial-gradient(circle at 50% 72%, rgba(255, 255, 255, 0.92), transparent 24%), linear-gradient(135deg, #d9f5ff 0%, #f8feff 36%, #fff7bf 100%)"
    };
  }

  return undefined;
}

const LIGHT_CELL_FILL_COLORS = new Set([
  "#ffffff",
  "#fff",
  "#eef6ff",
  "#ddeeff",
  "#bbddee",
  "#f8fdff",
  "#f6fbff",
  "#eaf4ff",
  "#e8f5e9",
  "#f0fdf4",
  "#ecfdf5"
]);

function normalizeCellBackgroundHexColor(value: string) {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed.startsWith("#")) {
    return trimmed;
  }

  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }

  return trimmed;
}

/** Decorative or near-white cell fills break the builder drill-down gradient — use tier tokens instead. */
export function usesBuilderDrillDownSurfaceDefault(background: BackgroundSettings | undefined) {
  if (!background || background.mode === "none") {
    return true;
  }

  if (background.mode === "style") {
    return true;
  }

  if (background.mode === "color") {
    return LIGHT_CELL_FILL_COLORS.has(normalizeCellBackgroundHexColor(background.color));
  }

  return false;
}

export function sanitizeCellBackgroundForDrillDown(background: BackgroundSettings): BackgroundSettings {
  if (usesBuilderDrillDownSurfaceDefault(background)) {
    return createDefaultBackgroundSettings();
  }

  return background;
}

function normalizeCellBackgrounds(
  value: unknown,
  layout: BuilderTemplateLayout
): Record<string, BackgroundSettings> {
  const columns = getLayoutColumns(layout);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, createDefaultBackgroundSettings()]));
  }

  const raw = value as Record<string, unknown>;
  return Object.fromEntries(
    columns.map((column) => {
      const background = normalizeBackgroundSettings(raw[column]);
      return [column, sanitizeCellBackgroundForDrillDown(background)];
    })
  );
}

function normalizeCellPadding(
  value: unknown,
  layout: BuilderTemplateLayout
): Record<string, string> {
  const columns = getLayoutColumns(layout);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, "18"]));
  }

  const raw = value as Record<string, unknown>;

  return Object.fromEntries(
    columns.map((column) => {
      const parsed = Number.parseInt(String(raw[column] ?? "18"), 10);
      const normalized = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 50) : 18;
      return [column, String(normalized)];
    })
  );
}

function normalizeCellMetric(
  value: unknown,
  layout: BuilderTemplateLayout,
  fallback: string,
  min: number,
  max: number
): Record<string, string> {
  const columns = getLayoutColumns(layout);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, fallback]));
  }

  const raw = value as Record<string, unknown>;

  return Object.fromEntries(
    columns.map((column) => {
      return [column, normalizeSpacingValue(raw[column], fallback, min, max)];
    })
  );
}

function normalizeCellColor(
  value: unknown,
  layout: BuilderTemplateLayout,
  fallback: string
): Record<string, string> {
  const columns = getLayoutColumns(layout);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, fallback]));
  }

  const raw = value as Record<string, unknown>;

  return Object.fromEntries(
    columns.map((column) => {
      const color = safeText(raw[column], 40);
      return [column, color || fallback];
    })
  );
}

export function normalizeModuleType(value: unknown): BuilderTemplateModuleType {
  const type = safeText(value, 40).toLowerCase();

  if (
    type === "navigation" ||
    type === "heading" ||
    type === "headline-rotator" ||
    type === "code" ||
    type === "merch" ||
    type === "image" ||
    type === "floating-image" ||
    type === "video" ||
    type === "quote" ||
    type === "speech-bubble" ||
    type === "reminder" ||
    type === "button" ||
    type === "contact-form" ||
    type === "player-portal" ||
    type === "table" ||
    type === "slider" ||
    type === "social" ||
    type === "social-share" ||
    type === "previous-results" ||
    type === "current-poll" ||
    type === "poll-category-list" ||
    type === "confetti"
  ) {
    return type;
  }

  return "text";
}

export function normalizeModuleSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string>;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, raw]) => {
      const normalizedKey = safeText(key, 120);
      // StarCaster: background settings live in module settings as objects
      // (legacy data); everything else is coerced to bounded strings.
      const normalizedValue =
        normalizedKey === "background" && raw && typeof raw === "object" && !Array.isArray(raw)
          ? (normalizeBackgroundSettings(raw) as unknown as string)
          : normalizedKey === "url" || normalizedKey === "backgroundImageUrl"
            ? normalizeBuilderAssetUrl(raw)
            : normalizedKey === "navItems"
              ? (Array.isArray(raw) ? JSON.stringify(raw) : safeText(raw, 500000))
              : normalizedKey === "tableData" || normalizedKey === "content" || normalizedKey === "tableContents"
                ? safeText(raw, 200000)
                : normalizedKey === "borderThickness" || normalizedKey === "borderWidth"
                  ? normalizeSpacingValue(raw, "1", 0, 24)
                  : normalizedKey === "cellPadding"
                    ? normalizeSpacingValue(raw, "14", 0, 40)
                    : normalizedKey === "columnsCount" || normalizedKey === "rowsCount"
                      ? normalizeSpacingValue(raw, "1", 1, 20)
                      : safeText(raw, 10000);

      return [normalizedKey, normalizedValue];
    })
  );
}

const OVERLAY_ONLY_IMAGE_SETTINGS = [
  "positionMode",
  "overlayAnchor",
  "offsetX",
  "offsetY",
  "zIndex"
] as const;

function stripOverlayOnlyImageSettings(settings: Record<string, string>) {
  for (const key of OVERLAY_ONLY_IMAGE_SETTINGS) {
    delete settings[key];
  }
}

export function resolveBuilderModuleType(
  rawType: unknown,
  settings: Record<string, string>
): BuilderTemplateModuleType {
  const type = normalizeModuleType(rawType);

  if (
    type === "text" &&
    (settings.particleCount !== undefined ||
      settings.spread !== undefined ||
      settings.originX !== undefined ||
      settings.popVolume !== undefined)
  ) {
    return "confetti";
  }

  if (type === "image" && settings.positionMode === "overlay" && settings.variant !== "video") {
    return "floating-image";
  }

  return type;
}

export function normalizeBuilderModuleSettingsForType(
  type: BuilderTemplateModuleType,
  value: unknown,
  moduleContext?: Pick<BuilderTemplateModule, "id" | "name" | "text">
) {
  const settings = normalizeModuleSettings(value);

  if (type === "navigation") {
    delete settings.navBackground;

    if (settings.navItems != null && typeof settings.navItems !== "string") {
      try {
        settings.navItems = JSON.stringify(settings.navItems);
      } catch {
        settings.navItems = "[]";
      }
    }
    if (!settings.menuName) settings.menuName = "Main Menu";
    if (!settings.menuLocation) settings.menuLocation = "primary";
    if (!settings.variant) settings.variant = "horizontal";
  }

  if (type === "image") {
    stripOverlayOnlyImageSettings(settings);
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
  }

  if (type === "floating-image") {
    delete settings.positionMode;
    delete settings.linkUrl;
    delete settings.newTab;
    settings.offsetX = normalizeSignedOffsetValue(settings.offsetX, "0");
    settings.offsetY = normalizeSignedOffsetValue(settings.offsetY, "0");
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
    settings.zIndex = normalizeSpacingValue(settings.zIndex, "20", -999, 999999);

    const trigger = normalizeModuleTrigger(settings[MODULE_TRIGGER_SETTING_KEY]);
    const anchor = safeText(settings.overlayAnchor, 24) || "center";
    const offsetY = Number.parseInt(settings.offsetY ?? "0", 10);

    if (trigger === "button" && (anchor === "center" || anchor === "")) {
      settings.overlayAnchor = "top-center";
      if (Number.isFinite(offsetY) && offsetY > 120) {
        settings.offsetY = "0";
      }
    }
  }

  if (type === "heading") {
    const legacy = settings.verticalMargin;
    settings.marginTop = normalizeSpacingValue(settings.marginTop ?? legacy, "0");
    settings.marginBottom = normalizeSpacingValue(settings.marginBottom ?? legacy, "0");
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
  }

  if (type === "current-poll") {
    settings.size = normalizeCurrentPollModuleWidth(settings.size);
  }

  if (type === "confetti") {
    return normalizeConfettiModuleSettings(settings);
  }

  if (type === "reminder") {
    delete settings.alignment;
    delete settings.verticalMargin;
    delete settings.width;
    return normalizeReminderModuleSettings(settings, moduleContext);
  }

  if (type === "speech-bubble") {
    settings.backgroundColor = normalizeBuilderHexColor(settings.backgroundColor || "#ffffff");
    settings.borderColor = normalizeBuilderHexColor(settings.borderColor || "#9ed4ee");
    settings.textColor = normalizeBuilderHexColor(settings.textColor || "#18324a");
    settings.borderRadius = normalizeSpacingValue(settings.borderRadius, "40", 0, 80);
    settings.borderThickness = normalizeSpacingValue(settings.borderThickness, "2", 0, 24);
    // Backward compatibility for older saved bubbles that used `width`.
    settings.containerWidth = normalizeSpacingValue(settings.containerWidth ?? settings.width, "520", 200, 900);
    delete settings.width;
    settings.containerHeight = normalizeSpacingValue(settings.containerHeight, "0", 0, 800);
    settings.offsetX = normalizeSignedOffsetValue(settings.offsetX, "0");
    settings.offsetY = normalizeSignedOffsetValue(settings.offsetY, "0");
    settings.zIndex = normalizeSpacingValue(settings.zIndex, "10", -999, 999999);
    settings[MODULE_TRIGGER_SETTING_KEY] = normalizeModuleTrigger(settings[MODULE_TRIGGER_SETTING_KEY] ?? "game");
    settings[MODULE_GAME_AUDIENCE_SETTING_KEY] = normalizeModuleGameAudience(
      settings[MODULE_GAME_AUDIENCE_SETTING_KEY] ?? "both"
    );
  }

  if (type === "headline-rotator") {
    settings.headlines = normalizeHeadlineRotatorHeadlinesJson(
      settings.headlines ?? "",
      settings.color || "#18324a"
    );
    settings.minHeight = normalizeSpacingValue(
      settings.minHeight,
      HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT,
      0,
      1200
    );
    if (!settings.verticalAlignment) {
      settings.verticalAlignment = "top";
    }
  }

  if (type === "poll-category-list") {
    settings.color = normalizeBuilderHexColor(settings.color || "#18324a");
    settings.fontSize = normalizeSpacingValue(
      settings.fontSize,
      "18",
      10,
      120
    );
    settings.itemGap = normalizeSpacingValue(settings.itemGap, "8", 0, 48);
    if (settings.categorySort !== "canonical") {
      settings.categorySort = "alphabetical";
    }
    if (settings.categoryListFlow !== "columns") {
      settings.categoryListFlow = "rows";
    }
    settings.listTitle = safeText(settings.listTitle, 120) || "Categories";
    if (!settings.bold) {
      settings.bold = "true";
    }

    const rawBackgroundMode = safeText(settings.backgroundMode, 20);
    const panelBackground = normalizeBackgroundSettings({
      mode: rawBackgroundMode || "color",
      color: settings.backgroundColor,
      color2: settings.backgroundColor2,
      imageUrl: settings.backgroundImageUrl,
      styleKey: settings.backgroundStyleKey
    });

    if (!rawBackgroundMode) {
      settings.backgroundMode = "color";
      settings.backgroundColor = normalizeBuilderHexColor(settings.backgroundColor, "#e8f6fc");
      settings.backgroundColor2 = panelBackground.color2;
      settings.backgroundImageUrl = "";
      settings.backgroundStyleKey = "";
    } else {
      settings.backgroundMode = panelBackground.mode;
      if (panelBackground.mode === "none") {
        settings.backgroundColor = "";
        settings.backgroundColor2 = "";
        settings.backgroundImageUrl = "";
        settings.backgroundStyleKey = "";
      } else {
        settings.backgroundColor = normalizeBuilderHexColor(settings.backgroundColor, "#e8f6fc");
        settings.backgroundColor2 = panelBackground.color2;
        settings.backgroundImageUrl = panelBackground.imageUrl;
        settings.backgroundStyleKey = panelBackground.styleKey;
      }
    }

    settings.panelBorderColor = normalizeBuilderHexColor(settings.panelBorderColor || "#c6e8f5", "#c6e8f5");
  }

  // StarCaster: text blocks carry their own background settings object.
  if (type === "text" && (settings.content || settings.textAlign || settings.maxWidth)) {
    const textBackground = normalizeBackgroundSettings(settings.background);
    settings.background = textBackground as unknown as string;

    if (textBackground.mode === "color") {
      settings.backgroundColor = normalizeBuilderHexColor(textBackground.color, "#ffffff");
    }
    if (textBackground.mode === "image" && textBackground.imageAssetId) {
      settings.backgroundImageId = textBackground.imageAssetId;
    }
  }

  // StarCaster: table modules keep border/padding/grid counts in sync.
  if (type === "table") {
    const borderThickness = normalizeSpacingValue(settings.borderThickness ?? settings.borderWidth, "1", 0, 24);
    settings.borderThickness = borderThickness;
    settings.borderWidth = borderThickness;
    settings.cellPadding = normalizeSpacingValue(settings.cellPadding, "14", 0, 40);
    settings.columnsCount = normalizeSpacingValue(settings.columnsCount ?? settings.columns, "3", 1, 8);
    settings.rowsCount = normalizeSpacingValue(settings.rowsCount, "4", 1, 20);
  }

  return settings;
}

function normalizeBuilderModuleFromRecord(
  module: Record<string, unknown>,
  fallbackId: string,
  fallbackColumn: string
): BuilderTemplateModule | null {
  const rawSettings = normalizeModuleSettings(module.settings);
  const type = resolveBuilderModuleType(module.type, rawSettings);

  return {
    id: safeText(module.id, 120) || fallbackId,
    type,
    column: safeText(module.column, 40) || fallbackColumn,
    name: safeText(module.name, 255),
    text: safeText(module.text, 10000),
    settings: normalizeBuilderModuleSettingsForType(type, rawSettings, {
      id: safeText(module.id, 120) || fallbackId,
      name: safeText(module.name, 255),
      text: safeText(module.text, 10000)
    })
  };
}

export function normalizeBuilderModules(
  value: unknown,
  fallbackColumn = "main"
): BuilderTemplateModule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((module, moduleIndex) => {
      if (!module || typeof module !== "object" || Array.isArray(module)) {
        return null;
      }

      return normalizeBuilderModuleFromRecord(
        module as Record<string, unknown>,
        `module-${moduleIndex + 1}`,
        fallbackColumn
      );
    })
    .filter((module): module is BuilderTemplateModule => Boolean(module));
}

export function rowToBuilderCellModule(row: Record<string, unknown>): BuilderCellModuleRecord {
  return {
    id: safeText(row.id, 120),
    name: safeText(row.name, 255),
    moduleClass: safeText(row.module_class ?? row.moduleClass, 255),
    modules: normalizeBuilderModules(row.modules),
    createdAt: safeText(row.created_at ?? row.createdAt, 120),
    updatedAt: safeText(row.updated_at ?? row.updatedAt, 120)
  };
}

export function normalizeBuilderSection(value: unknown): BuilderTemplateSection | null {
  return normalizeLayoutSections([value])[0] ?? null;
}

export function rowToBuilderSavedSection(row: Record<string, unknown>): BuilderSavedSectionRecord | null {
  const section = normalizeBuilderSection(row.section);

  if (!section) {
    return null;
  }

  return {
    id: safeText(row.id, 120),
    name: safeText(row.name, 255),
    section,
    createdAt: safeText(row.created_at ?? row.createdAt, 120),
    updatedAt: safeText(row.updated_at ?? row.updatedAt, 120)
  };
}

export function normalizeProductType(value: unknown): BuilderProductType {
  const type = safeText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  return type === "personality_profile" ? "personality_profile" : "merch";
}

export function rowToBuilderProduct(row: Record<string, unknown>): BuilderProductRecord {
  return {
    id: safeText(row.id, 120),
    name: safeText(row.name, 255),
    productType: normalizeProductType(row.product_type ?? row.productType),
    productUrl: normalizeBuilderAssetUrl(row.product_url ?? row.productUrl),
    imageUrl: normalizeBuilderAssetUrl(row.image_url ?? row.imageUrl),
    createdAt: safeText(row.created_at ?? row.createdAt, 120),
    updatedAt: safeText(row.updated_at ?? row.updatedAt, 120)
  };
}

export function normalizeLayoutSections(value: unknown): BuilderTemplateSection[] {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    try {
      return normalizeLayoutSections(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((section, sectionIndex): BuilderTemplateSection | null => {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        return null;
      }

      const normalizedSection = section as Record<string, unknown>;
      const layout = normalizeLayout(normalizedSection.layout);
      const modules = Array.isArray(normalizedSection.modules)
        ? normalizedSection.modules
            .map((module, moduleIndex) => {
              if (!module || typeof module !== "object" || Array.isArray(module)) {
                return null;
              }

              const normalizedModule = module as Record<string, unknown>;
              const column = resolveModuleColumnForLayout(normalizedModule.column, layout);
              const resolved = normalizeBuilderModuleFromRecord(
                normalizedModule,
                `module-${sectionIndex + 1}-${moduleIndex + 1}`,
                column
              );

              if (!resolved) {
                return null;
              }

              return {
                ...resolved,
                column
              } satisfies BuilderTemplateModule;
            })
            .filter((module): module is BuilderTemplateModule => Boolean(module))
        : [];

      return {
        id: safeText(normalizedSection.id, 120) || `section-${sectionIndex + 1}`,
        title: safeText(normalizedSection.title, 255),
        layout,
        alignment: normalizeAlignment(normalizedSection.alignment),
        marginTop: normalizeSpacingValue(
          normalizedSection.marginTop ?? normalizedSection.verticalMargin,
          "0",
          0,
          160
        ),
        marginBottom: normalizeSpacingValue(
          normalizedSection.marginBottom ?? normalizedSection.verticalMargin,
          "0",
          0,
          160
        ),
        mobileHidden: normalizeBooleanText(normalizedSection.mobileHidden),
        desktopHidden: normalizeBooleanText(normalizedSection.desktopHidden),
        mobileLayout: normalizeMobileLayout(normalizedSection.mobileLayout),
        background: normalizeBackgroundSettings(normalizedSection.background),
        overlayScreen: normalizeRowOverlayScreenSettings(normalizedSection.overlayScreen),
        cellBackgrounds: normalizeCellBackgrounds(normalizedSection.cellBackgrounds, layout),
        cellPadding: normalizeCellPadding(normalizedSection.cellPadding, layout),
        cellVerticalMargin: normalizeCellMetric(normalizedSection.cellVerticalMargin, layout, "0", 0, 160),
        cellMobileHidden: normalizeCellColor(normalizedSection.cellMobileHidden, layout, "false"),
        cellDesktopHidden: normalizeCellColor(normalizedSection.cellDesktopHidden, layout, "false"),
        cellBorderWidth: normalizeCellMetric(normalizedSection.cellBorderWidth, layout, "1", 0, 20),
        cellBorderColor: normalizeCellColor(normalizedSection.cellBorderColor, layout, "#d9e4ef"),
        cellBorderRadius: normalizeCellMetric(normalizedSection.cellBorderRadius, layout, "24", 0, 60),
        cellBorderStyle: normalizeCellColor(normalizedSection.cellBorderStyle, layout, "solid"),
        cellShadow: normalizeCellColor(normalizedSection.cellShadow, layout, "none"),
        cellOpacity: normalizeCellColor(normalizedSection.cellOpacity, layout, "1"),
        cellHAlign: normalizeCellColor(normalizedSection.cellHAlign, layout, "left"),
        cellVAlign: normalizeCellColor(normalizedSection.cellVAlign, layout, "top"),
        modules
      } satisfies BuilderTemplateSection;
    })
    .filter((section): section is BuilderTemplateSection => Boolean(section));
}

export function createEmptySection(layout: BuilderTemplateLayout = "single"): BuilderTemplateSection {
  return {
    id: createLocalId("section"),
    title: "",
    layout,
    alignment: "left",
    marginTop: "0",
    marginBottom: "0",
    mobileHidden: "false",
    desktopHidden: "false",
    mobileLayout: "stack",
    background: createDefaultBackgroundSettings(),
    overlayScreen: normalizeRowOverlayScreenSettings(null),
    cellBackgrounds: Object.fromEntries(
      getLayoutColumns(layout).map((column) => [column, createDefaultBackgroundSettings()])
    ),
    cellPadding: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "18"])),
    cellVerticalMargin: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellMobileHidden: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellDesktopHidden: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellBorderWidth: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "1"])),
    cellBorderColor: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "#d9e4ef"])),
    cellBorderRadius: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "24"])),
    cellBorderStyle: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "solid"])),
    cellShadow: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "none"])),
    cellOpacity: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "1"])),
    cellHAlign: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "left"])),
    cellVAlign: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "top"])),
    modules: []
  };
}

export function createEmptyModule(
  type: BuilderTemplateModuleType = "text",
  column = "main"
): BuilderTemplateModule {
  const defaults: Record<string, string> =
    type === "heading"
      ? {
          level: "h2",
          fontSize: "32",
          color: "#18324a",
          bold: "true",
          italic: "false",
          underline: "false",
          dropShadow: "false",
          dropShadowX: "3",
          dropShadowY: "3",
          dropShadowBlur: "2",
          dropShadowColor: "rgba(0, 0, 0, 0.55)",
          outline: "false",
          horizontalOffset: "0",
          verticalOffset: "0"
        }
      : type === "image"
      ? {
          url: "",
          linkUrl: "",
          newTab: "false",
          alt: "",
          size: "100",
          borderThickness: "0",
          borderColor: "#0f4f8f",
          borderRadius: "18",
          horizontalOffset: "0",
          verticalOffset: "0",
          effect: "none"
        }
      : type === "floating-image"
      ? {
          url: "",
          alt: "",
          size: "15",
          borderThickness: "0",
          borderColor: "#0f4f8f",
          borderRadius: "18",
          overlayAnchor: "center",
          offsetX: "0",
          offsetY: "0",
          horizontalOffset: "0",
          verticalOffset: "0",
          zIndex: "20",
          effect: "none"
        }
      : type === "code"
      ? {
          label: "",
          snippetMode: "html"
        }
      : type === "merch"
      ? {
          productId: "",
          productUrl: "",
          productName: "",
          imageUrl: "",
          buttonLabel: "Buy on Redbubble"
        }
      : type === "video"
      ? {
          url: "",
          newTab: "true",
          videoName: "",
          videoDescription: ""
        }
      : type === "reminder"
        ? defaultReminderModuleSettings()
      : type === "speech-bubble"
        ? {
            backgroundColor: "#ffffff",
            borderColor: "#9ed4ee",
            borderThickness: "2",
            textColor: "#18324a",
            borderRadius: "40",
            containerWidth: "520",
            containerHeight: "0",
            trigger: "game",
            gameAudience: "both",
            offsetX: "0",
            offsetY: "0",
            zIndex: "10"
          }
      : type === "button"
        ? {
            href: "",
            buttonColor: "#214c71",
            buttonHoverColor: "#0f4f8f",
            textColor: "#ffffff",
            textHoverColor: "#ffffff",
            borderColor: "#214c71",
            paddingX: "24",
            paddingY: "12"
          }
        : type === "contact-form"
          ? {
              formMode: "squeeze"
            }
          : type === "player-portal"
            ? {
                redirectPath: "/portal/dashboard",
                defaultMode: "login",
                showRegister: "true",
                showForgotPassword: "true"
              }
        : type === "table"
          ? {
              columns: "3",
              borderWidth: "1",
              borderColor: "#cccccc",
              cellPadding: "8",
              backgroundColor: "#ffffff",
              tableData: JSON.stringify({
                headers: ["", "", ""],
                cells: {},
                rowCount: 2
              })
            }
        : type === "slider"
            ? {
                sliderGap: "16",
                sliderCardWidth: "280",
                sliderHeight: "auto",
                sliderItems: JSON.stringify([])
              }
            : type === "social"
              ? {
                  socialIconSize: "44",
                  socialGap: "14",
                  socialShowLabels: "true",
                  socialItems: JSON.stringify([])
                }
              : type === "previous-results"
                ? {
                    showFallbackCopy: "true",
                    size: "100"
                  }
                : type === "current-poll"
                  ? {
                      showPromptCopy: "true",
                      size: "100"
                    }
                  : type === "poll-category-list"
                    ? {
                        listTitle: "Categories",
                        categorySort: "alphabetical",
                        categoryListFlow: "rows",
                        fontSize: "18",
                        color: "#18324a",
                        bold: "true",
                        alignment: "left",
                        itemGap: "8",
                        backgroundMode: "color",
                        backgroundColor: "#e8f6fc",
                        backgroundColor2: "#eaf4ff",
                        backgroundImageUrl: "",
                        backgroundStyleKey: "",
                        panelBorderColor: "#c6e8f5"
                      }
                  : type === "social-share"
                    ? {
                        shareLabel: "Share this poll",
                        shareTemplate: 'I just answered: "{pollQuestion}" What would you pick? {url}',
                        shareHashtags: "Normie,WYR",
                        shareVia: "Normie765714",
                        shareLabelSize: "14",
                        shareIconBackground: "#ffffff",
                        shareIconSize: "36",
                        shareGlyphSize: "20",
                        shareIconGap: "12"
                      }
                    : type === "confetti"
                      ? { ...CONFETTI_EFFECT_DEFAULTS }
                      : type === "headline-rotator"
                    ? {
                        fontSize: HEADLINE_ROTATOR_DEFAULT_FONT_SIZE,
                        color: "#18324a",
                        bold: "true",
                        dropShadow: "false",
                        dropShadowX: "3",
                        dropShadowY: "3",
                        dropShadowBlur: "2",
                        dropShadowColor: "rgba(0, 0, 0, 0.55)",
                        alignment: "center",
                        verticalAlignment: "top",
                        minHeight: HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT,
                        fadeDuration: "800",
                        displaySpeed: "3000",
                        headlines: JSON.stringify([])
                      }
          : {};

  return {
    id: createLocalId("module"),
    type,
    column,
    name: "",
    text: "",
    settings: { verticalMargin: "0", mobileHidden: "false", desktopHidden: "false", ...defaults }
  };
}

export function normalizeTemplateKind(value: unknown): BuilderTemplateKind {
  const kind = safeText(value, 40).toLowerCase();

  if (kind === "email") {
    return "email";
  }

  return "modular";
}

export function rowToBuilderTemplate(row: Record<string, unknown>): BuilderTemplateRecord {
  const document = normalizeBuilderDocument(row.layout_sections ?? row.layoutSections);

  return {
    id: safeText(row.id, 120),
    name: safeText(row.name, 255),
    templateKind: normalizeTemplateKind(row.template_kind ?? row.templateKind),
    emailFunction: normalizeEmailFunction(row.email_function ?? row.emailFunction),
    pageBackground: document.pageBackground,
    layoutSections: document.layoutSections,
    createdAt: safeText(row.created_at ?? row.createdAt, 120),
    updatedAt: safeText(row.updated_at ?? row.updatedAt, 120)
  };
}

export function rowToBuilderPage(row: Record<string, unknown>): BuilderPageRecord {
  const document = normalizeBuilderDocument(row.layout_sections ?? row.layoutSections);

  return {
    id: safeText(row.id, 120),
    name: safeText(row.name, 255),
    slug: safeText(row.slug, 255),
    templateId: safeText(row.template_id ?? row.templateId, 120),
    pageBackground: document.pageBackground,
    layoutSections: document.layoutSections,
    createdAt: safeText(row.created_at ?? row.createdAt, 120),
    updatedAt: safeText(row.updated_at ?? row.updatedAt, 120),
    isPublished: Boolean(row.is_published ?? row.isPublished ?? true)
  };
}

export function normalizeBuilderDocument(value: unknown): {
  pageBackground: BackgroundSettings;
  layoutSections: BuilderTemplateSection[];
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const document = value as Record<string, unknown>;
    return {
      pageBackground: normalizeBackgroundSettings(document.pageBackground),
      layoutSections: normalizeLayoutSections(document.sections ?? document.layoutSections)
    };
  }

  return {
    pageBackground: createDefaultBackgroundSettings(),
    layoutSections: normalizeLayoutSections(value)
  };
}

export function serializeBuilderDocument(input: {
  pageBackground?: unknown;
  layoutSections?: unknown;
}) {
  return {
    pageBackground: normalizeBackgroundSettings(input.pageBackground),
    sections: normalizeLayoutSections(input.layoutSections)
  };
}
