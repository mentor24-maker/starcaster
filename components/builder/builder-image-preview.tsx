import type { CSSProperties } from "react";
import { resolvePublicBuilderAssetUrl } from "@/lib/builder-template";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  getFloatingImageModuleShellStyle,
  getFloatingImageModuleStyle,
  getGameOverlayFloatingImageShellStyle,
  getImageModuleShellStyle,
  getImageModuleStyle,
  isFloatingImageModule,
  isVideoMedia
} from "./builder-utils";

export function getImageEffectClassName(effect: string | undefined) {
  if (effect === "bounce") return " starcaster-effect-bounce";
  if (effect === "fast-bounce") return " starcaster-effect-fast-bounce";
  if (effect === "big-bounce") return " starcaster-effect-big-bounce";
  if (effect === "spin") return " starcaster-effect-spin";
  if (effect === "cruise") return " starcaster-effect-cruise";
  if (effect === "tumbleweed") return " starcaster-effect-tumbleweed";
  return "";
}

/** Cruise / tumbleweed keyframes move ±100vw and can force a horizontal scrollbar that reads like a bottom progress bar. */
export function usesHorizontalMotionClip(effect: string | undefined): boolean {
  return effect === "cruise" || effect === "tumbleweed";
}

type BuilderImagePreviewProps = {
  module: BuilderTemplateModule;
  variant?: string;
  imageClassName?: string;
  placeholder?: string;
  /** Render in the full-screen game overlay host (above the translucent backdrop). */
  gameOverlayHost?: boolean;
  /** Button-trigger mascot row (stack above poll pods; Z-Index from module settings). */
  sectionScopedDecor?: boolean;
};

export function BuilderImagePreview({
  module,
  variant,
  imageClassName = "builder-preview-image",
  placeholder = "Choose an image",
  gameOverlayHost = false,
  sectionScopedDecor = false
}: BuilderImagePreviewProps) {
  const mediaUrl = resolvePublicBuilderAssetUrl(module.settings.url);
  const linkUrl = isFloatingImageModule(module) ? "" : resolvePublicBuilderAssetUrl(module.settings.linkUrl);
  const floating = isFloatingImageModule(module);
  const imageStyle = floating ? getFloatingImageModuleStyle(module.settings) : getImageModuleStyle(module.settings);
  const shellStyle = floating
    ? gameOverlayHost
      ? getGameOverlayFloatingImageShellStyle(module.settings)
      : getFloatingImageModuleShellStyle(module.settings, { sectionScopedDecor })
    : getImageModuleShellStyle(module.settings);
  const opensInNewTab = module.settings.newTab === "true";
  const effect = module.settings.effect;
  const effectClass = getImageEffectClassName(effect);
  const motionClip = usesHorizontalMotionClip(effect);
  const resolvedVariant = variant ?? module.settings.variant ?? "default";

  const figure = (
    <figure
      className={`${imageClassName} builder-preview-image-${resolvedVariant}${effectClass}`}
      style={imageStyle}
    >
      {mediaUrl ? (
        isVideoMedia(mediaUrl) ? (
          <video className="builder-preview-video" controls preload="metadata" src={mediaUrl} />
        ) : linkUrl ? (
          <a href={linkUrl} rel={opensInNewTab ? "noopener noreferrer" : undefined} target={opensInNewTab ? "_blank" : undefined} style={{ display: "block", borderRadius: "inherit" }}>
            <img
              alt={module.settings.alt || module.text || ""}
              src={mediaUrl}
              suppressHydrationWarning
              style={{ width: "100%", height: "auto", display: "block", borderRadius: "inherit" }}
            />
          </a>
        ) : (
          <img
            alt={module.settings.alt || module.text || ""}
            src={mediaUrl}
            suppressHydrationWarning
            style={{ width: "100%", height: "auto", display: "block", borderRadius: "inherit" } as CSSProperties}
          />
        )
      ) : (
        <div className="builder-module-preview-placeholder">{placeholder}</div>
      )}
    </figure>
  );

  return (
    <div
      className={`builder-preview-image-shell${floating ? " builder-preview-image-shell-overlay" : ""}`}
      style={shellStyle}
    >
      {motionClip ? <div className="starcaster-effect-motion-clip">{figure}</div> : figure}
    </div>
  );
}
