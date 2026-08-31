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
import { escapeHtmlText, sanitizeInlineHtml, sanitizeRichTextHtml } from "@/lib/sanitize-html";
import { rewriteRichTextImageSrcInHtml } from "@/lib/rich-text-image";

export { normalizeBuilderAssetUrl, resolvePublicBuilderAssetUrl, safeText } from "@/lib/builder-asset-url";
import { backgroundImageUrlFor } from "@/lib/image-renditions";
import { normalizeProximityEffectSettings } from "./proximity-effects";
import {
  imageEffectBounces,
  imageEffectRotates,
  imageEffectTravels
} from "@/components/builder/builder-image-effects";

/**
 * Section (row) column structures. Values are named for their `fr` ratio;
 * see docs/SECTION_LAYOUTS.md for the fractions each one means and how the
 * set tracks Divi's.
 *
 * Adding a member here is a compile error until it also gets an entry in
 * LAYOUT_SPECS below — which is the point. A layout with no column keys and
 * no grid template does not fail loudly; it renders as one full-width
 * column, which reads as the builder ignoring the click.
 */
export type BuilderTemplateLayout =
  | "single"
  // Two columns.
  | "two-column"
  | "two-four"
  | "four-two"
  | "one-five"
  | "five-one"
  | "one-three"
  | "three-one"
  | "two-three"
  | "three-two"
  // Three columns.
  | "three-column"
  | "one-four-one"
  | "one-three-one"
  | "one-two-one"
  | "two-one-one"
  | "one-one-two"
  | "three-one-one"
  | "one-one-three"
  // Four to six equal columns.
  | "four-column"
  | "five-column"
  | "six-column";

export type BackgroundStylePreset = "blue-yellow-circles";

/**
 * Every builder module type, as a runtime VALUE — the union below is derived
 * from it, so the two can never disagree.
 *
 * It is a list rather than a bare union because tooling outside TypeScript
 * needs to enumerate the types. `scripts/ui/seed_fixture.mjs` builds the
 * panel-lattice fixture from it: one module of every type on one page, so
 * `npm run check:panels` measures them all. A hand-maintained copy of this
 * list is exactly how that check once reported "OK across 6 panels" while
 * silently measuring no heading at all (PR #169) — the fixture must not be
 * able to fall behind the types it is supposed to cover.
 */
export const BUILDER_MODULE_TYPES = [
  "navigation",
  "heading",
  "headline-rotator",
  "text",
  "code",
  "merch",
  "image",
  "floating-image",
  "video",
  "quote",
  "speech-bubble",
  "reminder",
  "button",
  "contact-form",
  "player-portal",
  "table",
  "carousel",
  "feature-cards",
  "program-list",
  "social",
  "social-share",
  "previous-results",
  "current-poll",
  "poll-category-list",
  "confetti",
  "tractor-nav",
  "breadcrumb",
  "blog-post-list",
  "blog-post-card",
  "blog-author-bio",
  "crm-form",
  "crm-contacts-table",
  "blog-toc",
  "blog-newsletter-subscribe",
  "blog-related-posts",
  "blog-category-filter",
  "blog-post",
  "blog-tag-cloud",
  "blog-post-tags",
  "blog-post-create",
  "blog-post-manager",
  "blog-category-manager",
  "blog-card-manager",
  "blog-search",
  "blog-search-results",
  "site-search",
  "site-search-results",
  "messaging-topic-list",
  "messaging-tag-list",
  "admin-team-users",
  "admin-modules",
  "admin-login",
  "admin-nav-link",
  "admin-site-settings",
  "admin-support-form",
  "bug-report"
] as const;

export type BuilderTemplateModuleType = (typeof BUILDER_MODULE_TYPES)[number];

export type BuilderTemplateModule = {
  id: string;
  type: BuilderTemplateModuleType;
  column: string;
  name: string;
  text: string;
  settings: Record<string, string>;
  /** ID of the BuilderCellModuleRecord this was inserted from, if any. */
  savedModuleId?: string;
  /**
   * Does this copy follow its master? The ONE polarity as of Sync 7/7, written
   * by everything new at both levels. Absent means the copy never answered,
   * which on the module side has always meant "following" — see
   * lib/builder-client/canonical-follow.ts.
   */
  canonical?: boolean;
  /** Legacy spelling of `canonical: false`. Still read; no longer written. */
  canonicalLocked?: boolean;
};

export type BackgroundSettings = {
  mode: "none" | "color" | "gradient" | "image" | "video" | "style";
  color: string;
  color2: string;
  imageUrl: string;
  /** StarCaster: asset id behind imageUrl so the asset picker can round-trip. */
  imageAssetId?: string;
  styleKey: "" | BackgroundStylePreset;
  /** 0–100. Color/gradient bake alpha into rgba; image/style use a backdrop layer. */
  opacity?: number;
  /** Video background: the clip itself, from the asset gallery. Mode "video" only. */
  videoUrl?: string;
  videoAssetId?: string;
  /**
   * The still frame behind the clip. Every surface that cannot play a video —
   * buttons, email, saved-cell thumbnails, the frozen vanilla builder — paints
   * this instead, because `getBuilderBackgroundStyle` reports a video background
   * as an ordinary CSS image. That is what lets mode "video" be added without
   * touching a single one of its callers.
   */
  posterUrl?: string;
  posterAssetId?: string;
  /** Playback rate, 0.25–2. */
  videoSpeed?: number;
  videoLoop?: boolean;
  /**
   * Seconds of crossfade at the loop seam, 0–5. Zero is a hard cut.
   * Non-zero makes the layer render the clip TWICE and hand off between the
   * copies — one video cannot dissolve into itself, because seeking back to
   * the start is a single discontinuous jump with nothing to fade into.
   */
  videoLoopFade?: number;
  /** Seconds. An end of 0 means "play to the end of the clip". */
  videoTrimStart?: number;
  videoTrimEnd?: number;
  /** Pixels, 0–20. */
  videoBlur?: number;
  /** Phones show the poster instead unless this is on. */
  videoPlayOnMobile?: boolean;
  /** Percent, 0–100 — which part of the frame survives the crop. */
  videoFocalX?: number;
  videoFocalY?: number;
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
    /** Per-heading top-margin overrides in px (0 = inherit baseline). */
    h1Mt?: number; h2Mt?: number; h3Mt?: number; h4Mt?: number; h5Mt?: number; h6Mt?: number;
    /** Per-heading bottom-margin overrides in px (0 = inherit baseline). */
    h1Mb?: number; h2Mb?: number; h3Mb?: number; h4Mb?: number; h5Mb?: number; h6Mb?: number;
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
    /**
     * Site-wide reading width. Every row centres its CONTENT to this many
     * pixels while its background still spans edge to edge, so a contact
     * strip, a header and a hero all start at the same left edge without
     * anyone hand-matching cell padding row by row. 0 = off (full bleed).
     */
    contentWidth?: number;
  };
  /** Role palette storage home (see BuilderThemePalette) — no DB column needed. */
  palette?: BuilderThemePalette;
  /** Design-treatments storage home (see BuilderThemeTreatments). */
  treatments?: BuilderThemeTreatments;
  /** Hero-banner storage home (see BuilderThemeHeroBanner). */
  heroBanner?: BuilderThemeHeroBanner;
  /** Up to three saved banner options (the wizard keys one look on each). */
  heroBanners?: string[];
};

export type BuilderTheme = {
  typography: BuilderThemeTypography;
};

/**
 * Role palette — the multi-surface colour system a designed site actually uses,
 * as opposed to the single `backgroundColor` wash. Five background/text pairs:
 *
 *   surface  — the main content section ground (usually white or near-white)
 *   band     — the alternating tinted section that separates content bands
 *   inverse  — the dark statement band (weighty sections, big footers)
 *   header   — the site header / navigation chrome
 *   button   — the primary call-to-action fill
 *
 * Stored inside the theme's `typography` JSONB as `typography.palette` (the
 * same no-migration home `pageLayout` margins use) and surfaced as a top-level
 * `palette` field on the theme summary. Values are hex strings; absent role =
 * inherit the pre-theme default.
 */
export type BuilderThemePaletteRole =
  | "surface"
  | "surfaceText"
  | "band"
  | "bandText"
  | "inverse"
  | "inverseText"
  | "header"
  | "headerText"
  | "button"
  | "buttonText";

export type BuilderThemePalette = Partial<Record<BuilderThemePaletteRole, string>>;

export const THEME_PALETTE_ROLE_KEYS: BuilderThemePaletteRole[] = [
  "surface", "surfaceText",
  "band", "bandText",
  "inverse", "inverseText",
  "header", "headerText",
  "button", "buttonText",
];

/**
 * Design treatments — the layout-adjacent styling moves that make a themed
 * page read as designed rather than repainted, all of them styling on top of
 * content the operator supplied (never content itself):
 *
 *   heroOverlay/-Opacity — a tint laid over any section whose background is an
 *     image, with light (inverseText) text on top, so a photo section reads as
 *     a hero instead of text fighting a photograph.
 *   cardOverlap — a feature-cards section directly after an image section
 *     pulls up over its bottom edge.
 *   footerInverse — the last plain section takes the inverse role: the dark
 *     closing band big footers use.
 *
 * Same storage home as the palette: `typography.treatments` on the theme.
 */
