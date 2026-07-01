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
import { applyBuilderColorOpacity, clampBuilderOpacity, isTransparentBuilderColor, normalizeBuilderHexColor } from "@/lib/builder-hex-color";
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
  | "confetti"
  | "tractor-nav"
  | "breadcrumb"
  | "blog-post-list"
  | "blog-post-card"
  | "blog-author-bio"
  | "crm-form"
  | "crm-contacts-table"
  | "blog-toc"
  | "blog-newsletter-subscribe"
  | "blog-related-posts"
  | "blog-category-filter"
  | "blog-post"
  | "blog-tag-cloud"
  | "blog-post-tags"
  | "blog-post-create"
  | "blog-post-manager"
  | "blog-category-manager"
  | "blog-card-manager"
  | "blog-search"
  | "blog-search-results"
  | "messaging-topic-list"
  | "messaging-tag-list"
  | "admin-team-users"
  | "admin-modules"
  | "admin-login"
  | "admin-nav-link";

export type BuilderTemplateModule = {
  id: string;
  type: BuilderTemplateModuleType;
  column: string;
  name: string;
  text: string;
  settings: Record<string, string>;
  /** ID of the BuilderCellModuleRecord this was inserted from, if any. */
  savedModuleId?: string;
  /** When true, push operations from the canonical source skip this instance. */
  canonicalLocked?: boolean;
};

export type BackgroundSettings = {
  mode: "none" | "color" | "gradient" | "image" | "style";
  color: string;
  color2: string;
  imageUrl: string;
  /** StarCaster: asset id behind imageUrl so the asset picker can round-trip. */
  imageAssetId?: string;
  styleKey: "" | BackgroundStylePreset;
  /** 0–100. Color/gradient bake alpha into rgba; image/style use a backdrop layer. */
  opacity?: number;
};

/** StarCaster: dimmer/tint screen layered over a section's background. */
export type RowOverlayScreenSettings = {
  background: BackgroundSettings;
  opacity: number;
};

/**
 * Document-level Theme. Lives alongside pageBackground/sections in the layout
 * document JSON. Typography is the first (and currently only) facet; palette and
 * spacing facets are expected to follow. All values use "inherit" sentinels
 * (empty string for text, 0 for numbers) so the default theme is a visual no-op
 * — absent/default theme renders exactly like the pre-theme baseline.
 */
export type BuilderThemeFontRole = "heading" | "body" | "mono";

export type BuilderThemeElement =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "p"
  | "a"
  | "blockquote"
  | "button"
  | "nav"
  | "caption"
  | "code";

/**
 * Sparse per-element override. Only fields the user has set are present; absent
 * fields inherit from the typography scale / font roles / element CSS defaults.
 */
export type BuilderThemeElementStyle = {
  /** Font key (same keyspace as BUILDER_HEADING_FONTS); "" = inherit role font. */
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  color?: string;
  marginTop?: number;
  marginBottom?: number;
  /** CSS text-shadow value (drop shadow); "" = none. */
  textShadow?: string;
};

export type BuilderThemeTypography = {
  /** Named font slots that elements inherit from unless individually overridden. */
  fonts: Record<BuilderThemeFontRole, string>;
  /** Modular type scale: H1–H6 derive from baseSize × ratioⁿ unless overridden. */
  scale: {
    baseSize: number;
    ratio: number;
    baseLineHeight: number;
    /** Per-heading size overrides in px (0 = derive from scale). */
    h1?: number; h2?: number; h3?: number; h4?: number; h5?: number; h6?: number;
    /** Per-heading line-height overrides (0 = inherit baseLineHeight). */
    h1Lh?: number; h2Lh?: number; h3Lh?: number; h4Lh?: number; h5Lh?: number; h6Lh?: number;
    /** Per-heading font-weight overrides (0 = inherit; typical values 400–900). */
    h1Fw?: number; h2Fw?: number; h3Fw?: number; h4Fw?: number; h5Fw?: number; h6Fw?: number;
  };
  /** Semantic color roles wired to the palette, not raw hex at call sites. */
  colors: {
    text: string;
    heading: string;
    muted: string;
    link: string;
    linkHover: string;
    selection: string;
    /** Whether links render with an underline (default: true). */
    linkUnderline?: boolean;
    linkHoverUnderline?: boolean;
  };
  /** Sparse map — only elements the user has customized are present. */
  elements: Partial<Record<BuilderThemeElement, BuilderThemeElementStyle>>;
  /** Form control chrome (radio accent, labels, field focus ring). Stored in typography JSON. */
  forms?: {
    radioAccent?: string;
    radioLabel?: string;
    fieldFocus?: string;
  };
  /** Page viewport margins (Themes → Styles). Mirrored here when DB margin columns are absent. */
  pageLayout?: {
    topMargin?: number;
    bottomMargin?: number;
    sideMargins?: number;
  };
};

