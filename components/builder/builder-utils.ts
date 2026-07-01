import type { CSSProperties } from "react";
import { getModuleTrigger } from "@/lib/module-trigger";
import type {
  BackgroundSettings,
  BuilderPageRecord,
  BuilderTemplateKind,
  BuilderTemplateModule,
  BuilderTemplateRecord,
  BuilderTemplateSection,
  BuilderTheme
} from "@/lib/builder-template";
import type { BuilderEmailFunction } from "@/lib/builder-email-template";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import {
  PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX,
  resolveGameOverlayContentZIndex
} from "@/lib/game-overlay-layer";
import {
  createDefaultBackgroundSettings,
  createDefaultTheme,
  finalizeBackgroundSettings,
  promoteThemeStylesPageBackground,
  finalizeThemeStylesPageBackground,
  getBuilderBackgroundLayerOpacity,
  getBuilderBackgroundStyle,
  normalizeBackgroundMode,
  normalizeBackgroundSettings,
  normalizeBuilderAssetUrl,
  resolvePublicBuilderAssetUrl,
  normalizeSignedOffsetValue,
  normalizeSpacingValue
} from "@/lib/builder-template";
import type { BuilderDraft } from "./builder-types";

export function createDraftFromTemplate(template?: BuilderTemplateRecord | null): BuilderDraft {
  if (!template) {
    return {
      id: "",
      name: "",
      templateKind: "modular",
      emailFunction: "",
      pageBackground: createDefaultBackgroundSettings(),
      theme: createDefaultTheme(),
      layoutSections: []
    };
  }

  return {
    id: template.id,
    name: template.name,
    templateKind: template.templateKind,
    emailFunction: template.emailFunction,
    pageBackground: template.pageBackground,
    theme: template.theme,
    layoutSections: template.layoutSections
  };
}

export function createDraftFromPage(page?: BuilderPageRecord | null): BuilderDraft {
  if (!page) {
    return {
      id: "",
      name: "",
      templateKind: "modular",
      emailFunction: "",
      pageBackground: createDefaultBackgroundSettings(),
      theme: createDefaultTheme(),
      layoutSections: []
    };
  }

  return {
    id: page.id,
    name: page.name,
    templateKind: "modular",
    emailFunction: "",
    pageBackground: page.pageBackground,
    theme: page.theme,
    layoutSections: page.layoutSections
  };
}

export function getAlignmentClass(alignment: "left" | "center" | "right") {
  if (alignment === "center") {
    return "is-align-center";
  }

  if (alignment === "right") {
    return "is-align-right";
  }

  return "is-align-left";
}

export function getModuleAlignment(settings: Record<string, string>): "left" | "center" | "right" {
  const alignment = settings.alignment;

  if (alignment === "center" || alignment === "right") {
    return alignment;
  }

  return "left";
}

/**
 * Container content alignment (cellHAlign/cellVAlign). Returns a flex-column
 * style aligning everything inside the cell; empty for the left/top default
 * so untouched containers keep normal block stacking.
 */
export function getCellContentAlignmentStyle(hAlign: string, vAlign: string): CSSProperties {
  const horizontal = hAlign === "center" || hAlign === "right" ? hAlign : "left";
  const vertical = vAlign === "center" || vAlign === "middle" ? "center" : vAlign === "bottom" ? "bottom" : "top";

  if (horizontal === "left" && vertical === "top") {
    return {};
  }

  return {
    display: "flex",
    flexDirection: "column",
    alignItems: horizontal === "center" ? "center" : horizontal === "right" ? "flex-end" : "stretch",
    justifyContent: vertical === "center" ? "center" : vertical === "bottom" ? "flex-end" : "flex-start"
  };
}

export function getVerticalMarginStyle(value: unknown): CSSProperties {
  const margin = normalizeSpacingValue(value, "0", 0, 160);

  return {
    marginTop: `${margin}px`,
    marginBottom: `${margin}px`
  };
}

export function getHorizontalMarginStyle(value: unknown): CSSProperties {
  const margin = normalizeSpacingValue(value, "0", 0, 160);

  return {
    marginLeft: `${margin}px`,
    marginRight: `${margin}px`
  };
}

export function getModuleOuterSpacingStyle(settings: Record<string, string>): CSSProperties {
  return {
    ...getVerticalMarginStyle(settings.verticalMargin),
    ...getHorizontalMarginStyle(settings.horizontalMargin)
  };
}

export function getSplitVerticalMarginStyle(top: unknown, bottom: unknown): CSSProperties {
  return {
    marginTop: `${normalizeSpacingValue(top, "0", 0, 160)}px`,
    marginBottom: `${normalizeSpacingValue(bottom, "0", 0, 160)}px`
  };
}

export function getModuleMarginStyle(settings: Record<string, string>): CSSProperties {
  const legacy = settings.verticalMargin;

  return getSplitVerticalMarginStyle(
    settings.marginTop ?? legacy,
    settings.marginBottom ?? legacy
  );
}

export function getSectionMarginStyle(section: BuilderTemplateSection): CSSProperties {
  return getSplitVerticalMarginStyle(section.marginTop, section.marginBottom);
}

export function getSectionBackgroundStyle(section: BuilderTemplateSection): CSSProperties | undefined {
  return getBuilderBackgroundStyle(section.background);
}

export function getModuleWidthPercent(settings: Record<string, string>) {
  const size = Number.parseInt(settings.size ?? "100", 10);
  return Math.min(Math.max(Number.isFinite(size) ? size : 100, 10), 100);
}

export function getModuleWidthStyle(settings: Record<string, string>): CSSProperties {
  return {
    width: `${getModuleWidthPercent(settings)}%`,
    maxWidth: "100%",
    boxSizing: "border-box"
  };
}

export function getModuleWidthShellStyle(settings: Record<string, string>): CSSProperties {
  const widthPercent = getModuleWidthPercent(settings);
  const alignment = getModuleAlignment(settings);

  return {
    ...getModuleWidthStyle(settings),
  ...(widthPercent >= 100
      ? { alignSelf: "stretch" }
      : {
          alignSelf:
            alignment === "center" ? "center" : alignment === "right" ? "flex-end" : "flex-start"
        })
  };
}

