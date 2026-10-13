/*
 * The builder's drill-down surfaces are editor chrome: each level (workspace,
 * section, cell, column, module) shows its own step of one blue ladder, set in
 * CSS (`--builder-bg-*`, `_builder-react-overrides.css`). A cell's or module's
 * own background is page content and is never painted on its editor card —
 * doing so broke the ladder on every dark or photo cell (task 86bch66at).
 */
export { sanitizeCellBackgroundForDrillDown, usesBuilderDrillDownSurfaceDefault } from "@/lib/builder-template";
