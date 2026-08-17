import type { CSSProperties } from "react";
import { resolvePublicBuilderAssetUrl } from "@/lib/builder-template";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  getFloatingImageModuleShellStyle,
  getFloatingImageModuleStyle,
  getGameOverlayFloatingImageShellStyle,
  getImageModuleShellStyle,
  getImageModuleStyle,
  getModuleWidthPercent,
  isFloatingImageModule,
  isVideoMedia
} from "./builder-utils";
import { imageProps, sizesForWidthPercent } from "@/lib/image-renditions";
import {
  getImageEffectClassName,
  getImageEffectStageStyle,
  getImageEffectStyle,
  imageEffectBounces,
  usesHorizontalMotionClip
} from "./builder-image-effects";

export { getImageEffectClassName, usesHorizontalMotionClip };

type BuilderImagePreviewProps = {
  module: BuilderTemplateModule;
  variant?: string;
  imageClassName?: string;
  placeholder?: string;
  /** Render in the full-screen game overlay host (above the translucent backdrop). */
  gameOverlayHost?: boolean;
  /** Button-trigger mascot row (stack above poll pods; Z-Index from module settings). */
  sectionScopedDecor?: boolean;
  /**
   * How wide this module's column is, as a percentage of the row. A module set
   * to "100" inside a two-column row fills half the page, not all of it — and
   * without that the browser is told to expect a full-width file.
   */
  columnWidthPercent?: number;
};

export function BuilderImagePreview({
  module,
  variant,
  imageClassName = "builder-preview-image",
  placeholder = "Choose an image",
  gameOverlayHost = false,
  sectionScopedDecor = false,
  columnWidthPercent = 100
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
  // Rotation Rate reaches the keyframes as a CSS variable on the figure, so
  // one stylesheet rule serves every rate rather than one class per speed.
  const effectStyle = getImageEffectStyle(module.settings);
  // The hop rides its own element: the figure is already animating `translate`
  // for the travel, and one element cannot animate one property twice.
  const hopStageStyle = getImageEffectStageStyle(module.settings);
  const hops = imageEffectBounces(effect);
  const motionClip = usesHorizontalMotionClip(effect);
  const resolvedVariant = variant ?? module.settings.variant ?? "default";
  // Offer the browser the scaled-down copies of this picture, and tell it how
  // wide the slot is so it does not fetch a full-width file for a half column.
  // Falls back to a plain `src` for any image that has no copies.
  // The module's width is a share of its COLUMN, and the column is a share of
  // the row — so the slot is the two multiplied. Half a two-column row is 50%,
  // not 100%, and that is the difference between fetching the 600px copy and
  // the 1200px one.
  const slotWidthPercent = (getModuleWidthPercent(module.settings) * columnWidthPercent) / 100;
  const responsiveImage = imageProps(mediaUrl, {
    sizes: sizesForWidthPercent(slotWidthPercent)
  });

  const figure = (
    <figure
      className={`${imageClassName} builder-preview-image-${resolvedVariant}${effectClass}`}
      style={effectStyle ? { ...imageStyle, ...effectStyle } : imageStyle}
    >
      {mediaUrl ? (
        isVideoMedia(mediaUrl) ? (
          <video className="builder-preview-video" controls preload="metadata" src={mediaUrl} />
        ) : linkUrl ? (
          <a href={linkUrl} rel={opensInNewTab ? "noopener noreferrer" : undefined} target={opensInNewTab ? "_blank" : undefined} style={{ display: "block" }}>
            <img
              alt={module.settings.alt || module.text || ""}
              {...responsiveImage}
              suppressHydrationWarning
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </a>
        ) : (
          <img
            alt={module.settings.alt || module.text || ""}
            {...responsiveImage}
            suppressHydrationWarning
            style={{ width: "100%", height: "auto", display: "block" } as CSSProperties}
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
      {motionClip ? (
        <div className="starcaster-effect-motion-clip">
          {hops ? (
            <div className="starcaster-effect-hop-stage" style={hopStageStyle}>
              {figure}
            </div>
          ) : (
            figure
          )}
        </div>
      ) : (
        figure
      )}
    </div>
  );
}