export type BuilderTheme = {
  typography: BuilderThemeTypography;
};

/** Lightweight reference to a saved theme in the builder_themes table. */
export type BuilderThemeSummary = {
  id: string;
  name: string;
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  borderThickness?: number;
  borderRadius?: number;
  containerBlur?: number;
  contrastLevel?: number;
  topMargin?: number;
  bottomMargin?: number;
  sideMargins?: number;
  logoWideId?: string;
  logoSquareId?: string;
  featureImageId?: string;
  backgroundImageId?: string;
  /** Theme Styles → Page Background (website shell default). */
  stylesPageBackground?: BackgroundSettings;
  /** @deprecated Use stylesPageBackground — kept for API compatibility. */
  pageBackground?: BackgroundSettings;
  typography?: BuilderThemeTypography;
};

export type BuilderTemplateSection = {
  id: string;
  title: string;
  locked: boolean;
  isPrivate: boolean;
  /** ID of the saved section this was instantiated from, if any. */
  savedSectionId?: string;
  /** When true, this instance stays in sync with the master saved section. */
  canonical?: boolean;
  layout: BuilderTemplateLayout;
  alignment: "left" | "center" | "right";
  marginTop: string;
  marginBottom: string;
  rowBorderWidth: string;
  rowBorderColor: string;
  rowBorderStyle: string;
  rowBorderRadius: string;
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
  cellIsPrivate: Record<string, string>;
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
  theme: BuilderTheme;
  layoutSections: BuilderTemplateSection[];
  createdAt: string;
  updatedAt: string;
};

export type BuilderPageRecord = {
  id: string;
  name: string;
  slug: string;
  templateId: string;
  themeId?: string;
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  layoutSections: BuilderTemplateSection[];
  createdAt: string;
  updatedAt: string;
  isPublished: boolean;
  isPrivate: boolean;
};

export type BuilderCellModuleRecord = {
  id: string;
  name: string;
  moduleClass: string;
  isPrivate: boolean;
  modules: BuilderTemplateModule[];
  createdAt: string;
  updatedAt: string;
};

export type BuilderSavedSectionRecord = {
  id: string;
  name: string;
  section: BuilderTemplateSection;
  isPrivate: boolean;
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

export type BuilderPageSnapshot = {
  id: string;
  label: string;
  pageCount: number;
  pages: BuilderPageRecord[];
  createdAt: string;
};

export type BuilderPageSnapshotSummary = {
  id: string;
  label: string;
  pageCount: number;
  createdAt: string;
};

export const BUILDER_PREVIEW_STORAGE_KEY = "starcaster_builder_preview_draft";
export const BUILDER_PREVIEW_DEVICE_STORAGE_KEY = "starcaster_builder_preview_device";
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

function normalizeDecimalValue(value: unknown, fallback: string, min: number, max: number) {
  const parsed = Number.parseFloat(String(value ?? fallback));
  const fallbackValue = Number.parseFloat(fallback);
  const normalized = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : Math.min(Math.max(Number.isFinite(fallbackValue) ? fallbackValue : min, min), max);
  // Drop trailing zeros so saved values stay tidy (1.20 -> 1.2, 0.0 -> 0).
  return String(Number(normalized.toFixed(2)));
}

// Keep these in sync with BUILDER_HEADING_FONTS in components/builder/builder-utils.ts.
const HEADING_FONT_KEYS = new Set([
  "",
  "inter",
  "poppins",
  "montserrat",
  "oswald",
  "archivo",
  "space-grotesk",
  "bebas",
  "playfair",
  "merriweather",
  "lora"
]);
const HEADING_TEXT_ALIGN_KEYS = new Set(["left", "center", "right"]);
const HEADING_TEXT_TRANSFORM_KEYS = new Set(["none", "uppercase", "lowercase", "capitalize"]);
const HEADING_FONT_WEIGHTS = new Set(["400", "500", "600", "700", "800", "900"]);

function normalizeHeadingFontWeight(value: unknown, bold: unknown) {
  const candidate = String(value ?? "");
  if (HEADING_FONT_WEIGHTS.has(candidate)) {
    return candidate;
  }
  return bold === "false" ? "500" : "800";
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
    styleKey: "",
    opacity: 100
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
    styleKey: normalizeBackgroundStyleKey(background.styleKey),
    opacity: clampBuilderOpacity(background.opacity)
  };
}

/**
 * Promote mode from "none" when background fields were configured without a mode
 * (e.g. color picked before mode was committed in the picker UI).
 * Explicit mode "none" always wins — stale color/image values are discarded.
 */
