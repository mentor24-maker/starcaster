"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BuilderSettingRow } from "./builder-setting-row";

export type ButtonTextColorSettings = {
  color: string;
  hoverColor: string;
};

const textColorTabs = [
  { value: "color", label: "Color" },
  { value: "hover", label: "Hover" }
] as const;

type TextColorTab = (typeof textColorTabs)[number]["value"];

type BuilderButtonTextColorPickerProps = {
  colors: ButtonTextColorSettings;
  onChange: (colors: ButtonTextColorSettings) => void;
};

export function getButtonTextColorSettings(settings: Record<string, string>): ButtonTextColorSettings {
  return {
    color: settings.textColor || "#ffffff",
    hoverColor: settings.textHoverColor || "#ffffff"
  };
}

export function BuilderButtonTextColorPicker({ colors, onChange }: BuilderButtonTextColorPickerProps) {
  const popupId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TextColorTab>("color");

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
        className="builder-button-background-swatch"
        onClick={() => setIsOpen((current) => !current)}
        style={{ background: colors.color }}
        title="Edit text color and hover color"
        type="button"
      />
      {isOpen ? (
        <div
          className="builder-button-background-popup"
          id={popupId}
          role="dialog"
          aria-label="Button text color"
        >
          <div className="builder-button-background-mode-tabs" role="tablist" aria-label="Text color options">
            {textColorTabs.map((tab) => (
              <button
                key={tab.value}
                aria-selected={activeTab === tab.value}
                className={
                  activeTab === tab.value
                    ? "builder-button-background-mode-tab builder-button-background-mode-tab-active"
                    : "builder-button-background-mode-tab"
                }
                onClick={() => setActiveTab(tab.value)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="builder-button-background-popup-body">
            {activeTab === "color" ? (
              <BuilderSettingRow label="Color" fullWidth>
                <input
                  type="color"
                  value={colors.color}
                  onChange={(event) => onChange({ ...colors, color: event.target.value })}
                />
              </BuilderSettingRow>
            ) : null}
            {activeTab === "hover" ? (
              <BuilderSettingRow label="Hover" fullWidth>
                <input
                  type="color"
                  value={colors.hoverColor}
                  onChange={(event) => onChange({ ...colors, hoverColor: event.target.value })}
                />
              </BuilderSettingRow>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
