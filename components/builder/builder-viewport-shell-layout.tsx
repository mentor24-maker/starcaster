import type { ReactNode } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import { BuilderBackgroundLayer } from "./builder-background-layer";
import {
  getBuilderThemePageMarginStyle,
  getShellBackgroundLayers,
  type BuilderThemeStyles,
  type ThemeShellBackgroundSource,
} from "./builder-utils";

type Props = {
  pageBackground: BackgroundSettings;
  themeShellBackground?: ThemeShellBackgroundSource;
  themeStyles?: BuilderThemeStyles;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

/**
 * Full-viewport shell background with theme page margins on an inner content
 * wrapper.
 *
 * THIS IS WHERE A PAGE-LEVEL VIDEO BACKGROUND LIVES, and not in
 * `BuilderTemplatePreview` where a reader might first look for it. Both
 * surfaces that show a page at full window size — the live tenant site
 * (`BuilderPublicSitePage`) and the operator's preview (`builder-preview-page`)
 * — wrap the preview in THIS component and pass `suppressShellBackground` to
 * the preview itself, precisely because this component owns the page
 * background and the preview does not. Mounting the layer in the preview would
 * mean rendering a background the caller has just asked to suppress, and it
 * would follow the preview into the two places that are NOT a browser window —
 * the theme wizard's pod and the email preview — where a viewport-fixed
 * element would cover the app.
 *
 * It is the SAME component a section row mounts (`BuilderBackgroundLayer`), on
 * purpose: muted, autoplay, loop, speed, trim, blur, focal point, the poster
 * fallback on reduced motion and on phones, and pausing when off screen are
 * all one implementation. Only the geometry differs, and that is one CSS rule.
 */
export function BuilderViewportShellLayout({
  pageBackground,
  themeShellBackground,
  themeStyles,
  className = "",
  contentClassName = "",
  children,
}: Props) {
  const shellBackground = getShellBackgroundLayers(pageBackground, themeShellBackground);
  // `video` counts here as well as the two CSS layers: a video background whose
  // poster has not been chosen resolves to no CSS at all, and it is still a
  // background the operator set.
  const hasResolvedShellBackground = Boolean(
    shellBackground.inlineBackground || shellBackground.backdrop || shellBackground.video
  );
  const marginStyle = getBuilderThemePageMarginStyle(themeStyles);
  const shellClassName = [
    "builder-viewport-shell-layout",
    className,
    hasResolvedShellBackground ? "has-resolved-shell-background" : "",
    shellBackground.backdrop ? "has-shell-background-backdrop" : "",
    shellBackground.video ? "has-shell-background-video" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const innerClassName = [
    "builder-theme-page-margin-layout",
    "builder-viewport-shell-content",
    contentClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClassName} style={shellBackground.inlineBackground}>
      {shellBackground.backdrop ? (
        <div
          aria-hidden
          className="builder-preview-shell-backdrop"
          style={{
            ...shellBackground.backdrop.style,
            opacity: shellBackground.backdrop.opacity,
          }}
        />
      ) : null}
      {shellBackground.video ? (
        <BuilderBackgroundLayer background={shellBackground.video} surface="page" />
      ) : null}
      <div className={innerClassName} style={marginStyle}>
        {children}
      </div>
    </div>
  );
}
