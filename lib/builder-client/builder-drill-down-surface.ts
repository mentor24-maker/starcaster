import type { CSSProperties } from "react";
import {
  getBuilderBackgroundStyle,
  sanitizeCellBackgroundForDrillDown,
  usesBuilderDrillDownSurfaceDefault,
  type BackgroundSettings
} from "@/lib/builder-template";

export type BuilderDrillDownSurfaceTier =
  | "workspace"
  | "section"
  | "cell"
  | "column"
  | "module";

const BUILDER_SURFACE_VAR: Record<BuilderDrillDownSurfaceTier, string> = {
  workspace: "--builder-bg-workspace",
  section: "--builder-bg-section",
  cell: "--builder-bg-cell",
  column: "--builder-bg-column",
  module: "--builder-bg-module"
};

export { sanitizeCellBackgroundForDrillDown, usesBuilderDrillDownSurfaceDefault };

export function resolveBuilderDrillDownSurfaceBackground(
  background: BackgroundSettings | undefined,
  tier: BuilderDrillDownSurfaceTier
): CSSProperties {
  if (usesBuilderDrillDownSurfaceDefault(background)) {
    return { background: `var(${BUILDER_SURFACE_VAR[tier]})` };
  }

  return getBuilderBackgroundStyle(background) ?? { background: `var(${BUILDER_SURFACE_VAR[tier]})` };
}
