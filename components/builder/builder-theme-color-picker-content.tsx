"use client";

import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeSwatches } from "./builder-theme-swatches";

type BuilderThemeColorPickerContentProps = {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  fallback?: string;
  themeColors?: Array<{ label: string; hex: string }>;
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
  themeColors = []
}: BuilderThemeColorPickerContentProps) {
  const resolved = resolveHexColor(value, fallback);

  return (
    <>
      <BuilderThemeSwatches colors={themeColors} onSelect={onChange} />
      <BuilderSettingRow label="Custom" fullWidth>
        <input
          type="color"
          disabled={disabled}
          value={resolved}
          onChange={(event) => onChange(event.target.value)}
        />
      </BuilderSettingRow>
    </>
  );
}