export type BuilderThemeTreatments = {
  heroOverlay?: string;
  /** 0–0.75; a full blackout would defeat the photo. */
  heroOverlayOpacity?: number;
  cardOverlap?: boolean;
  footerInverse?: boolean;
};

/** Hero banner: the image the site's top band wears. Operator-chosen URL. */
export type BuilderThemeHeroBanner = {
  url: string;
};

export function normalizeThemeHeroBanner(raw: unknown): BuilderThemeHeroBanner | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const url = String((raw as Record<string, unknown>).url || "").trim();
  return /^https?:\/\//i.test(url) ? { url } : null;
}

/** Up to three saved banner options — the bank the wizard's three looks key on.
 * The first non-empty one is what pages actually wear. */
export function normalizeThemeHeroBanners(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const urls = raw
    .map((value) => String(value || "").trim())
    .filter((value) => /^https?:\/\//i.test(value))
    .slice(0, 3);
  return urls.length ? urls : null;
}

export function normalizeThemeTreatments(raw: unknown): BuilderThemeTreatments | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const treatments: BuilderThemeTreatments = {};
  if (typeof source.heroOverlay === "string" && source.heroOverlay.trim()) {
    treatments.heroOverlay = source.heroOverlay.trim();
  }
  const opacity = Number(source.heroOverlayOpacity);
  if (Number.isFinite(opacity)) {
    treatments.heroOverlayOpacity = Math.min(0.75, Math.max(0, opacity));
  }
  if (typeof source.cardOverlap === "boolean") treatments.cardOverlap = source.cardOverlap;
  if (typeof source.footerInverse === "boolean") treatments.footerInverse = source.footerInverse;
  return Object.keys(treatments).length ? treatments : null;
}

/** Keep known roles with non-empty string values; null when nothing usable. */
export function normalizeThemePalette(raw: unknown): BuilderThemePalette | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const palette: BuilderThemePalette = {};
  for (const role of THEME_PALETTE_ROLE_KEYS) {
    const value = source[role];
    if (typeof value === "string" && value.trim()) palette[role] = value.trim();
  }
  return Object.keys(palette).length ? palette : null;
}

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
  /** Multi-role colour palette (surface/band/inverse/header/button pairs). */
  palette?: BuilderThemePalette;
  /** Design treatments (hero overlay, card overlap, inverse footer). */
  treatments?: BuilderThemeTreatments;
  /** The image the site's top band wears (with the hero overlay on it). */
  heroBanner?: BuilderThemeHeroBanner;
  /** Up to three saved banner options (the wizard keys one look on each). */
  heroBanners?: string[];
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
  /**
   * "contained" (default) keeps the section within the theme's side margins;
   * "full-width" lets its background and content span edge to edge of the
   * viewport. Two adjacent full-width sections with the same flat background
   * read as one continuous band.
   */
  widthMode: "contained" | "full-width";
  /**
   * For contained sections, narrows the section to this percentage of the page
   * content width and centers it (25–100; 100 = full content width). Ignored
   * when widthMode is "full-width", which spans edge to edge.
   */
  widthPercent: string;
  /**
   * When true, this row joins the run of rows above it: the group renders
   * inside one wrapper that carries the FIRST row's background, so a single
   * image can span several rows. The joined row's own background is ignored
   * while it is joined — unjoin it and the background comes straight back.
   */
  joinWithPrevious: boolean;
  alignment: "left" | "center" | "right";
  marginTop: string;
  marginBottom: string;
  /**
   * Breathing room INSIDE the row, above and below its columns — the space
   * that used to be a hard-coded 18px in CSS with no way to reach it, which
   * is why every band (a contact strip especially) rendered far taller than
   * its own text. Defaults to "18" so untouched rows do not move.
   */
  paddingTop: string;
  paddingBottom: string;
  /**
   * Breathing room inside the row's left and right edges. ADDS to the inset
   * that already centres every row on the theme's content width, so setting it
   * pushes content further in rather than breaking the shared left edge that
   * lines a contact strip up with the hero above it. Defaults to "0".
   */
  paddingLeft: string;
  paddingRight: string;
  /** Space OUTSIDE the row's left and right edges — moves the row itself in. */
  marginLeft: string;
  marginRight: string;
  /** Space between this row's columns. "16" is the gap that used to be fixed. */
  columnGap: string;
  /** Floor for the row's height, so a band can be taller than its content. "0" = size to content. */
  minHeight: string;
  /**
   * Per-column proportions, keyed by column. All zero (the default) means
   * "follow the Layout preset"; any complete set overrides it, so 70/30 is
   * reachable without adding a layout for every ratio anyone might want.
   */
  columnWidths: Record<string, string>;
  /**
   * When "true", every module in the row stretches to the height of the
   * tallest column, so a row of cards has one bottom edge instead of a ragged
   * one. Off by default because it makes short modules grow.
   */
  equalColumnHeights: string;
  /**
   * Nudges the whole row off where the layout put it, WITHOUT moving anything
   * else — this is a transform, not a margin, so the rows above and below stay
   * exactly where they are and the row simply rides over them. That is what
   * makes a card band overlap the banner above it. Positive vertical moves the
   * row UP and positive horizontal moves it RIGHT, matching the module-level
   * Vertical/Horizontal Offset an operator already knows.
   */
  horizontalOffset: string;
  verticalOffset: string;
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
  /**
   * Legacy: one number for all four sides of a cell. Kept as the seed for
   * the two axes below, so a row saved before 2026-08-11 renders identically
   * — and kept in the type because old rows still carry it.
   */
  cellPadding: Record<string, string>;
  cellPaddingTop: Record<string, string>;
  cellPaddingBottom: Record<string, string>;
  cellPaddingLeft: Record<string, string>;
  cellPaddingRight: Record<string, string>;
  cellMarginTop: Record<string, string>;
  cellMarginBottom: Record<string, string>;
  cellMarginLeft: Record<string, string>;
  cellMarginRight: Record<string, string>;
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
  /** Legacy layout NAME ("standard-right-form"). Not a page-template id. */
  templateId: string;
  /** Which builder_page_templates row this page came from. "" = none, which is valid. */
  pageTemplateId: string;
  themeId?: string;
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  layoutSections: BuilderTemplateSection[];
  createdAt: string;
  updatedAt: string;
  isPublished: boolean;
  isPrivate: boolean;
  /** Site Search ranking. Optional: pages saved before it exists read as "normal". */
  searchPriority?: string;
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

/**
 * The Simple Text variant of the `text` module — a `text` module whose
 * `settings.variant` is this value. Paragraph / Intro Copy / Caption all run
 * through `formatRichTextContent`, which wraps bare typing in `<p>`; the
 * paragraph's own margins then push whatever sits above and below it away, and
 * a `<p>` cannot legally contain a block element. Simple Text exists for copy
 * that has to sit flush against its neighbours or carry the operator's own
 * markup, so it skips the wrapper entirely.
 */
export const PLAIN_TEXT_VARIANT = "plain";

export function isPlainTextVariant(settings: Record<string, string> | undefined) {
  return settings?.variant === PLAIN_TEXT_VARIANT;
}

/**
 * Text that already lays itself out. Markup like `<p>` / `<div>` / `<h2>` /
 * `<ul>` carries its own line structure, so the newlines *between* those tags
 * are the author's formatting, not content.
 */
export const BLOCK_LEVEL_TAG =
  /<\s*(p|div|h[1-6]|ul|ol|li|dl|blockquote|pre|table|thead|tbody|tr|td|th|section|article|aside|header|footer|figure|figcaption|hr)\b/i;

/**
 * An `&` that does not already open a character entity — `&amp;`, `&#160;`,
 * `&#xA0;`. Those are the operator's own escapes and must survive verbatim.
 */
const BARE_AMPERSAND = /&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]{1,31};)/g;

/**
 * Escape for Simple Text, which — unlike the rich-text editor's output — is
 * typed by hand.
 *
 * `escapeHtmlText` turns every `&` into `&amp;`, so an operator who typed
 * `&nbsp;` to add a space got the six literal characters back on the page
 * (reported 2026-08-11). Entities are the only way to type a space HTML will
 * not collapse, so in a plain typing box they are content, not an accident.
 * Bare ampersands are still escaped; `<` and `>` always are.
 *
 * Quotes are deliberately left alone: this value becomes text content, never
 * an attribute, and `&quot;` in body text only makes the editor's markup
 * harder to read.
 */
function escapePlainTextPreservingEntities(text: string) {
  return text
    .replace(BARE_AMPERSAND, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Simple Text rendering: no `<p>` wrapper, ever.
 *
 * Line breaks the operator typed are content and survive as `<br />` —
 * including next to inline markup like `<em>` or `<a>`, which is the whole
 * reason this doesn't simply reuse `formatRichTextContent`'s HTML branch: a
 * single `<em>` anywhere in the value used to make the entire thing "HTML" and
 * silently swallow every newline in it.
 *
 * The exception is a value containing block-level tags. There the markup
 * governs its own layout, and converting the newlines between tags would
 * inject gaps nobody asked for — so it passes through untouched.
 *
 * Everything still goes through the sanitizer either way (Standard 9).
 */
export function formatPlainTextContent(value: unknown) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  const escaped = looksLikeHtml(text) ? text : escapePlainTextPreservingEntities(text);
  const html = BLOCK_LEVEL_TAG.test(text) ? escaped : escaped.replace(/\n/g, "<br />");

  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(html), "display");
}

