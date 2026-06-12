"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BuilderSettingRow } from "./builder-setting-row";

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
};

export function getButtonBorderSettings(settings: Record<string, string>): ButtonBorderColorSettings {
  const style = settings.borderStyle as ButtonBorderStyle | undefined;

  return {
    style: style === "none" || style === "dashed" || style === "dotted" ? style : "solid",
    color: settings.borderColor || "#214c71"
  };
}

export function BuilderButtonBorderColorPicker({
  border,
  borderWidth,
  borderRadius,
  disabled = false,
  onChange
}: BuilderButtonBorderColorPickerProps) {
  const popupId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const width = Math.max(Number.parseInt(borderWidth ?? "2", 10) || 0, 0);
  const radius = Math.max(Number.parseInt(borderRadius ?? "0", 10) || 0, 0);
  const swatchStyle = {
    background: "#ffffff",
    borderStyle: border.style === "none" ? "solid" : border.style,
    borderColor: border.style === "none" ? "transparent" : border.color,
    borderWidth: border.style === "none" ? 0 : `${Math.max(width, 2)}px`,
    borderRadius: `${radius}px`
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="builder-button-background-picker" ref={rootRef}>
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
        <div
          className="builder-button-background-popup"
          id={popupId}
          role="dialog"
          aria-label="Button border color"
        >
          <div className="builder-button-background-popup-body">
            <BuilderSettingRow label="Color" fullWidth>
              <input
                type="color"
                value={border.color}
                onChange={(event) => onChange({ ...border, color: event.target.value })}
              />
            </BuilderSettingRow>
          </div>
        </div>
      ) : null}
    </div>
  );
}