export function getImageModuleStyle(settings: Record<string, string>): CSSProperties {
  const borderThickness = Number.parseInt(settings.borderThickness ?? "0", 10);
  const borderRadius = Number.parseInt(settings.borderRadius ?? "18", 10);

  return {
    ...getModuleWidthStyle(settings),
    border: `${Math.max(Number.isFinite(borderThickness) ? borderThickness : 0, 0)}px solid ${
      settings.borderColor || "#0f4f8f"
    }`,
    borderRadius: `${Math.max(Number.isFinite(borderRadius) ? borderRadius : 18, 0)}px`
  };
}

export function getSpeechBubbleContainerWidthPx(settings: Record<string, string>): number {
  const parsed = Number.parseInt(settings.containerWidth ?? settings.width ?? "520", 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 520, 200), 900);
}

export type SpeechBubbleLayoutMode = "overlay" | "embedded";

function getSpeechBubbleMaxWidthCss(containerWidth: number, layoutMode: SpeechBubbleLayoutMode): string {
  if (layoutMode === "overlay") {
    return `min(${containerWidth}px, calc(100vw - 48px))`;
  }

  return `min(${containerWidth}px, 100%)`;
}

export function getSpeechBubbleContainerHeightPx(settings: Record<string, string>): number {
  const parsed = Number.parseInt(settings.containerHeight ?? "0", 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), 800);
}

export function getSpeechBubbleModuleStyle(
  settings: Record<string, string>,
  layoutMode: SpeechBubbleLayoutMode = "embedded"
): CSSProperties {
  const borderRadius = Math.max(0, Number.parseInt(settings.borderRadius ?? "40", 10) || 40);
  const borderThickness = Math.max(0, Number.parseInt(settings.borderThickness ?? "2", 10) || 2);
  const containerWidth = getSpeechBubbleContainerWidthPx(settings);
  const containerHeight = getSpeechBubbleContainerHeightPx(settings);
  const maxWidth = getSpeechBubbleMaxWidthCss(containerWidth, layoutMode);
  const offsetX = Number.parseInt(normalizeSignedOffsetValue(settings.offsetX, "0"), 10);
  const offsetY = Number.parseInt(normalizeSignedOffsetValue(settings.offsetY, "0"), 10);
  const zIndex = Number.parseInt(settings.zIndex ?? "10", 10);
  const resolvedOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
  const resolvedOffsetY = Number.isFinite(offsetY) ? offsetY : 0;
  const resolvedZIndex =
    layoutMode === "overlay"
      ? resolveGameOverlayContentZIndex(settings, Number.isFinite(zIndex) ? zIndex : 10)
      : Number.isFinite(zIndex)
        ? zIndex
        : 10;

  return {
    width: maxWidth,
    maxWidth,
    boxSizing: "border-box",
    "--speech-bubble-container-width": `${containerWidth}px`,
    ...(containerHeight > 0
      ? { "--speech-bubble-container-min-height": `${containerHeight}px` }
      : {}),
    "--speech-bubble-bg": normalizeBuilderHexColor(settings.backgroundColor || "#ffffff"),
    "--speech-bubble-border": normalizeBuilderHexColor(settings.borderColor || "#9ed4ee"),
    "--speech-bubble-border-width": `${borderThickness}px`,
    "--speech-bubble-radius": `${borderRadius}px`,
    "--speech-bubble-text": normalizeBuilderHexColor(settings.textColor || "#18324a"),
    color: normalizeBuilderHexColor(settings.textColor || "#18324a"),
    position: "relative",
    zIndex: resolvedZIndex,
    transform:
      resolvedOffsetX !== 0 || resolvedOffsetY !== 0
        ? `translate(${resolvedOffsetX}px, ${-resolvedOffsetY}px)`
        : undefined
  } as CSSProperties;
}

export function getSpeechBubbleBodyStyle(settings: Record<string, string>): CSSProperties {
  const containerHeight = getSpeechBubbleContainerHeightPx(settings);
  const borderThickness = Math.max(0, Number.parseInt(settings.borderThickness ?? "2", 10) || 2);

  return {
    width: "100%",
    boxSizing: "border-box",
    "--speech-bubble-bg": normalizeBuilderHexColor(settings.backgroundColor || "#ffffff"),
    "--speech-bubble-border": normalizeBuilderHexColor(settings.borderColor || "#9ed4ee"),
    "--speech-bubble-border-width": `${borderThickness}px`,
    ...(containerHeight > 0 ? { minHeight: `${containerHeight}px` } : {})
  } as CSSProperties;
}

export function getFloatingImageModuleStyle(settings: Record<string, string>): CSSProperties {
  const size = Number.parseInt(settings.size ?? "15", 10);

  return {
    ...getImageModuleStyle({ ...settings, size: String(Math.min(Math.max(Number.isFinite(size) ? size : 15, 10), 100)) }),
    width: "100%"
  };
}

export function getImagePositionMode(settings: Record<string, string>): "inline" | "overlay" {
  return settings.positionMode === "overlay" ? "overlay" : "inline";
}

export function isFloatingImageModule(module: Pick<BuilderTemplateModule, "type" | "settings">) {
  return module.type === "floating-image";
}

/** Legacy overlay images are migrated to `floating-image` on normalize. */
export function isOverlayImageModule(module: Pick<BuilderTemplateModule, "type" | "settings">) {
  return (
    isFloatingImageModule(module) ||
    (module.type === "image" &&
      module.settings.variant !== "video" &&
      getImagePositionMode(module.settings) === "overlay")
  );
}

export function columnHasOnlyOverlayImageModules(modules: BuilderTemplateModule[]) {
  return modules.length > 0 && modules.every(isOverlayImageModule);
}

/** Button-trigger floating images anchor to their row below the nav, not the full page. */
export function isSectionScopedOverlayDecor(module: Pick<BuilderTemplateModule, "type" | "settings">) {
  return isFloatingImageModule(module) && getModuleTrigger(module.settings) === "button";
}

export function columnHasOnlySectionScopedOverlayModules(modules: BuilderTemplateModule[]) {
  return modules.length > 0 && modules.every(isSectionScopedOverlayDecor);
}

export function sectionHasOnlySectionScopedOverlayModules(section: BuilderTemplateSection) {
  return section.modules.length > 0 && section.modules.every(isSectionScopedOverlayDecor);
}

/** Stack decorative floating rows above poll pods and other main sections (builder Z-Index applies here). */
export function resolveSectionScopedOverlaySectionZIndex(section: BuilderTemplateSection): number {
  return section.modules.reduce((max, module) => {
    if (!isSectionScopedOverlayDecor(module)) {
      return max;
    }

    return Math.max(max, resolveGameOverlayContentZIndex(module.settings, PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX));
  }, PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX);
}

