import type { CSSProperties } from "react";
import { getModuleTrigger } from "@/lib/module-trigger";
import type {
  BackgroundSettings,
  BuilderPageRecord,
  BuilderTemplateKind,
  BuilderTemplateModule,
  BuilderTemplateRecord,
  BuilderTemplateSection
} from "@/lib/builder-template";
import type { BuilderEmailFunction } from "@/lib/builder-email-template";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import {
  PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX,
  resolveGameOverlayContentZIndex
} from "@/lib/game-overlay-layer";
import {
  createDefaultBackgroundSettings,
  getBuilderBackgroundStyle,
  normalizeBackgroundMode,
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
      layoutSections: []
    };
  }

  return {
    id: template.id,
    name: template.name,
    templateKind: template.templateKind,
    emailFunction: template.emailFunction,
    pageBackground: template.pageBackground,
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
      layoutSections: []
    };
  }

  return {
    id: page.id,
    name: page.name,
    templateKind: "modular",
    emailFunction: "",
    pageBackground: page.pageBackground,
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

/** Button-trigger floating images (e.g. Bouncing Normie) anchor to their row below the nav, not the full page. */
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
    isPublished: false,
    pageBackground: { ...source.pageBackground },
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

export function getHeadingModuleStyle(settings: Record<string, string>): CSSProperties {
  const fontSize = Number.parseInt(settings.fontSize ?? "32", 10);
  const color = settings.color || "#18324a";
  const dropShadow = getModuleDropShadowStyle(settings);
  const nudgeTransform = getModuleNudgeTransform(settings);
  const verticalOffset = Number.parseInt(normalizeSignedOffsetValue(settings.verticalOffset, "0"), 10);
  const offsetY = Number.isFinite(verticalOffset) ? verticalOffset : 0;

  return {
    margin: 0,
    fontSize: `${Math.max(Number.isFinite(fontSize) ? fontSize : 32, 10)}px`,
    color,
    fontWeight: settings.bold === "false" ? 500 : 800,
    fontStyle: settings.italic === "true" ? "italic" : "normal",
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
