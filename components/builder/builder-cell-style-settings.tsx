"use client";

import type { CSSProperties } from "react";
import type { BackgroundSettings, BuilderTemplateSection } from "@/lib/builder-template";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorField } from "./builder-theme-color-field";

type BuilderCellStyleSettingsProps = {
  column: string;
  section: BuilderTemplateSection;
  editorDevice: "browser" | "mobile";
  onUpdateCellBackground: (column: string, updater: (bg: BackgroundSettings) => BackgroundSettings) => void;
  onUpdateCellBorderWidth: (column: string, value: string) => void;
  onUpdateCellBorderColor: (column: string, value: string) => void;
  onUpdateCellBorderRadius: (column: string, value: string) => void;
  onSetCellExtra: (column: string, key: string, value: string) => void;
  getCellExtra: (column: string, key: string, fallback?: string) => string;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
  themeColors?: Array<{ label: string; hex: string }>;
};

function opacityPercentValue(value: string, fallback = "1") {
  return String(Math.round(Number.parseFloat(value || fallback) * 100));
}

function opacityFromPercent(percent: string) {
  return String(Number(percent) / 100);
}

/**
 * The cell (column) editor.
 *
 * D8 axes and the W0 lattice, the same shape a module panel and a row panel
 * wear (operator 8/11, "these cell settings still have the horrendous old
 * style form arrangement"). It was five stacked `builder-cell-style-group`
 * blocks in one narrow column with its own label styling — 1.125rem labels
 * that were allowed to WRAP, against L2 — so a cell editor looked like
 * nothing else in the Builder and read top to bottom in a single file.
 *
 * Reusing `.builder-schema-panel-column` rather than restyling those blocks
 * is the point, exactly as it was for the row editors: the lattice, the
 * shared label/field tracks, the D9 ordering and `npm run check:panels` all
 * arrive with it, and S1 holds — learn one panel, know them all.
 *
 * Axis assignment follows the row panel's vocabulary so the two read the
 * same: spacing and alignment are Placement, everything that paints the box
 * is Frame, and who can see the cell is Visibility.
 */