/** Game / page-load floating images paint a full-page overlay layer above main content. */
export function sectionHasOnlyPageOverlayImageModules(section: BuilderTemplateSection) {
  return (
    section.modules.length > 0 &&
    section.modules.every((module) => isOverlayImageModule(module) && !isSectionScopedOverlayDecor(module))
  );
}

export function sectionHasOnlyOverlayImageModules(section: BuilderTemplateSection) {
  return sectionHasOnlyPageOverlayImageModules(section);
}

export const columnHasOnlyFloatingImageModules = columnHasOnlyOverlayImageModules;
export const sectionHasOnlyFloatingImageModules = sectionHasOnlyOverlayImageModules;

export function cloneBuilderLayoutSections(sections: BuilderTemplateSection[]): BuilderTemplateSection[] {
  return sections.map((section) => ({
    ...section,
    id: crypto.randomUUID(),
    modules: section.modules.map((module) => ({
      ...module,
      id: crypto.randomUUID(),
      settings: { ...module.settings }
    }))
  }));
}

export function buildUniquePageSlug(baseSlug: string, existingSlugs: Iterable<string>): string {
  const slugs = new Set(existingSlugs);
  const normalized = baseSlug.replace(/^-+|-+$/g, "") || "page";
  let candidate = `${normalized}-copy`;
  let counter = 2;

  while (slugs.has(candidate)) {
    candidate = `${normalized}-copy-${counter}`;
    counter += 1;
  }

  return candidate;
}

export function buildClonedPageCreatePayload(source: BuilderPageRecord, existingPages: BuilderPageRecord[]) {
  return {
    name: `${source.name.trim() || "Untitled page"} Copy`,
    slug: buildUniquePageSlug(source.slug, existingPages.map((page) => page.slug)),
    templateId: source.templateId,
    templateKind: "modular" as const,
    themeId: source.themeId ?? undefined,
    pageBackground: { ...source.pageBackground },
    theme: source.theme ? JSON.parse(JSON.stringify(source.theme)) : undefined,
    layoutSections: cloneBuilderLayoutSections(source.layoutSections)
  };
}

/** Overlay images are painted out-of-flow; collapse their row/column layout box. */
export function getOverlayFlowCollapsedSectionStyle(collapsed: boolean): CSSProperties {
  return collapsed
    ? {
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
        minHeight: 0,
        overflow: "visible"
      }
    : {};
}

export function getOverlayFlowCollapsedColumnStyle(collapsed: boolean): CSSProperties {
  return collapsed
    ? {
        padding: 0,
        minHeight: 0,
        overflow: "visible",
        borderWidth: 0
      }
    : {};
}

export function getOverlayFlowCollapsedModuleStyle(collapsed: boolean): CSSProperties {
  return collapsed
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        minHeight: 0,
        marginTop: 0,
        marginBottom: 0,
        padding: 0,
        overflow: "visible"
      }
    : {};
}

/** Zero-height in-flow row; image shell is positioned inside this slot (below nav when the row follows navigation). */
export function getSectionScopedOverlayColumnStyle(collapsed: boolean): CSSProperties {
  return collapsed
    ? {
        position: "relative",
        padding: 0,
        minHeight: 0,
        overflow: "visible",
        borderWidth: 0
      }
    : {};
}

export function getSectionScopedOverlayModuleStyle(collapsed: boolean): CSSProperties {
  return collapsed
    ? {
        position: "relative",
        height: 0,
        width: "100%",
        minHeight: 0,
        marginTop: 0,
        marginBottom: 0,
        padding: 0,
        overflow: "visible",
        zIndex: 40
      }
    : {};
}

export function getImageOverlayStyle(settings: Record<string, string>): CSSProperties {
  const x = Number.parseInt(settings.offsetX ?? "0", 10);
  const y = Number.parseInt(settings.offsetY ?? "0", 10);
  const zIndex = Number.parseInt(settings.zIndex ?? "20", 10);
  const size = Number.parseInt(settings.size ?? "100", 10);
  const offsetX = Number.isFinite(x) ? x : 0;
  const offsetY = Number.isFinite(y) ? y : 0;
  const anchor = settings.overlayAnchor ?? "center";
  const width = `${Math.min(Math.max(Number.isFinite(size) ? size : 100, 10), 100)}%`;
  /** Match speech bubble: positive Y moves up, negative Y moves down. */
  const offsetTransform = `translate(${offsetX}px, ${-offsetY}px)`;

  const style: CSSProperties = {
    position: "absolute",
    zIndex: Number.isFinite(zIndex) ? zIndex : 20,
    width
  };

  if (anchor === "top-left") {
    style.left = "0";
    style.top = "0";
    style.transform = offsetTransform;
    return style;
  }

  if (anchor === "top-center") {
    style.left = "50%";
    style.top = "0";
    style.transform = `translateX(-50%) ${offsetTransform}`;
    return style;
  }

  if (anchor === "top-right") {
    style.right = "0";
    style.top = "0";
    style.transform = offsetTransform;
    return style;
  }

  if (anchor === "center-left") {
    style.left = "0";
    style.top = "50%";
    style.transform = `translateY(-50%) ${offsetTransform}`;
    return style;
  }

  if (anchor === "center-right") {
    style.right = "0";
    style.top = "50%";
    style.transform = `translateY(-50%) ${offsetTransform}`;
    return style;
  }

  if (anchor === "bottom-left") {
    style.left = "0";
    style.bottom = "0";
    style.transform = offsetTransform;
    return style;
  }

  if (anchor === "bottom-center") {
    style.left = "50%";
    style.bottom = "0";
    style.transform = `translateX(-50%) ${offsetTransform}`;
    return style;
  }

  if (anchor === "bottom-right") {
    style.right = "0";
    style.bottom = "0";
    style.transform = offsetTransform;
    return style;
  }

  style.left = "50%";
  style.top = "50%";
  style.transform = `translate(-50%, -50%) ${offsetTransform}`;
  return style;
}

export function getModuleNudgeTransform(settings: Record<string, string>) {
  const horizontal = Number.parseInt(normalizeSignedOffsetValue(settings.horizontalOffset, "0"), 10);
  const vertical = Number.parseInt(normalizeSignedOffsetValue(settings.verticalOffset, "0"), 10);
  const offsetX = Number.isFinite(horizontal) ? horizontal : 0;
  const offsetY = Number.isFinite(vertical) ? vertical : 0;

  if (offsetX === 0 && offsetY === 0) {
    return null;
  }

  return `translate(${offsetX}px, ${-offsetY}px)`;
}

