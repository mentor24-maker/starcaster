import type { ReactNode } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
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

/** Full-viewport shell background with theme page margins on an inner content wrapper. */
export function BuilderViewportShellLayout({
  pageBackground,
  themeShellBackground,
  themeStyles,
  className = "",
  contentClassName = "",
  children,
}: Props) {
  const shellBackground = getShellBackgroundLayers(pageBackground, themeShellBackground);
  const hasResolvedShellBackground = Boolean(
    shellBackground.inlineBackground || shellBackground.backdrop
  );
  const marginStyle = getBuilderThemePageMarginStyle(themeStyles);
  const shellClassName = [
    "builder-viewport-shell-layout",
    className,
    hasResolvedShellBackground ? "has-resolved-shell-background" : "",
    shellBackground.backdrop ? "has-shell-background-backdrop" : "",
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
      <div className={innerClassName} style={marginStyle}>
        {children}
      </div>
    </div>
  );
}
