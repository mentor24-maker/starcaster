"use client";

import { useId, useState } from "react";
import { BuilderEditorPopup } from "./builder-editor-popup";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorPickerContent } from "./builder-theme-color-picker-content";

export type BuilderThemePalette = Array<{ label: string; hex: string }>;

type BuilderThemeColorFieldProps = {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  fallback?: string;
  themeColors?: Array<{ label: string; hex: string }>;
  dialogLabel?: string;
  opacity?: number;
  onChangeOpacity?: (opacity: number) => void;
  onClear?: () => void;
};

function resolveHexColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function BuilderThemeColorField({
  value,
  onChange,
  disabled = false,
  fallback = "#000000",
  themeColors = [],
  dialogLabel = "Choose color",
  opacity,
  onChangeOpacity,
  onClear
}: BuilderThemeColorFieldProps) {
  const popupId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const resolved = resolveHexColor(value, fallback);

  function selectColor(hex: string) {
    onChange(hex);
  }

  function handleClear() {
    onClear?.();
    setIsOpen(false);
  }

  return (
    <div className="builder-button-background-picker builder-theme-color-picker">
      <button
        aria-controls={popupId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="builder-button-background-swatch"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        style={{ background: resolved }}
        title={dialogLabel}
        type="button"
      />
      {isOpen ? (
        <BuilderEditorPopup
          ariaLabel={dialogLabel}
          className="builder-theme-color-popup"
          id={popupId}
          onClose={() => setIsOpen(false)}
          title={dialogLabel}
        >
          <div className="builder-button-background-popup-body">
            <BuilderThemeColorPickerContent
              disabled={disabled}
              fallback={fallback}
              themeColors={themeColors}
              value={value}
              opacity={opacity}
              onChangeOpacity={onChangeOpacity}
              onClear={onClear ? handleClear : undefined}
              onChange={selectColor}
            />
          </div>
        </BuilderEditorPopup>
      ) : null}
    </div>
  );
}

type BuilderThemeColorSettingRowProps = {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  themeColors?: BuilderThemePalette;
  fallback?: string;
  dialogLabel?: string;
  fullWidth?: boolean;
};

export function BuilderThemeColorSettingRow({
  label,
  value,
  onChange,
  themeColors = [],
  fallback = "#000000",
  dialogLabel,
  fullWidth
}: BuilderThemeColorSettingRowProps) {
  return (
    <BuilderSettingRow fullWidth={fullWidth} label={label}>
      <BuilderThemeColorField
        dialogLabel={dialogLabel ?? label}
        fallback={fallback}
        themeColors={themeColors}
        value={value}
        onChange={onChange}
      />
    </BuilderSettingRow>
  );
}

type BuilderThemeColorFieldWithDefaultProps = {
  label: string;
  value: string;
  defaultColor: string;
  onChange: (value: string) => void;
  themeColors?: BuilderThemePalette;
  dialogLabel?: string;
  fullWidth?: boolean;
};

/** Theme swatch picker; empty value shows platform/theme default with optional reset. */
export function BuilderThemeColorFieldWithDefault({
  label,
  value,
  defaultColor,
  onChange,
  themeColors = [],
  dialogLabel,
  fullWidth = true
}: BuilderThemeColorFieldWithDefaultProps) {
  const isSet = !!value;

  return (
    <BuilderSettingRow fullWidth={fullWidth} label={label}>
      <div className="builder-nav-color-field">
        <BuilderThemeColorField
          dialogLabel={dialogLabel ?? label}
          fallback={defaultColor}
          themeColors={themeColors}
          value={isSet ? value : defaultColor}
          onChange={onChange}
        />
        {isSet ? (
          <button
            className="builder-nav-color-clear"
            onClick={() => onChange("")}
            title="Reset to default"
            type="button"
          >
            ✕
          </button>
        ) : (
          <span className="builder-nav-color-hint">default</span>
        )}
      </div>
    </BuilderSettingRow>
  );
}