export function getFloatingImageModuleShellStyle(
  settings: Record<string, string>,
  options?: { sectionScopedDecor?: boolean }
): CSSProperties {
  const base = getImageModuleShellStyle({ ...settings, positionMode: "overlay" });

  if (!options?.sectionScopedDecor) {
    return base;
  }

  return {
    ...base,
    zIndex: resolveGameOverlayContentZIndex(settings, PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX)
  };
}

/** Shell styles when rendered inside `PlayerGameFloatingImageHost` (above the white backdrop). */
export function getGameOverlayFloatingImageShellStyle(settings: Record<string, string>): CSSProperties {
  return {
    ...getImageOverlayStyle(settings),
    zIndex: resolveGameOverlayContentZIndex(settings)
  };
}

export function getImageModuleShellStyle(settings: Record<string, string>): CSSProperties {
  const positionMode = getImagePositionMode(settings);
  const baseStyle = positionMode === "overlay" ? getImageOverlayStyle(settings) : undefined;
  const nudgeTransform = getModuleNudgeTransform(settings);

  if (!nudgeTransform) {
    return baseStyle ?? {};
  }

  if (baseStyle?.transform) {
    return {
      ...baseStyle,
      transform: `${String(baseStyle.transform)} ${nudgeTransform}`
    };
  }

  return {
    ...(baseStyle ?? {}),
    position: baseStyle?.position ?? "relative",
    transform: nudgeTransform
  };
}

export function getModuleBackgroundSettings(settings: Record<string, string>): BackgroundSettings {
  return {
    mode: normalizeBackgroundMode(settings.backgroundMode),
    color: settings.backgroundColor || "#ffffff",
    color2: settings.backgroundColor2 || "#eaf4ff",
    imageUrl: resolvePublicBuilderAssetUrl(settings.backgroundImageUrl),
    styleKey: settings.backgroundStyleKey === "blue-yellow-circles" ? "blue-yellow-circles" : ""
  };
}

export function getPollCategoryListPanelStyle(settings: Record<string, string>): CSSProperties {
  const panelBackground = getModuleBackgroundSettings(settings);

  if (panelBackground.mode === "none") {
    return {
      background: "transparent",
      backgroundColor: "transparent",
      backgroundImage: "none",
      boxShadow: "none",
      border: "none",
      borderRadius: undefined
    };
  }

  return {
    ...(getBuilderBackgroundStyle(panelBackground) ?? {}),
    borderRadius: "12px",
    border: `1px solid ${normalizeBuilderHexColor(settings.panelBorderColor, "#c6e8f5")}`
  };
}

export function isPollCategoryListPanelTransparent(settings: Record<string, string>): boolean {
  return getModuleBackgroundSettings(settings).mode === "none";
}

export function getButtonBackgroundSettings(settings: Record<string, string>): BackgroundSettings {
  const mode = settings.buttonBackgroundMode as BackgroundSettings["mode"] | undefined;

  if (mode) {
    return {
      mode,
      color: settings.buttonBackgroundColor || settings.buttonColor || "#214c71",
      color2: settings.buttonBackgroundColor2 || "#eaf4ff",
      imageUrl: resolvePublicBuilderAssetUrl(settings.buttonBackgroundImageUrl),
      styleKey: settings.buttonBackgroundStyleKey === "blue-yellow-circles" ? "blue-yellow-circles" : ""
    };
  }

  return {
    mode: "color",
    color: settings.buttonColor || "#214c71",
    color2: "#eaf4ff",
    imageUrl: "",
    styleKey: ""
  };
}

export function getModuleDropShadowStyle(settings: Record<string, string>): string {
  const shadowX = Number.parseInt(settings.dropShadowX ?? "3", 10);
  const shadowY = Number.parseInt(settings.dropShadowY ?? "3", 10);
  const shadowBlur = Number.parseInt(settings.dropShadowBlur ?? "2", 10);
  const shadowColor = settings.dropShadowColor || "rgba(0, 0, 0, 0.55)";
  const dropShadowEnabled = settings.dropShadow === "true" || settings.dropShadow === "on";

  if (!dropShadowEnabled) {
    return "none";
  }

  return `${Number.isFinite(shadowX) ? shadowX : 3}px ${Number.isFinite(shadowY) ? shadowY : 3}px ${Number.isFinite(shadowBlur) ? shadowBlur : 2}px ${shadowColor}`;
}

export function applyButtonBackgroundSettings(
  settings: Record<string, string>,
  background: BackgroundSettings
): Record<string, string> {
  return {
    ...settings,
    buttonBackgroundMode: background.mode,
    buttonBackgroundColor: background.color,
    buttonBackgroundColor2: background.color2,
    buttonBackgroundImageUrl: background.imageUrl,
    buttonBackgroundStyleKey: background.styleKey,
    ...(background.mode === "color" ? { buttonColor: background.color } : {})
  };
}

export function getButtonModuleStyle(settings: Record<string, string>): CSSProperties {
  const fontSize = Number.parseInt(settings.fontSize ?? "", 10);
  const textColor = settings.textColor || "#ffffff";
  const textShadow = getModuleDropShadowStyle(settings);
  const borderStyle = settings.borderStyle === "none" || settings.borderStyle === "dashed" || settings.borderStyle === "dotted"
    ? settings.borderStyle
    : "solid";
  const borderWidth = Number.parseInt(settings.borderWidth ?? "2", 10);
  const borderRadius = Number.parseInt(settings.borderRadius ?? "0", 10);
  const resolvedBorderWidth = borderStyle === "none" ? 0 : Math.max(Number.isFinite(borderWidth) ? borderWidth : 2, 0);
  const buttonBackground = getButtonBackgroundSettings(settings);
  const buttonFillStyle = getBuilderBackgroundStyle(buttonBackground);

  return {
    ...buttonFillStyle,
    ...(!buttonFillStyle ? { "--btn-bg": settings.buttonColor || "#214c71" } : {}),
    "--btn-bg-hover": settings.buttonHoverColor || "#0f4f8f",
    "--btn-color": textColor,
    "--btn-color-hover": settings.textHoverColor || "#ffffff",
    "--btn-text-shadow": textShadow,
    "--btn-border": settings.borderColor || "#214c71",
    color: textColor,
    textShadow,
    padding: `${settings.paddingY || "12"}px ${settings.paddingX || "24"}px`,
    borderStyle,
    borderColor: borderStyle === "none" ? "transparent" : settings.borderColor || "#214c71",
    borderWidth: `${resolvedBorderWidth}px`,
    borderRadius: `${Math.max(Number.isFinite(borderRadius) ? borderRadius : 0, 0)}px`,
    ...(Number.isFinite(fontSize) && fontSize >= 10 ? { fontSize: `${fontSize}px` } : {}),
    fontWeight: settings.bold === "false" ? 500 : 700,
    fontStyle: settings.italic === "true" ? "italic" : "normal",
    textDecoration: settings.underline === "true" ? "underline" : "none",
    textDecorationColor: settings.underline === "true" ? textColor : undefined
  } as CSSProperties;
}