export function finalizeBackgroundSettings(background: BackgroundSettings | unknown): BackgroundSettings {
  const normalized = normalizeBackgroundSettings(background);
  if (normalized.mode !== "none") {
    return normalized;
  }

  const raw =
    background && typeof background === "object" && !Array.isArray(background)
      ? (background as Record<string, unknown>)
      : null;
  const rawMode = safeText(raw?.mode, 20).toLowerCase();
  if (rawMode === "none") {
    return createDefaultBackgroundSettings();
  }

  if (normalized.styleKey) {
    return { ...normalized, mode: "style" };
  }

  if (normalized.imageUrl) {
    return { ...normalized, mode: "image" };
  }

  const defaults = createDefaultBackgroundSettings();
  const colorChanged = normalized.color !== defaults.color;
  const color2Changed = normalized.color2 !== defaults.color2;
  const opacityChanged = clampBuilderOpacity(normalized.opacity) !== clampBuilderOpacity(defaults.opacity);

  if (colorChanged && color2Changed) {
    return { ...normalized, mode: "gradient" };
  }

  if (colorChanged || opacityChanged) {
    return { ...normalized, mode: "color" };
  }

  return normalized;
}

/**
 * Theme Styles → Page Background only. Promotes mode "none" when a custom color,
 * gradient, image, or style was configured (picker often leaves mode unset).
 * Returns null when no theme shell background is configured.
 */
export function promoteThemeStylesPageBackground(
  background: BackgroundSettings | unknown
): BackgroundSettings | null {
  if (!background || typeof background !== "object" || Array.isArray(background)) {
    return null;
  }

  const normalized = normalizeBackgroundSettings(background);
  if (normalized.mode !== "none") {
    return normalized;
  }

  if (normalized.styleKey) {
    return { ...normalized, mode: "style" };
  }

  if (normalized.imageUrl) {
    return { ...normalized, mode: "image" };
  }

  const defaults = createDefaultBackgroundSettings();
  const colorChanged =
    normalized.color !== defaults.color && !isTransparentBuilderColor(normalized.color);
  const color2Changed = normalized.color2 !== defaults.color2;
  const opacityChanged =
    clampBuilderOpacity(normalized.opacity) !== clampBuilderOpacity(defaults.opacity);

  if (colorChanged && color2Changed) {
    return { ...normalized, mode: "gradient" };
  }

  if (colorChanged || opacityChanged) {
    return { ...normalized, mode: "color" };
  }

  return null;
}

/** Persistable theme Styles page background (promotes then defaults to explicit none). */
export function finalizeThemeStylesPageBackground(
  background: BackgroundSettings | unknown
): BackgroundSettings {
  return promoteThemeStylesPageBackground(background) ?? createDefaultBackgroundSettings();
}
export function getBuilderBackgroundLayerOpacity(background: BackgroundSettings | undefined): number {
  if (!background || background.mode === "none") {
    return 1;
  }

  const opacity = clampBuilderOpacity(background.opacity) / 100;
  if (background.mode === "image" || background.mode === "style") {
    return opacity;
  }

  return 1;
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

const THEME_ELEMENT_KEYS = new Set<BuilderThemeElement>([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "blockquote",
  "button",
  "nav",
  "caption",
  "code"
]);
const THEME_TEXT_TRANSFORMS = new Set(["none", "uppercase", "lowercase", "capitalize"]);

export function createDefaultTheme(): BuilderTheme {
  // Pure "inherit" defaults — emitting this theme produces no overrides, so an
  // absent or default theme is indistinguishable from the pre-theme baseline.
  return {
    typography: {
      fonts: { heading: "", body: "", mono: "" },
      scale: { baseSize: 0, ratio: 0, baseLineHeight: 0 },
      colors: { text: "", heading: "", muted: "", link: "", linkHover: "", selection: "" },
      elements: {}
    }
  };
}

/** Optional theme color: "" when blank/unset, otherwise a normalized hex. */
function normalizeThemeColor(value: unknown): string {
  if (!String(value ?? "").trim()) {
    return "";
  }
  return normalizeBuilderHexColor(value, "");
}

/** Clamp a number into [min, max]; returns 0 ("inherit") for blank/invalid. */
function normalizeThemeNumber(value: unknown, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) {
    return 0;
  }
  return Math.min(max, Math.max(min, num));
}

function normalizeThemeFontKey(value: unknown): string {
  const key = safeText(value, 40);
  return HEADING_FONT_KEYS.has(key) ? key : "";
}