/**
 * Heading content, which is inline markup inside the `<h1>`…`<h6>` the module
 * renders — never a document of its own.
 *
 * The module used to store a bare string and render it as a text node, so a
 * heading could only ever be one colour and one size: the operator could not
 * make a single word green (reported 2026-08-11, hero heading on the model
 * page). It now stores markup, and everything that reads it comes through
 * here.
 *
 * A value with no tags is escaped exactly the way Simple Text escapes typed
 * copy — entities the operator typed (`&nbsp;`) survive, bare `&` and every
 * `<`/`>` do not — so every heading that existed before this change renders
 * character-for-character as it did. Newlines become `<br />`; block tags are
 * unwrapped to their text by the sanitizer, because nothing block-level can
 * legally live inside a heading.
 */
export function formatHeadingContent(value: unknown) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  const escaped = looksLikeHtml(text) ? text : escapePlainTextPreservingEntities(text);

  return sanitizeInlineHtml(escaped.replace(/\n/g, "<br />"));
}

/**
 * Storage → editor. The inline editor is a ProseMirror document, which must
 * have a block node at the top, so the stored inline markup gets a `<p>`
 * wrapper it never carries on disk.
 */
export function prepareHeadingHtmlForEditor(value: unknown) {
  const html = formatHeadingContent(value);

  return html ? `<p>${html}</p>` : "<p></p>";
}

/**
 * Editor → storage. Unwraps the editor's paragraph and turns a paragraph
 * break into the `<br />` a heading actually wants — pressing Enter in a
 * heading means "second line", not "second paragraph".
 */
export function headingHtmlFromEditor(html: string) {
  const inline = String(html ?? "")
    .replace(/<\/p>\s*<p[^>]*>/gi, "<br />")
    .replace(/^\s*<p[^>]*>/i, "")
    .replace(/<\/p>\s*$/i, "");

  return sanitizeInlineHtml(inline)
    .replace(/(?:\s*<br\s*\/?>\s*)+$/i, "")
    .trim();
}

// A trailing empty block (an otherwise-empty <p> or heading whose only
// contents are whitespace, non-breaking spaces, or <br>). The editor keeps
// an empty line at the end for a comfortable typing cursor, but we do not
// want that saved as extra markup — spacing under headings is a style
// concern, not a content one.
const TRAILING_EMPTY_BLOCK = /(?:<(p|h[1-6])(?:\s[^>]*)?>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>)\s*$/i;

function stripTrailingEmptyBlocks(html: string) {
  let result = html;
  let previous: string;

  do {
    previous = result;
    result = result.replace(TRAILING_EMPTY_BLOCK, "").replace(/\s+$/, "");
  } while (result !== previous);

  return result;
}

export function prepareRichTextHtmlForStorage(html: string) {
  const sanitized = stripTrailingEmptyBlocks(sanitizeRichTextHtml(html));
  return rewriteRichTextImageSrcInHtml(sanitized, "storage");
}

export function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const SINGLE_COLUMN = ["main"] as const;
const TWO_COLUMNS = ["left", "right"] as const;
const THREE_COLUMNS = ["left", "center", "right"] as const;
// Past three columns the keys EXTEND the three-column set rather than
// renaming to col1…colN — every stored left/center/right stays valid, and a
// row narrowed from six columns to three keeps its first three cells intact.
const FOUR_COLUMNS = ["left", "center", "right", "col4"] as const;
const FIVE_COLUMNS = ["left", "center", "right", "col4", "col5"] as const;
const SIX_COLUMNS = ["left", "center", "right", "col4", "col5", "col6"] as const;

/**
 * The one table every layout is defined in: which column keys it exposes,
 * and how its tracks are sized. `Record<BuilderTemplateLayout, …>` makes a
 * missing entry a compile error rather than a section that quietly renders
 * as one full-width column.
 *
 * Column keys are persisted — on `module.column` and as the key of every
 * `cellBackgrounds` / `cellPadding` / … record — so the vocabulary is fixed
 * at main / left / center / right, plus col4 / col5 / col6 for the wide
 * rows. Layouts sharing a key set (all the three-column ones, say) keep
 * their cell styling when swapped between.
 *
 * Track sizes are ratios, not widths: `2fr 3fr` is Divi's 2/5 + 3/5.
 */
const LAYOUT_SPECS: Record<
  BuilderTemplateLayout,
  { columns: readonly string[]; grid: string }
> = {
  single: { columns: SINGLE_COLUMN, grid: "1fr" },

  "two-column": { columns: TWO_COLUMNS, grid: "1fr 1fr" },
  "two-four": { columns: TWO_COLUMNS, grid: "2fr 4fr" },
  "four-two": { columns: TWO_COLUMNS, grid: "4fr 2fr" },
  "one-five": { columns: TWO_COLUMNS, grid: "1fr 5fr" },
  "five-one": { columns: TWO_COLUMNS, grid: "5fr 1fr" },
  "one-three": { columns: TWO_COLUMNS, grid: "1fr 3fr" },
  "three-one": { columns: TWO_COLUMNS, grid: "3fr 1fr" },
  "two-three": { columns: TWO_COLUMNS, grid: "2fr 3fr" },
  "three-two": { columns: TWO_COLUMNS, grid: "3fr 2fr" },

  "three-column": { columns: THREE_COLUMNS, grid: "1fr 1fr 1fr" },
  "one-four-one": { columns: THREE_COLUMNS, grid: "1fr 4fr 1fr" },
  "one-three-one": { columns: THREE_COLUMNS, grid: "1fr 3fr 1fr" },
  "one-two-one": { columns: THREE_COLUMNS, grid: "1fr 2fr 1fr" },
  "two-one-one": { columns: THREE_COLUMNS, grid: "2fr 1fr 1fr" },
  "one-one-two": { columns: THREE_COLUMNS, grid: "1fr 1fr 2fr" },
  "three-one-one": { columns: THREE_COLUMNS, grid: "3fr 1fr 1fr" },
  "one-one-three": { columns: THREE_COLUMNS, grid: "1fr 1fr 3fr" },

  "four-column": { columns: FOUR_COLUMNS, grid: "1fr 1fr 1fr 1fr" },
  "five-column": { columns: FIVE_COLUMNS, grid: "1fr 1fr 1fr 1fr 1fr" },
  "six-column": { columns: SIX_COLUMNS, grid: "1fr 1fr 1fr 1fr 1fr 1fr" }
};

function getLayoutSpec(layout: BuilderTemplateLayout) {
  return LAYOUT_SPECS[layout] ?? LAYOUT_SPECS.single;
}