export const HEADING_VARIANT_PRESETS = {
  eyebrow: { variant: "eyebrow", level: "h6", fontSize: "14" },
  section: { variant: "section", level: "h2", fontSize: "32" },
  hero: { variant: "hero", level: "h1", fontSize: "56" },
  default: { variant: "default", level: "h2", fontSize: "32" }
} as const;

export type HeadingVariantPresetKey = keyof typeof HEADING_VARIANT_PRESETS;

/**
 * Curated Google Fonts subset offered for heading-style modules. Keep this list
 * in sync with BUILDER_GOOGLE_FONTS_HREF (the stylesheet that actually loads the
 * families) and with the <link> tags in src/layout.html / public/builder-preview.html.
 */
export const BUILDER_HEADING_FONTS = [
  { key: "", label: "Default (theme)", stack: "" },
  { key: "inter", label: "Inter", stack: "'Inter', system-ui, sans-serif" },
  { key: "poppins", label: "Poppins", stack: "'Poppins', system-ui, sans-serif" },
  { key: "montserrat", label: "Montserrat", stack: "'Montserrat', system-ui, sans-serif" },
  { key: "oswald", label: "Oswald", stack: "'Oswald', 'Arial Narrow', sans-serif" },
  { key: "archivo", label: "Archivo", stack: "'Archivo', system-ui, sans-serif" },
  { key: "space-grotesk", label: "Space Grotesk", stack: "'Space Grotesk', system-ui, sans-serif" },
  { key: "bebas", label: "Bebas Neue", stack: "'Bebas Neue', Impact, sans-serif" },
  { key: "playfair", label: "Playfair Display", stack: "'Playfair Display', Georgia, serif" },
  { key: "merriweather", label: "Merriweather", stack: "'Merriweather', Georgia, serif" },
  { key: "lora", label: "Lora", stack: "'Lora', Georgia, serif" }
] as const;

export const BUILDER_GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?" +
  [
    "family=Inter:wght@400;500;600;700;800;900",
    "family=Poppins:wght@400;500;600;700;800",
    "family=Montserrat:wght@400;500;600;700;800;900",
    "family=Oswald:wght@400;500;600;700",
    "family=Archivo:wght@400;500;600;700;800;900",
    "family=Space+Grotesk:wght@400;500;600;700",
    "family=Bebas+Neue",
    "family=Playfair+Display:wght@400;500;600;700;800;900",
    "family=Merriweather:wght@400;700;900",
    "family=Lora:wght@400;500;600;700"
  ].join("&") +
  "&display=swap";

export function getHeadingFontStack(fontFamily: string | undefined): string | undefined {
  if (!fontFamily) {
    return undefined;
  }
  return BUILDER_HEADING_FONTS.find((font) => font.key === fontFamily)?.stack || undefined;
}

/**
 * Emit a theme's GLOBAL typography tokens as CSS custom properties for the
 * preview content root (.builder-preview-shell). Only tokens the user has set
 * are emitted, so an absent/default theme yields an empty object and content
 * keeps its pre-theme baseline (the fallbacks baked into _builder-theme.css).
 *
 * Covers font roles, semantic colors, and the modular type scale. H1–H6 sizes
 * derive from baseSize × ratio^(6 − level), so H6 == baseSize and H1 is largest.
 * Per-element overrides (theme.typography.elements) are applied by a later slice.
 */
export function getThemeRootVars(theme: BuilderTheme | undefined): CSSProperties {
  const vars: Record<string, string> = {};
  if (!theme) {
    return vars as CSSProperties;
  }
  const { fonts, scale, colors } = theme.typography;

  const headingStack = getHeadingFontStack(fonts.heading);
  if (headingStack) vars["--bx-font-heading"] = headingStack;
  const bodyStack = getHeadingFontStack(fonts.body);
  if (bodyStack) vars["--bx-font-body"] = bodyStack;
  const monoStack = getHeadingFontStack(fonts.mono);
  if (monoStack) vars["--bx-font-mono"] = monoStack;

  if (colors.text) vars["--bx-text"] = colors.text;
  if (colors.heading) vars["--bx-heading"] = colors.heading;
  if (colors.muted) vars["--bx-muted"] = colors.muted;
  if (colors.link) vars["--bx-link"] = colors.link;
  if (colors.linkHover) vars["--bx-link-hover"] = colors.linkHover;
  if (colors.selection) vars["--bx-selection"] = colors.selection;

  if (scale.baseSize) vars["--bx-size-base"] = `${scale.baseSize}px`;
  if (scale.baseLineHeight) vars["--bx-line-base"] = String(scale.baseLineHeight);
  if (scale.baseSize && scale.ratio) {
    for (let level = 1; level <= 6; level += 1) {
      const size = scale.baseSize * scale.ratio ** (6 - level);
      vars[`--bx-size-h${level}`] = `${Math.round(size * 100) / 100}px`;
    }
  }
  // Per-heading explicit overrides take precedence over the modular scale above.
  for (let level = 1; level <= 6; level += 1) {
    const explicit = (scale as Record<string, number | undefined>)[`h${level}`];
    if (explicit) vars[`--bx-size-h${level}`] = `${explicit}px`;
    const lh = (scale as Record<string, number | undefined>)[`h${level}Lh`];
    if (lh) vars[`--bx-line-h${level}`] = String(lh);
    const fw = (scale as Record<string, number | undefined>)[`h${level}Fw`];
    if (fw) vars[`--bx-weight-h${level}`] = String(fw);
  }

  if (colors.linkUnderline === true) vars["--bx-link-decoration"] = "underline";
  else if (colors.linkUnderline === false) vars["--bx-link-decoration"] = "none";
  if (colors.linkHoverUnderline === true) vars["--bx-link-hover-decoration"] = "underline";
  else if (colors.linkHoverUnderline === false) vars["--bx-link-hover-decoration"] = "none";

  return vars as CSSProperties;
}