function normalizeThemeElementStyle(value: unknown): BuilderThemeElementStyle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const style: BuilderThemeElementStyle = {};

  const fontFamily = normalizeThemeFontKey(raw.fontFamily);
  if (fontFamily) style.fontFamily = fontFamily;

  const fontSize = normalizeThemeNumber(raw.fontSize, 6, 400);
  if (fontSize) style.fontSize = fontSize;

  const fontWeight = normalizeThemeNumber(raw.fontWeight, 100, 900);
  if (fontWeight) style.fontWeight = fontWeight;

  const lineHeight = normalizeThemeNumber(raw.lineHeight, 0.5, 4);
  if (lineHeight) style.lineHeight = lineHeight;

  // letterSpacing/margins allow negatives; only 0 means "unset".
  const letterSpacing = normalizeThemeNumber(raw.letterSpacing, -20, 60);
  if (letterSpacing) style.letterSpacing = letterSpacing;

  const marginTop = normalizeThemeNumber(raw.marginTop, -400, 400);
  if (marginTop) style.marginTop = marginTop;

  const marginBottom = normalizeThemeNumber(raw.marginBottom, -400, 400);
  if (marginBottom) style.marginBottom = marginBottom;

  const transform = safeText(raw.textTransform, 20);
  if (transform && transform !== "none" && THEME_TEXT_TRANSFORMS.has(transform)) {
    style.textTransform = transform as BuilderThemeElementStyle["textTransform"];
  }

  const color = normalizeThemeColor(raw.color);
  if (color) style.color = color;

  const textShadow = safeText(raw.textShadow, 200);
  if (textShadow) style.textShadow = textShadow;

  return Object.keys(style).length > 0 ? style : null;
}

export function normalizeTheme(value: unknown): BuilderTheme {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultTheme();
  }
  const theme = value as Record<string, unknown>;
  const typography =
    theme.typography && typeof theme.typography === "object" && !Array.isArray(theme.typography)
      ? (theme.typography as Record<string, unknown>)
      : {};

  const fonts = (typography.fonts ?? {}) as Record<string, unknown>;
  const scale = (typography.scale ?? {}) as Record<string, unknown>;
  const colors = (typography.colors ?? {}) as Record<string, unknown>;
  const rawElements =
    typography.elements && typeof typography.elements === "object" && !Array.isArray(typography.elements)
      ? (typography.elements as Record<string, unknown>)
      : {};

  const elements: Partial<Record<BuilderThemeElement, BuilderThemeElementStyle>> = {};
  for (const key of Object.keys(rawElements)) {
    if (!THEME_ELEMENT_KEYS.has(key as BuilderThemeElement)) continue;
    const normalized = normalizeThemeElementStyle(rawElements[key]);
    if (normalized) elements[key as BuilderThemeElement] = normalized;
  }

  return {
    typography: {
      fonts: {
        heading: normalizeThemeFontKey(fonts.heading),
        body: normalizeThemeFontKey(fonts.body),
        mono: normalizeThemeFontKey(fonts.mono)
      },
      scale: {
        baseSize: normalizeThemeNumber(scale.baseSize, 10, 100),
        ratio: normalizeThemeNumber(scale.ratio, 1, 2.5),
        baseLineHeight: normalizeThemeNumber(scale.baseLineHeight, 0.8, 3),
        ...(normalizeThemeNumber(scale.h1, 8, 200) ? { h1: normalizeThemeNumber(scale.h1, 8, 200) } : {}),
        ...(normalizeThemeNumber(scale.h2, 8, 200) ? { h2: normalizeThemeNumber(scale.h2, 8, 200) } : {}),
        ...(normalizeThemeNumber(scale.h3, 8, 200) ? { h3: normalizeThemeNumber(scale.h3, 8, 200) } : {}),
        ...(normalizeThemeNumber(scale.h4, 8, 200) ? { h4: normalizeThemeNumber(scale.h4, 8, 200) } : {}),
        ...(normalizeThemeNumber(scale.h5, 8, 200) ? { h5: normalizeThemeNumber(scale.h5, 8, 200) } : {}),
        ...(normalizeThemeNumber(scale.h6, 8, 200) ? { h6: normalizeThemeNumber(scale.h6, 8, 200) } : {}),
        ...(normalizeThemeNumber(scale.h1Lh, 0.8, 3) ? { h1Lh: normalizeThemeNumber(scale.h1Lh, 0.8, 3) } : {}),
        ...(normalizeThemeNumber(scale.h2Lh, 0.8, 3) ? { h2Lh: normalizeThemeNumber(scale.h2Lh, 0.8, 3) } : {}),
        ...(normalizeThemeNumber(scale.h3Lh, 0.8, 3) ? { h3Lh: normalizeThemeNumber(scale.h3Lh, 0.8, 3) } : {}),
        ...(normalizeThemeNumber(scale.h4Lh, 0.8, 3) ? { h4Lh: normalizeThemeNumber(scale.h4Lh, 0.8, 3) } : {}),
        ...(normalizeThemeNumber(scale.h5Lh, 0.8, 3) ? { h5Lh: normalizeThemeNumber(scale.h5Lh, 0.8, 3) } : {}),
        ...(normalizeThemeNumber(scale.h6Lh, 0.8, 3) ? { h6Lh: normalizeThemeNumber(scale.h6Lh, 0.8, 3) } : {}),
        ...(normalizeThemeNumber(scale.h1Fw, 100, 900) ? { h1Fw: normalizeThemeNumber(scale.h1Fw, 100, 900) } : {}),
        ...(normalizeThemeNumber(scale.h2Fw, 100, 900) ? { h2Fw: normalizeThemeNumber(scale.h2Fw, 100, 900) } : {}),
        ...(normalizeThemeNumber(scale.h3Fw, 100, 900) ? { h3Fw: normalizeThemeNumber(scale.h3Fw, 100, 900) } : {}),
        ...(normalizeThemeNumber(scale.h4Fw, 100, 900) ? { h4Fw: normalizeThemeNumber(scale.h4Fw, 100, 900) } : {}),
        ...(normalizeThemeNumber(scale.h5Fw, 100, 900) ? { h5Fw: normalizeThemeNumber(scale.h5Fw, 100, 900) } : {}),
        ...(normalizeThemeNumber(scale.h6Fw, 100, 900) ? { h6Fw: normalizeThemeNumber(scale.h6Fw, 100, 900) } : {})
      },
      colors: {
        text: normalizeThemeColor(colors.text),
        heading: normalizeThemeColor(colors.heading),
        muted: normalizeThemeColor(colors.muted),
        link: normalizeThemeColor(colors.link),
        linkHover: normalizeThemeColor(colors.linkHover),
        selection: normalizeThemeColor(colors.selection),
        linkUnderline: colors.linkUnderline === false ? false : undefined,
        linkHoverUnderline: colors.linkHoverUnderline === false ? false : undefined
      },
      elements
    }
  };
}