export function getLayoutColumns(layout: BuilderTemplateLayout) {
  // A copy: callers have always received a fresh array, and the specs are
  // shared across every section on the page.
  return [...getLayoutSpec(layout).columns];
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
  // Four-plus columns: same first three, and main lands in the first column.
  // col4…col6 need no entry — when the layout has them they pass the
  // allowedColumns check above; when it doesn't, the first-column fallback
  // below is the right answer.
  const legacyMapWide: Record<string, string> = {
    col1: "left",
    col2: "center",
    col3: "right",
    main: "left"
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
    allowedColumns.length >= 4
      ? legacyMapWide
      : allowedColumns.length === 3
        ? legacyMapThree
        : allowedColumns.length === 2
          ? legacyMapTwo
          : legacyMapSingle;
  const mapped = map[raw];

  if (mapped && allowedColumns.includes(mapped)) {
    return mapped;
  }

  return allowedColumns[0] || "main";
}

export function getLayoutGridTemplate(layout: BuilderTemplateLayout) {
  return getLayoutSpec(layout).grid;
}

/**
 * The layout preset's own proportions as whole percentages — "2fr 4fr" reads
 * back as [33, 67]. This is what the Column Widths control shows before the
 * operator has set anything, so the numbers he starts editing are the widths
 * he is already looking at rather than an arbitrary even split.
 */
export function getLayoutColumnPercents(layout: BuilderTemplateLayout): number[] {
  const parts = getLayoutSpec(layout)
    .grid.split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part) && part > 0);

  const total = parts.reduce((sum, part) => sum + part, 0);

  if (!parts.length || total <= 0) return [100];

  return parts.map((part) => Math.round((part / total) * 100));
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

  if (Object.prototype.hasOwnProperty.call(LAYOUT_SPECS, layout)) {
    return layout as BuilderTemplateLayout;
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

  if (
    mode === "color" ||
    mode === "gradient" ||
    mode === "image" ||
    mode === "video" ||
    mode === "style"
  ) {
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

/**
 * Clamp a stored number into range, falling back when it is missing or not a
 * number at all. Every video setting is a number a panel writes, which means
 * every one of them can arrive as "", null, or a string from an old row.
 */
function clampBackgroundNumber(value: unknown, min: number, max: number, fallback: number): number {
  // Absent must be checked BEFORE Number(), not after it. `Number("")` and
  // `Number(null)` are both 0 — a finite number that sails past the guard below
  // and then clamps to the minimum. An emptied Speed box would have become
  // 0.25x rather than normal speed, silently, with nothing to see.
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export const BUILDER_VIDEO_SPEED_MIN = 0.25;
export const BUILDER_VIDEO_SPEED_MAX = 2;
export const BUILDER_VIDEO_BLUR_MAX = 20;
export const BUILDER_VIDEO_LOOP_FADE_MAX = 5;

export function createDefaultBackgroundSettings(): BackgroundSettings {
  return {
    mode: "none",
    color: "#ffffff",
    color2: "#eaf4ff",
    imageUrl: "",
    imageAssetId: "",
    styleKey: "",
    opacity: 100,
    videoUrl: "",
    videoAssetId: "",
    posterUrl: "",
    posterAssetId: "",
    videoSpeed: 1,
    videoLoop: true,
    videoLoopFade: 0.6,
    videoTrimStart: 0,
    videoTrimEnd: 0,
    videoBlur: 0,
    videoPlayOnMobile: false,
    videoFocalX: 50,
    videoFocalY: 50
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
    opacity: clampBuilderOpacity(background.opacity),
    videoUrl: normalizeBuilderAssetUrl(background.videoUrl),
    videoAssetId: safeText(background.videoAssetId, 120),
    posterUrl: normalizeBuilderAssetUrl(background.posterUrl),
    posterAssetId: safeText(background.posterAssetId, 120),
    videoSpeed: clampBackgroundNumber(
      background.videoSpeed,
      BUILDER_VIDEO_SPEED_MIN,
      BUILDER_VIDEO_SPEED_MAX,
      1
    ),
    // Looping is the default, so only an explicit `false` turns it off — an
    // absent key on an older row must not read as "do not loop".
    videoLoop: background.videoLoop === undefined ? true : background.videoLoop !== false,
    videoLoopFade: clampBackgroundNumber(background.videoLoopFade, 0, BUILDER_VIDEO_LOOP_FADE_MAX, 0.6),
    videoTrimStart: clampBackgroundNumber(background.videoTrimStart, 0, Number.MAX_SAFE_INTEGER, 0),
    videoTrimEnd: clampBackgroundNumber(background.videoTrimEnd, 0, Number.MAX_SAFE_INTEGER, 0),
    videoBlur: clampBackgroundNumber(background.videoBlur, 0, BUILDER_VIDEO_BLUR_MAX, 0),
    videoPlayOnMobile: background.videoPlayOnMobile === true,
    videoFocalX: Math.round(clampBackgroundNumber(background.videoFocalX, 0, 100, 50)),
    videoFocalY: Math.round(clampBackgroundNumber(background.videoFocalY, 0, 100, 50))
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

  // Checked before imageUrl: a video background carries its still in
  // `posterUrl`, never `imageUrl`, so the two cannot both be set by the picker.
  if (normalized.videoUrl) {
    return { ...normalized, mode: "video" };
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

/** Is a dimmer/tint screen actually configured on this row? */
export function hasActiveRowOverlayScreen(overlayScreen: unknown): boolean {
  return normalizeRowOverlayScreenSettings(overlayScreen).background.mode !== "none";
}

/**
 * The tint a video background starts with. A dark neutral at partial strength —
 * the same treatment the hero banner already applies for the same reason, which
 * is that text laid over a photograph or over moving footage is unreadable
 * without something between them.
 */
export const BUILDER_VIDEO_DEFAULT_OVERLAY_TINT = "#101820";
export const BUILDER_VIDEO_DEFAULT_OVERLAY_OPACITY = 45;

/**
 * Seed the tint when a row first becomes a video row (operator's call,
 * 2026-08-31: "Default overlay tint ON").
 *
 * It SEEDS, it does not lock: an overlay already configured is returned
 * untouched, and everything about the seeded one — colour, strength, or
 * turning it off entirely — stays the operator's afterwards. Nothing here
 * ever removes a tint, because tearing out a setting he can see, as a side
 * effect of a mode change he made for another reason, is the kind of silent
 * edit this repo has been bitten by before.
 */
export function seedVideoBackgroundOverlayScreen(overlayScreen: unknown): RowOverlayScreenSettings {
  const current = normalizeRowOverlayScreenSettings(overlayScreen);
  if (current.background.mode !== "none") {
    return current;
  }

  return {
    background: {
      ...createDefaultBackgroundSettings(),
      mode: "color",
      color: BUILDER_VIDEO_DEFAULT_OVERLAY_TINT
    },
    opacity: BUILDER_VIDEO_DEFAULT_OVERLAY_OPACITY
  };
}

/**
 * The tint screen's own style. Ported from the frozen vanilla builder
 * (`public/js/builder.js`, `buildRowOverlayScreenStyle`) — the settings were
 * normalized on both sides all along, but only the vanilla builder ever
 * PAINTED one, so a React-rendered row silently had no overlay at all. Text
 * sitting on moving footage is what finally forced the port.
 */
export function getBuilderRowOverlayScreenStyle(overlayScreen: unknown): CSSProperties | undefined {
  const normalized = normalizeRowOverlayScreenSettings(overlayScreen);
  if (normalized.background.mode === "none") {
    return undefined;
  }

  const style = getBuilderBackgroundStyle(normalized.background);
  if (!style) {
    return undefined;
  }

  const opacity = normalized.opacity / 100;
  return Number.isFinite(opacity) && opacity < 1 ? { ...style, opacity } : style;
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
  if (background.mode === "image" || background.mode === "video" || background.mode === "style") {
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
        ...(normalizeThemeNumber(scale.h6Fw, 100, 900) ? { h6Fw: normalizeThemeNumber(scale.h6Fw, 100, 900) } : {}),
        ...(normalizeThemeNumber(scale.h1Mt, -400, 400) ? { h1Mt: normalizeThemeNumber(scale.h1Mt, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h2Mt, -400, 400) ? { h2Mt: normalizeThemeNumber(scale.h2Mt, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h3Mt, -400, 400) ? { h3Mt: normalizeThemeNumber(scale.h3Mt, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h4Mt, -400, 400) ? { h4Mt: normalizeThemeNumber(scale.h4Mt, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h5Mt, -400, 400) ? { h5Mt: normalizeThemeNumber(scale.h5Mt, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h6Mt, -400, 400) ? { h6Mt: normalizeThemeNumber(scale.h6Mt, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h1Mb, -400, 400) ? { h1Mb: normalizeThemeNumber(scale.h1Mb, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h2Mb, -400, 400) ? { h2Mb: normalizeThemeNumber(scale.h2Mb, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h3Mb, -400, 400) ? { h3Mb: normalizeThemeNumber(scale.h3Mb, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h4Mb, -400, 400) ? { h4Mb: normalizeThemeNumber(scale.h4Mb, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h5Mb, -400, 400) ? { h5Mb: normalizeThemeNumber(scale.h5Mb, -400, 400) } : {}),
        ...(normalizeThemeNumber(scale.h6Mb, -400, 400) ? { h6Mb: normalizeThemeNumber(scale.h6Mb, -400, 400) } : {})
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

/**
 * THE THEME A PAGE ACTUALLY RENDERS WITH — the live theme record when the page
 * names one, not the copy taken at the moment the theme was assigned.
 *
 * Assigning a theme to a page copies its typography into the page's own
 * document (`applyThemeToPage`), and until 2026-08-15 every renderer read that
 * copy. Colours, margins and backgrounds already resolved live — the server
 * sends the theme record alongside each page — so a theme edit reached a
 * published page's colour and not its type, which is indistinguishable from
 * "the setting is broken". The operator changed a theme's global line height,
 * saw nothing move, and reasonably concluded the control did not work.
 *
 * This is the same contract the page TEMPLATE frame already keeps: the page
 * stores a REFERENCE and the reference resolves against the current master at
 * render. Nothing is written to any page, which is the point — the canonical
 * saved-section propagation had to rewrite every linked page to push a change
 * out, and that is what lost 35 sections off the Delray home page on
 * 2026-08-14. A theme edit here touches no page row at all.
 *
 * The stored copy stays as the fallback, and is what a page keeps if its theme
 * is later deleted, or if the theme record carries no typography at all.
 *
 * Callers decide what counts as "linked" — the public site passes the theme
 * shell only when the page carries a themeId, the editor passes the theme the
 * Theme dropdown currently names. A page with no theme keeps its own stored
 * values and must never inherit some other theme's type.
 */
export function resolveRenderTheme(
  storedTheme: unknown,
  liveTheme: { typography?: unknown } | null | undefined
): BuilderTheme {
  const liveTypography =
    liveTheme && typeof liveTheme === "object" && !Array.isArray(liveTheme)
      ? liveTheme.typography
      : null;

  const hasLiveTypography =
    Boolean(liveTypography) &&
    typeof liveTypography === "object" &&
    !Array.isArray(liveTypography) &&
    Object.keys(liveTypography as Record<string, unknown>).length > 0;

  return hasLiveTypography
    ? normalizeTheme({ typography: liveTypography })
    : normalizeTheme(storedTheme);
}

/**
 * The focal point as a CSS position string. Shared on purpose: the poster
 * fallback below uses it for `background-position` and the video layer uses it
 * for `object-position`, so the still and the moving footage crop identically
 * and nothing jumps when one replaces the other.
 */
/**
 * The crossfade actually used, clamped against the clip's own playing window.
 *
 * A dissolve longer than the material is not a dissolve — the section would
 * spend its whole life mid-fade, with both copies half-visible and neither
 * ever clearly on screen. A third of the window is the ceiling: it leaves the
 * clip visibly ITSELF for the majority of every pass, which is the point of
 * having a video at all.
 *
 * `windowSeconds` is what actually plays: (trim end, or the full duration)
 * minus the trim start. Pass 0 when the duration is not known yet — the
 * browser has not loaded metadata — and the requested value stands until it
 * is.
 */
export function resolveBuilderVideoLoopFade(
  background: BackgroundSettings | undefined,
  windowSeconds: number
): number {
  const requested = clampBackgroundNumber(
    background?.videoLoopFade,
    0,
    BUILDER_VIDEO_LOOP_FADE_MAX,
    0.6
  );
  if (requested <= 0) {
    return 0;
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return requested;
  }
  return Math.min(requested, windowSeconds / 3);
}

/** Does this background wrap with a dissolve rather than a cut? */
export function builderVideoCrossfades(
  background: BackgroundSettings | undefined,
  windowSeconds = 0
): boolean {
  if (!background || background.videoLoop === false) {
    return false;
  }
  return resolveBuilderVideoLoopFade(background, windowSeconds) > 0;
}

export function builderVideoBackgroundPosition(background: BackgroundSettings | undefined): string {
  const x = Math.round(clampBackgroundNumber(background?.videoFocalX, 0, 100, 50));
  const y = Math.round(clampBackgroundNumber(background?.videoFocalY, 0, 100, 50));
  return `${x}% ${y}%`;
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
      // A CSS background cannot carry a srcset, so it takes the widest copy
      // instead: identical dimensions, a fraction of the bytes.
      backgroundImage: `url("${backgroundImageUrlFor(background.imageUrl)}")`,
      backgroundSize: "cover",
      backgroundPosition: "center"
    };
  }

  // A video is not a CSS background, and this function only returns CSS.
  // Surfaces that CAN play one draw a real <video> layer of their own and never
  // reach this branch; every surface that cannot — buttons, email, module cards,
  // saved-cell thumbnails, the frozen vanilla builder — lands here and paints the
  // poster. That is deliberate: it is why mode "video" could be added without a
  // single caller of this function learning about it.
  if (background.mode === "video") {
    if (!background.posterUrl) {
      // No poster means no CSS answer. Returning `undefined` leaves the surface
      // exactly as it renders today; a `url("")` would paint a broken image.
      return undefined;
    }

    return {
      backgroundImage: `url("${backgroundImageUrlFor(background.posterUrl)}")`,
      backgroundSize: "cover",
      backgroundPosition: builderVideoBackgroundPosition(background)
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

/**
 * Legacy all-sides cell padding.
 *
 * The fallback is 0, not the 18 it was until 2026-08-11. A cell that nobody
 * has given a padding to should not quietly carry one: the operator spent an
 * evening hunting an 18px band above a banner logo that no image setting
 * could reach, because the cell had been given that inset by a default
 * rather than by him. Cells already carrying an explicit number keep it —
 * this only changes what an unset cell inherits.
 */
function normalizeCellPadding(
  value: unknown,
  layout: BuilderTemplateLayout
): Record<string, string> {
  const columns = getLayoutColumns(layout);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, "0"]));
  }

  const raw = value as Record<string, unknown>;

  return Object.fromEntries(
    columns.map((column) => {
      const parsed = Number.parseInt(String(raw[column] ?? "0"), 10);
      const normalized = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 50) : 0;
      return [column, String(normalized)];
    })
  );
}

/**
 * One SIDE of a cell's padding, seeded from whatever the cell used to carry.
 *
 * Two generations of fallback, newest first: the vertical/horizontal pair
 * that shipped 2026-08-11, then the single all-sides `cellPadding` before
 * it. A cell that has never been given a padding gets 0 — a default nobody
 * asked for is what put an unreachable 18px band above a banner logo and
 * cost the operator an evening.
 */
function normalizeCellPaddingSide(
  value: unknown,
  pair: unknown,
  legacy: Record<string, string>,
  layout: BuilderTemplateLayout
): Record<string, string> {
  const columns = getLayoutColumns(layout);
  const read = (source: unknown, column: string) =>
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)[column]
      : undefined;

  return Object.fromEntries(
    columns.map((column) => [
      column,
      normalizeSpacingValue(
        read(value, column) ?? read(pair, column) ?? legacy[column] ?? "0",
        "0",
        0,
        50
      )
    ])
  );
}

/** One side of a cell's margin, seeded from the vertical pair that preceded it. */
function normalizeCellMarginSide(
  value: unknown,
  pair: unknown,
  layout: BuilderTemplateLayout
): Record<string, string> {
  const columns = getLayoutColumns(layout);
  const read = (source: unknown, column: string) =>
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)[column]
      : undefined;

  return Object.fromEntries(
    columns.map((column) => [
      column,
      normalizeSpacingValue(read(value, column) ?? read(pair, column) ?? "0", "0", 0, 160)
    ])
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

/**
 * Type names that no longer exist, and what they became.
 *
 * `slideshow` and `slider` merged into `carousel` on 2026-08-16: they were
 * one machine with two settings locked to opposite extremes — one item
 * visible and moving by itself, versus many items visible and moved by
 * hand — so neither could ever borrow the other's behaviour. `format`
 * carries that distinction now (see `migrateCarouselSettings`).
 *
 * These entries are PERMANENT. An unrecognized type falls through to
 * "text" at the bottom of this function, which silently replaces a page's
 * module with an empty text block on the next load — no error, no undo
 * (CLAUDE.md landmine 1). Old documents keep arriving from page revisions,
 * saved sections, imports and backups long after a rename, so a retired
 * name is never removed from this map, only added to.
 */
const RETIRED_MODULE_TYPES: Record<string, BuilderTemplateModuleType> = {
  slideshow: "carousel",
  slider: "carousel"
};

export function normalizeModuleType(value: unknown): BuilderTemplateModuleType {
  const type = safeText(value, 40).toLowerCase();

  const retired = RETIRED_MODULE_TYPES[type];
  if (retired) return retired;

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
    type === "carousel" ||
    type === "feature-cards" ||
    type === "program-list" ||
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
    type === "site-search" ||
    type === "site-search-results" ||
    type === "messaging-topic-list" ||
    type === "messaging-tag-list" ||
    type === "admin-team-users" ||
    type === "admin-modules" ||
    type === "admin-login" ||
    type === "admin-nav-link" ||
    type === "admin-site-settings" ||
    type === "admin-support-form" ||
    type === "bug-report"
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
            : normalizedKey === "slides"
              ? (Array.isArray(raw) ? JSON.stringify(raw) : safeText(raw, 200000))
            // Standard 6: collection keys must be exempted from the 10k cap
            // or a long collection is truncated mid-JSON on save, parses as
            // empty on the next load, and the content is gone with no error.
            // `sliderItems` was missing here until 2026-08-07 — the Card
            // Slider had been capped at 10k since it shipped.
            : normalizedKey === "cards" ||
                normalizedKey === "sliderItems" ||
                // The carousel's unified collection. Exempted from the day it
                // was named rather than a month later, which is the mistake
                // `sliderItems` records directly above.
                normalizedKey === "items" ||
                // `programs` holds every class a club runs, each with its own
                // sessions, price bands and bullets — fifteen programs is
                // ordinary for one tennis centre, and the whole collection is
                // one JSON value.
                normalizedKey === "programs"
              ? (Array.isArray(raw) ? JSON.stringify(raw) : safeText(raw, 200000))
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

/**
 * Rotation Rate, in turns per minute, for the two effects that rotate
 * (added 2026-08-16). Only stamped when the effect actually uses it, so a
 * page whose image has no effect does not gain a setting it will never read —
 * and 25 is the speed Spin has always run at, so an existing page is
 * unchanged either way.
 */
/**
 * Keep the effect controls that apply to the chosen effect, drop the rest.
 *
 * ONE RULE, TWO HALVES. The settings panel decides which of the seven
 * controls to SHOW with three predicates (`imageEffectTravels`,
 * `imageEffectRotates`, `imageEffectBounces`); this function decides which
 * ones to KEEP on the way to the page. Those have to be the same rule, and
 * they were not — the keep-half listed effect names by hand.
 *
 * So when Slide, Axis Rotate and Flips were surfaced on 2026-08-22, their
 * panels correctly offered Speed, Rotation Rate, Frequency and the rest, the
 * operator could move every one of them, the value saved — and it was
 * deleted here before it ever reached the renderer. All three ran at the
 * built-in defaults forever, with no error anywhere and an animation on
 * screen the whole time, so "it animates" stayed true while every control
 * was dead. Found in review the same day.
 *
 * Reading the panel's own predicates is what stops the next effect repeating
 * it: adding one to `imageEffectRotates` now teaches both halves at once.
 */
function normalizeImageEffectSettings(settings: Record<string, string>) {
  // Direction belongs to the travelling effects, and is stored only when it
  // is not the default — a page that never chose one carries no key.
  if (imageEffectTravels(settings.effect)) {
    if (settings.effectDirection !== "rtl") delete settings.effectDirection;
    if (settings.effectRepeat !== "once") delete settings.effectRepeat;
    settings.effectSpeed = normalizeSpacingValue(settings.effectSpeed, "8", 1, 600);
    settings.effectDelay = normalizeSpacingValue(settings.effectDelay, "0", 0, 120);
  } else {
    delete settings.effectDirection;
    delete settings.effectRepeat;
    delete settings.effectSpeed;
    delete settings.effectDelay;
  }

  if (imageEffectRotates(settings.effect)) {
    settings.effectRotationRate = normalizeSpacingValue(settings.effectRotationRate, "25", 1, 600);
  } else {
    delete settings.effectRotationRate;
  }

  // Frequency — hops per crossing — and how high each hop goes belong to the
  // effects that leave the midline: Tumbleweed while it crosses the page,
  // Flips without going anywhere. Spin turns in place and stays on it.
  if (imageEffectBounces(settings.effect)) {
    settings.effectFrequency = normalizeSpacingValue(settings.effectFrequency, "4", 1, 60);
    settings.effectBounceHeight = normalizeSpacingValue(settings.effectBounceHeight, "50", 0, 1000);
  } else {
    delete settings.effectFrequency;
    delete settings.effectBounceHeight;
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

/**
 * Migrate one spacing pair onto its four sides.
 *
 * Every object in the Builder — row, cell, module — spells its spacing the
 * same way from 2026-08-11: Top, Bottom, Left, Right, for both margin and
 * padding (operator: "standardize all objects on the Top/Bottom/Left/Right
 * model"). Rows already did; everything else carried a vertical/horizontal
 * PAIR, so each side inherits the pair's value and nothing moves.
 *
 * A side that has already been set wins, which is what makes this safe to
 * run on every load: the operator's own number is never overwritten by the
 * pair it came from.
 */
function migrateSpacingPairToSides(
  settings: Record<string, string>,
  prefix: string,
  legacyVerticalKey: string,
  legacyHorizontalKey: string,
  {
    min = 0,
    max = 160,
    verticalFallback = "0",
    horizontalFallback = verticalFallback
  }: { min?: number; max?: number; verticalFallback?: string; horizontalFallback?: string } = {}
) {
  const cap = (side: string) => `${prefix}${side}`;
  const vertical = settings[legacyVerticalKey];
  const horizontal = settings[legacyHorizontalKey];

  // The two fallbacks are separate because a pair does not always default to
  // the same number on both axes — a menu bar's links ship 0 top/bottom and
  // 14 left/right. One shared fallback here would have flattened the link
  // padding of every live menu that had never touched the control.
  settings[cap("Top")] = normalizeSpacingValue(settings[cap("Top")] ?? vertical, verticalFallback, min, max);
  settings[cap("Bottom")] = normalizeSpacingValue(settings[cap("Bottom")] ?? vertical, verticalFallback, min, max);
  settings[cap("Left")] = normalizeSpacingValue(settings[cap("Left")] ?? horizontal, horizontalFallback, min, max);
  settings[cap("Right")] = normalizeSpacingValue(settings[cap("Right")] ?? horizontal, horizontalFallback, min, max);

  delete settings[legacyVerticalKey];
  delete settings[legacyHorizontalKey];
}

const CAROUSEL_CAPTION_POSITIONS = new Set([
  "bottom-left",
  "bottom-center",
  "top-left",
  "top-center",
  "center"
]);

/**
 * Fold the two retired collections into the carousel's one.
 *
 * The old shapes were a strict subset relationship, which is why the merge
 * could be automatic and lossless in the first place:
 *
 *   slideshow  slides      [{ id, url, alt }]
 *   slider     sliderItems [{ id, title, body, imageUrl, imageAlt, linkUrl,
 *                            linkLabel, icon, iconImageUrl }]
 *
 * A slide is a card with only its picture filled in, so `url` → `imageUrl`
 * and `alt` → `imageAlt` and the rest arrive empty. Nothing is discarded in
 * either direction, and the surviving shape is the card — deliberately the
 * SAME field names `feature-cards` uses (`builder-card-items.ts`), so content
 * still moves between the two without retyping.
 *
 * Which key a document arrives with is also the only honest evidence of what
 * the operator built, so it seeds `format` — a document that never named a
 * format still renders as the module it was authored as.
 *
 * Deliberately hand-rolled rather than reusing `parseBuilderCardItems`:
 * that module resolves asset URLs through browser-only code and is
 * explicitly NOT importable here (see its header note) — this file bundles
 * for the server too. This transform only renames keys.
 */
function migrateCarouselSettings(settings: Record<string, string>) {
  const readArray = (raw: string | undefined): Record<string, unknown>[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  };

  const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));

  const toItem = (entry: Record<string, unknown>, index: number) => ({
    id: str(entry?.id) || `item-${index + 1}`,
    title: str(entry?.title),
    body: str(entry?.body),
    // `url` is the slideshow spelling, `imageUrl` the slider's.
    imageUrl: str(entry?.imageUrl ?? entry?.url),
    imageAlt: str(entry?.imageAlt ?? entry?.alt),
    linkUrl: str(entry?.linkUrl),
    linkLabel: str(entry?.linkLabel),
    icon: str(entry?.icon),
    iconImageUrl: str(entry?.iconImageUrl)
  });

  const hasItems = typeof settings.items === "string" && settings.items !== "";
  const legacySlides = readArray(settings.slides);
  const legacyCards = readArray(settings.sliderItems);

  if (!hasItems) {
    // Both keys present at once has never been written by any code path, but a
    // hand-edited or merged document could carry it. Concatenating is the only
    // choice that cannot silently drop content.
    const merged = [...legacySlides, ...legacyCards];
    settings.items = JSON.stringify(merged.map(toItem));
  } else {
    settings.items = JSON.stringify(readArray(settings.items).map(toItem));
  }

  if (!settings.format) {
    settings.format = legacyCards.length || (settings.sliderItems !== undefined && !legacySlides.length)
      ? "cards"
      : "slideshow";
  }

  // The old spellings, carried over before the keys are dropped. `sliderHeight`
  // is not among them: it was written onto every Card Slider ever created and
  // read by absolutely nothing, so there is no value in it to preserve.
  if (settings.cardWidth === undefined && settings.sliderCardWidth !== undefined) {
    settings.cardWidth = settings.sliderCardWidth;
  }
  if (settings.gap === undefined && settings.sliderGap !== undefined) {
    settings.gap = settings.sliderGap;
  }

  delete settings.slides;
  delete settings.sliderItems;
  delete settings.sliderCardWidth;
  delete settings.sliderGap;
  delete settings.sliderHeight;
}

export function normalizeBuilderModuleSettingsForType(
  type: BuilderTemplateModuleType,
  value: unknown,
  moduleContext?: Pick<BuilderTemplateModule, "id" | "name" | "text">
) {
  const settings = normalizeModuleSettings(value);

  // Universal, before any per-type block: EVERY module's outer spacing is
  // four sides. The per-type copies of this migration (heading's and the
  // button's) are gone — one rule, run once, for all 38 types.
  migrateSpacingPairToSides(settings, "margin", "verticalMargin", "horizontalMargin");

  if (type === "tractor-nav") {
    /* The module draws one of several proximity effects; "rings" is the
       original and stays the default, so every page that predates the picker
       keeps rendering what it already rendered. normalizeProximityEffectSettings
       deliberately does NOT delete the keys the chosen preset ignores — see the
       note on it; a ring layout somebody tuned by hand must survive a flick to
       Glow and back. */
    normalizeProximityEffectSettings(settings);
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

    /*
     * Style overhaul, 2026-08-11. Three old keys are replaced by keys the
     * new panel can actually control; each migrates once and only when the
     * new key is still unset, so an operator's later choice always wins.
     *
     * Run on load AND on save, which is what makes it safe to do here: a
     * page nobody re-saves still renders from migrated values.
     */

    // "8px 12px" was one text field for two numbers, and only the live site
    // read it as link padding — the builder applied it to the whole bar.
    if (settings.navPadding && !settings.navLinkPaddingV && !settings.navLinkPaddingH) {
      const parts = settings.navPadding.trim().split(/\s+/);
      const vertical = Number.parseInt(parts[0] ?? "", 10);
      const horizontal = Number.parseInt(parts[1] ?? parts[0] ?? "", 10);
      if (Number.isFinite(vertical)) {
        settings.navLinkPaddingV = normalizeSpacingValue(String(vertical), "0", 0, 40);
      }
      if (Number.isFinite(horizontal)) {
        settings.navLinkPaddingH = normalizeSpacingValue(String(horizontal), "14", 0, 60);
      }
    }
    delete settings.navPadding;

    // Bold never reached a link — `.site-nav-link` hardcoded font-weight 700
    // over it. Anyone who ticked it got what they wanted anyway; anyone who
    // unticked it kept bold links. Weight honours both answers from now on.
    if (settings.navBold !== undefined && !settings.navWeight) {
      settings.navWeight = settings.navBold === "true" ? "700" : "500";
    }
    delete settings.navBold;

    // The nav had its own margin pair alongside the module's, both live, both
    // labelled "Vertical Margin". One survives, and it is the standard the
    // whole Builder now spells the same way (W7). The universal migration
    // above has already run, so an unset side is still "0" here and taking
    // the nav's own number does not overwrite anybody's choice.
    if (settings.navMarginV && settings.marginTop === "0" && settings.marginBottom === "0") {
      settings.marginTop = normalizeSpacingValue(settings.navMarginV, "0", 0, 160);
      settings.marginBottom = settings.marginTop;
    }
    if (settings.navMarginH && settings.marginLeft === "0" && settings.marginRight === "0") {
      settings.marginLeft = normalizeSpacingValue(settings.navMarginH, "0", 0, 160);
      settings.marginRight = settings.marginLeft;
    }
    delete settings.navMarginV;
    delete settings.navMarginH;

    // The bar's own padding and the links' padding, each on four sides.
    // Fallbacks are NAV_STYLE_DEFAULTS: the bar ships 8 on every side, the
    // links 0 top/bottom and 14 left/right. Migrating to a flat 0 would have
    // stripped the padding from every menu on every live site.
    migrateSpacingPairToSides(settings, "navPadding", "navPaddingV", "navPaddingH", {
      max: 60,
      verticalFallback: "8",
      horizontalFallback: "8"
    });
    migrateSpacingPairToSides(settings, "navLinkPadding", "navLinkPaddingV", "navLinkPaddingH", {
      max: 60,
      verticalFallback: "0",
      horizontalFallback: "14"
    });

    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
  }

  if (type === "image") {
    stripOverlayOnlyImageSettings(settings);
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
    migrateSpacingPairToSides(settings, "padding", "verticalPadding", "horizontalPadding");
    normalizeImageEffectSettings(settings);
  }

  if (type === "floating-image") {
    delete settings.positionMode;
    delete settings.linkUrl;
    delete settings.newTab;
    settings.offsetX = normalizeSignedOffsetValue(settings.offsetX, "0");
    settings.offsetY = normalizeSignedOffsetValue(settings.offsetY, "0");
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
    migrateSpacingPairToSides(settings, "padding", "verticalPadding", "horizontalPadding");
    settings.zIndex = normalizeSpacingValue(settings.zIndex, "20", -999, 999999);
    normalizeImageEffectSettings(settings);

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

  if (type === "carousel") {
    migrateCarouselSettings(settings);

    settings.format = settings.format === "cards" ? "cards" : "slideshow";
    const isCards = settings.format === "cards";

    // Fade means nothing when several items share the frame — there is no
    // single item to fade between — so the cards format is always "slide".
    settings.transition = !isCards && settings.transition === "fade" ? "fade" : "slide";

    // Autoplay is what a slideshow IS and what a card shelf is not, so the
    // default follows the format. A stored value always wins: an operator who
    // switches format keeps the playback they chose.
    settings.autoplay = settings.autoplay === "" || settings.autoplay === undefined
      ? String(!isCards)
      : String(settings.autoplay !== "false");
    settings.intervalMs = normalizeSpacingValue(settings.intervalMs, "5000", 1000, 20000);
    settings.pauseOnHover = String(settings.pauseOnHover !== "false");
    settings.loop = String(settings.loop !== "false");

    // Manual controls. Neither module had both: the slideshow had no way for a
    // visitor to move it at all, and the slider had arrows but no dots.
    settings.showArrows = settings.showArrows === "" || settings.showArrows === undefined
      ? "true"
      : String(settings.showArrows !== "false");
    settings.showDots = settings.showDots === "" || settings.showDots === undefined
      ? String(!isCards)
      : String(settings.showDots !== "false");

    settings.heightPx = normalizeSpacingValue(settings.heightPx, "0", 0, 900);
    settings.gap = normalizeSpacingValue(settings.gap, isCards ? "16" : "0", 0, 40);
    settings.cardWidth = normalizeSpacingValue(settings.cardWidth, "280", 180, 420);

    // Captions ride on the same title/body/link every item already carries, so
    // turning them on never asks for content to be retyped — and they default
    // OFF so no existing slideshow gains text it never had.
    settings.showCaptions = String(settings.showCaptions === "true");
    settings.captionPosition = CAROUSEL_CAPTION_POSITIONS.has(settings.captionPosition ?? "")
      ? settings.captionPosition
      : "bottom-left";

    // The nudge, added 2026-08-12. Clamped here rather than trusted from the
    // document, the same as every other module that offers it — an imported
    // page can carry anything in these keys.
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
  }

  if (type === "feature-cards") {
    // Empty color settings mean "follow the site theme". Modules created
    // before 2026-08-08 were seeded with these literal factory colors, so a
    // module still carrying the complete untouched set is one nobody ever
    // recolored — convert it to theme-following. Changing any single color
    // breaks the fingerprint and preserves the operator's choice.
    if (
      settings.cardBackground === "#ffffff" &&
      settings.cardBorderColor === "#e1e8f0" &&
      settings.iconColor === "#0b2a4a" &&
      settings.iconAltColor === "#4f9c3a"
    ) {
      settings.cardBackground = "";
      settings.cardBorderColor = "";
      settings.iconColor = "";
      settings.iconAltColor = "";
    }
  }

  if (type === "text") {
    // The block's vertical rhythm, both of which mean "follow the theme" when
    // empty (A2). Only a key that is actually present is touched: writing a
    // normalized "" onto every text module would put the key on every text
    // block on every page, and a fallback-on-blank would put a real line
    // height on all of them.
    if (settings.lineHeight) {
      settings.lineHeight = normalizeDecimalValue(settings.lineHeight, "1.6", 0.8, 3);
    }
    if (settings.paragraphGap) {
      settings.paragraphGap = normalizeSpacingValue(settings.paragraphGap, "14", 0, 120);
    }
  }

  if (type === "heading") {
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
    // A button that has never carried a padding keeps the shape it shipped
    // with — 12 top/bottom, 24 left/right — so no live button changes size.
    settings.paddingTop = normalizeSpacingValue(settings.paddingTop ?? settings.paddingY, "12", 1, 50);
    settings.paddingBottom = normalizeSpacingValue(settings.paddingBottom ?? settings.paddingY, "12", 1, 50);
    settings.paddingLeft = normalizeSpacingValue(settings.paddingLeft ?? settings.paddingX, "24", 1, 50);
    settings.paddingRight = normalizeSpacingValue(settings.paddingRight ?? settings.paddingX, "24", 1, 50);
    delete settings.paddingX;
    delete settings.paddingY;
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
    /**
     * `borderWidth` is the key. The editor writes it and both renderers read
     * it; `borderThickness` is a mirror kept for older saved modules and for
     * nothing else — no table renderer has ever read it.
     *
     * The precedence used to be `borderThickness ?? borderWidth`, which made
     * the mirror authoritative and silently reverted every border change: the
     * first normalization pass set borderThickness from borderWidth, and from
     * then on it shadowed whatever the operator picked. Border COLOUR worked
     * because it has no mirror — which is exactly how the bug was reported
     * (2026-08-11, "the border color setting works, but not the size").
     *
     * `??` is the whole guard: normalizeModuleSettings above has already run
     * every present borderWidth through normalizeSpacingValue, so if the key
     * exists it holds a usable number — including "0", which is a deliberate
     * borderless table and must not be mistaken for "unset".
     */
    const borderThickness = normalizeSpacingValue(
      settings.borderWidth ?? settings.borderThickness,
      "1",
      0,
      24
    );
    settings.borderWidth = borderThickness;
    settings.borderThickness = borderThickness;
    settings.cellPadding = normalizeSpacingValue(settings.cellPadding, "14", 0, 40);
    // `columnsCount` / `rowsCount` are vestigial: the grid's real shape lives
    // in `tableData` (headers.length and rowCount), which is what the editor
    // and both renderers use. Nothing reads these two. Kept only so older
    // saved modules round-trip unchanged; do not wire a control to them (C6).
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

      // Read once: both padding axes fall back to it, so they must see the
      // same normalized value the legacy key ends up with.
      const cellPadding = normalizeCellPadding(normalizedSection.cellPadding, layout);

      return {
        id: safeText(normalizedSection.id, 120) || `section-${sectionIndex + 1}`,
        title: safeText(normalizedSection.title, 255),
        layout,
        widthMode: normalizedSection.widthMode === "full-width" ? "full-width" : "contained",
        widthPercent: normalizeSpacingValue(normalizedSection.widthPercent, "100", 25, 100),
        locked: normalizedSection.locked === true,
        isPrivate: normalizedSection.isPrivate === true,
        // The first row can never join upward — there is nothing above it.
        joinWithPrevious: sectionIndex > 0 && normalizedSection.joinWithPrevious === true,
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
        paddingTop: normalizeSpacingValue(normalizedSection.paddingTop, "18", 0, 160),
        paddingBottom: normalizeSpacingValue(normalizedSection.paddingBottom, "18", 0, 160),
        paddingLeft: normalizeSpacingValue(normalizedSection.paddingLeft, "0", 0, 160),
        paddingRight: normalizeSpacingValue(normalizedSection.paddingRight, "0", 0, 160),
        marginLeft: normalizeSpacingValue(normalizedSection.marginLeft, "0", 0, 160),
        marginRight: normalizeSpacingValue(normalizedSection.marginRight, "0", 0, 160),
        columnGap: normalizeSpacingValue(normalizedSection.columnGap, "16", 0, 120),
        minHeight: normalizeSpacingValue(normalizedSection.minHeight, "0", 0, 1200),
        columnWidths: normalizeCellMetric(normalizedSection.columnWidths, layout, "0", 0, 100),
        equalColumnHeights: normalizeBooleanText(normalizedSection.equalColumnHeights),
        horizontalOffset: normalizeSignedOffsetValue(normalizedSection.horizontalOffset, "0"),
        verticalOffset: normalizeSignedOffsetValue(normalizedSection.verticalOffset, "0"),
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
        cellPadding: cellPadding,
        cellPaddingTop: normalizeCellPaddingSide(
          normalizedSection.cellPaddingTop,
          normalizedSection.cellVerticalPadding,
          cellPadding,
          layout
        ),
        cellPaddingBottom: normalizeCellPaddingSide(
          normalizedSection.cellPaddingBottom,
          normalizedSection.cellVerticalPadding,
          cellPadding,
          layout
        ),
        cellPaddingLeft: normalizeCellPaddingSide(
          normalizedSection.cellPaddingLeft,
          normalizedSection.cellHorizontalPadding,
          cellPadding,
          layout
        ),
        cellPaddingRight: normalizeCellPaddingSide(
          normalizedSection.cellPaddingRight,
          normalizedSection.cellHorizontalPadding,
          cellPadding,
          layout
        ),
        cellMarginTop: normalizeCellMarginSide(
          normalizedSection.cellMarginTop,
          normalizedSection.cellVerticalMargin,
          layout
        ),
        cellMarginBottom: normalizeCellMarginSide(
          normalizedSection.cellMarginBottom,
          normalizedSection.cellVerticalMargin,
          layout
        ),
        cellMarginLeft: normalizeCellMarginSide(normalizedSection.cellMarginLeft, undefined, layout),
        cellMarginRight: normalizeCellMarginSide(normalizedSection.cellMarginRight, undefined, layout),
        cellMobileHidden: normalizeCellColor(normalizedSection.cellMobileHidden, layout, "false"),
        cellDesktopHidden: normalizeCellColor(normalizedSection.cellDesktopHidden, layout, "false"),
        cellIsPrivate: normalizeCellColor(normalizedSection.cellIsPrivate, layout, "false"),
        cellBorderWidth: normalizeCellMetric(normalizedSection.cellBorderWidth, layout, "0", 0, 20),
        cellBorderColor: normalizeCellColor(normalizedSection.cellBorderColor, layout, "transparent"),
        cellBorderRadius: normalizeCellMetric(normalizedSection.cellBorderRadius, layout, "0", 0, 60),
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

/**
 * Split rows into the runs that share one background. A row with
 * `joinWithPrevious` extends the run above it; every other row starts a new
 * one. A run of one is the ordinary case — a row standing on its own — so
 * callers can render every group the same way.
 */
export function groupJoinedSections(sections: BuilderTemplateSection[]): BuilderTemplateSection[][] {
  const groups: BuilderTemplateSection[][] = [];

  sections.forEach((section) => {
    const openGroup = groups[groups.length - 1];

    if (section.joinWithPrevious && openGroup) {
      openGroup.push(section);
      return;
    }

    groups.push([section]);
  });

  return groups;
}

export function createEmptySection(layout: BuilderTemplateLayout = "single"): BuilderTemplateSection {
  return {
    id: createLocalId("section"),
    title: "",
    locked: false,
    isPrivate: false,
    joinWithPrevious: false,
    layout,
    widthMode: "contained",
    widthPercent: "100",
    alignment: "left",
    marginTop: "0",
    marginBottom: "0",
    paddingTop: "18",
    paddingBottom: "18",
    paddingLeft: "0",
    paddingRight: "0",
    marginLeft: "0",
    marginRight: "0",
    columnGap: "16",
    minHeight: "0",
    columnWidths: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    equalColumnHeights: "false",
    horizontalOffset: "0",
    verticalOffset: "0",
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
    cellPadding: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellPaddingTop: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellPaddingBottom: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellPaddingLeft: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellPaddingRight: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellMarginTop: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellMarginBottom: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellMarginLeft: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellMarginRight: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellMobileHidden: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellDesktopHidden: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellIsPrivate: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellBorderWidth: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellBorderColor: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "transparent"])),
    cellBorderRadius: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
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
          // A2 (UI_RULES.md): seeded empty so a new heading FOLLOWS THE
          // THEME. getHeadingModuleStyle falls back to this exact hex
          // (builder-utils.ts `settings.color || "#18324a"`), so nothing
          // renders differently — but the Advanced badge no longer reports
          // an override the operator never chose.
          color: "",
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
          // A2: empty = follow the theme; getImageModuleStyle falls back to
          // this same hex, so the rendered result is unchanged.
          borderColor: "",
          borderRadius: "18",
          // horizontalOffset / verticalOffset removed 2026-08-07: nothing in
          // the image render path ever read them (they are a
          // floating-image concept). Existing pages keep the stale keys
          // harmlessly; no renderer consults them.
          effect: "none"
        }
      : type === "floating-image"
      ? {
          url: "",
          alt: "",
          size: "15",
          // A2: empty = follow the theme (same renderer fallback).
          borderColor: "",
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
      : type === "carousel"
      ? {
          // Seeded as a slideshow because that is what the bare type means
          // with nothing else said. The palette's Card Slider tile overrides
          // `format` at creation, and `normalizeBuilderModuleSettingsForType`
          // supplies every format-dependent default from there.
          format: "slideshow",
          items: "[]",
          intervalMs: "5000",
          transition: "slide",
          heightPx: "0"
        }
      : type === "feature-cards"
      ? {
          cards: "[]",
          cardColumns: "3",
          cardGap: "12",
          cardAlign: "center",
          cardRadius: "18",
          // Empty color = follow the site theme (resolved to --crm-theme-*
          // vars at render). A hex here would be stamped into every new
          // module's data and pin it to that color forever.
          cardBackground: "",
          cardBorderColor: "",
          cardShadow: "true",
          cardHoverLift: "true",
          imageAspect: "4-3",
          showIcons: "true",
          // Symbol or picture. "symbol" is the only value that existed
          // before 2026-08-12, so it stays the default and an older module
          // with no `iconType` reads the same as one that says "symbol".
          iconType: "symbol",
          iconColor: "",
          iconAltColor: "",
          iconTextColor: "",
          iconAlternate: "true",
          // The icon badge used to be entirely hardcoded in CSS — 48px,
          // circular, centred, overhanging the top edge, and painting
          // BEHIND the card image because nothing declared a stacking
          // order. These five settings expose all of it; the defaults
          // reproduce the old look exactly, except iconFront, which is
          // the fix (an icon nobody can see was never the intent).
          iconSize: "48",
          iconPlacement: "above",
          iconAlign: "center",
          iconShape: "circle",
          iconFront: "true",
          linkLabel: "Learn More",
          linkArrow: "true"
        }
      : type === "program-list"
      ? {
          programs: "[]",
          // The level chip is the one device carried over from the source
          // flyers, because it is the one doing real work: it tells a reader
          // in a glance whether a session is for them.
          showLevelBadge: "true",
          // The pro shop number is the club's, not each program's, so it
          // lives once on the module. A club that wants a different number
          // per program is a real but unmet case — see the ClickUp task.
          showReserve: "true",
          reserveLabel: "Reserve",
          reservePhone: "",
          // Stated once under the list rather than stamped on every entry.
          // On the source flyers this was a shield graphic repeated fifteen
          // times; it is a policy, and policies are text.
          policyNote: "",
          showInstructorColumn: "true",
          // Empty color = follow the site theme, resolved at render. A hex
          // here would be stamped into every new module and pin it forever
          // (the mistake feature-cards had to be migrated out of).
          accentColor: "",
          headingColor: "",
          cardBackground: "",
          cardBorderColor: "",
          cardRadius: "10"
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
                            // A2: empty = follow the theme; builder-module-card.tsx
                            // breadcrumb preview falls back to this same hex (#587592).
                            color: "",
                            // A2: empty = follow the theme; builder-module-card.tsx
                            // breadcrumb preview falls back to this same hex (#18324a).
                            activeColor: "",
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
                            // A2: empty = follow the theme; builder-module-card.tsx
                            // blog-toc preview falls back to this same hex (#0f4f8f).
                            color: "",
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
                            // A2: empty = follow the theme; builder-module-card.tsx
                            // blog-newsletter-subscribe preview falls back to this
                            // same hex (#0f4f8f).
                            accentColor: "",
                            // A2: empty = follow the theme; builder-module-card.tsx
                            // and BlogNewsletterSubscribePreview both fall back to
                            // this same hex (#eaf4ff).
                            bgColor: "",
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
                            // A2: empty = follow the theme; MessagingTagListPreview
                            // (builder-template-preview.tsx) falls back to this same
                            // hex (#0f4f8f), and no other renderer reads it.
                            activeColor: "",
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
                      : type === "admin-site-settings"
                        ? {
                            panelTitle: "Site Settings",
                            showTitle: "true"
                          }
                      : type === "admin-support-form"
                        ? {
                            formTitle: "Request Support",
                            showTitle: "true",
                            layout: "two-column",
                            defaultPriority: "normal",
                            showScreenshot: "true",
                            buttonText: "Send Request",
                            showHistory: "true",
                            historyTitle: "Your Recent Requests",
                            showContact: "true",
                            contactHeading: "Need a hand with your website?",
                            contactIntro: "Use the form below and it comes straight to us, along with anything you attach. For anything urgent, reach out directly:"
                          }
                      : type === "bug-report"
                        ? {
                            // Floating bug-report trigger (task 4/5). Keys are
                            // read by BugReportModule (builder-bug-report-module.tsx)
                            // and edited by builder-bug-report-module-settings.tsx.
                            visibility: "public",
                            // 5/5: off by default. Turning it on emails the
                            // project's Support Email address on every report;
                            // the server reads THIS value, never the request.
                            emailReports: "false",
                            icon: "bug",
                            corner: "bottom-right",
                            iconSize: "40",
                            iconBlock: "true",
                            blockColor: "#0f4f8f",
                            iconColor: "#ffffff",
                            labelText: "",
                            popupTitle: "Report a problem",
                            promptPlaceholder: "What went wrong? What did you expect to happen?",
                            thankYouMessage: "Thanks — we got it."
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
    pageTemplateId: safeText(row.page_template_id ?? row.pageTemplateId, 120),
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