export type CrmThemePalette = {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
};

/** Saved theme record style + palette fields applied to the live page shell. */
export type BuilderThemeStyles = {
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
};

function safeThemeNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function accentBorderColor(accent: string): string {
  const hex = accent.replace(/^#/, "").trim();
  if (hex.length !== 6) return "rgba(15, 79, 143, 0.24)";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return "rgba(15, 79, 143, 0.24)";
  }
  return `rgba(${r}, ${g}, ${b}, 0.24)`;
}

type ThemePageLayoutMargins = {
  topMargin?: number;
  bottomMargin?: number;
  sideMargins?: number;
};

function readThemeMarginColumn(
  theme: Record<string, unknown>,
  camel: "topMargin" | "bottomMargin" | "sideMargins",
  snake: string
): number | undefined {
  if (theme[snake] !== undefined && theme[snake] !== null) {
    return safeThemeNumber(theme[snake], 0);
  }
  if (theme[camel] !== undefined && theme[camel] !== null) {
    return safeThemeNumber(theme[camel], 0);
  }
  return undefined;
}

function readThemePageLayoutMargins(theme: Record<string, unknown>): ThemePageLayoutMargins | null {
  const typography = theme.typography;
  if (!typography || typeof typography !== "object" || Array.isArray(typography)) return null;
  const pageLayout = (typography as Record<string, unknown>).pageLayout;
  if (!pageLayout || typeof pageLayout !== "object" || Array.isArray(pageLayout)) return null;
  return pageLayout as ThemePageLayoutMargins;
}

/** Prefer dedicated columns; fall back to typography.pageLayout when columns are 0/missing. */
export function resolveThemeMarginValue(
  columnMargin: number | undefined,
  typographyMargin: number | undefined
): number {
  const col = columnMargin === undefined ? -1 : safeThemeNumber(columnMargin, -1);
  const typo = typographyMargin === undefined ? -1 : safeThemeNumber(typographyMargin, -1);
  if (col > 0) return col;
  if (typo > 0) return typo;
  if (col >= 0) return col;
  return typo >= 0 ? typo : 0;
}

export function buildBuilderThemeStyles(
  theme: BuilderThemeStyles | Record<string, unknown> | null | undefined
): BuilderThemeStyles | undefined {
  if (!theme || typeof theme !== "object") return undefined;
  const row = theme as Record<string, unknown>;
  const pageLayout = readThemePageLayoutMargins(row);
  return {
    primaryColor: String(row.primaryColor ?? row.primary_color ?? "").trim(),
    secondaryColor: String(row.secondaryColor ?? row.secondary_color ?? "").trim(),
    backgroundColor: String(row.backgroundColor ?? row.background_color ?? "").trim(),
    accentColor: String(row.accentColor ?? row.accent_color ?? "").trim(),
    borderThickness: safeThemeNumber(row.borderThickness ?? row.border_thickness, 1),
    borderRadius: safeThemeNumber(row.borderRadius ?? row.border_radius, 12),
    containerBlur: safeThemeNumber(row.containerBlur ?? row.container_blur, 0),
    contrastLevel: safeThemeNumber(row.contrastLevel ?? row.contrast_level, 0),
    topMargin: resolveThemeMarginValue(
      readThemeMarginColumn(row, "topMargin", "top_margin"),
      pageLayout?.topMargin
    ),
    bottomMargin: resolveThemeMarginValue(
      readThemeMarginColumn(row, "bottomMargin", "bottom_margin"),
      pageLayout?.bottomMargin
    ),
    sideMargins: resolveThemeMarginValue(
      readThemeMarginColumn(row, "sideMargins", "side_margins"),
      pageLayout?.sideMargins
    ),
  };
}

export type ThemeShellBackgroundSource = {
  /** Theme Styles → Page Background (distinct from page-level pageBackground). */
  stylesPageBackground?: BackgroundSettings | Record<string, unknown> | null;
  /** @deprecated Use stylesPageBackground on theme records. */
  pageBackground?: BackgroundSettings | Record<string, unknown> | null;
  backgroundColor?: string;
} | null | undefined;

/** Read theme Styles → Page Background from a theme or themeShell payload. */
export function readThemeStylesPageBackground(
  theme: ThemeShellBackgroundSource
): BackgroundSettings | null {
  if (!theme || typeof theme !== "object") return null;
  const raw = theme.stylesPageBackground ?? theme.pageBackground;
  return promoteThemeStylesPageBackground(raw);
}

/** Normalize a theme record before shell resolution. */
export function coerceThemeShellBackgroundSource(
  theme: ThemeShellBackgroundSource
): ThemeShellBackgroundSource {
  if (!theme || typeof theme !== "object") return theme;
  const styles = readThemeStylesPageBackground(theme);
  if (!styles) return theme;
  return { ...theme, stylesPageBackground: styles, pageBackground: styles };
}

/**
 * Theme shell background: Styles → Page Background, then palette Background,
 * then the default palette background color.
 */
export function resolveThemePageBackground(theme: ThemeShellBackgroundSource): BackgroundSettings {
  const coerced = coerceThemeShellBackgroundSource(theme);
  const saved = readThemeStylesPageBackground(coerced);
  if (saved && saved.mode !== "none") {
    return saved;
  }
  const paletteColor = String(coerced?.backgroundColor ?? "").trim();
  if (paletteColor) {
    return shellBackgroundFromColor(paletteColor);
  }
  return shellBackgroundFromColor(DEFAULT_THEME_PALETTE_BACKGROUND);
}

/** Default palette Background when no theme palette value is saved. */
export const DEFAULT_THEME_PALETTE_BACKGROUND = "#f5fbff";

function shellBackgroundFromColor(color: string): BackgroundSettings {
  return {
    ...createDefaultBackgroundSettings(),
    mode: "color",
    color: normalizeBuilderHexColor(color, DEFAULT_THEME_PALETTE_BACKGROUND),
  };
}

/** Page background wins when set; otherwise theme Styles → Page Background → palette → default. */
export function resolveShellPageBackground(
  pageBackground: BackgroundSettings | undefined,
  theme: ThemeShellBackgroundSource
): BackgroundSettings {
  const page = finalizeBackgroundSettings(pageBackground);
  if (page.mode !== "none") {
    return page;
  }
  return resolveThemePageBackground(theme);
}