export function getBuilderBackgroundStyle(background: BackgroundSettings | undefined): CSSProperties | undefined {
  if (!background || background.mode === "none") {
    return undefined;
  }

  const opacity = clampBuilderOpacity(background.opacity);

  if (background.mode === "color") {
    if (isTransparentBuilderColor(background.color)) {
      return {
        background: "transparent",
        backgroundColor: "transparent"
      };
    }

    const color = applyBuilderColorOpacity(background.color, opacity);
    return {
      background: color,
      backgroundColor: color
    };
  }

  if (background.mode === "gradient") {
    const color = applyBuilderColorOpacity(background.color, opacity);
    const color2 = applyBuilderColorOpacity(background.color2, opacity);
    return {
      backgroundImage: `linear-gradient(135deg, ${color} 0%, ${color2} 100%)`
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
    type === "confetti" ||
    type === "tractor-nav" ||
    type === "breadcrumb" ||
    type === "blog-post-list" ||
    type === "blog-post-card" ||
    type === "blog-author-bio" ||
    type === "crm-form" ||
    type === "crm-contacts-table" ||
    type === "blog-toc" ||
    type === "blog-newsletter-subscribe" ||
    type === "blog-related-posts" ||
    type === "blog-category-filter" ||
    type === "blog-post" ||
    type === "blog-tag-cloud" ||
    type === "blog-post-tags" ||
    type === "blog-post-create" ||
    type === "blog-post-manager" ||
    type === "blog-category-manager" ||
    type === "blog-card-manager" ||
    type === "blog-search" ||
    type === "blog-search-results" ||
    type === "messaging-topic-list" ||
    type === "messaging-tag-list" ||
    type === "admin-team-users" ||
    type === "admin-modules" ||
    type === "admin-login" ||
    type === "admin-nav-link"
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

  if (type === "tractor-nav") {
    if (!settings.color)        settings.color        = "#0000ff";
    if (!settings.dotSize)      settings.dotSize      = "10";
    if (!settings.dotHoverColor) settings.dotHoverColor = "#ffffff";
    if (!settings.ringCount)    settings.ringCount    = "10";
    if (!settings.sizingMode)   settings.sizingMode   = "linear";
    if (!settings.ringStep)     settings.ringStep     = "10";
    if (!settings.outerSize)    settings.outerSize    = "600";
    if (!settings.curve)        settings.curve        = "2";
    if (!settings.innerOpacity) settings.innerOpacity = "90";
    if (!settings.opacityStep)  settings.opacityStep  = "10";
    if (!settings.transition)   settings.transition   = "0";
    if (!settings.posX)         settings.posX         = "0";
    if (!settings.posY)         settings.posY         = "0";
    if (!settings.zIndex)       settings.zIndex       = "-9999";
  }

  if (type === "navigation") {
    delete settings.navBackground;

    // Schema unification: the Module Studio editor historically wrote
    // `variant`/`navItems[].url`; the page-builder editor writes
    // `navDirection`/`navItems[].href`. Migrate legacy data to the
    // canonical keys here so every renderer/editor can read one schema.
    if (!settings.navDirection && settings.variant) {
      settings.navDirection = settings.variant === "vertical" ? "vertical" : "horizontal";
    }
    delete settings.variant;

    if (settings.navItems != null && typeof settings.navItems !== "string") {
      try {
        settings.navItems = JSON.stringify(settings.navItems);
      } catch {
        settings.navItems = "[]";
      }
    }
    if (typeof settings.navItems === "string" && settings.navItems) {
      try {
        const items = JSON.parse(settings.navItems);
        if (Array.isArray(items)) {
          settings.navItems = JSON.stringify(
            items.map((item) => {
              if (!item || typeof item !== "object") return item;
              const next: Record<string, unknown> = { ...item };
              if (!next.href && next.url) next.href = next.url;
              delete next.url;
              return next;
            })
          );
        }
      } catch {
        // Malformed JSON is left as-is; downstream parsers already guard against it.
      }
    }

    if (!settings.menuName) settings.menuName = "Main Menu";
    if (!settings.menuLocation) settings.menuLocation = "primary";
    if (!settings.navDirection) settings.navDirection = "horizontal";
    if (!settings.navItemSizing) settings.navItemSizing = "auto";
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
    settings.fontFamily = HEADING_FONT_KEYS.has(settings.fontFamily ?? "") ? settings.fontFamily ?? "" : "";
    settings.fontWeight = normalizeHeadingFontWeight(settings.fontWeight, settings.bold);
    settings.textAlign = HEADING_TEXT_ALIGN_KEYS.has(settings.textAlign ?? "")
      ? settings.textAlign
      : "left";
    settings.textTransform = HEADING_TEXT_TRANSFORM_KEYS.has(settings.textTransform ?? "")
      ? settings.textTransform
      : "none";
    settings.lineHeight = normalizeDecimalValue(settings.lineHeight, "1.2", 0.8, 3);
    settings.letterSpacing = normalizeDecimalValue(settings.letterSpacing, "0", -5, 20);
  }

  if (type === "button") {
    const legacyVertical = settings.verticalMargin;
    const legacyHorizontal = settings.horizontalMargin;
    settings.marginTop = normalizeSpacingValue(settings.marginTop ?? legacyVertical, "0", 0, 160);
    settings.marginBottom = normalizeSpacingValue(settings.marginBottom ?? legacyVertical, "0", 0, 160);
    settings.marginLeft = normalizeSpacingValue(settings.marginLeft ?? legacyHorizontal, "0", 0, 160);
    settings.marginRight = normalizeSpacingValue(settings.marginRight ?? legacyHorizontal, "0", 0, 160);
    settings.paddingX = normalizeSpacingValue(settings.paddingX, "24", 1, 50);
    settings.paddingY = normalizeSpacingValue(settings.paddingY, "12", 1, 50);
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
    isPrivate: Boolean(row.is_private ?? row.isPrivate ?? false),
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
    isPrivate: Boolean(row.is_private ?? row.isPrivate ?? false),
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
        locked: normalizedSection.locked === true,
        isPrivate: normalizedSection.isPrivate === true,
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
        rowBorderWidth: normalizeSpacingValue(normalizedSection.rowBorderWidth, "0", 0, 20),
        rowBorderColor: normalizeBuilderHexColor(
          typeof normalizedSection.rowBorderColor === "string" ? normalizedSection.rowBorderColor : ""
        ) || "#000000",
        rowBorderStyle: ["solid", "dashed", "dotted"].includes(normalizedSection.rowBorderStyle as string)
          ? (normalizedSection.rowBorderStyle as string)
          : "solid",
        rowBorderRadius: normalizeSpacingValue(normalizedSection.rowBorderRadius, "0", 0, 60),
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
        cellIsPrivate: normalizeCellColor(normalizedSection.cellIsPrivate, layout, "false"),
        cellBorderWidth: normalizeCellMetric(normalizedSection.cellBorderWidth, layout, "0", 0, 20),
        cellBorderColor: normalizeCellColor(normalizedSection.cellBorderColor, layout, "transparent"),
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
    locked: false,
    isPrivate: false,
    layout,
    alignment: "left",
    marginTop: "0",
    marginBottom: "0",
    rowBorderWidth: "0",
    rowBorderColor: "#000000",
    rowBorderStyle: "solid",
    rowBorderRadius: "0",
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
    cellIsPrivate: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellBorderWidth: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellBorderColor: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "transparent"])),
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
          fontFamily: "",
          fontWeight: "800",
          textAlign: "left",
          lineHeight: "1.2",
          letterSpacing: "0",
          textTransform: "none",
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
        : type === "crm-form"
          ? {
              crmFormId: ""
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
                        shareHashtags: "StarCaster,WYR",
                        shareVia: "",
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
                      : type === "breadcrumb"
                        ? {
                            items: JSON.stringify([{ id: "home", label: "Home", url: "/" }]),
                            separator: "›",
                            fontSize: "14",
                            color: "#587592",
                            activeColor: "#18324a",
                            bold: "false",
                            alignment: "left"
                          }
                      : type === "blog-post-list"
                        ? {
                            layout: "grid",
                            columns: "3",
                            postsPerPage: "9",
                            postPageUrl: "",
                            cardGap: "24",
                            filterCategory: "",
                            showSearch: "true",
                            showCategoryFilter: "true",
                            showTagFilter: "true",
                            showAuthorFilter: "true",
                            showDateFilter: "false"
                          }
                      : type === "blog-post-card"
                        ? {
                            title: "",
                            excerpt: "",
                            author: "",
                            date: "",
                            imageUrl: "",
                            imageAspectRatio: "16:9",
                            url: "",
                            categories: "",
                            cardLayout: "vertical",
                            cardStyle: "default",
                            cardBorderRadius: "12",
                            showFeaturedImage: "true",
                            showExcerpt: "true",
                            showAuthor: "true",
                            showDate: "true",
                            showCategories: "true",
                            showReadMore: "true",
                            readMoreLabel: "Read More"
                          }
                      : type === "blog-author-bio"
                        ? {
                            name: "",
                            title: "",
                            bio: "",
                            avatarUrl: "",
                            avatarShape: "circle",
                            avatarSize: "80",
                            layout: "horizontal",
                            socialLinks: JSON.stringify([])
                          }
                      : type === "blog-toc"
                        ? {
                            title: "In This Article",
                            showTitle: "true",
                            items: JSON.stringify([]),
                            style: "default",
                            showNumbers: "false",
                            indentSubheadings: "true",
                            fontSize: "14",
                            titleFontSize: "16",
                            color: "#0f4f8f",
                            titleColor: "#18324a"
                          }
                      : type === "blog-newsletter-subscribe"
                        ? {
                            crmFormId: "",
                            headline: "Stay in the loop",
                            description: "Get new posts delivered to your inbox. No spam, ever.",
                            layout: "stacked",
                            showImage: "false",
                            imageUrl: "",
                            accentColor: "#0f4f8f",
                            bgColor: "#eaf4ff",
                            successMessage: "You're subscribed! Check your inbox."
                          }
                      : type === "blog-related-posts"
                        ? {
                            title: "You Might Also Like",
                            showTitle: "true",
                            count: "3",
                            matchBy: "categories",
                            layout: "grid",
                            columns: "3",
                            showFeaturedImage: "true",
                            imageAspectRatio: "16:9",
                            showExcerpt: "false",
                            showAuthor: "false",
                            showDate: "true",
                            showCategories: "true",
                            cardStyle: "default",
                            cardBorderRadius: "12",
                            cardGap: "20",
                            manualPosts: JSON.stringify([])
                          }
                      : type === "blog-category-filter"
                        ? {
                            categories: JSON.stringify([]),
                            layout: "pills",
                            allLabel: "All",
                            showAll: "true",
                            filterParam: "category",
                            targetPageUrl: "",
                            activeColor: "#0f4f8f",
                            activeBg: "#e8f6fc",
                            inactiveColor: "#587592",
                            inactiveBg: "#f0f4f8",
                            borderRadius: "20",
                            fontSize: "13",
                            gap: "8",
                            alignment: "left"
                          }
                      : type === "blog-post"
                        ? {
                            title: "",
                            slug: "",
                            status: "draft",
                            author: "",
                            publishDate: "",
                            featuredImageUrl: "",
                            showFeaturedImage: "true",
                            excerpt: "",
                            showExcerpt: "true",
                            body: "",
                            categories: "",
                            showCategories: "true",
                            tags: "",
                            showTags: "false",
                            showAuthor: "true",
                            showDate: "true",
                            seoTitle: "",
                            seoDescription: ""
                          }
                      : type === "blog-tag-cloud"
                        ? {
                            tags: JSON.stringify([]),
                            layout: "cloud",
                            showCounts: "false",
                            minFontSize: "12",
                            maxFontSize: "22",
                            filterParam: "tag",
                            targetPageUrl: "",
                            activeColor: "#0f4f8f",
                            inactiveColor: "#587592",
                            inactiveBg: "#f0f4f8",
                            gap: "8",
                            alignment: "left"
                          }
                      : type === "blog-post-tags"
                        ? {
                            tags: "",
                            prefix: "Tags:",
                            showPrefix: "true",
                            layout: "pills",
                            linkToFilter: "true",
                            filterParam: "tag",
                            targetPageUrl: "",
                            color: "#587592",
                            bgColor: "#f0f4f8",
                            borderRadius: "4",
                            fontSize: "12",
                            gap: "6"
                          }
                      : type === "blog-post-create"
                        ? {
                            formTitle: "Create New Post",
                            showFormTitle: "true",
                            submitLabel: "Publish Post",
                            draftLabel: "Save as Draft",
                            defaultStatus: "draft",
                            allowStatusChange: "true",
                            showSlug: "true",
                            showFeaturedImage: "true",
                            showExcerpt: "true",
                            showCategories: "true",
                            showTags: "true",
                            showSeoFields: "false",
                            showAuthorField: "false",
                            successMessage: "Post created successfully.",
                            redirectAfterCreate: "",
                            accentColor: "#0f4f8f"
                          }
                      : type === "blog-post-manager"
                        ? {
                            editPageUrl: "",
                            viewPageUrl: "",
                            showStatus: "true",
                            showDate: "true",
                            showDelete: "true",
                            accentColor: "#0f4f8f"
                          }
                      : type === "blog-category-manager"
                        ? {
                            showDescription: "true",
                            showColor: "true",
                            showSortOrder: "false",
                            showDelete: "true",
                            accentColor: "#0f4f8f"
                          }
                      : type === "messaging-topic-list"
                        ? {
                            layout: "pills",
                            showAll: "true",
                            allLabel: "All Topics",
                            targetPageUrl: "",
                            filterParam: "topic",
                            activeColor: "#0f4f8f",
                            activeBg: "#0f4f8f",
                            inactiveColor: "#587592",
                            inactiveBg: "#f0f4f8",
                            borderRadius: "20",
                            fontSize: "13",
                            gap: "8",
                            alignment: "left"
                          }
                      : type === "messaging-tag-list"
                        ? {
                            layout: "cloud",
                            targetPageUrl: "",
                            filterParam: "tag",
                            activeColor: "#0f4f8f",
                            inactiveColor: "#587592",
                            inactiveBg: "#f0f4f8",
                            minFontSize: "12",
                            maxFontSize: "22",
                            gap: "8",
                            alignment: "left"
                          }
                      : type === "crm-contacts-table"
                        ? {
                            crmConfigId: "",
                            tableTitle: "Contacts",
                            showTitle: "true",
                            rowsPerPage: "20",
                            showSearch: "true",
                            showAddButton: "true",
                            addButtonLabel: "Add Contact",
                            showViewButton: "true",
                            showEditButton: "true",
                            showDeleteButton: "true"
                          }
                      : type === "admin-team-users"
                        ? {
                            tableTitle: "Team Members",
                            showTitle: "true",
                            showAddButton: "true",
                            addButtonLabel: "Add Team Member",
                            showEditButton: "true",
                            showDeleteButton: "true"
                          }
                      : type === "admin-modules"
                        ? {
                            tableTitle: "Premium Modules",
                            showTitle: "true",
                            showToggle: "true"
                          }
                      : type === "admin-login"
                        ? {
                            formTitle: "Admin Sign In",
                            buttonText: "Sign In",
                            showForgotPassword: "true",
                            successRedirect: "/admin-dashboard"
                          }
                      : type === "admin-nav-link"
                        ? {
                            linkText: "Admin",
                            linkHref: "/admin-login"
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
    theme: document.theme,
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
    themeId: safeText(row.theme_id ?? row.themeId, 120) || undefined,
    pageBackground: document.pageBackground,
    theme: document.theme,
    layoutSections: document.layoutSections,
    createdAt: safeText(row.created_at ?? row.createdAt, 120),
    updatedAt: safeText(row.updated_at ?? row.updatedAt, 120),
    isPublished: Boolean(row.is_published ?? row.isPublished ?? true),
    isPrivate: Boolean(row.is_private ?? row.isPrivate ?? false)
  };
}

export function normalizeBuilderDocument(value: unknown): {
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  layoutSections: BuilderTemplateSection[];
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const document = value as Record<string, unknown>;
    return {
      pageBackground: normalizeBackgroundSettings(document.pageBackground),
      theme: normalizeTheme(document.theme),
      layoutSections: normalizeLayoutSections(document.sections ?? document.layoutSections)
    };
  }

  return {
    pageBackground: createDefaultBackgroundSettings(),
    theme: createDefaultTheme(),
    layoutSections: normalizeLayoutSections(value)
  };
}

export function serializeBuilderDocument(input: {
  pageBackground?: unknown;
  theme?: unknown;
  layoutSections?: unknown;
}) {
  return {
    pageBackground: normalizeBackgroundSettings(input.pageBackground),
    theme: normalizeTheme(input.theme),
    sections: normalizeLayoutSections(input.layoutSections)
  };
}