export function BuilderCellStyleSettings({
  column,
  section,
  editorDevice,
  onUpdateCellBackground,
  onUpdateCellBorderWidth,
  onUpdateCellBorderColor,
  onUpdateCellBorderRadius,
  onSetCellExtra,
  getCellExtra,
  themeBackgroundColor,
  themePrimaryColor,
  themeColors = []
}: BuilderCellStyleSettingsProps) {
  if (editorDevice === "mobile") {
    return (
      <div className="builder-cell-style-settings is-lattice">
        <div className="builder-schema-panel-columns" style={{ "--builder-axis-count": "1" } as CSSProperties}>
          <div className="builder-schema-panel-column">
            <div className="builder-schema-group-title">Visibility</div>
            <BuilderSettingRow label="Hide on Mobile">
              <input
                type="checkbox"
                checked={getCellExtra(column, "cellMobileHidden", "false") === "true"}
                onChange={(event) =>
                  onSetCellExtra(column, "cellMobileHidden", event.target.checked ? "true" : "false")
                }
              />
            </BuilderSettingRow>
          </div>
        </div>
      </div>
    );
  }

  const borderStyle = getCellExtra(column, "cellBorderStyle", "solid");
  const shadow = getCellExtra(column, "cellShadow", "none");
  const opacity = getCellExtra(column, "cellOpacity", "1");
  const hAlign = getCellExtra(column, "cellHAlign", "left");
  const vAlign = getCellExtra(column, "cellVAlign", "top");
  const borderDisabled = borderStyle === "none";
  // What both padding axes read when neither has been set: the one number the
  // cell used to carry for all four sides.
  const legacyPadding = section.cellPadding?.[column] ?? "0";

  return (
    <div className="builder-cell-style-settings is-lattice">
      <div className="builder-schema-panel-columns" style={{ "--builder-axis-count": "3" } as CSSProperties}>
        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Placement</div>
          <BuilderSettingRow label="Horizontal">
            <select value={hAlign} onChange={(event) => onSetCellExtra(column, "cellHAlign", event.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Vertical">
            <select value={vAlign} onChange={(event) => onSetCellExtra(column, "cellVAlign", event.target.value)}>
              <option value="top">Top</option>
              <option value="center">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </BuilderSettingRow>
          {/* W7: these are the only names the four spacing controls may
              carry, and the pair is adjacent (E4). They replaced a single
              "Size" that moved all four sides at once — the dead end being
              that a banner logo could not lose the 18px above it without also
              losing the 18px holding it off the left edge. Both read the
              legacy all-sides number when neither axis has been set. */}
          <BuilderSettingRow label="Vertical Padding">
            <BuilderNumberSelectControl
              value={getCellExtra(column, "cellVerticalPadding", legacyPadding)}
              min={0}
              max={50}
              fallback="0"
              onChange={(value) => onSetCellExtra(column, "cellVerticalPadding", value)}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Horizontal Padding">
            <BuilderNumberSelectControl
              value={getCellExtra(column, "cellHorizontalPadding", legacyPadding)}
              min={0}
              max={50}
              fallback="0"
              onChange={(value) => onSetCellExtra(column, "cellHorizontalPadding", value)}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Vertical Margin">
            <BuilderNumberSelectControl
              value={getCellExtra(column, "cellVerticalMargin", "0")}
              min={0}
              max={160}
              fallback="0"
              onChange={(value) => onSetCellExtra(column, "cellVerticalMargin", value)}
            />
          </BuilderSettingRow>
        </div>

        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Frame</div>
          {/* D9, blast radius descending: the fill moves the most, then how
              much of it shows, then the border — style first because it gates
              width and colour — and the shadow last. */}
          <BuilderBackgroundControls
            label="Background"
            background={section.cellBackgrounds[column] ?? createDefaultBackgroundSettings()}
            horizontal
            onChange={(updater) => onUpdateCellBackground(column, updater)}
            themeBackgroundColor={themeBackgroundColor}
            themeColors={themeColors}
            themePrimaryColor={themePrimaryColor}
          />
          <BuilderSettingRow label="Opacity">
            <BuilderNumberSelectControl
              value={opacityPercentValue(opacity)}
              min={0}
              max={100}
              fallback="100"
              onChange={(value) => onSetCellExtra(column, "cellOpacity", opacityFromPercent(value))}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Border Style">
            <select
              value={borderStyle}
              onChange={(event) => onSetCellExtra(column, "cellBorderStyle", event.target.value)}
            >
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Border Width">
            <BuilderNumberSelectControl
              disabled={borderDisabled}
              value={section.cellBorderWidth[column] ?? "0"}
              min={0}
              max={20}
              fallback="0"
              onChange={(value) => onUpdateCellBorderWidth(column, value)}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Border Color">
            <BuilderThemeColorField
              disabled={borderDisabled}
              fallback="#d9e4ef"
              themeColors={themeColors}
              value={section.cellBorderColor[column] ?? ""}
              onChange={(hex) => onUpdateCellBorderColor(column, hex)}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Border Radius">
            <BuilderNumberSelectControl
              value={section.cellBorderRadius[column] ?? "0"}
              min={0}
              max={60}
              fallback="0"
              onChange={(value) => onUpdateCellBorderRadius(column, value)}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Shadow">
            <select value={shadow} onChange={(event) => onSetCellExtra(column, "cellShadow", event.target.value)}>
              <option value="none">None</option>
              <option value="light">Light</option>
              <option value="medium">Medium</option>
              <option value="heavy">Heavy</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Visibility</div>
          <BuilderSettingRow label="Access">
            <div className="builder-radio-group">
              <label>
                <input
                  type="radio"
                  name={`cell-visibility-${column}`}
                  value="public"
                  checked={getCellExtra(column, "cellIsPrivate", "false") !== "true"}
                  onChange={() => onSetCellExtra(column, "cellIsPrivate", "false")}
                />
                {" "}Public
              </label>
              <label>
                <input
                  type="radio"
                  name={`cell-visibility-${column}`}
                  value="private"
                  checked={getCellExtra(column, "cellIsPrivate", "false") === "true"}
                  onChange={() => onSetCellExtra(column, "cellIsPrivate", "true")}
                />
                {" "}Private
              </label>
            </div>
          </BuilderSettingRow>
        </div>
      </div>
    </div>
  );
}