/** Color seed for page-level background pickers: Styles page background, then palette Background. */
export function getThemeShellBackgroundSeedColor(theme: ThemeShellBackgroundSource): string {
  const styles = readThemeStylesPageBackground(theme);
  if (styles && (styles.mode === "color" || styles.mode === "gradient")) {
    const color = String(styles.color || "").trim();
    if (color) return color;
  }
  return String(theme?.backgroundColor ?? "").trim();
}

export function getShellPageBackgroundStyle(
  pageBackground: BackgroundSettings | undefined,
  theme: ThemeShellBackgroundSource
): CSSProperties | undefined {
  const background = resolveShellPageBackground(pageBackground, theme);
  const style = getBuilderBackgroundStyle(background);
  if (!style) return undefined;
  if (getBuilderBackgroundLayerOpacity(background) < 1) {
    return undefined;
  }
  return style;
}

export type ShellBackgroundLayers = {
  inlineBackground?: CSSProperties;
  backdrop?: { style: CSSProperties; opacity: number };
};

export function getShellBackgroundLayers(
  pageBackground: BackgroundSettings | undefined,
  theme: ThemeShellBackgroundSource
): ShellBackgroundLayers {
  const background = resolveShellPageBackground(pageBackground, theme);
  const style = getBuilderBackgroundStyle(background);
  if (!style) return {};
  const layerOpacity = getBuilderBackgroundLayerOpacity(background);
  if (layerOpacity < 1) {
    return { backdrop: { style, opacity: layerOpacity } };
  }
  return { inlineBackground: style };
}

function readBuilderThemeMargins(styles: BuilderThemeStyles | undefined) {
  return {
    topMargin: Math.max(0, safeThemeNumber(styles?.topMargin, 0)),
    bottomMargin: Math.max(0, safeThemeNumber(styles?.bottomMargin, 0)),
    sideMargins: Math.max(0, safeThemeNumber(styles?.sideMargins, 0)),
  };
}

/** Page margin tokens for the preview content wrapper (Themes → Styles). */
export function getBuilderThemePageMarginStyle(styles: BuilderThemeStyles | undefined): CSSProperties {
  if (!styles) return {};
  const { topMargin, bottomMargin, sideMargins } = readBuilderThemeMargins(styles);
  return {
    paddingTop: `${topMargin}px`,
    paddingBottom: `${bottomMargin}px`,
    paddingLeft: `${sideMargins}px`,
    paddingRight: `${sideMargins}px`,
    "--bx-theme-padding-top": `${topMargin}px`,
    "--bx-theme-padding-bottom": `${bottomMargin}px`,
    "--bx-theme-padding-inline": `${sideMargins}px`,
  } as CSSProperties;
}

/**
 * Emit saved theme palette + container style tokens for the preview shell root.
 * Page margins apply on `.builder-preview-shell-content`; border radius, blur, and
 * contrast cascade via --lp-* vars on the shell.
 */
export function getBuilderThemeStyleVars(styles: BuilderThemeStyles | undefined): CSSProperties {
  const vars: Record<string, string> = {};
  if (!styles) return vars as CSSProperties;

  const primary = String(styles.primaryColor || "").trim();
  const accent = String(styles.accentColor || "").trim();
  if (primary) vars["--lp-primary"] = primary;
  if (accent) {
    vars["--lp-accent"] = accent;
    vars["--lp-border"] = accentBorderColor(accent);
    vars["--lp-border-soft"] = accentBorderColor(accent);
    vars["--lp-dash-border"] = accentBorderColor(accent);
  }

  const borderThickness = Math.max(0, safeThemeNumber(styles.borderThickness, 1));
  const borderRadius = Math.max(0, safeThemeNumber(styles.borderRadius, 12));
  const containerBlur = Math.max(0, safeThemeNumber(styles.containerBlur, 0));
  const contrastLevel = Math.max(0, Math.min(100, safeThemeNumber(styles.contrastLevel, 0)));
  const { topMargin, bottomMargin, sideMargins } = readBuilderThemeMargins(styles);

  vars["--lp-border-thickness"] = `${borderThickness}px`;
  vars["--lp-radius"] = `${borderRadius}px`;
  vars["--lp-blur"] = `${containerBlur}px`;
  vars["--lp-filter"] = contrastLevel > 0 ? `contrast(${1 + contrastLevel / 100})` : "none";
  vars["--bx-theme-padding-top"] = `${topMargin}px`;
  vars["--bx-theme-padding-bottom"] = `${bottomMargin}px`;
  vars["--bx-theme-padding-inline"] = `${sideMargins}px`;

  return vars as CSSProperties;
}

/** Palette vars consumed by CRM form theme tokens on builder/public pages. */
export function getCrmThemePaletteVars(palette: CrmThemePalette | undefined): CSSProperties {
  const vars: Record<string, string> = {};
  if (!palette) return vars as CSSProperties;
  if (palette.primaryColor) vars["--crm-theme-primary"] = palette.primaryColor;
  if (palette.secondaryColor) vars["--crm-theme-secondary"] = palette.secondaryColor;
  if (palette.accentColor) vars["--crm-theme-accent"] = palette.accentColor;
  if (palette.backgroundColor) vars["--crm-theme-background"] = palette.backgroundColor;
  return vars as CSSProperties;
}

/** Form-control tokens for builder/admin shells (radio groups, focused inputs). */
export function getThemeFormControlVars(
  theme: BuilderTheme | undefined,
  palette?: CrmThemePalette
): CSSProperties {
  const vars: Record<string, string> = {};
  const forms = theme?.typography?.forms;
  const radioAccent = forms?.radioAccent || palette?.primaryColor;
  if (radioAccent) vars["--sc-radio-accent"] = radioAccent;
  if (forms?.radioLabel) vars["--sc-radio-label-color"] = forms.radioLabel;
  vars["--sc-field-focus-color"] = forms?.fieldFocus || "#22c55e";
  return vars as CSSProperties;
}

export function builderThemeToCrmPalette(theme: {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
} | null | undefined): CrmThemePalette {
  if (!theme) return {};
  return {
    primaryColor: String(theme.primaryColor || "").trim(),
    secondaryColor: String(theme.secondaryColor || "").trim(),
    backgroundColor: String(theme.backgroundColor || "").trim(),
    accentColor: String(theme.accentColor || "").trim(),
  };
}

export type BuilderThemePaletteSwatch = { label: string; hex: string };

