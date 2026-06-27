"use client";

import { useId, useState } from "react";
import { BuilderEditorPopup } from "./builder-editor-popup";
import { BuilderThemeColorPickerContent } from "./builder-theme-color-picker-content";

type BuilderThemeColorFieldProps = {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  fallback?: string;
  themeColors?: Array<{ label: string; hex: string }>;
  dialogLabel?: string;
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
  dialogLabel = "Choose color"
}: BuilderThemeColorFieldProps) {
  const popupId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const resolved = resolveHexColor(value, fallback);

  function selectColor(hex: string) {
    onChange(hex);
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
              onChange={selectColor}
            />
          </div>
        </BuilderEditorPopup>
      ) : null}
    </div>
  );
}
