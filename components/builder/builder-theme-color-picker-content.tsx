"use client";

import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeSwatches } from "./builder-theme-swatches";

type BuilderThemeColorPickerContentProps = {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  fallback?: string;
  themeColors?: Array<{ label: string; hex: string }>;
  opacity?: number;
  onChangeOpacity?: (opacity: number) => void;
  onClear?: () => void;
};

function resolveHexColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/** Inline theme palette swatches plus a custom color input. */
export function BuilderThemeColorPickerContent({
  value,
  onChange,
  disabled = false,
  fallback = "#000000",
  themeColors = [],
  opacity,
  onChangeOpacity,
  onClear
}: BuilderThemeColorPickerContentProps) {
  const resolved = resolveHexColor(value, fallback);

  return (
    <>
      <BuilderThemeSwatches colors={themeColors} onSelect={onChange} showLabels />
      <BuilderSettingRow label="Custom" fullWidth>
        <input
          type="color"
          disabled={disabled}
          value={resolved}
          onChange={(event) => onChange(event.target.value)}
        />
      </BuilderSettingRow>
      {opacity !== undefined && onChangeOpacity ? (
        <BuilderSettingRow label="Opacity" fullWidth>
          <div className="builder-background-opacity-row">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              value={opacity}
              onChange={(event) => onChangeOpacity(Number(event.target.value))}
            />
            <span className="builder-background-opacity-value">{opacity}%</span>
          </div>
        </BuilderSettingRow>
      ) : null}
      {onClear ? (
        <BuilderSettingRow label="None" fullWidth>
          <button className="secondary-button" disabled={disabled} onClick={onClear} type="button">
            Clear color
          </button>
        </BuilderSettingRow>
      ) : null}
    </>
  );
}
