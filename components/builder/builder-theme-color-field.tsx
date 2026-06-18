"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeSwatches } from "./builder-theme-swatches";

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const resolved = resolveHexColor(value, fallback);

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

  function selectColor(hex: string) {
    onChange(hex);
  }

  return (
    <div className="builder-button-background-picker builder-theme-color-picker" ref={rootRef}>
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
        <div
          className="builder-button-background-popup builder-theme-color-popup"
          id={popupId}
          role="dialog"
          aria-label={dialogLabel}
        >
          <div className="builder-button-background-popup-body">
            <BuilderThemeSwatches colors={themeColors} onSelect={selectColor} />
            <BuilderSettingRow label="Custom" fullWidth>
              <input
                type="color"
                value={resolved}
                onChange={(event) => selectColor(event.target.value)}
              />
            </BuilderSettingRow>
          </div>
        </div>
      ) : null}
    </div>
  );
}