/** Primary, Secondary, Background, and Accent swatches for editor color pickers. */
export function buildBuilderThemePaletteColors(theme: {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
} | null | undefined): BuilderThemePaletteSwatch[] {
  return [
    { label: "Primary", hex: theme?.primaryColor ?? "" },
    { label: "Secondary", hex: theme?.secondaryColor ?? "" },
    { label: "Background", hex: theme?.backgroundColor ?? "" },
    { label: "Accent", hex: theme?.accentColor ?? "" }
  ];
}

export function mergeCrmThemePalette(
  primary: CrmThemePalette | undefined,
  fallback: CrmThemePalette | undefined
): CrmThemePalette {
  const a = primary || {};
  const b = fallback || {};
  return {
    primaryColor: a.primaryColor || b.primaryColor,
    secondaryColor: a.secondaryColor || b.secondaryColor,
    backgroundColor: a.backgroundColor || b.backgroundColor,
    accentColor: a.accentColor || b.accentColor,
  };
}

/** Theme palette + typography vars for builder admin data tables on public pages. */
export function getAdminDataTableThemeStyle(
  themePalette: CrmThemePalette | undefined,
  theme: import("@/lib/builder-template").BuilderTheme | undefined
): CSSProperties {
  return getCrmFormThemeContextStyle(themePalette, theme);
}

/** Theme palette + typography vars for CRM form color tokens on builder/public pages. */
export function getCrmFormThemeContextStyle(
  themePalette: CrmThemePalette | undefined,
  theme: import("@/lib/builder-template").BuilderTheme | undefined
): CSSProperties {
  const vars: Record<string, string> = {
    ...(getCrmThemePaletteVars(themePalette) as Record<string, string>),
  };
  const colors = theme?.typography?.colors;
  if (colors?.text) vars["--bx-text"] = colors.text;
  if (colors?.heading) vars["--bx-heading"] = colors.heading;
  if (colors?.link) vars["--bx-link"] = colors.link;
  return vars as CSSProperties;
}

const HEADING_TEXT_TRANSFORMS = new Set(["none", "uppercase", "lowercase", "capitalize"]);
const HEADING_TEXT_ALIGNS = new Set(["left", "center", "right"]);

function getHeadingFontWeight(settings: Record<string, string>): number {
  const explicit = Number.parseInt(settings.fontWeight ?? "", 10);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 900) {
    return explicit;
  }
  // Backward compatibility for headings saved before the weight selector existed.
  return settings.bold === "false" ? 500 : 800;
}

export function getHeadingModuleStyle(settings: Record<string, string>): CSSProperties {
  const fontSize = Number.parseInt(settings.fontSize ?? "32", 10);
  const color = settings.color || "#18324a";
  const dropShadow = getModuleDropShadowStyle(settings);
  const nudgeTransform = getModuleNudgeTransform(settings);
  const verticalOffset = Number.parseInt(normalizeSignedOffsetValue(settings.verticalOffset, "0"), 10);
  const offsetY = Number.isFinite(verticalOffset) ? verticalOffset : 0;
  const fontFamily = getHeadingFontStack(settings.fontFamily);
  const lineHeight = Number.parseFloat(settings.lineHeight ?? "");
  const letterSpacing = Number.parseFloat(settings.letterSpacing ?? "");
  const textAlign = HEADING_TEXT_ALIGNS.has(settings.textAlign ?? "") ? settings.textAlign : undefined;
  const textTransform = HEADING_TEXT_TRANSFORMS.has(settings.textTransform ?? "")
    ? settings.textTransform
    : undefined;

  return {
    margin: 0,
    fontSize: `${Math.max(Number.isFinite(fontSize) ? fontSize : 32, 10)}px`,
    color,
    ...(fontFamily ? { fontFamily } : {}),
    fontWeight: getHeadingFontWeight(settings),
    fontStyle: settings.italic === "true" ? "italic" : "normal",
    ...(textAlign ? { textAlign: textAlign as CSSProperties["textAlign"] } : {}),
    ...(Number.isFinite(lineHeight) && lineHeight > 0 ? { lineHeight } : {}),
    ...(Number.isFinite(letterSpacing) ? { letterSpacing: `${letterSpacing}px` } : {}),
    ...(textTransform && textTransform !== "none"
      ? { textTransform: textTransform as CSSProperties["textTransform"] }
      : {}),
    textDecoration: settings.underline === "true" ? "underline" : "none",
    textDecorationColor: settings.underline === "true" ? color : undefined,
    textShadow: dropShadow,
    WebkitTextStroke: settings.outline === "true" ? `2px ${color}` : undefined,
    ...(nudgeTransform
      ? {
          position: "relative",
          transform: nudgeTransform,
          ...(offsetY > 0 ? { marginBottom: `-${offsetY}px` } : {}),
          ...(offsetY < 0 ? { marginTop: `${Math.abs(offsetY)}px` } : {})
        }
      : {})
  };
}

export function formatTemplateTimestamp(value: string) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function isVideoMedia(url: string | undefined) {
  if (!url) {
    return false;
  }

  return /\.(mp4|mov|m4v|webm|ogg)(\?.*)?$/i.test(url);
}

export function getVideoEmbedSource(value: string | undefined):
  | { kind: "iframe"; src: string; href: string }
  | { kind: "video"; src: string; href: string }
  | null {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const iframeSrc = raw.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  const source = normalizeBuilderAssetUrl(iframeSrc || raw);

  if (isVideoMedia(source)) {
    return { kind: "video", src: source, href: source };
  }

  try {
    const url = new URL(source);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
      const videoId =
        host === "youtu.be"
          ? url.pathname.split("/").filter(Boolean)[0]
          : url.pathname.startsWith("/shorts/")
            ? url.pathname.split("/").filter(Boolean)[1]
            : url.pathname.startsWith("/embed/")
              ? url.pathname.split("/").filter(Boolean)[1]
              : url.searchParams.get("v");

      return videoId
        ? {
            kind: "iframe",
            src: `https://www.youtube.com/embed/${videoId}`,
            href: `https://www.youtube.com/watch?v=${videoId}`
          }
        : null;
    }

    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const videoId = host === "player.vimeo.com" ? parts.at(-1) : parts[0];
      return videoId
        ? {
            kind: "iframe",
            src: `https://player.vimeo.com/video/${videoId}`,
            href: `https://vimeo.com/${videoId}`
          }
        : null;
    }

    if (url.protocol === "https:" || url.protocol === "http:") {
      return { kind: "iframe", src: source, href: source };
    }
  } catch {
    if (source.startsWith("/")) {
      return { kind: "video", src: source, href: source };
    }
  }

  return null;
}
