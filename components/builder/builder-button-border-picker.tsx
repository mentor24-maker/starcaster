"use client";

import { useId, useState } from "react";
import { BuilderEditorPopup } from "./builder-editor-popup";
import { BuilderThemeColorPickerContent } from "./builder-theme-color-picker-content";

export type ButtonBorderStyle = "none" | "solid" | "dashed" | "dotted";

export type ButtonBorderColorSettings = {
  style: ButtonBorderStyle;
  color: string;
};

export const borderStyleOptions: Array<{ value: ButtonBorderStyle; label: string }> = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" }
];

type BuilderButtonBorderColorPickerProps = {
  border: ButtonBorderColorSettings;
  borderWidth: string;
  borderRadius: string;
  disabled?: boolean;
  onChange: (border: ButtonBorderColorSettings) => void;
  themeColors?: Array<{ label: string; hex: string }>;
};

export function getButtonBorderSettings(settings: Record<string, string>): ButtonBorderColorSettings {
  const style = settings.borderStyle as ButtonBorderStyle | undefined;

  const color = settings.borderColor;

  return {
    style: style === "none" || style === "dashed" || style === "dotted" ? style : "solid",
    color: color === "transparent" ? "transparent" : color || "#214c71"
  };
}

export function BuilderButtonBorderColorPicker({
  border,
  borderWidth,
  borderRadius,
  disabled = false,
  onChange,
  themeColors = []
}: BuilderButtonBorderColorPickerProps) {
  const popupId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const width = Math.max(Number.parseInt(borderWidth ?? "2", 10) || 0, 0);
  const radius = Math.max(Number.parseInt(borderRadius ?? "0", 10) || 0, 0);
  const isTransparentBorder = border.color === "transparent" || border.style === "none";
  const swatchStyle = {
    background: border.color === "transparent"
      ? "linear-gradient(135deg, transparent 46%, #c94a4a 46%, #c94a4a 54%, transparent 54%), #ffffff"
      : "#ffffff",
    borderStyle: border.style === "none" ? "solid" : border.style,
    borderColor: isTransparentBorder ? "transparent" : border.color,
    borderWidth: border.style === "none" ? 0 : `${Math.max(width, 2)}px`,
    borderRadius: `${radius}px`
  };

  return (
    <div className="builder-button-background-picker">
      <button
        aria-controls={popupId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="builder-button-background-swatch builder-button-border-swatch"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        style={swatchStyle}
        title="Edit border color"
        type="button"
      />
      {isOpen ? (
        <BuilderEditorPopup
          ariaLabel="Button border color"
          className="builder-theme-color-popup"
          id={popupId}
          onClose={() => setIsOpen(false)}
          title="Border Color"
        >
          <div className="builder-button-background-popup-body">
            <BuilderThemeColorPickerContent
              disabled={disabled}
              fallback="#214c71"
              themeColors={themeColors}
              value={border.color === "transparent" ? "" : border.color}
              onChange={(color) => onChange({ ...border, color })}
              onClear={() => {
                onChange({ ...border, color: "transparent" });
                setIsOpen(false);
              }}
            />
            <div className="builder-button-background-popup-actions">
              <button className="submit-button" onClick={() => setIsOpen(false)} type="button">
                Done
              </button>
            </div>
          </div>
        </BuilderEditorPopup>
      ) : null}
    </div>
  );
}
