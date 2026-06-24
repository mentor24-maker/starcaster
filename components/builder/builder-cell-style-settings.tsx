"use client";

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
  onUpdateCellPadding: (column: string, value: string) => void;
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

export function BuilderCellStyleSettings({
  column,
  section,
  editorDevice,
  onUpdateCellBackground,
  onUpdateCellPadding,
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
      <div className="builder-cell-style-settings">
        <BuilderSettingRow label="Hide on Mobile" fullWidth>
          <input
            type="checkbox"
            checked={getCellExtra(column, "cellMobileHidden", "false") === "true"}
            onChange={(event) =>
              onSetCellExtra(column, "cellMobileHidden", event.target.checked ? "true" : "false")
            }
          />
        </BuilderSettingRow>
      </div>
    );
  }

  const borderStyle = getCellExtra(column, "cellBorderStyle", "solid");
  const shadow = getCellExtra(column, "cellShadow", "none");
  const opacity = getCellExtra(column, "cellOpacity", "1");
  const hAlign = getCellExtra(column, "cellHAlign", "left");
  const vAlign = getCellExtra(column, "cellVAlign", "top");
  const borderDisabled = borderStyle === "none";

  return (
    <div className="builder-cell-style-settings">
      <div className="builder-cell-style-group">
        <div className="builder-cell-style-group-label">Border</div>
        <BuilderSettingRow label="Style" fullWidth>
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
        <BuilderSettingRow label="Width" fullWidth>
          <BuilderNumberSelectControl
            disabled={borderDisabled}
            value={section.cellBorderWidth[column] ?? "0"}
            min={0}
            max={20}
            fallback="0"
            onChange={(value) => onUpdateCellBorderWidth(column, value)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Color" fullWidth>
          <BuilderThemeColorField
            disabled={borderDisabled}
            fallback="#d9e4ef"
            themeColors={themeColors}
            value={section.cellBorderColor[column] ?? ""}
            onChange={(hex) => onUpdateCellBorderColor(column, hex)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Radius" fullWidth>
          <BuilderNumberSelectControl
            value={section.cellBorderRadius[column] ?? "24"}
            min={0}
            max={60}
            fallback="24"
            onChange={(value) => onUpdateCellBorderRadius(column, value)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Shadow" fullWidth>
          <select value={shadow} onChange={(event) => onSetCellExtra(column, "cellShadow", event.target.value)}>
            <option value="none">None</option>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="heavy">Heavy</option>
          </select>
        </BuilderSettingRow>
      </div>

      <div className="builder-cell-style-group">
        <div className="builder-cell-style-group-label">Background</div>
        <BuilderBackgroundControls
          label="Background"
          background={section.cellBackgrounds[column] ?? createDefaultBackgroundSettings()}
          horizontal
          onChange={(updater) => onUpdateCellBackground(column, updater)}
          themeBackgroundColor={themeBackgroundColor}
          themeColors={themeColors}
          themePrimaryColor={themePrimaryColor}
        />
        <BuilderSettingRow label="Opacity" fullWidth>
          <BuilderNumberSelectControl
            value={opacityPercentValue(opacity)}
            min={0}
            max={100}
            fallback="100"
            onChange={(value) => onSetCellExtra(column, "cellOpacity", opacityFromPercent(value))}
          />
        </BuilderSettingRow>
      </div>

      <div className="builder-cell-style-group">
        <div className="builder-cell-style-group-label">Padding</div>
        <BuilderSettingRow label="Size" fullWidth>
          <BuilderNumberSelectControl
            value={section.cellPadding[column] ?? "18"}
            min={0}
            max={50}
            fallback="18"
            onChange={(value) => onUpdateCellPadding(column, value)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Vertical Margin" fullWidth>
          <BuilderNumberSelectControl
            value={getCellExtra(column, "cellVerticalMargin", "0")}
            min={0}
            max={160}
            fallback="0"
            onChange={(value) => onSetCellExtra(column, "cellVerticalMargin", value)}
          />
        </BuilderSettingRow>
      </div>

      <div className="builder-cell-style-group">
        <div className="builder-cell-style-group-label">Alignment</div>
        <BuilderSettingRow label="Horizontal" fullWidth>
          <select value={hAlign} onChange={(event) => onSetCellExtra(column, "cellHAlign", event.target.value)}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </BuilderSettingRow>
        <BuilderSettingRow label="Vertical" fullWidth>
          <select value={vAlign} onChange={(event) => onSetCellExtra(column, "cellVAlign", event.target.value)}>
            <option value="top">Top</option>
            <option value="center">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </BuilderSettingRow>
      </div>

      <div className="builder-cell-style-group">
        <div className="builder-cell-style-group-label">Visibility</div>
        <BuilderSettingRow label="Access" fullWidth>
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
  );
}
